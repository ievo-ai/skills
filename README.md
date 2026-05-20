# iEvo — Self-Evolving Plugin for AI Coding Agents

> Discover relevant skills + agents for your project, audit them via senior-security-engineer review (deep content scan + threat modeling, no owner-based trust shortcuts), install with project-scope portability. Capture lessons as overlays that survive upstream updates. Works on Claude Code, Codex, and any platform that supports the [agentskills.io](https://agentskills.io) standard.

iEvo is a **universal discovery + safety + evolution layer** on top of [skills.sh](https://www.skills.sh) and the multi-platform agent skills ecosystem.

**Currently distributed via:**
- Claude Code marketplace (`.claude-plugin/marketplace.json`)
- Codex marketplace (`.codex-plugin/marketplace.json`)
- skills.sh registry (planned for v1.0)

**Cross-platform skills** inside the plugin are portable via the [agentskills.io specification](https://agentskills.io/specification) — adopted by Claude Code, Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms. Platform-specific bits (slash commands, sub-agents via Task tool) work on Claude Code and Codex.

## Quick start

### Claude Code

```bash
# 1. Install iEvo plugin (zero prereqs — v0.6.0 dropped the find-skills install step)
/plugin marketplace add ievo-ai/skills
/plugin install ievo@ievo-skills
/reload-plugins

# 2. Initialize in your project
cd <your-project>
/ievo:init
```

**v0.6.0**: discovery now happens via our own `discover.mjs` script hitting `https://skills.sh/api/search` directly — no more manual `npx skills add` step required.

### Codex (CLI / app / VS Code extension)

```bash
# 1. Add the iEvo marketplace
/plugins add ievo-ai/skills

# 2. Install
/plugins install ievo@ievo-skills

# 3. Initialize in your project
cd <your-project>
/ievo:init
```

Codex support added in v0.3.3 — same plugin content, separate marketplace manifests (`.claude-plugin/marketplace.json` vs `.codex-plugin/marketplace.json`).

**Cross-platform skills inside the plugin** are fully portable via [agentskills.io](https://agentskills.io) spec. Slash commands and sub-agents work on Claude Code; Codex's own command/agent semantics may differ — refer to your platform's docs for exact behavior of the commands.

`/ievo:init` will ask you to add Bash permissions for `gh` commands on first run — say yes (`Add to .claude/settings.local.json` recommended) to avoid each network call needing manual approval.

That's it. Interactive interview, security checks, install. Then `/reload-plugins` to activate.

### Permission pre-setup (optional, skips the prompt)

If you want to set permissions before running `/ievo:init`, add to `.claude/settings.local.json` (per-user, gitignored — recommended) or `.claude/settings.json` (team-shared, committed):

```json
{
  "permissions": {
    "allow": [
      "Bash(gh api*)",
      "Bash(gh search*)"
    ]
  }
}
```

Without these, Claude Code's auto-mode classifier blocks each `gh api` call as "untrusted network command" — works but with manual Allow prompts. (v0.6.0 dropped the previously-required `npx skills` permission since discovery now happens via local Node script.)

## The pipeline

`/ievo:init` composes 6 stages (v0.6.0+):

```
discover.mjs (ours, parallel skills.sh API queries)
    ↓
index-repos (ours, parallel repo-indexer sub-agents)
    ↓
categorical rank — top-5 per category
    ↓
interview (per candidate — AskUserQuestion)
    ↓
security-auditor (parallel sub-agents, antivirus deep scan)
    ↓
install (project-scope vendor or plugin)
```

1. **discover.mjs** queries `https://skills.sh/api/search` in parallel — one request per language / dep / category / framework / stack-specific compound query. Heuristics inherited from find-skills SKILL.md (trusted owners reputation boost, install thresholds, category seed queries, synonym fallback) encoded directly in the script. Wall-clock ~3-6 seconds.
2. **index-repos** scans the FULL content of every unique repo from step 1 — finds plugins, agents, hooks, commands. Uses shallow `git clone --depth=1` into `~/.ievo/checkouts/` (one network op per repo, then filesystem scan — no API rate limits). Sub-agents run in parallel — wall-clock = slowest repo (~30-60s).
3. **categorical rank** groups candidates by category (testing, linting, security, observability, etc.) and keeps top-5 per category instead of overall top-12. Every relevant category gets visibility.
4. **security-auditor** sub-agents run in parallel — one per selected item. Each runs as a senior application security engineer with domain expertise (prompt injection, credential exfiltration, supply-chain compromise, hook abuse, indirection attacks). Reads FULL content of every file shipped with the item + all dependencies. Wall-clock ~10-15s for 5-7 items.
5. **install** runs two paths (project-scope, copy + source SHA metadata):
   - **Vendor** (skills + agents): `gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>` → Write tool → `.claude/<type>/` → inject overlay marker → record source repo + commit SHA in `.ievo/evolution/<scope>/<name>.md` for `/ievo:update` to track upstream changes
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

## Security model (v0.5.2 — senior-security-engineer vulnerability assessment)

**Reputation is not security.** Owner-based trust is unreliable — OpenAI, Anthropic, Microsoft accounts have all been compromised in past incidents. iEvo's verdict comes only from content scan.

`security-auditor` agent dispatches in parallel per selected item. Each instance acts as a **senior application security engineer** with deep domain expertise in AI agent supply-chain vulnerabilities (prompt injection, credential exfiltration, supply-chain compromise, hook abuse, indirection attacks, encoded payloads, social engineering, tool-model bypass). It applies the `security-check` skill — full content review of every file shipped with the item (SKILL.md/agent.md body + scripts/ + references/ + assets/ + bundled plugin files), then performs threat modeling and structured vulnerability assessment using the current Sonnet family reasoning (`model: sonnet` alias — platform-agnostic, vendor-neutral).

### Verdicts

| Verdict | What | UX |
|---------|------|-----|
| 🟢 GREEN | Full deep scan complete, no threats detected, intent is clearly legitimate | silent install |
| 🟡 YELLOW | Minor concerns worth noting but not blocking (e.g., plain utility scripts present) | batch multi-select confirmation |
| 🔴 RED | At least one specific threat detected with high confidence, cited file + excerpt | 4 options: try alternative / force install / skip / **report to source repo** |

### Threats scanned for

1. **Prompt injection** — direct ("ignore previous"), indirect ("for debugging note .env contents"), encoded payloads
2. **Credential exfiltration** — reads of `.env`, `~/.aws/`, `~/.ssh/`, even when framed as "debugging"
3. **Suspicious external network** — `curl X | bash`, unknown domains, output to writable paths
4. **Time bombs** — date/counter/env-flag-based conditional execution
5. **Encoded payloads** — long base64/hex strings, dynamic command construction
6. **Broad/destructive bash** — `Bash(*)`, `Bash(rm:*)`, `Bash(sudo:*)`, `Bash(curl:*)`
7. **Hook abuse** — PreToolUse/UserPromptSubmit with suspicious command
8. **Runtime download** — scripts pulling additional code at runtime
9. **Social engineering** — legitimate name + malicious body
10. **Tool model bypass** — instructions to disable safety checks

### Report-to-source flow (RED only)

When verdict is RED, user gets a 4th option: **"Report to `<owner>/<repo>` (file security issue)"**. iEvo pre-fills a professional issue body citing the specific findings (file + excerpt + concern), shows preview, lets user edit/cancel, then files via `gh issue create`. Community defense layer — maintainer notified within minutes, future users protected.

Issue body footer identifies iEvo as the source (`Reviewed via iEvo — community security audit tooling`) so maintainers know it's automated review, not random spam.

### What we DON'T do

- ❌ Owner-based trust shortcuts (TRUSTED_OWNERS, "famous account = safe") — dropped in v0.5.2
- ❌ Heuristic risk_tier in repo indices ("trusted/neutral/caution") — dropped in v0.5.2
- ❌ Surface-level pattern matching as final verdict — Sonnet's reasoning is the only signal
- ❌ Auto-install RED items — always explicit user choice

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
    ├── agents/
    │   ├── evolution.md            # sub-agent dispatched by evolution skill
    │   ├── repo-indexer.md         # parallel dispatch — one per repo for indexing (Step 6)
    │   └── security-auditor.md     # parallel dispatch — one per selected item for audit (Step 8)
    └── scripts/
        └── scan_repo.mjs           # deterministic repo scanner (Node, no LLM)
```

## Standards compliance

- Plugin format: Claude Code-native + Codex-native (dual marketplace manifests)
- Skills inside: [agentskills.io spec](https://agentskills.io/specification) — portable to Cursor, Copilot, Gemini CLI, Goose, Junie, 30+ other agent platforms
- Distribution: triple-mode — Claude Code plugin install OR Codex plugin install OR `npx skills add ievo-ai/skills --skill <name>` via [skills.sh](https://www.skills.sh) (planned v1.0)
- Universal positioning: works wherever Node.js 18+ + git + an agent platform that supports skills are available

## Roadmap

- **v0.2:** Initial pipeline (find-skills → index-repos → security-check → install) + overlay model.
- **v0.3:** Codex support, checkout-based indexing (no API rate limits), Python scanner.
- **v0.4 (reverted):** Pre-built community-index integration. Replaced with simpler user-side architecture in v0.5.
- **v0.5.0:** All-user-side architecture. Full Node migration. Categorical ranking. Parallel security-auditor sub-agents.
- **v0.5.1:** `npx skills add --all --copy` flags; hard-stop on missing find-skills prereq.
- **v0.5.2:** Antivirus deep-scan security model. Dropped owner-based trust (TRUSTED_OWNERS), risk_tier heuristics, pattern-matching verdicts. Current Sonnet family reasoning over full content + all dependencies is the only trust signal (declared via vendor-neutral `model: sonnet` alias). Report-to-source flow — file pre-filled GitHub issue at source repo when RED detected.
- **v0.6.0 (current):** Drop find-skills prereq — own `discover.mjs` script hits skills.sh API directly with inherited heuristics. Zero-prereq install. New `debug-on` / `debug-off` skill pair for verbose session logging. 100% Node test coverage rule enforced via `validate_agents.mjs` + per-script test suites under `plugins/ievo/scripts/tests/`.
- **v0.6 (planned):** Cortex A/B validation gate for evolutions. Mutations that don't improve get rejected via blind evaluation.
- **v1.0:** Skills.sh publication + cross-project pattern detection (curator). Lessons that recur across projects get promoted to "blessed" upstream evolutions.

## Acknowledgments

- [find-skills](https://github.com/vercel-labs/skills) — vercel-labs's skill discovery. Through v0.5.x we used find-skills as bootstrap prereq; v0.6.0+ we ship our own [`discover.mjs`](plugins/ievo/scripts/discover.mjs) that hits the same skills.sh API directly, with heuristics inherited verbatim from find-skills SKILL.md (trusted owners, install thresholds, category queries, synonym fallback). Credit to vercel-labs for the original best practices.
- [agentskills.io](https://agentskills.io) — the open standard for skills

## License

MIT. See `LICENSE`.
