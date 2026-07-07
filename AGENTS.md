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
    │   ├── update.md
    │   └── vuln-scan.md               # /ievo:vuln-scan — Glasswing-inspired orchestrator (Phase 1-4, parallel sub-agents)
    ├── scripts/                       # Node helpers (no LLM, no extra runtime)
    │   ├── discover.mjs               # skills.sh API discovery (parallel queries)
    │   ├── scan_repo.mjs              # Deterministic repo scanner (Node, stdlib)
    │   ├── validate_agents.mjs        # Vendor-neutral `model:` frontmatter validator
    │   ├── evolution_candidates.mjs   # Auto-evolution per-session candidate accumulator (append/count/prune)
    │   └── tests/                     # node:test suites + fixtures (100% coverage gate)
    └── skills/                        # agentskills.io-compliant — cross-platform
        ├── init/SKILL.md              # /ievo:init — orchestrator
        ├── evo/SKILL.md               # /ievo:evo — overlay capture
        ├── feedback/SKILL.md          # /ievo:feedback — file GitHub issues
        ├── deep-review/SKILL.md       # /ievo:deep-review — structured gap-detection review
        ├── debug-on/SKILL.md          # /ievo:debug-on — enable verbose session logging
        ├── debug-off/SKILL.md         # /ievo:debug-off — disable verbose session logging
        ├── evo-auto-enable/SKILL.md   # /ievo:evo-auto-enable — turn on auto-evolution mode (flag + pending queue)
        ├── evo-auto-disable/SKILL.md  # /ievo:evo-auto-disable — turn off auto-evolution mode (preserves queue)
        ├── handoff/SKILL.md           # /ievo:handoff — portable context handoff between sessions
        ├── hooks-setup/SKILL.md       # /ievo:hooks-setup — configure lifecycle hooks
        ├── inspect/SKILL.md           # /ievo:inspect — pre-install structured summary of a remote repo
        ├── overlay-status/SKILL.md    # /ievo:overlay-status — list active evolution overlays
        ├── index-repos/SKILL.md       # /ievo:index-repos — enumerate a repo
        ├── schedule/SKILL.md          # /ievo:schedule — create Routines for periodic operations
        ├── security-check/SKILL.md    # /ievo:security-check — antivirus audit
        ├── version/SKILL.md           # /ievo:version — show installed version + changelog since latest
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

**Test before commit/comment**: would this paragraph help an attacker plan a credential-stuffing or supply-chain attack? Would removing the specific name lose any signal for an honest reader? If "yes / no" → strip. Eva's PR review reads this section and will flag PRs that violate it; pre-empt the review by self-checking.

### Changelog goes in `CHANGELOG.md`, NOT this file

Every shipped version gets an entry in **`CHANGELOG.md` at the repo root** — reverse-chronological, one `## vX.Y.Z` section per release. Each section has a **required structure** — `cut-release.yml` copies the matching section verbatim into the public GitHub Release body (#259), so a single dense wall-of-text paragraph becomes an unreadable Releases page (#306). Author every `## vX.Y.Z` section as:

1. **Summary line** — the first line is one sentence stating what shipped plus the closed-issue reference (e.g. `Add a /ievo:version skill … — closes #291.`). Keep it to a single sentence, hard-capped at ~240 characters; do NOT inline `**(1)**`/`**(2)**` component markers here.
2. **Blank line** separating the summary from the list.
3. **Bullet list** — one top-level `-` bullet per component/change, with indented sub-bullets where a component needs detail. What used to be inline `**(1)**`/`**(2)**` markers become top-level bullets. Reflow the same rationale, coverage/version-bump, and validator notes into bullets — restructure for scannability, never drop information.

**Never add shipped-version entries to `AGENTS.md`** — this file is the contract for AI agents working on the repo and must describe *current* conventions, not accumulate history that dilutes the convention surface.

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
- Required frontmatter: `name`, `description` (≤1024 chars). Optional: `license`, `compatibility`, `metadata`, `allowed-tools`, `disable-model-invocation`
- Body should be ≤500 lines; split detail into `references/` if more is needed
- Skills are activated by description match (semantic), so descriptions must clearly state WHAT + WHEN to use
- `disable-model-invocation: true` (optional, default `false`) makes a skill **user-invoke only** — its description is withheld from the model so it cannot auto-activate on description match. Reserve it for heavyweight skills where accidental activation is costly AND no agent invokes them programmatically; the current set is `init`, `deep-review`. Do NOT set it on skills that sub-agents load via the Skill tool / skills system (`security-check` ← `security-auditor`) — a Skill-tool call is a model invocation, so the flag would break that pipeline. The same constraint applies to `vuln-scan` for a related reason (v0.47.1+): `vuln-scanner.md` preloads it via `skills:` subagent frontmatter rather than a runtime `Skill()` call, and per Claude Code's docs a skill can't be preloaded either once it sets `disable-model-invocation: true`, since preloading draws from the same set of skills Claude can invoke. As of Claude Code v2.1.196 it also prevents a [scheduled task](https://code.claude.com/docs/en/scheduled-tasks) from firing the skill when the skill is the task's prompt. Explicit `/ievo:<name>` invocation is unaffected.

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
- `fable` — Fable family (Claude Fable 5+, added v0.21.0)
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

**Current compliance ledger (v0.49.3):**
- ✅ `validate_agents.mjs` — 100 / 100 / 100. Literal coverage on every axis is enforced by `.github/workflows/coverage-gate.yml`.
- ✅ `discover.mjs` — 100 / 100 / 100. Same gate as above.
- ✅ `scan_repo.mjs` — 100 / 100 / 100. Carve-out cleared in v0.6.7 (the HARD STOP from v0.6.6). The 6-phase test landing followed the v0.6.1 isCliEntry / execImpl pattern from `discover.mjs`: `export` refactor, pure-function tests, execImpl-injected git-call tests, integration tests with on-disk fixtures, main() end-to-end, then gap-fill nullish-coalescing and ternary false-branches.
- ✅ `validate_skills.mjs` — 100 / 100 / 100. Same gate as above. Enforces agentskills.io spec constraints on SKILL.md frontmatter (name format/length, description ≤1024, compatibility ≤500, no vendor model IDs, `effort:` field validation — warning on absent, error on invalid value).
- ✅ `evolution_candidates.mjs` — 100 / 100 / 100. Same gate as above. Added in v0.45.0 (auto-evolution PR 2) following the `isCliEntry` / injected-fs-deps pattern from `discover.mjs`: pure parse/path helpers, dependency-injected `append`/`list`/`count`/`prune`, `main()` end-to-end via injected io, and a subprocess suite covering the CLI entry guard.
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
- **Infra-only PRs do NOT bump the version.** Changes confined to `.github/` (workflows, prompts, CI scripts) or repo docs (`AGENTS.md`, `README.md`) with **no** edit to plugin files (`plugins/ievo/**`, `.claude-plugin/**`) leave the version untouched. The version represents the *plugin* — bumping it for a CI/docs change would fire `notify-release` (a false release announcement) and misrepresent the changelog. The coupling test still passes (SCRIPT_VERSION == plugin.json, both unchanged).
- **Codex marketplace** (`.codex-plugin/marketplace.json`) currently has **no version field** — Codex tracks versioning via git refs/tags in the `source` block.
- **Codex discovery schema** — `discover.mjs` reads `codex plugin list --json` → `available[]` with the fields `pluginId` / `name` / `marketplaceName` / `marketplaceSource.source`. Manually validated against **codex-cli 0.142.3**. The code degrades gracefully on schema drift (missing fields → fallback id or filtered out), but re-verify these field names on a major Codex CLI update.

### Branch + commit conventions
- Feature branches: `feat/<description>` or `fix/<description>` (no version number — auto-bump assigns it)
- Commit footer: `Co-Authored-By: iEVO <noreply@ievo.ai>` (NOT the default Claude/Anthropic footer)
- Merge strategy: merge commit (`--merge --delete-branch`), never squash

### Issue lifecycle — Eva-brokered (D-004 Phase 2, skills#271/#277)

Issue triage and implementation are handled by the private Eva orchestration repo; this repo keeps only thin event forwarders. The v1 in-repo pipeline (`issue-pipeline.yml` route/implement, `review-fixer.yml`, `fix-command.yml`, `conflict-resolver.yml`, the `@`-mention responder, the in-repo code-review workflow, and `.github/prompts/`) was paused in skills#271 and removed in skills#277.

**`forward-to-eva.yml`** relays issue events via `repository_dispatch`: `issues: opened` → Eva triages; `issues: labeled = approved` → Eva builds the PR. Auto-execution sources are exactly two (eva#132 trust matrix — enforced in the forwarder and re-verified on the Eva side): a **human MEMBER/OWNER**, or the **exact ievo-eva App** (`ievo-eva[bot]`) — Eva's own audit findings, routed into the Router's adversarial skeptic mode (default reject; self-approve only for docs/`plugins/ievo/**` under a daily cap; rejected/held issues carry terminal labels `eva-rejected`/`eva-hold-high-risk`, unlocked only by a human-applied `approved`). Any other bot or external author: passive backlog, never forwarded. No untrusted free-text crosses into a shell. Eva-authored PRs arrive App-authored, built fresh from `main`.

**`notify-eva.yml`** requests Eva's PR review once BOTH product gates (Coverage Gate + Pre-commit Gate) are green for the head SHA — that all-green check is the merge-safety gate. Eva reviews every PR; for Eva-authored PRs she also auto-merges after her APPROVE (merge-method fallback handles the repo ruleset — eva#129/#130).

**Retired without replacement (accepted loss):** v1's conflict-resolver auto-rebased long-lived DIRTY handler PRs. Eva PRs are built fresh from `main` and merge within minutes of green gates, so the DIRTY window shrank from days to minutes; a stale Eva PR is rebuilt from the issue rather than rebased in place.

### PR workflow — wait for in-progress reviews before merging

**Do NOT merge while any review check is `IN_PROGRESS`** — even with `--admin` override. Run `gh pr view <N> --json statusCheckRollup` and confirm no check is in flight before invoking `gh pr merge`. Eva's review typically lands within a few minutes of both gates going green; that window is cheap insurance.

**Exception:** the check is *known to fail by-design* for structural reasons. In that case `--admin` is acceptable, but document the reason in the merge chat / commit message.

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

Plus one upstream builtin (not a local validator, so it falls outside the "eight" count): **`check-merge-conflict`** from `pre-commit/pre-commit-hooks` (pinned `rev: v6.0.0`) — fails on leftover merge-conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) reaching a commit. Configured with `--assume-in-merge` so it also catches botched **rebase** resolutions (`git rebase` does not set `MERGE_HEAD`), not just `git merge` conflicts.

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
- **Sub-agent tool isolation.** A skill's `disallowed-tools` (kebab-case) does NOT propagate to a Task-tool-dispatched sub-agent, so `security-auditor.md`, `deep-reviewer.md`, and `vuln-scanner.md` each self-enforce with their own `disallowedTools` (camelCase per Claude Code sub-agent frontmatter) — blocking `Edit` (and, for `vuln-scanner.md`/`deep-reviewer.md`, `Write` too — neither has a legitimate file-write step), destructive `Bash(rm*|mv*|cp*|curl*|wget*|sudo*|chmod*)`, and `WebSearch`. WebSearch is denied because the auditor must never search the web about a candidate it is scanning: a target carrying prompt injection could turn that into an exfiltration channel. `Write` is intentionally **kept** on `security-auditor.md` only — its only file write is the RED-only `.ievo/hooks/security-red` lifecycle signal (Step 6); the report-body write happens later in `/ievo:init` Step 8b. (`WebFetch` is also kept for skills.sh audit signals — a known residual exfil surface tracked for a future `PreToolUse`-hook restriction.) The security skills (`security-check`, `vuln-scan`, `deep-review`) carry the same `WebSearch` denial in their `disallowed-tools` and a `model: sonnet` turn-pin for direct invocation.
- **Report-to-source flow** for RED verdicts: pre-filled GitHub issue body filed at source repo via `gh issue create`.
- **`CLAUDE_CODE_SUBAGENT_MODEL` precedence — operator gotcha.** Claude Code first mentions a `CLAUDE_CODE_SUBAGENT_MODEL` env var in v2.1.146 release notes (May 2026); it **overrides** agent frontmatter `model:`. Per [official docs](https://code.claude.com/docs/en/sub-agents), the resolution order is: (1) env var if set, (2) per-invocation parameter, (3) frontmatter, (4) main-conversation model. **If an operator sets `CLAUDE_CODE_SUBAGENT_MODEL` to any Haiku-tier value (`haiku`, or a pinned `claude-haiku-...` ID), the `security-auditor` runs at Haiku reasoning** — `security-check/SKILL.md` explicitly states "Haiku is insufficient (misses indirection attacks)", silently degrading the entire security guarantee. **Mitigation**: leave the env var unset (frontmatter wins), or set it to `sonnet`/`opus`. No equivalent Codex env var documented yet (May 2026); update this note when one ships.
- **Model bypass vectors — complete list.** `CLAUDE_CODE_SUBAGENT_MODEL` (above) is one of four settings that can route `security-auditor` to a weaker model. Because `security-check/SKILL.md` requires Sonnet-tier reasoning ("Haiku is insufficient — misses indirection attacks"), any of these resolving the auditor to a Haiku-class model silently breaks the guarantee. Verified against the [model-config docs](https://code.claude.com/docs/en/model-config) (2026-06-27):

  | Mechanism | Introduced | Effect on a subagent's model | Mitigation |
  |-----------|------------|------------------------------|------------|
  | `CLAUDE_CODE_SUBAGENT_MODEL` env var | v2.1.146 | **Overrides** all subagent `model:` frontmatter (highest precedence); still gated by `availableModels`. | leave unset, or set `sonnet`/`opus` |
  | `availableModels` allowlist | v2.1.166 (subagent overrides covered v2.1.172) | **The only hard enforcement.** Restricts the `model:` field, the Agent-tool `model` param, and `CLAUDE_CODE_SUBAGENT_MODEL`. If `sonnet` is excluded, `model: sonnet` is **silently dropped** to the inherited/default model — no error. | managed/org `availableModels` must include `sonnet` |
  | `enforceAvailableModels` | v2.1.175 (managed) | Locks the model picker's **Default** option to the first available allowlisted model; pairs with `availableModels` to make the allowlist authoritative (does not itself gate subagents). | pair with an `availableModels` list containing `sonnet` |
  | `fallbackModel` | v2.1.166 | **Availability** fallback only — when the in-use model is overloaded/unavailable, retries the configured model for that turn. A Haiku-class value can degrade a scan mid-run when Sonnet is rate-limited (common under parallel scans). Not enforcement; entries outside `availableModels` are dropped. | set `sonnet`/`opus`, or omit |

  The only hard enforcement is `availableModels` — every value above is filtered through it. The model-resolution precedence chain (env var → per-invocation param → frontmatter → main model) governs `CLAUDE_CODE_SUBAGENT_MODEL` and frontmatter `model:`; `enforceAvailableModels` and `fallbackModel` act on adjacent controls (the picker default and availability retry). Operator-side guarantee: managed `availableModels` includes `sonnet` (or `opus`), and `CLAUDE_CODE_SUBAGENT_MODEL` / `fallbackModel` are unset or Sonnet-class. Org-managed model restrictions are exactly this `availableModels` managed-settings mechanism.
- **External plugin install consent gate (CC platform, v2.1.195+).** This is a parallel concern to the bypass vectors above — not model selection, but install authorization. iEvo's own consent gate is the `AskUserQuestion` steps in the pipeline below (Step 7b's per-candidate interview, Step 8's RED-verdict confirmation) — the only gate iEvo itself enforces before an install is queued. The plugin install path (Step 9) enables a candidate by merging `extraKnownMarketplaces` + `enabledPlugins` into `.claude/settings.json` — exactly the enablement path [Claude Code v2.1.195](https://github.com/anthropics/claude-code/releases/tag/v2.1.195) (2026-06-26, verified 2026-07-06) fixed: before that release, external plugins enabled only via project `.claude/settings.json` did not require explicit install consent on every loader path, so CC's own platform-level consent dialog could be silently skipped when the plugin actually loaded (e.g. on `/reload-plugins` or next session start), leaving iEvo's `AskUserQuestion` as the only gate in practice. On v2.1.195+, both gates are active: (1) iEvo's `AskUserQuestion`, then (2) CC's own consent dialog on load. Operator minimum for full dual-gate protection: **Claude Code v2.1.195+**.

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
