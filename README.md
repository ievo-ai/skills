# iEvo — Self-Evolving Plugin for Claude Code

> Discover relevant skills + agents for your project, audit them for safety, install with project-scope portability. Capture lessons as overlays that survive upstream updates.

iEvo is a discovery + safety + evolution layer on top of [skills.sh](https://www.skills.sh) and the Claude Code plugin ecosystem.

## Quick start

```bash
# 1. Install find-skills (prereq) and the iEvo plugin
npx skills add vercel-labs/skills --skill find-skills
/plugin marketplace add ievo-ai/skills
/plugin install ievo@ievo-skills
/reload-plugins

# 2. Initialize in your project
cd <your-project>
/ievo:init
```

`/ievo:init` will ask you to add Bash permissions for `npx skills` and `gh` commands on first run — say yes (`Add to .claude/settings.local.json` recommended) to avoid each network call needing manual approval.

That's it. Interactive interview, security checks, install. Then `/reload-plugins` to activate.

### Permission pre-setup (optional, skips the prompt)

If you want to set permissions before running `/ievo:init`, add to `.claude/settings.local.json` (per-user, gitignored — recommended) or `.claude/settings.json` (team-shared, committed):

```json
{
  "permissions": {
    "allow": [
      "Bash(npx skills*)",
      "Bash(npx -y skills*)",
      "Bash(gh api*)",
      "Bash(gh search*)"
    ]
  }
}
```

Without these, Claude Code's auto-mode classifier blocks each `npx skills` / `gh api` call as "untrusted network command" — works but with manual Allow prompts.

## The pipeline

`/ievo:init` composes 4 stages:

```
find-skills (vercel-labs)  →  index-repos (ours)  →  security-check (ours)  →  install
   discovery                    enumerate full         per-item audit          two paths
                                content per repo       with fallback
```

1. **find-skills** queries skills.sh for skill candidates based on your project's stack.
2. **index-repos** scans the FULL content of every unique repo from step 1 — finds plugins, agents, hooks, commands that skills.sh didn't index.
3. **security-check** audits each candidate the user selects — combines skills.sh's Snyk/Socket/Gen Agent Trust Hub audits with our own content scan (hooks, allowed-tools, prompts) and repo metadata.
4. **install** runs two paths:
   - **Vendor** (skills + agents): `gh api fetch` → write to `.claude/<type>/` → inject overlay marker
   - **Plugin install** (anything with hooks/MCP/commands): edit `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins` for team-portable activation

## Commands & Skills

### Skills (auto-activatable, cross-platform via agentskills.io)

| Skill | What it does |
|-------|--------------|
| `/ievo:init` | Full pipeline: discover, audit, install |
| `/ievo:evolution "<lesson>"` | Capture a lesson — append to overlay file. Never modifies agent/skill body. |
| `/ievo:feedback` | Submit bug/idea/skip-reasons as GitHub issue |
| `/ievo:index-repos` | Standalone: enumerate a repo (callable on its own) |
| `/ievo:security-check` | Standalone: audit a specific skill/agent/plugin |

### Commands (strictly explicit, Claude Code-specific)

| Command | What it does |
|---------|--------------|
| `/ievo:uninstall` | Remove markers from CLAUDE.md/AGENTS.md and `.claude/agents/`, `.claude/skills/`. Preserves `.ievo/`. |
| `/ievo:update` | Refresh vendored agent/skill files from upstream. Re-inject markers. Overlay files untouched. |

## The overlay model

Under v0.2.0, **agent and skill files are never modified by evolution**. Lessons accumulate in separate **overlay files**, read live at every dispatch.

When you vendor an agent (via `/ievo:init`) or evolve it (via `/ievo:evolution`):

1. **Local file** (`.claude/agents/<name>.md`) gets a ONE-TIME marker block right after its frontmatter:
   ```markdown
   <!-- ievo:start -->
   **Before applying the instructions below**, read `.ievo/evolution/agents/<name>.md` if it exists, and apply ALL rules from its sections IN ADDITION to the instructions below.
   <!-- ievo:end -->
   ```
2. **Overlay file** (`.ievo/evolution/agents/<name>.md`) holds the accumulated rules:
   ```markdown
   ---
   source:
     repo: wshobson/agents
     path: plugins/python-development/agents/python-pro.md
     commit_sha: a1b2c3d4
     fetched_at: 2026-05-18T10:00:00Z
   ---

   # python-pro — Evolution Overlay

   ## 2026-05-19 14:32 UTC — Check git status before commit
   **Trigger:** user-observed mistake during code review

   Always check `git status` before commits to avoid orphaned files.
   ```

When the agent is dispatched, Claude reads both files automatically — the agent body's instructions and the overlay's accumulated rules.

**Why this matters:**
- Upstream updates are trivial: `/ievo:update` re-fetches the file and re-injects the marker. Overlay rules continue applying.
- No drift, no Opus replay loop, no patches accumulating in the agent body.
- Overlay file is the **single source of truth** for evolution. Easy to audit, easy to share via git.

## Project-side layout

After `/ievo:init` with some skills/agents vendored and some plugins installed:

```
<your-project>/
├── CLAUDE.md                        # (if first project-wide evolution recorded — gets marker block)
├── .claude/
│   ├── settings.json                # NEW: plugin marketplaces + enabledPlugins (commit for team sync)
│   ├── agents/
│   │   └── python-pro.md            # vendored, has overlay marker
│   └── skills/
│       └── changelog/
│           └── SKILL.md             # vendored, has overlay marker
└── .ievo/
    ├── evolution/                   # COMMIT to git — project's evolution state
    │   ├── project.md
    │   ├── agents/
    │   │   └── python-pro.md        # overlay file — actual rules live here
    │   └── skills/
    │       └── changelog.md
    ├── cache/                       # GITIGNORE — re-derivable
    │   └── index/
    │       └── wshobson-agents.md
    └── log/                         # GITIGNORE — local diagnostic
        └── init-20260518-093613.md
```

`/ievo:init` adds the right `.gitignore` entries automatically if your project has a `.gitignore`.

## Security model

`security-check` runs per selected candidate before install. Risk tiers:

| Tier | What | UX |
|------|------|-----|
| 🟢 GREEN | All skills.sh audits pass + no risky content patterns + trusted repo signals | silent auto-install |
| 🟡 YELLOW | Audit warning, has scripts/, has non-tool hooks, young repo | brief note + install confirm |
| 🔴 RED | Audit FAIL, has PreToolUse/UserPromptSubmit hooks, broad Bash permissions, suspicious prompts | strict review: show alternatives or force-install |

What we layer on top of skills.sh:
- **Hooks scan** — skills.sh doesn't expose hook presence; we flag PreToolUse / UserPromptSubmit as RED (they intercept every tool call / user input)
- **Permission analysis** — `allowed-tools: Bash(*)` etc. flagged
- **Prompt injection signatures** — known suspicious patterns
- **Agent vendoring** — skills.sh doesn't audit agents at all; our scan covers them

## Install paths

iEvo supports two install paths per candidate:

### Vendor (skills + agents)

- `gh api` fetches the source file/directory.
- Writes to `.claude/<type>/<name>/` in your project.
- Injects the overlay marker.
- Creates `.ievo/evolution/<scope>/<name>.md` with source metadata frontmatter.
- **No hooks, no MCP, no commands** come along — just the agent/skill content.
- Best for: pulling specific agents/skills without committing to a whole plugin.

### Plugin install (anything with hooks / MCP / commands)

- Edits `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins`.
- Settings file is committed to git → team gets prompt to trust folder → plugin auto-installs for them too.
- Brings everything: agents, skills, commands, hooks, MCP servers.
- Best for: plugins where the value is the integration (hooks intercepting workflows, MCP servers, slash commands).

The interview at `/ievo:init` step 7b asks per candidate: vendor specific items OR install whole plugin OR skip.

## Repository structure

```
ievo-ai/skills/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
└── plugins/ievo/
    ├── .claude-plugin/plugin.json
    ├── commands/
    │   ├── uninstall.md
    │   └── update.md
    ├── skills/
    │   ├── init/SKILL.md           # /ievo:init — orchestrator
    │   ├── evolution/SKILL.md      # /ievo:evolution — overlay capture
    │   ├── feedback/SKILL.md       # /ievo:feedback — file GitHub issues
    │   ├── index-repos/SKILL.md    # /ievo:index-repos — enumerate a repo
    │   └── security-check/SKILL.md # /ievo:security-check — audit a candidate
    └── agents/
        └── evolution.md            # sub-agent dispatched by evolution skill
```

## Standards compliance

- Plugin format: Claude Code-native
- Skills inside: [agentskills.io spec](https://agentskills.io/specification) — portable to Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, 30+ other agent platforms
- Distribution: dual-mode — Claude Code plugin install OR `npx skills add ievo-ai/skills --skill <name>` via [skills.sh](https://www.skills.sh)

## Roadmap

- **v0.2 (this release):** Full pipeline (find-skills → index-repos → security-check → install). Overlay model for evolutions. Two install paths.
- **v0.3:** Cortex A/B validation gate. Mutations that don't improve get rejected via blind evaluation.
- **v1.0:** Cross-project pattern detection (curator). Lessons that recur across projects get promoted to "blessed" upstream evolutions.

## Acknowledgments

- [find-skills](https://github.com/vercel-labs/skills) — vercel-labs's skill discovery (we use it as the bootstrap for our pipeline)
- [agentskills.io](https://agentskills.io) — the open standard for skills

## License

MIT. See `LICENSE`.
