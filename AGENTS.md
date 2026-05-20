# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Cursor, Copilot, etc.) working on the `ievo-ai/skills` codebase.

## Project Overview

iEvo is a **universal self-evolving plugin for AI coding agents** — discovery + safety + evolution layer on top of [skills.sh](https://www.skills.sh) and the multi-platform agent skills ecosystem.

**Universal via the [agentskills.io standard](https://agentskills.io/specification)** — skills inside this plugin work on Claude Code, Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms. Platform-specific bits (slash commands, sub-agents via Task tool) work on Claude Code and Codex.

Not a Claude Code-only plugin. Position framing as universal in all user-facing copy.

## What this repo ships

```
ievo-ai/skills/
├── .claude-plugin/marketplace.json    # Claude Code marketplace manifest
├── .codex-plugin/marketplace.json     # Codex marketplace manifest
├── AGENTS.md                          # This file — for AI agents
├── README.md                          # For humans + AI
└── plugins/ievo/                      # The plugin itself
    ├── .claude-plugin/plugin.json     # Plugin manifest
    ├── agents/                        # Sub-agents (Claude Code + Codex Task tool)
    │   ├── evolution.md
    │   ├── repo-indexer.md            # Parallel dispatch per repo for indexing
    │   └── security-auditor.md        # Parallel dispatch per item for antivirus audit
    ├── commands/                      # Slash commands (Claude Code-specific)
    │   ├── uninstall.md
    │   └── update.md
    ├── scripts/                       # Node helpers (no LLM, no extra runtime)
    │   └── scan_repo.mjs              # Deterministic repo scanner (Node, stdlib)
    └── skills/                        # agentskills.io-compliant — cross-platform
        ├── init/SKILL.md              # /ievo:init — orchestrator
        ├── evolution/SKILL.md         # /ievo:evolution — overlay capture
        ├── feedback/SKILL.md          # /ievo:feedback — file GitHub issues
        ├── index-repos/SKILL.md       # /ievo:index-repos — enumerate a repo
        └── security-check/SKILL.md    # /ievo:security-check — antivirus audit
```

## Key conventions

### Skills format
- Every `SKILL.md` MUST conform to [agentskills.io spec](https://agentskills.io/specification)
- Required frontmatter: `name`, `description` (≤1024 chars). Optional: `license`, `compatibility`, `metadata`, `allowed-tools`
- Body should be ≤500 lines; split detail into `references/` if more is needed
- Skills are activated by description match (semantic), so descriptions must clearly state WHAT + WHEN to use

### Scripts language
- **All scripts in `plugins/ievo/scripts/` are Node.js (`.mjs`)** — no Python, no other runtimes
- Reason: Node 18+ is bundled with Claude Code and Codex (guaranteed available). Python is NOT (especially Windows bare)
- Stdlib only — no `package.json` dependencies needed (yet)
- File extension `.mjs` (ESM)

### Agent `model:` frontmatter — ALWAYS use vendor-neutral aliases

**Rule**: agent `.md` files MUST use family-level aliases in their `model:` frontmatter, NEVER pinned IDs.

**Allowed values:**
- `sonnet` — Sonnet family (host resolves to current Sonnet)
- `opus` — Opus family
- `haiku` — Haiku family
- `inherit` — inherit from caller context

**Forbidden** (and why):
- `claude-sonnet-4-6` — locks to specific Anthropic version (drift risk + vendor lock)
- `claude-opus-4-7` — same
- `claude-haiku-4-5-20251001` — same, even worse (date-pinned snapshot)
- `gpt-5` / `gpt-4o` / `gemini-pro` — vendor-locked to non-Anthropic providers
- Any model ID containing a vendor name or version number

**Why this matters:**
1. **agentskills.io spec doesn't define `model:` field** — it's Claude Code/Codex agent convention. Sticking to aliases means our agents work on any host that adopts this convention.
2. **Version drift**: pinned IDs lock you to a specific snapshot. When Anthropic ships Sonnet 4.7, our pinned `claude-sonnet-4-6` agents don't benefit until manual bump. Aliases auto-roll.
3. **Vendor lock**: `claude-sonnet-4-6` only resolves on hosts using Anthropic's API. Codex with OpenAI provider, Gemini CLI, etc. → broken. Aliases are vendor-neutral by design (host translates to its provider's equivalent).
4. **Universal positioning**: iEvo claims cross-platform. Vendor IDs contradict this.

**Validator**: run `node plugins/ievo/scripts/validate_agents.mjs` — checks every `plugins/ievo/agents/*.md` for forbidden model patterns. Fails CI / pre-commit on any violation. (Hook this into your workflow as `pre-commit`.)

### Version bumping
- **Every PR bumps version** in BOTH `plugins/ievo/.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` (in the latter: `metadata.version` + `plugins[0].version`)
- **Codex marketplace** (`.codex-plugin/marketplace.json`) currently has **no version field** — Codex tracks versioning via git refs/tags in the `source` block. No update needed there.
- If the Codex marketplace spec evolves to require a version field, update this guidance and ensure all three manifests bump together.
- Skip = bot/marketplace caches stale. Discipline matters.

### Branch + commit conventions
- Feature branches: `feat/v<x.y.z>-<description>` or `fix/v<x.y.z>-<description>`
- Commit footer: `Co-Authored-By: iEVO <noreply@ievo.ai>` (NOT the default Claude/Anthropic footer)
- Merge strategy: merge commit (`--merge --delete-branch`), never squash

### Security model (v0.5.2+)
- **No owner-based trust** (no TRUSTED_OWNERS shortcuts). Reputation isn't security.
- **No heuristic risk_tier** in indices. `scan_repo.mjs` emits structural facts only.
- **Antivirus deep scan** via `security-auditor` sub-agent: reads FULL content of every file in the candidate + all dependencies, uses current Sonnet family reasoning to detect threats (declared via `model: sonnet` alias for vendor neutrality — agentskills.io spec has no `model` field, this is Claude Code/Codex agent convention). Per-install only.
- **Report-to-source flow** for RED verdicts: pre-filled GitHub issue body filed at source repo via `gh issue create`.

## Pipeline (`/ievo:init`)

```
find-skills (skills.sh)              ← user-side; prereq install required first
    ↓
index-repos (parallel sub-agents)    ← scan_repo.mjs on each candidate repo
    ↓
categorical rank — top-5 per category
    ↓
interview (per candidate)            ← AskUserQuestion
    ↓
security-auditor (parallel sub-agents) ← Sonnet antivirus deep scan per selected item
    ↓
install (vendor or plugin)           ← gh api fetch + Write, OR settings.json edit
```

Everything runs on the user's machine. No central trust gates. No community caches.

## What NOT to do

- **Don't add owner-based trust shortcuts.** OpenAI, Anthropic, Microsoft accounts have all been compromised. Verdict must come from content scan alone.
- **Don't add Python prereqs.** Migration to Node is complete. Don't regress.
- **Don't position as Claude Code-only.** This is a universal plugin via agentskills.io. Frame accordingly.
- **Don't trust skills.sh's Snyk/Socket audits as the verdict.** Use as context — they audit dep CVEs, not behavioral patterns. Antivirus deep scan is the trust signal.
- **Don't auto-install RED items.** Always explicit user choice via `AskUserQuestion`.

## Development

This is mostly a documentation repo (markdown + small Node scripts). No build step, no tests yet (planned for v0.6+).

```bash
# Local syntax check on Node scripts
node --check plugins/ievo/scripts/scan_repo.mjs

# Test scan_repo against a real repo
node plugins/ievo/scripts/scan_repo.mjs anthropics/claude-code \
  --output-dir /tmp/scan-out --checkout-dir /tmp/scan-checkout

# Validate skill format (when skills-ref CLI lands)
# skills-ref validate plugins/ievo/skills/<name>
```

## Roadmap (high-level)

- v0.5.x — security tightening, simplifications (current)
- v0.6.x — `discover.mjs` (multi-source candidate discovery, drop find-skills prereq)
- v0.7.x — cortex A/B validation gate for evolutions
- v1.0 — skills.sh publication + cross-project pattern curation

See README.md for full roadmap and user-facing documentation.
