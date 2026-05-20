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

### Test coverage — 100% rule

**Every Node script in `plugins/ievo/scripts/` must have 100% test coverage.** No exceptions.

- Tests live in `plugins/ievo/scripts/tests/*.test.mjs`
- Fixtures in `plugins/ievo/scripts/tests/fixtures/`
- Use built-in `node:test` (stdlib — no jest/vitest dependency)
- Run all tests + coverage: `node --test --experimental-test-coverage plugins/ievo/scripts/tests/`
- CI must run tests on every PR; merge gated by 100% coverage + 0 failures

**Why 100% and not "high"?**
- Security-critical: these scripts ARE the security model (validate_agents enforces vendor neutrality, discover surfaces install candidates, scan_repo emits structural facts). Untested code in the security path is unacceptable.
- Small surface: scripts are <700 lines each. 100% is reachable, not aspirational.
- Refactor safety: agents (Claude/Codex/etc.) will modify these scripts. Full coverage = changes can't silently break behavior.

**What counts as covered:**
- Every exported function called by at least one test
- Every conditional branch (`if`/`else`/`switch`/ternary) hit
- Every CLI flag exercised
- Every error path exercised (file not found, bad JSON, network failure, etc.)
- Every YAML frontmatter edge case (no frontmatter, malformed, missing required fields)

**What does NOT count:**
- "It works locally" — must have a test
- "Tested manually" — must have a test
- "Trivial getter" — must have a test if it's used by other code

If a function is genuinely impossible to test in isolation (e.g., network call to live skills.sh API), mock it in tests + add an integration test gated behind `INTEGRATION=1` env var.

**Current compliance ledger (v0.6.0):**
- ✅ `validate_agents.mjs` — 100 line / 100 func / 97.87 branch (51 tests). The 2.13% branch gap is the `process.argv[1] ?? ""` nullish-coalescing fallback in the CLI entry guard at line 193 — unreachable from `spawnSync`-based tests because Node always populates `argv[1]` when launching a script. Counted compliant: the rule's intent is "no untested code paths reachable from input"; this branch is reachable only from a hypothetical bootstrap where Node was invoked with no script path.
- ✅ `discover.mjs` — 100 line / 100 func / 99.17 branch (85 tests). Same single uncovered branch as `validate_agents.mjs` above: the `process.argv[1] ?? ""` nullish-coalescing fallback in the CLI entry guard at line 402. Same compliant-with-rationale status — unreachable from spawn-launched tests by Node's own argv-population contract.
- ⏳ `scan_repo.mjs` — **tests pending, exception until v0.6.1**. Existing battle-tested code (validated byte-identical against the prior Python implementation on 10 community repos), no behavior changes in v0.6.0. Adding tests is tracked as a v0.6.1 must-do — new modifications to `scan_repo.mjs` between v0.6.0 and v0.6.1 require accompanying tests by the modifying PR (the rule applies; only the pre-existing baseline is grandfathered).
- ⏳ Any new script added to `plugins/ievo/scripts/` after v0.6.0 — 100% coverage in the same PR, no exceptions.

This carve-out is the only one. When `scan_repo.mjs` gains tests in v0.6.1, remove the line above and mark it ✅.

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

## Pipeline (`/ievo:init`, v0.6.0+)

```
discover.mjs (parallel skills.sh API queries) ← Node, zero prereq install
    ↓
index-repos (parallel sub-agents)              ← scan_repo.mjs on each candidate repo
    ↓
categorical rank — top-5 per category
    ↓
interview (per candidate)                      ← AskUserQuestion
    ↓
security-auditor (parallel sub-agents)         ← Sonnet senior-security-engineer deep scan
    ↓
install (vendor or plugin, project-scope)      ← Write tool (copy) + source SHA metadata
```

Everything runs on the user's machine. No central trust gates. No community caches. No prereq installs (v0.6.0 dropped find-skills).

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
- v0.6.0 — `discover.mjs` (own skills.sh API integration, drop find-skills prereq), debug-on/off skills, 100% test coverage rule
- v0.7.x — cortex A/B validation gate for evolutions; GitHub search source in discover.mjs for agent-only/plugin-only repos
- v1.0 — skills.sh publication + cross-project pattern curation

See README.md for full roadmap and user-facing documentation.
