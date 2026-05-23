# Changelog

All notable shipped versions of `ievo-ai/skills`. Forward roadmap (planned items) lives in `AGENTS.md` § Roadmap.

Entries are reverse-chronological (newest first) and reference the merging PR + the Eva proposal / external trigger where applicable.

---

## v0.6.16

Closes #65 with new `issue-handler.yml` workflow: when a new GitHub issue opens, Claude (Opus) performs deep research and either closes the issue with explanation or implements a fix/feature PR with full test coverage. After PR creation, monitors `claude-code-review` and iterates on feedback (max 3 rounds) until green; never auto-merges (human must merge).

Safety rails: bot-loop prevention via `endsWith('[bot]')` (catches the App's own bot login generically, not just `github-actions[bot]`), scope lock (agent prompt confines edits to `plugins/ievo/`), GitHub App token from org secrets `APP_ID` + `APP_PRIVATE_KEY` (so PRs trigger downstream workflows — `GITHUB_TOKEN` would silently skip them). Privilege ceiling: only `contents: write` + `issues: write` + `pull-requests: write`; deliberately NO `secrets: read`, NO `id-token: write` (`create-github-app-token@v1` signs a JWT with the private key directly — no OIDC exchange needed; granting id-token would mint arbitrary OIDC tokens for external services for no benefit).

Originally filed against the v0.6.12 baseline as PR #66; rebased onto v0.6.15 main and bumped to v0.6.16 (v0.6.14 slot was overtaken by v0.6.15 landing first via PR #70). 5 rounds of claude-review feedback applied — security: indirect-prompt-injection accepted-risk documented with mitigation enumeration, `Bash` in `--allowedTools` justified (no structured-tool equivalent for git ops), token passed via step-level `env:` not JSON-interpolated `settings:`; correctness: poll-loop case-normalized via `ascii_upcase`, `gh pr create` URL parsed into `$PR_NUMBER`, `MAX_WAIT=600` ×3 budget fits inside the 60-min job wall clock, `last.state` over `.[0].state` for rerun safety, exhaustion comment posted to BOTH issue + PR threads, sticky-comment endpoint correctly used.

## v0.6.15

Operational hygiene: extracted shipped-version history out of `AGENTS.md` into this `CHANGELOG.md`. Rationale — `AGENTS.md` is a contract for AI agents working on the repo and should describe *current* conventions; the chronological history is reference material that grows unbounded and dilutes the convention surface. Added a convention rule in `AGENTS.md` § Key conventions that all future shipped-version entries go here, not in `AGENTS.md`. The forward roadmap (v0.7.0 / v1.0) stays in `AGENTS.md` § Roadmap because it's a contract about what's coming, not a record of what shipped.

Reconciled the older `AGENTS.md` § Version bumping section (which said "touch two files") with the new four-file checklist so both rule blocks agree. Updated `README.md` § Roadmap to point at `CHANGELOG.md` for shipped-version history (it had frozen at `v0.6.9 (current)`) and aligned the v0.7.0 scope wording between `AGENTS.md` and `README.md`.

## v0.6.13

Spec compliance fix: `hooks-setup/SKILL.md` `compatibility` field trimmed from 537 chars to 412 chars — now within the agentskills.io spec limit of 500 chars (`compatibility: ≤500` explicitly documented in the spec May 2026). Caught by Eva audit run 26354909799. Closes the gap surfaced in ievo-ai/skills#68 (validate_skills.mjs proposal, filed same run).

## v0.6.12

Eva proposal #61 applied. New `/ievo:overlay-status` skill reads `.ievo/evolution/`, groups overlays by scope (Project / agents / skills) matching `evolution/SKILL.md`'s actual layout (`project.md` flat file at the evolution root + `agents/<name>.md` + `skills/<name>.md` subdirs), and emits a structured per-file summary with last-modified date — closing the self-documented "Standalone 'list installed iEvo overlays' command" gap that `coverage-audit.md` flagged in v0.6.8. Read-only (never modifies overlay files); pure Read + Glob enumeration + a single `stat` invocation for mtime via `Bash(stat*)` permission declared in frontmatter `allowed-tools`; cross-platform on the agentskills.io standard (POSIX hosts get mtime + 180-day stale-overlay warning; Windows hosts without POSIX shell omit dates with a footer note). Honours the *agent legibility* principle from [`DenisSergeevitch/agents-best-practices`](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/agent-legibility-feedback-loops.md): captured overlays are load-bearing for iEvo behaviour and were previously invisible until manually grepped. `coverage-audit.md` gap row flipped to `covered`; minimum file set includes the new skill. Credit: @ievo-eva for the proposal + the legibility-citation chain.

## v0.6.11

Eva proposal #60 applied. New `utf8-validate.mjs` pre-commit validator (`.github/scripts/validators/`) using `TextDecoder` `{ fatal: true }` for byte-level UTF-8 verification. Closes a Codex skill-load hole: Codex `rust-v0.133.0` (May 21, 2026) started warning on invalid UTF-8 in AGENTS / SKILL.md files instead of silent drops; catching the bad bytes at commit time prevents broken files from ever reaching install. Concrete failure modes caught: CP-1252 smart quotes from Word-paste (0x91-0x94, 0x96-0x97), Latin-1 / mis-encoded escape sequences in `terminalSequence` examples, truncated multi-byte tails at EOF. Wired into `.pre-commit-config.yaml` for `.md`/`.mjs`/`.js`/`.ts`/`.py`/`.sh`/`.yaml`/`.yml`/`.json`/`.txt` (excluding `package-lock.json` + `coverage.lcov`); CI `pre-commit-gate.yml` runs `pre-commit run --all-files` so no workflow change needed. Lives in `.github/scripts/validators/` — 100% coverage rule does not apply to lint-infra. Credit: @ievo-eva for the proposal + verified citations (Codex rust-v0.133.0 release notes; agentskills/agentskills PR #386 + #343 Windows UTF-8 fixes).

## v0.6.10

Eva proposal #59 applied. `/ievo:hooks-setup` skill extended with a new optional Step 5.5: read-side **Stop hook** for "all background agents complete" notification. Uses the `background_tasks` + `session_crons` fields added to Stop / SubagentStop hook input in Claude Code v2.1.145 — the hook fires its notification only when both arrays are empty (typically the moment parallel `security-auditor` / `repo-indexer` subagents dispatched by `/ievo:init` are done). Hook script written to `.ievo/hooks/scripts/on-stop.sh`; exits 0 unconditionally per the `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (default 8, v2.1.143+) blocking-Stop-hook semantics. Notification command parameterised: macOS `osascript`, Linux `notify-send`, terminal BEL fallback, or user-supplied custom. Read-side Stop hook is structurally distinct from the v0.6.9 write-side PostToolUse matchers (`Write(.ievo/hooks/<event>)`); both coexist in the same `settings.json`. Credit: @ievo-eva for the proposal + verified citations against the v2.1.145 release notes.

## v0.6.9

Eva proposal #57 applied with full integration. New `/ievo:hooks-setup` skill configures Claude Code lifecycle hooks for iEvo pipeline events (init-complete / security-red / evolution-captured) using exec-form `args: string[]` (v2.1.139+) and `terminalSequence` (v2.1.141+) — verified against release notes. Signal-file integration added to `init/SKILL.md` (Step 11.5 — writes `.ievo/hooks/init-complete`), `evolution/SKILL.md` (Step 5.5 — writes `.ievo/hooks/evolution-captured` after overlay append), and `security-auditor.md` (Step 6 — writes `.ievo/hooks/security-red` only on RED verdict). Without these signal files the hooks would have nothing to fire on — Eva's original #57 acknowledged this as a "follow-up PR needed"; bundled into v0.6.9 instead so the feature ships functional end-to-end. Credit: @ievo-eva for the skill design + verified Claude Code feature citations.

## v0.6.8

Eva proposals #52 + #51 + #53 applied.

- **#52**: `CLAUDE_CODE_SUBAGENT_MODEL` env var (Claude Code v2.1.146+) **overrides** agent frontmatter `model:` per [official docs](https://code.claude.com/docs/en/sub-agents) — operator setting it to a Haiku-tier value silently downgrades `security-auditor`. Warning added to `security-auditor.md`, `AGENTS.md` Security model section, and README "Known configuration gotcha" subsection.
- **#51**: Codex `doctor` pre-flight (Codex `rust-v0.131.0` shipped this diagnostic) added to `init/SKILL.md` Step 1.5 — fail fast with clear remediation on unhealthy Codex environments.
- **#53**: new `coverage-audit.md` at repo root maps user-intent → skill/command/agent/script with covered/gap/planned status. Pattern adopted from [`DenisSergeevitch/agents-best-practices/references/coverage-audit.md`](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/coverage-audit.md) — credit upstream.

## v0.6.7

`scan_repo.mjs` tests landed (the HARD STOP from v0.6.6 honoured). 6-phase refactor + 121 tests bring it to literal 100/100/100. `CARVE_OUTS` map in `.github/scripts/check-coverage.mjs` is now empty; the 100% rule applies to every `.mjs` in `plugins/ievo/scripts/` without exception. One dead `?? []` defensive guard removed from `renderIndexMd` in the process (unreachable since `enumerateOnePlugin` always populates `skills`).

## v0.6.6

Third Eva PR bundle (#47 + #48): `index-repos/SKILL.md` rule clarified — `scan_repo.mjs` tracks its own format-version independently of `plugin.json` (currently `1.1.0`, inherited from community-index-bot lineage); only `discover.mjs` is coupled to `plugin.json` and that coupling is enforced by `discover.test.mjs`. Plus `commands/uninstall.md` `allowed-tools` line now includes `Bash` — the Step 1 `grep -l` calls previously triggered manual-approval prompts.

## v0.6.5

Second Eva PR bundle (#44 + #45): missing `debug-on` / `debug-off` entries added to `AGENTS.md` + README directory listings, scripts listing in README expanded with `discover.mjs` / `validate_agents.mjs` / `tests/`, `/ievo:debug-on` + `/ievo:debug-off` rows added to README skills table. **Security fix**: `feedback/SKILL.md` Step 6 now writes the issue body via the Write tool + passes it to `gh` via `--body-file` instead of inline `--body "..."` — closes a shell-interpolation surface (user-verbatim feedback could contain backticks / `$(...)` / `${VAR}`). Pattern already enforced in `init/SKILL.md` Step 8b; this brings `feedback` into alignment.

## v0.6.4

Eva PR bundle (4 small text fixes that had been queued as PRs #37–#40 against the v0.6.2 baseline, all coverage-gated due to stale SCRIPT_VERSION coupling): stale "Python" → "Node" in `index-repos/SKILL.md`; stale `risk: <tier>` → `mcp: yes/no` in `repo-indexer.md` + `index-repos/SKILL.md` stdout-format docs; universal-first compatibility in `evolution/SKILL.md`; vendor-neutral "Sonnet family" instead of pinned "Sonnet 4.6+" in `security-check/SKILL.md`. Plus `/home/runner` whitelist in `machine-local-paths.mjs` (CI-doc false-positive from PR #41 claude-review).

## v0.6.3

Pre-commit hooks (5 validators: nested fences, machine-local paths, CRLF frontmatter, placeholder leakage, agent frontmatter) + `.github/workflows/pre-commit-gate.yml` server-side mirror; `AGENTS.md` "wait for in-progress reviews" rule promoted from operator memory; 2 pre-existing nested-fence bugs in `feedback/SKILL.md` fixed as the validator caught them.

## v0.6.2

claude-review follow-ups: `pathToFileURL` in tests for Windows-correct file URLs; `parseLcov` keys by full SF path with explicit basename-collision detection.

## v0.6.1

CI coverage gate (`.github/workflows/coverage-gate.yml`), `isCliEntry` refactor closes the CLI-entry-guard branch gap → ledger carve-outs dropped.

## v0.6.0

`discover.mjs` (own skills.sh API integration, drop find-skills prereq), debug-on / debug-off skills, 100% test coverage rule.

## v0.5.2

Antivirus deep-scan security model. Dropped owner-based trust (`TRUSTED_OWNERS`), risk_tier heuristics, pattern-matching verdicts. Current Sonnet-family reasoning over full content + all dependencies is the only trust signal (declared via vendor-neutral `model: sonnet` alias). Report-to-source flow — file a pre-filled GitHub issue at the source repo when a RED verdict is detected.

## v0.5.1

`npx skills add --all --copy` flags; hard-stop on missing find-skills prereq.

## v0.5.0

All-user-side architecture. Full Node migration. Categorical ranking. Parallel security-auditor sub-agents.

## v0.4 (reverted)

Pre-built community-index integration. Replaced with a simpler user-side architecture in v0.5.

## v0.3

Codex support, checkout-based indexing (no API rate limits), Python scanner.

## v0.2

Initial pipeline (find-skills → index-repos → security-check → install) + overlay model.
