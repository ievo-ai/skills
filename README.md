# iEvo — Self-Evolving Plugin for AI Coding Agents

> ⚠️ **Alpha** — iEvo is in active early development (see [`marketplace.json`](.claude-plugin/marketplace.json) for the current version — this file is not the source of truth and goes stale between releases). The pipeline works end-to-end and individual skills are tested, but APIs, file layouts, and behaviour can change between minor versions. Pin to a specific `marketplace.json` version if you need stability. v1.0 will be the first stable release.

> Discover relevant skills + agents for your project, audit them via senior-security-engineer review (deep content scan + threat modeling, no owner-based trust shortcuts), install with project-scope portability. Capture lessons as overlays that survive upstream updates. Works on Claude Code, Codex, and any platform that supports the [agentskills.io](https://agentskills.io) standard.

iEvo is a **universal discovery + safety + evolution layer** on top of [skills.sh](https://www.skills.sh) and the multi-platform agent skills ecosystem.

**Currently distributed via:**
- Claude Code marketplace (`.claude-plugin/marketplace.json`)
- Codex marketplace (`.codex-plugin/marketplace.json`)
- skills.sh registry (planned for v1.0)

**Cross-platform skills** inside the plugin are portable via the [agentskills.io specification](https://agentskills.io/specification) — adopted by Claude Code, Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms. Platform-specific bits (slash commands, sub-agents via Task tool) work on Claude Code and Codex.

## Contents

- [Quick start](#quick-start)
- [The pipeline](#the-pipeline)
- [Commands & Skills](#commands--skills)
- [The overlay model](#the-overlay-model)
- [Project-side layout](#project-side-layout)
- [Security model](#security-model-v052--senior-security-engineer-vulnerability-assessment)
- [Install paths](#install-paths)
- [Repository structure](#repository-structure)
- [Standards compliance](#standards-compliance)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)
- [License](#license)

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

### Keep iEvo up to date

iEvo ships as a Claude Code / Codex **plugin**, so let the host keep it current instead of manually re-installing.

**Claude Code — enable native auto-update (recommended).** Third-party marketplaces like iEvo have plugin auto-update **disabled by default** — only Anthropic's official marketplace auto-updates out of the box ([plugins docs](https://code.claude.com/docs/en/discover-plugins#configure-auto-updates)). Turn it on once and Claude Code refreshes the marketplace and updates the iEvo plugin at startup, then prompts you to run `/reload-plugins`:

1. Run `/plugin`
2. Open the **Marketplaces** tab
3. Select the `ievo-skills` marketplace
4. Choose **Enable auto-update**

For **team / managed installs**, an administrator can set `"autoUpdate": true` on the iEvo entry in `extraKnownMarketplaces` (managed settings) so everyone gets updates without toggling:

```json
{
  "extraKnownMarketplaces": {
    "ievo-skills": {
      "source": { "source": "github", "repo": "ievo-ai/skills" },
      "autoUpdate": true
    }
  }
}
```

With auto-update off you can still update manually by re-running `/plugin install ievo@ievo-skills` (then `/reload-plugins`). To keep plugin auto-updates while disabling Claude Code's own updater, set `FORCE_AUTOUPDATE_PLUGINS=1` alongside `DISABLE_AUTOUPDATER`.

> **Optional nudge.** If you prefer to keep auto-update off, `/ievo:hooks-setup` can install a fail-silent `SessionStart` hook that checks the marketplace at most once per day and — only when your installed version is behind — reminds you to update. See [hooks-setup](plugins/ievo/skills/hooks-setup/SKILL.md).

**Codex** tracks plugin versions via git refs/tags in the marketplace `source` block — re-run the marketplace add/install to pick up a newer ref.

**Cross-platform skills inside the plugin** are fully portable via [agentskills.io](https://agentskills.io) spec. Slash commands and sub-agents work on Claude Code; Codex's own command/agent semantics may differ — refer to your platform's docs for exact behavior of the commands.

`/ievo:init` will ask you to add Bash permissions for `gh` commands on first run — say yes (`Add to .claude/settings.local.json` recommended) to avoid each network call needing manual approval.

That's it. Interactive interview, security checks, install. Then `/reload-plugins` to activate.

### Migrating from Claude Code → Codex (or back)

Already running iEvo on one platform and switching to the other? Your iEvo state is **already portable** — `.ievo/evolution/` overlays, the repo index, and config are plain files on the shared filesystem, platform-agnostic by design. You do **not** need a fresh `/ievo:init`:

1. On Codex, run `codex /import` (Codex `v0.140.0+`) to bring over your Claude Code project configuration (plugin state, recent context).
2. Install the iEvo plugin on the new platform if it isn't already (marketplace add + install above).
3. Your `.ievo/evolution/` overlays and `.ievo/cache/index/` transfer automatically — **skip `/ievo:init`**; run `/ievo:evolution`, `/ievo:security-check`, or `/ievo:index-repos` directly when you want to refresh.

`/ievo:init` also detects pre-existing `.ievo/evolution/` state on startup and tells you it's already active, so re-running it after a migration won't clobber your overlays.

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
| `/ievo:debug-on` | Enable verbose / trace-level logging for the iEvo pipeline |
| `/ievo:debug-off` | Disable verbose logging and finalize the debug session |
| `/ievo:hooks-setup` | Configure Claude Code lifecycle hooks for iEvo pipeline events (init complete, security RED, evolution captured) |
| `/ievo:overlay-status` | List active evolution overlays in this project, grouped by scope (Project / agents / skills) with last-modified dates |
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
├── CLAUDE.md                        # (first project-wide evolution — gets marker block; a thin-pointer CLAUDE.md routes it to AGENTS.md instead)
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
7. **Hook abuse** — PreToolUse/UserPromptSubmit with suspicious command (iEvo's own flag-gated correction-capture hook is a documented exception — it only writes under `.ievo/`)
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

### Known configuration gotcha — `CLAUDE_CODE_SUBAGENT_MODEL`

Claude Code v2.1.146+ ships a `CLAUDE_CODE_SUBAGENT_MODEL` environment variable that **overrides** an agent's frontmatter `model:` declaration. Per [official docs](https://code.claude.com/docs/en/sub-agents), the model-resolution order for subagents is:

1. `CLAUDE_CODE_SUBAGENT_MODEL` env var, if set
2. Per-invocation model parameter
3. The subagent definition's `model:` frontmatter (where iEvo declares `sonnet`)
4. The main-conversation model

**The security implication.** iEvo's `security-auditor` agent declares `model: sonnet` precisely because Sonnet-tier reasoning is required to catch indirection attacks ("Haiku is insufficient", per `security-check/SKILL.md`). If an operator sets `CLAUDE_CODE_SUBAGENT_MODEL` to any Haiku-tier value (`haiku`, or a pinned `claude-haiku-...` ID) for cost or speed, the security scan silently runs at Haiku reasoning — degrading the entire security guarantee without any visible warning.

**Mitigation**: either (a) leave `CLAUDE_CODE_SUBAGENT_MODEL` unset (frontmatter wins), or (b) set it to a vendor-neutral Sonnet/Opus alias (`sonnet` / `opus`) when needed for specific subagent classes. Do NOT set it to a Haiku-tier value in any environment running `/ievo:init`. The env var first appears in Claude Code release notes at v2.1.146 (May 2026); it may have been added earlier without changelog mention. No equivalent Codex env var is documented yet (May 2026); this note will update when one ships.

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
    │   ├── debug-on/SKILL.md       # /ievo:debug-on — enable verbose session logging
    │   ├── debug-off/SKILL.md      # /ievo:debug-off — disable verbose session logging
    │   ├── hooks-setup/SKILL.md    # /ievo:hooks-setup — configure lifecycle hooks
    │   ├── overlay-status/SKILL.md # /ievo:overlay-status — list active evolution overlays
    │   ├── index-repos/SKILL.md    # /ievo:index-repos — enumerate a repo
    │   └── security-check/SKILL.md # /ievo:security-check — audit a candidate
    ├── agents/
    │   ├── evolution.md            # sub-agent dispatched by evolution skill
    │   ├── repo-indexer.md         # parallel dispatch — one per repo for indexing (Step 6)
    │   └── security-auditor.md     # parallel dispatch — one per selected item for audit (Step 8)
    └── scripts/
        ├── discover.mjs            # skills.sh API discovery (parallel queries)
        ├── scan_repo.mjs           # deterministic repo scanner (Node, no LLM)
        ├── validate_agents.mjs     # vendor-neutral model: frontmatter validator
        └── tests/                  # node:test suites + fixtures (100% coverage gate)
```

## Standards compliance

- Plugin format: Claude Code-native + Codex-native (dual marketplace manifests)
- Skills inside: [agentskills.io spec](https://agentskills.io/specification) — portable to Cursor, Copilot, Gemini CLI, Goose, Junie, 30+ other agent platforms
- Distribution: triple-mode — Claude Code plugin install OR Codex plugin install OR `npx skills add ievo-ai/skills --skill <name>` via [skills.sh](https://www.skills.sh) (planned v1.0)
- Universal positioning: works wherever Node.js 18+ + git + an agent platform that supports skills are available

## Roadmap

For the full shipped-version history (v0.2 → current), see [`CHANGELOG.md`](./CHANGELOG.md). Forward-looking items only below.

- **v0.7.0 (planned):** Cortex A/B validation gate for evolutions — mutations that don't improve get rejected via blind evaluation. Plus a GitHub-search source in `discover.mjs` for agent-only / plugin-only repos not surfaced by skills.sh.
- **v1.0:** Skills.sh publication + cross-project pattern detection (curator). Lessons that recur across projects get promoted to "blessed" upstream evolutions.

## Acknowledgments

- [find-skills](https://github.com/vercel-labs/skills) — vercel-labs's skill discovery. Through v0.5.x we used find-skills as bootstrap prereq; v0.6.0+ we ship our own [`discover.mjs`](plugins/ievo/scripts/discover.mjs) that hits the same skills.sh API directly, with heuristics inherited verbatim from find-skills SKILL.md (trusted owners, install thresholds, category queries, synonym fallback). Credit to vercel-labs for the original best practices.
- [agentskills.io](https://agentskills.io) — the open standard for skills

## License

MIT. See `LICENSE`.
