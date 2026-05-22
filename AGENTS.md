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
    │   ├── discover.mjs               # skills.sh API discovery (parallel queries)
    │   ├── scan_repo.mjs              # Deterministic repo scanner (Node, stdlib)
    │   ├── validate_agents.mjs        # Vendor-neutral `model:` frontmatter validator
    │   └── tests/                     # node:test suites + fixtures (100% coverage gate)
    └── skills/                        # agentskills.io-compliant — cross-platform
        ├── init/SKILL.md              # /ievo:init — orchestrator
        ├── evolution/SKILL.md         # /ievo:evolution — overlay capture
        ├── feedback/SKILL.md          # /ievo:feedback — file GitHub issues
        ├── debug-on/SKILL.md          # /ievo:debug-on — enable verbose session logging
        ├── debug-off/SKILL.md         # /ievo:debug-off — disable verbose session logging
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
- `it("cleanup", …)` / `it("setup", …)` blocks that only run `rmSync` / `mkdirSync` and contain no `assert.*` call — these are test-count padding. Use `after()` / `before()` from `node:test` for teardown / setup instead. The 100% rule is about real-coverage signal, not reported-pass-count signal; tests that don't assert against the SUT erode that signal.

If a function is genuinely impossible to test in isolation (e.g., network call to live skills.sh API), mock it in tests + add an integration test gated behind `INTEGRATION=1` env var.

**Current compliance ledger (v0.6.7):**
- ✅ `validate_agents.mjs` — 100 / 100 / 100. Literal coverage on every axis is enforced by `.github/workflows/coverage-gate.yml`.
- ✅ `discover.mjs` — 100 / 100 / 100. Same gate as above.
- ✅ `scan_repo.mjs` — 100 / 100 / 100. Tests landed in v0.6.7 (`scan_repo.test.mjs`). Script refactored to export all functions + `isCliEntry` guard + `defaultUrlFn` named export for testability. `check-coverage.mjs` carve-out removed.
- ⏳ Any new script added to `plugins/ievo/scripts/` after v0.6.0 — 100% coverage in the same PR, no exceptions.

### Version bumping
- **Every PR bumps version** in BOTH `plugins/ievo/.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` (in the latter: `metadata.version` + `plugins[0].version`)
- **Codex marketplace** (`.codex-plugin/marketplace.json`) currently has **no version field** — Codex tracks versioning via git refs/tags in the `source` block. No update needed there.
- If the Codex marketplace spec evolves to require a version field, update this guidance and ensure all three manifests bump together.
- Skip = bot/marketplace caches stale. Discipline matters.

### Branch + commit conventions
- Feature branches: `feat/v<x.y.z>-<description>` or `fix/v<x.y.z>-<description>`
- Commit footer: `Co-Authored-By: iEVO <noreply@ievo.ai>` (NOT the default Claude/Anthropic footer)
- Merge strategy: merge commit (`--merge --delete-branch`), never squash

### PR workflow — wait for in-progress reviews before merging

**Do NOT merge while any review check is `IN_PROGRESS`** — even with `--admin` override. Run `gh pr view <N> --json statusCheckRollup` and confirm no check is in flight before invoking `gh pr merge`. The `claude-review` automation typically completes in 2–5 minutes; that window is cheap insurance.

**Exception:** the check is *known to fail by-design* for structural reasons (e.g. workflow-validation rejection when the PR modifies the very workflow being reviewed — the Claude GitHub App refuses to mint a token against a diverged workflow file). In that case `--admin` is acceptable, but document the reason in the merge chat / commit message.

**Why:** v0.6.1 was merged with `--admin` while `claude-review` was `IN_PROGRESS`; the review completed 2 minutes later with two valid findings (basename-collision bypass in lcov, Windows-broken file URLs in tests). Both fixable, but had to ship as a follow-up v0.6.2 PR instead of being folded into the original. Burned a review cycle. The fix landed in v0.6.2 + this rule landed in v0.6.3 to prevent recurrence across any agent working in this repo.

### Pre-commit hooks + workflow gate

Local enforcement + server-side hard gate, sharing the same validator scripts. See `.pre-commit-config.yaml` (local) and `.github/workflows/pre-commit-gate.yml` (server). The five validators are in `.github/scripts/validators/`:

- `nested-fences.mjs` — markdown code-fence nesting bug (catches the `\`\`\`markdown` outer with `\`\`\`X` inner pattern that closes the outer per CommonMark)
- `crlf-frontmatter.mjs` — CRLF or CR-only line endings inside YAML frontmatter (validator-bypass surface)
- `machine-local-paths.mjs` — concrete-username paths like `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\`, `/private/var/folders/...`
- `placeholder-leakage.mjs` — orphan `TODO` / `FIXME` / `XXX` / `HACK` without a tracking reference `(#NNN)` / `(<url>)` / `(v0.X.Y)` / `(ticket-link-pending)` <!-- placeholder-ok: documenting the markers the validator catches -->

- `validate_agents.mjs` — re-used from `plugins/ievo/scripts/` for agent frontmatter validation

Setup for new contributors (uv-based, matches the iEvo toolchain):
```
uv tool install pre-commit  # uvx pre-commit ... also works for one-offs
pre-commit install          # wires .git/hooks/pre-commit
```
Alternatives if `uv` is unavailable: `pipx install pre-commit`, `pip install pre-commit`, or `brew install pre-commit`. The `pre-commit/action@v3.0.1` in `pre-commit-gate.yml` handles the CI side automatically.

Without the install, the GHA workflow still gates server-side; local hooks just give faster feedback. Adding a new validator: drop a `.mjs` in `.github/scripts/validators/` + a hook entry in `.pre-commit-config.yaml`. Each validator must exit non-zero on violation, print `<path>:<line>: <message>` to stderr, support `<file>...` argv, and live outside `plugins/ievo/scripts/` (so the 100% coverage rule does not apply to lint-infra code).

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

Documentation repo + small Node scripts. No build step. Tests live in `plugins/ievo/scripts/tests/` (built-in `node:test`, stdlib only) and the 100% coverage rule on `REQUIRED` scripts is enforced by `.github/workflows/coverage-gate.yml` — see the ledger above for the current carve-out.

```bash
# Local syntax check on Node scripts
node --check plugins/ievo/scripts/scan_repo.mjs

# Run all tests
node --test plugins/ievo/scripts/tests/*.test.mjs

# Run tests with coverage + gate check (mirrors CI)
node --test --experimental-test-coverage \
  --test-reporter=lcov --test-reporter-destination=coverage.lcov \
  --test-reporter=spec --test-reporter-destination=stdout \
  plugins/ievo/scripts/tests/*.test.mjs
node .github/scripts/check-coverage.mjs coverage.lcov

# Test scan_repo against a real repo
node plugins/ievo/scripts/scan_repo.mjs anthropics/claude-code \
  --output-dir /tmp/scan-out --checkout-dir /tmp/scan-checkout

# Validate skill format (when skills-ref CLI lands)
# skills-ref validate plugins/ievo/skills/<name>
```

## Roadmap (high-level)

- v0.5.x — security tightening, simplifications
- v0.6.0 — `discover.mjs` (own skills.sh API integration, drop find-skills prereq), debug-on/off skills, 100% test coverage rule
- v0.6.1 — CI coverage gate (`.github/workflows/coverage-gate.yml`), `isCliEntry` refactor closes the CLI-entry-guard branch gap → ledger carve-outs dropped
- v0.6.2 — claude-review follow-ups: `pathToFileURL` in tests for Windows-correct file URLs; `parseLcov` keys by full SF path with explicit basename-collision detection
- v0.6.3 — pre-commit hooks (5 validators: nested fences, machine-local paths, CRLF frontmatter, placeholder leakage, agent frontmatter) + `.github/workflows/pre-commit-gate.yml` server-side mirror; AGENTS.md "wait for in-progress reviews" rule promoted from operator memory; 2 pre-existing nested-fence bugs in `feedback/SKILL.md` fixed as the validator caught them
- v0.6.4 — Eva PR bundle (4 small text fixes that had been queued as PRs #37–#40 against the v0.6.2 baseline, all coverage-gated due to stale SCRIPT_VERSION coupling): stale "Python" → "Node" in `index-repos/SKILL.md`; stale `risk: <tier>` → `mcp: yes/no` in `repo-indexer.md` + `index-repos/SKILL.md` stdout-format docs; universal-first compatibility in `evolution/SKILL.md`; vendor-neutral "Sonnet family" instead of pinned "Sonnet 4.6+" in `security-check/SKILL.md`. Plus `/home/runner` whitelist in `machine-local-paths.mjs` (CI-doc false-positive from PR #41 claude-review).
- v0.6.5 — second Eva PR bundle (#44 + #45): missing `debug-on` / `debug-off` entries added to AGENTS.md + README directory listings, scripts listing in README expanded with `discover.mjs` / `validate_agents.mjs` / `tests/`, `/ievo:debug-on` + `/ievo:debug-off` rows added to README skills table; **security fix**: `feedback/SKILL.md` Step 6 now writes the issue body via the Write tool + passes it to `gh` via `--body-file` instead of inline `--body "..."` — closes a shell-interpolation surface (user-verbatim feedback could contain backticks / `$(...)` / `${VAR}`). Pattern already enforced in `init/SKILL.md` Step 8b; this brings `feedback` into alignment.
- v0.6.6 — third Eva PR bundle (#47 + #48): `index-repos/SKILL.md` rule clarified — `scan_repo.mjs` tracks its own format-version independently of `plugin.json` (currently `1.1.0`, inherited from community-index-bot lineage); only `discover.mjs` is coupled to `plugin.json` and that coupling is enforced by `discover.test.mjs`. Plus `commands/uninstall.md` `allowed-tools` line now includes `Bash` — the Step 1 `grep -l` calls previously triggered manual-approval prompts.
- v0.6.7 (current) — `scan_repo.mjs` 100% test coverage: 133 tests, `scan_repo.test.mjs`, exports + `isCliEntry` + `defaultUrlFn` refactor, `check-coverage.mjs` carve-out removed. Fulfils the HARD STOP commitment (5th roll).
- v0.7.0 (planned) — cortex A/B validation gate for evolutions; GitHub search source in discover.mjs for agent-only/plugin-only repos
- v1.0 — skills.sh publication + cross-project pattern curation

See README.md for full roadmap and user-facing documentation.
