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
    │   ├── deep-reviewer.md           # Independent gap-detection reviewer for /ievo:deep-review
    │   ├── evolution.md
    │   ├── repo-indexer.md            # Parallel dispatch per repo for indexing
    │   ├── security-auditor.md        # Parallel dispatch per item for antivirus audit
    │   └── vuln-scanner.md            # Per-module vulnerability scanner for /ievo:vuln-scan
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
        ├── deep-review/SKILL.md       # /ievo:deep-review — structured gap-detection review
        ├── debug-on/SKILL.md          # /ievo:debug-on — enable verbose session logging
        ├── debug-off/SKILL.md         # /ievo:debug-off — disable verbose session logging
        ├── handoff/SKILL.md           # /ievo:handoff — portable context handoff between sessions
        ├── hooks-setup/SKILL.md       # /ievo:hooks-setup — configure lifecycle hooks
        ├── inspect/SKILL.md           # /ievo:inspect — pre-install structured summary of a remote repo
        ├── overlay-status/SKILL.md    # /ievo:overlay-status — list active evolution overlays
        ├── index-repos/SKILL.md       # /ievo:index-repos — enumerate a repo
        ├── schedule/SKILL.md          # /ievo:schedule — create Routines for periodic operations
        ├── security-check/SKILL.md    # /ievo:security-check — antivirus audit
        └── vuln-scan/SKILL.md         # /ievo:vuln-scan — CWE-aware source vulnerability scan
```

## Key conventions

### Public-repo content safety — no sensitive names in public artefacts

`ievo-ai/skills` is a public repo. **NEVER** write into any public artefact (`CHANGELOG.md`, `README.md`, `AGENTS.md`, `docs/`, merged-PR descriptions, public-issue replies, commit messages, public Slack/Discord posts) any of the following:

- **Secret names** — e.g. `APP_ID`, `APP_PRIVATE_KEY`, `GH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, or anything matching `*_TOKEN` / `*_KEY` / `*_SECRET` / `*_PASSWORD` / `*_ID` patterns.
- **Specific internal endpoints**, hostnames, dashboard URLs, internal-only paths.
- **Infrastructure details that hint at attack vectors** — which scanning tools run where, which org/repo combos hold which credentials, account-recovery channels, security tooling vendor names + their config.
- **Internal account / team names**, employee handles when not contributors.

Use generic descriptions instead: *"GitHub App token"*, *"org-level secrets"*, *"App credentials"*, *"internal CI dashboard"*, *"a write-permission token"*. The PR-private channels (private review notes, internal coordination, godfather's `.ievo/evolution/OPERATOR.md`) are fine for the specifics; the public artefacts are not.

**Workflow files** themselves are public (they `${{ secrets.NAME }}` openly — GitHub masks values, names are by-design visible), but **prose about them** in CHANGELOG / README / merged-PR bodies should describe the *mechanism*, not enumerate the secret names. The workflow declaration is the authoritative spec; the prose is reference for humans and shouldn't duplicate the secret allowlist into a public-grep-able paragraph.

**Test before commit/comment**: would this paragraph help an attacker plan a credential-stuffing or supply-chain attack? Would removing the specific name lose any signal for an honest reader? If "yes / no" → strip. claude-review reads this section and will flag PRs that violate it; pre-empt the review by self-checking.

### Changelog goes in `CHANGELOG.md`, NOT this file

Every shipped version gets an entry in **`CHANGELOG.md` at the repo root** — reverse-chronological, one `## vX.Y.Z` section per release with a paragraph (or short bullet list) describing what changed and why. **Never add shipped-version entries to `AGENTS.md`** — this file is the contract for AI agents working on the repo and must describe *current* conventions, not accumulate history that dilutes the convention surface.

- Forward-looking roadmap (planned items) stays in `AGENTS.md` § Roadmap.
- Shipped-version history lives in `CHANGELOG.md`.
- **Every PR that changes plugin files MUST bump the version.** Bump all FOUR files in the same commit:
  1. `.claude-plugin/marketplace.json` → `metadata.version` + `plugins[0].version`
  2. `plugins/ievo/.claude-plugin/plugin.json` → `version`
  3. `plugins/ievo/scripts/discover.mjs` → `export const SCRIPT_VERSION`
  4. AGENTS.md → compliance ledger header `(vX.Y.Z)`
- Bump type: `fix:` → patch, `feat:` → minor, `feat!:` → minor (pre-1.0).
- Query main's CURRENT version at push time (not branch time) to avoid race with parallel PRs. Check open PRs for in-flight version claims and pick the next free slot.
- Add a CHANGELOG.md entry in the same commit — reverse-chronological, `## vX.Y.Z` header.
- The coupling assertion in `discover.test.mjs` catches drift on the coverage-gate.

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

**Current compliance ledger (v0.20.0):**
- ✅ `validate_agents.mjs` — 100 / 100 / 100. Literal coverage on every axis is enforced by `.github/workflows/coverage-gate.yml`.
- ✅ `discover.mjs` — 100 / 100 / 100. Same gate as above.
- ✅ `scan_repo.mjs` — 100 / 100 / 100. Carve-out cleared in v0.6.7 (the HARD STOP from v0.6.6). The 6-phase test landing followed the v0.6.1 isCliEntry / execImpl pattern from `discover.mjs`: `export` refactor, pure-function tests, execImpl-injected git-call tests, integration tests with on-disk fixtures, main() end-to-end, then gap-fill nullish-coalescing and ternary false-branches.
- ✅ `validate_skills.mjs` — 100 / 100 / 100. Same gate as above. Enforces agentskills.io spec constraints on SKILL.md frontmatter (name format/length, description ≤1024, compatibility ≤500, no vendor model IDs, `effort:` field validation — warning on absent, error on invalid value).
- ⏳ Any new script added to `plugins/ievo/scripts/` after v0.6.0 — 100% coverage in the same PR, no exceptions.

No carve-outs remain as of v0.6.7. Every Node script in `plugins/ievo/scripts/` is under the 100% gate. The `CARVE_OUTS` map in `.github/scripts/check-coverage.mjs` is empty; keep it as the canonical place to grandfather any future legitimate exception.

### Version bumping — in every PR
- **Every PR bumps version** in **four files** in the same commit:
  1. `.claude-plugin/marketplace.json` → `metadata.version` + `plugins[0].version`
  2. `plugins/ievo/.claude-plugin/plugin.json` → `version`
  3. `plugins/ievo/scripts/discover.mjs` → `export const SCRIPT_VERSION`
  4. AGENTS.md → compliance ledger header `**Current compliance ledger (vX.Y.Z):**`
- Also add a `## vX.Y.Z` entry in `CHANGELOG.md` (reverse-chronological).
- To avoid race with parallel PRs: query main's CURRENT version at push time via `gh api`, check open PRs for claimed versions, pick next free slot.
- The coupling assertion in `discover.test.mjs` catches drift on the coverage-gate.
- **Codex marketplace** (`.codex-plugin/marketplace.json`) currently has **no version field** — Codex tracks versioning via git refs/tags in the `source` block.

### Branch + commit conventions
- Feature branches: `feat/<description>` or `fix/<description>` (no version number — auto-bump assigns it)
- Commit footer: `Co-Authored-By: iEVO <noreply@ievo.ai>` (NOT the default Claude/Anthropic footer)
- Merge strategy: merge commit (`--merge --delete-branch`), never squash

### Issue lifecycle — two-phase discussion + implementation

Issues follow a two-phase lifecycle (skills#153):

**Phase 1 — Discussion (`@ievo` triggered):** `issue-discussion.yml` triggers when an org member (MEMBER/OWNER) mentions `@ievo` in an issue comment. Claude (Opus) does deep research on the codebase and posts a structured analysis (Understanding, Approach, Questions, Conflicts, Risks). The bot does NOT create branches, open PRs, or modify files. Operators iterate via `@ievo` follow-up comments until requirements are clear. Edit and Write tools are excluded from --allowedTools to enforce read-only at the tool level.

**Phase 2 — Implementation (`/implement` triggered):** `issue-handler.yml` triggers when an org member comments exactly `/implement` on an issue. Claude reads the discussion thread, validates that all questions are resolved, then either closes the issue with explanation or implements a fix/feature PR with full test coverage. After creating the PR, it monitors `claude-code-review` and iterates on feedback (max 5 attempts) until the review is green. Never auto-merges — human must review and merge.

The discussion phase is optional — `/implement` works without prior `@ievo` discussion. Both workflows use a GitHub App token (org-level App credentials) so that PRs trigger downstream workflows. See skills#65 and skills#153 for the full design.

**After merging infra fixes (workflow, CI config) into main** — immediately rebase open handler PRs that depend on the fix. A workflow fix in main is inert until dependent branches pull it in. Check `gh pr list --state open --author app/claude` and rebase any that would benefit.

### Conflict resolver — auto-rebase DIRTY handler PRs

`conflict-resolver.yml` triggers on every push to main (and every 6 hours as a safety net). When main advances, open handler PRs may become DIRTY (merge conflicts) — GitHub Actions skips CI on DIRTY PRs, so the review-fixer never triggers. This workflow bridges the gap:

1. Lists all open PRs by `app/claude` / `claude[bot]` with `mergeStateStatus == "DIRTY"`
2. For each, rebases onto latest main
3. `.github/prompts/*.md` conflicts → auto-resolved (take main's version, same as issue-handler Phase 4h)
4. Non-infra conflicts → escalate to a PR comment for operator review
5. Force-with-lease push triggers fresh CI

No LLM needed — pure git rebase operations. Never auto-merges. Also supports `workflow_dispatch` for manual operator invocation.

### PR workflow — wait for in-progress reviews before merging

**Do NOT merge while any review check is `IN_PROGRESS`** — even with `--admin` override. Run `gh pr view <N> --json statusCheckRollup` and confirm no check is in flight before invoking `gh pr merge`. The `claude-review` automation typically completes in 2–5 minutes; that window is cheap insurance.

**Exception:** the check is *known to fail by-design* for structural reasons (e.g. workflow-validation rejection when the PR modifies the very workflow being reviewed — the Claude GitHub App refuses to mint a token against a diverged workflow file). In that case `--admin` is acceptable, but document the reason in the merge chat / commit message.

**Why:** v0.6.1 was merged with `--admin` while `claude-review` was `IN_PROGRESS`; the review completed 2 minutes later with two valid findings (basename-collision bypass in lcov, Windows-broken file URLs in tests). Both fixable, but had to ship as a follow-up v0.6.2 PR instead of being folded into the original. Burned a review cycle. The fix landed in v0.6.2 + this rule landed in v0.6.3 to prevent recurrence across any agent working in this repo.

### Pre-commit hooks + workflow gate

Local enforcement + server-side hard gate, sharing the same validator scripts. See `.pre-commit-config.yaml` (local) and `.github/workflows/pre-commit-gate.yml` (server). Eight validators enforce quality — six in `.github/scripts/validators/` and two re-used from `plugins/ievo/scripts/`:

- `nested-fences.mjs` — markdown code-fence nesting bug (catches the `\`\`\`markdown` outer with `\`\`\`X` inner pattern that closes the outer per CommonMark)
- `crlf-frontmatter.mjs` — CRLF or CR-only line endings inside YAML frontmatter (validator-bypass surface)
- `machine-local-paths.mjs` — concrete-username paths like `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\`, `/private/var/folders/...`
- `placeholder-leakage.mjs` — orphan `TODO` / `FIXME` / `XXX` / `HACK` without a tracking reference `(#NNN)` / `(<url>)` / `(v0.X.Y)` / `(ticket-link-pending)` <!-- placeholder-ok: documenting the markers the validator catches -->
- `utf8-validate.mjs` — byte-level UTF-8 validity using `TextDecoder` `{ fatal: true }`. Catches CP-1252 smart quotes (0x91-0x94, 0x96-0x97) from Word-paste, Latin-1 / mis-encoded escape sequences in `terminalSequence` examples, and truncated multi-byte tails at EOF. Closes a Codex skill-load hole — Codex `rust-v0.133.0` (May 2026) started warning on invalid UTF-8 in AGENTS / SKILL.md files instead of silent drops; catching at commit time prevents the broken-file install entirely.
- `yaml-frontmatter.mjs` — YAML frontmatter syntax validation. Catches unquoted values containing `: ` (colon-space), unterminated quoted strings, duplicate keys, flow indicator characters in unquoted values, and inline comment ambiguity (` #`). For SKILL.md files, also checks required fields (`name`, `description`) and description length (≤1024). Complements `validate_skills.mjs` / `validate_agents.mjs` (semantic checks) — this validator covers syntax that minimal regex-based parsers miss. Motivated by PR #122 (5 SKILL.md files with Codex-breaking unquoted colons). <!-- placeholder-ok: (#119) -->

- `validate_agents.mjs` — re-used from `plugins/ievo/scripts/` for agent frontmatter validation
- `validate_skills.mjs` — re-used from `plugins/ievo/scripts/` for SKILL.md frontmatter validation (agentskills.io spec constraints)

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
- **`CLAUDE_CODE_SUBAGENT_MODEL` precedence — operator gotcha.** Claude Code first mentions a `CLAUDE_CODE_SUBAGENT_MODEL` env var in v2.1.146 release notes (May 2026); it **overrides** agent frontmatter `model:`. Per [official docs](https://code.claude.com/docs/en/sub-agents), the resolution order is: (1) env var if set, (2) per-invocation parameter, (3) frontmatter, (4) main-conversation model. **If an operator sets `CLAUDE_CODE_SUBAGENT_MODEL` to any Haiku-tier value (`haiku`, or a pinned `claude-haiku-...` ID), the `security-auditor` runs at Haiku reasoning** — `security-check/SKILL.md` explicitly states "Haiku is insufficient (misses indirection attacks)", silently degrading the entire security guarantee. **Mitigation**: leave the env var unset (frontmatter wins), or set it to `sonnet`/`opus`. No equivalent Codex env var documented yet (May 2026); update this note when one ships.

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

Documentation repo + small Node scripts. No build step. Tests live in `plugins/ievo/scripts/tests/` (built-in `node:test`, stdlib only) and the 100% coverage rule on `REQUIRED` scripts is enforced by `.github/workflows/coverage-gate.yml` — see the ledger above for the current `REQUIRED` set (all three `.mjs` scripts as of v0.6.7; no carve-outs).

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

## Roadmap (planned)

Forward-looking only. **Shipped versions live in `CHANGELOG.md` at the repo root** — see § Key conventions § Changelog goes in `CHANGELOG.md`.

- **planned** — cortex A/B validation gate for evolutions; GitHub search source in `discover.mjs` for agent-only / plugin-only repos. (Originally targeted v0.7.0; carried forward as the plugin surpassed that version without shipping these items.)
- **v1.0** — skills.sh publication + cross-project pattern curation.

See `README.md` for user-facing documentation; see `CHANGELOG.md` for the full shipped-version history.
