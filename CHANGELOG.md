# Changelog

All notable shipped versions of `ievo-ai/skills`. Forward roadmap (planned items) lives in `AGENTS.md` § Roadmap.

Entries are reverse-chronological (newest first) and reference the merging PR + the Eva proposal / external trigger where applicable.

---

## v0.12.0

Add `effort:` field validation to `validate_skills.mjs`. All 13 iEvo SKILL.md files declare `effort:` (added in v0.6.24) and Claude Code v2.1.149+ renders it in the status bar, making it user-facing UI. The validator now warns on absent `effort:` (severity: warning, does not fail CI) and errors on invalid values (severity: error, fails CI). Valid values: `low`, `medium`, `high`, `xhigh`, `max`. Also introduces warning-vs-error severity distinction in the `main()` exit logic — warnings no longer cause exit 1, only errors do. Exports `VALID_EFFORT_VALUES` set and `checkEffortField()` function for reuse. Closes #141.
Add `disallowed-tools` frontmatter to `security-check/SKILL.md` and `vuln-scan/SKILL.md` for read-only enforcement during security assessments. Claude Code v2.1.152 introduced `disallowed-tools` in skill frontmatter, allowing skills to explicitly block specific tools during execution. The security-check skill now blocks `Write`, `Edit`, `Bash(rm*)`, `Bash(mv*)`, `Bash(cp*)`, `Bash(curl*)`, and `Bash(wget*)`; the vuln-scan skill blocks `Write`, `Edit`, `Bash(rm*)`, `Bash(mv*)`, and `Bash(cp*)`. This is defense-in-depth: the sub-agents already declare limited `tools:` allowlists, but the skill-level wrapper previously had no such restriction. Closes #139.
Add `disallowed-tools` frontmatter to `security-check/SKILL.md` and `vuln-scan/SKILL.md` for read-only enforcement during security assessments. Claude Code v2.1.152 introduced `disallowed-tools` in skill frontmatter, allowing skills to explicitly block specific tools during execution. The security-check skill now blocks `Write`, `Edit`, `Bash(rm*)`, `Bash(mv*)`, `Bash(cp*)`, `Bash(curl*)`, and `Bash(wget*)`; the vuln-scan skill blocks `Write`, `Edit`, `Bash(rm*)`, `Bash(mv*)`, `Bash(cp*)`, `Bash(curl*)`, and `Bash(wget*)`. This is defense-in-depth: the sub-agents already declare limited `tools:` allowlists, but the skill-level wrapper previously had no such restriction. Closes #139.

## v0.10.0

New `/ievo:inspect` skill — pre-install structured summary of a remote skill/plugin repo. Fetches the repo tree and key file frontmatter via `gh api`, then renders a human-readable capability overview (skills, agents, commands, scripts, hooks, MCP servers, aggregate permission footprint) without triggering discovery, security scan, or install. Read-only, pure SKILL.md (no scripts, no coverage obligation). Closes #67.

## v0.9.0

Add `yaml-frontmatter.mjs` pre-commit validator to catch YAML frontmatter syntax errors before they reach production. Detects unquoted values containing `: ` (colon-space), unterminated quoted strings, duplicate keys, flow indicator characters, and inline comment ambiguity. For SKILL.md files, also validates required fields (`name`, `description`) and description length. Motivated by PR #122 where 5 SKILL.md files had Codex-breaking unquoted colons that survived all existing validators. Includes comprehensive test suite (60 tests). Closes #119.

## [0.7.0](https://github.com/ievo-ai/skills/compare/v0.6.24...v0.7.0) (2026-05-25)


### Features

* add --help flag to discover.mjs (v0.6.23) ([1ddb550](https://github.com/ievo-ai/skills/commit/1ddb550981bde7ebaae642d12c889d3a56acff55))
* add --help flag to discover.mjs (v0.6.23) ([ffd9b2f](https://github.com/ievo-ai/skills/commit/ffd9b2f5b5e3577fc3a5238325d13fdaf32c22bf)), closes [#81](https://github.com/ievo-ai/skills/issues/81)
* add /ievo:feedback skill + init feedback prompt (0.1.8) ([8dc52b6](https://github.com/ievo-ai/skills/commit/8dc52b6b703d99ce19ceb3bd17b988aca5928173))
* add /ievo:feedback skill + init feedback prompt (0.1.8) ([09ba858](https://github.com/ievo-ai/skills/commit/09ba858d3a9f3faf2310545daeffa81bbc863801))
* add /ievo:schedule skill — guided Routine wizard (v0.6.24) ([dd593e5](https://github.com/ievo-ai/skills/commit/dd593e57e9c0fb53980f49bafea9eccb9fde01c5))
* add /ievo:schedule skill for periodic Routine creation (v0.6.24) ([a20906e](https://github.com/ievo-ai/skills/commit/a20906e8c1f95a1e4b7c3baf1ac9422d108db051)), closes [#84](https://github.com/ievo-ai/skills/issues/84)
* add effort: frontmatter to all 9 SKILL.md files (v0.6.24) ([59f1f8b](https://github.com/ievo-ai/skills/commit/59f1f8bc3606a173f954b3c7ecd3020ff7511e36))
* add effort: frontmatter to all 9 SKILL.md files (v0.6.24) ([0d713f8](https://github.com/ievo-ai/skills/commit/0d713f8c9bd5c6f3b8499210a29392d969bdef57)), closes [#83](https://github.com/ievo-ai/skills/issues/83)
* add marketplace.json — make repo installable as plugin marketplace ([f5aa4e2](https://github.com/ievo-ai/skills/commit/f5aa4e203d1268963c400323a71aa6404ecccddb))
* auto-translate feedback to English before submit (0.1.11) ([ee625d2](https://github.com/ievo-ai/skills/commit/ee625d23b508e0df336948f20aa59cbc993d2faa))
* auto-translate feedback to English before submit (0.1.11) ([fbdca37](https://github.com/ievo-ai/skills/commit/fbdca37e9637bd3c4efddb016145b89aed0c4100))
* automated version bumping via release-please ([4983e09](https://github.com/ievo-ai/skills/commit/4983e09871599f616c821c59a04567822f86340a))
* automated version bumping via release-please ([0c10aac](https://github.com/ievo-ai/skills/commit/0c10aacbc831e47c4110d8d4807d15859be6297c))
* deep stack/deps scan + agents awareness + consolidated search (0.1.6) ([2a5c53e](https://github.com/ievo-ai/skills/commit/2a5c53efa39611a2adb690d1157013be943a3ca9))
* deep stack/deps scan + agents awareness + consolidated search (0.1.6) ([f6e605d](https://github.com/ievo-ai/skills/commit/f6e605de22ad535fba3084c5d06590e60f5119a3))
* feedback quality gate + per-skill rejection reasons (0.1.10) ([5d7f62d](https://github.com/ievo-ai/skills/commit/5d7f62d9f6e303ac8c82c5c4180149d33025bfae))
* feedback quality gate + per-skill rejection reasons (0.1.10) ([991ada1](https://github.com/ievo-ai/skills/commit/991ada1c059d3e4435833955d270024a7b9a14a5))
* full multi-stack manifest coverage (0.1.7) ([7aa62ec](https://github.com/ievo-ai/skills/commit/7aa62ecd92478ebfc6699afa7632e312a06a01e6))
* full multi-stack manifest coverage (0.1.7) ([75b1c65](https://github.com/ievo-ai/skills/commit/75b1c65a2ff7bab8186dfdd04b300f81474dab89))
* generic sub-type disambiguation registry (0.1.12) ([54c2981](https://github.com/ievo-ai/skills/commit/54c2981fb664bdcb16b89bfd78baadef8a00ddb7))
* generic sub-type disambiguation registry (0.1.12) — closes [#11](https://github.com/ievo-ai/skills/issues/11) ([0144a0a](https://github.com/ievo-ai/skills/commit/0144a0ae8a65a86a0e2c5e130fd46bb38925740b))
* incremental log writes during init (0.2.4) ([263252b](https://github.com/ievo-ai/skills/commit/263252bf98269c5d6b3d1125350d9e9227ac93e1))
* incremental log writes during init (0.2.4) ([8f4df44](https://github.com/ievo-ai/skills/commit/8f4df4409dd1efeadcae2fcfbc636961b7fa6120))
* per-run diagnostic logging in .ievo/log/ + feedback log attach (0.1.13) ([a365950](https://github.com/ievo-ai/skills/commit/a365950626fce3954b285fbfe293a3582aa81fe8))
* per-run diagnostic logging in .ievo/log/ + feedback log attach (0.1.13) ([323b0fb](https://github.com/ievo-ai/skills/commit/323b0fbf5cd9d78db8c53dd81f976fba7bf72ec0))
* prompt + auto-add Bash permissions on init start (0.2.3) ([92ea322](https://github.com/ievo-ai/skills/commit/92ea322861dddd87eaa6b7f1d783515d1a160820))
* prompt + auto-add Bash permissions on init start (0.2.3) ([d8f4fd6](https://github.com/ievo-ai/skills/commit/d8f4fd630655f5fe22696115e507d3fb9ed2aa48))
* scaffold iEvo plugin v0.1.0 ([268667d](https://github.com/ievo-ai/skills/commit/268667d0695482cd7f80d79fabd58e69cfcf420a))
* user-level target handling in evolution (0.2.1) ([3317eec](https://github.com/ievo-ai/skills/commit/3317eeca9786ada4d0271b416a2e9278c7f16c2a))
* user-level target handling in evolution (0.2.1) ([a4c1261](https://github.com/ievo-ai/skills/commit/a4c1261449c94ce780a303e9deb907fe6585fa1c))
* v0.2.0 — full pipeline with index-repos, security-check, overlay model ([6235b52](https://github.com/ievo-ai/skills/commit/6235b52cca77df7cbf7065efd7df242309ef7b21))
* v0.2.0 — pipeline + index-repos + security-check + overlay evolution ([cfc06c0](https://github.com/ievo-ai/skills/commit/cfc06c02fbbc15ad6ff2b9e4852e49f3215569f5))
* v0.3.0 — checkout-based indexing (no more rate limits) ([6b0f5b5](https://github.com/ievo-ai/skills/commit/6b0f5b56b5ddf4a773fdf195c5133f5b3289fdeb))
* v0.3.0 — checkout-based indexing (no more rate limits) ([ccbf36f](https://github.com/ievo-ai/skills/commit/ccbf36f8e3cc7cf4eb0c9b6ecc9292836f6a59f0))
* v0.3.1 — parallel repo indexing via sub-agents ([a5e5228](https://github.com/ievo-ai/skills/commit/a5e5228c3d576f99f72163df73591254623e42db))
* v0.3.1 — parallel repo indexing via sub-agents ([5a03aad](https://github.com/ievo-ai/skills/commit/5a03aada8f5251eb987d534790db28b973ceab70))
* v0.3.3 — Codex support (.codex-plugin/marketplace.json) ([c695d7a](https://github.com/ievo-ai/skills/commit/c695d7abaddd6abd7af20e29fb7e61acdf0a013e))
* v0.3.3 — Codex support via .codex-plugin/marketplace.json ([2df8699](https://github.com/ievo-ai/skills/commit/2df86995ba9a306353980fd80c27664b4a8212ba))
* v0.3.4 — extract scanner to Python script (single source of truth) ([5892307](https://github.com/ievo-ai/skills/commit/589230764616c53b8783cdcc1a47057471523d0c))
* v0.3.4 — extract scanner to Python script (single source of truth) ([ece5412](https://github.com/ievo-ai/skills/commit/ece54125f8c67561cc8b219b1d51dec12a23c11f))
* version banner + mandatory verbose logging (0.2.2) ([d161d1f](https://github.com/ievo-ai/skills/commit/d161d1f3bfd8ff493fc3ce1c201fed6e972d350f))
* version banner + mandatory verbose logging (0.2.2) ([ea8e4d6](https://github.com/ievo-ai/skills/commit/ea8e4d6da6d83939a99b1ee803112b334b898eac))


### Bug Fixes

* add delimiter collision guard comment per code review ([9fc340e](https://github.com/ievo-ai/skills/commit/9fc340eaec7a9f53313c542913c4bf83b2352a28))
* add schedule skill to AGENTS.md directory listing ([42c78cf](https://github.com/ievo-ai/skills/commit/42c78cf0a2bbb6679d6e22f96dfeb73cf75c2bb2))
* add stale-listing pre-validation in init (0.1.9) ([7576845](https://github.com/ievo-ai/skills/commit/75768456af1c4906731f9b2e3a31479d0413eccd))
* address code review findings on schedule skill ([af5c175](https://github.com/ievo-ai/skills/commit/af5c175edb3aaf63d0a02d30a3de7cb12d056e1e))
* address review findings on version-bump automation ([c21955d](https://github.com/ievo-ai/skills/commit/c21955d3b1882b8064f290a6ebba444f05a43ff9))
* address round-2 review findings ([51a9bb7](https://github.com/ievo-ai/skills/commit/51a9bb7845d4ff0984eb8f55ee028c82dc47fd0b))
* allow ievo-eva[bot] in claude-code-review allowed_bots ([6b3f3d2](https://github.com/ievo-ai/skills/commit/6b3f3d2f944e9cf71415b75a59bb306552dab9c9))
* allow ievo-eva[bot] in claude-code-review allowed_bots ([6f589f0](https://github.com/ievo-ai/skills/commit/6f589f06a0d4a1d6e33702d70c6167c050ee8f65))
* bulletproof version banner — Read tool, no inference (0.2.6) ([efda230](https://github.com/ievo-ai/skills/commit/efda230e4e18cde61c1fc681c8ffc647a119f1d0))
* bulletproof version banner — Read tool, no inference (0.2.6) ([857ecce](https://github.com/ievo-ai/skills/commit/857ecce84985e15fb506b6267a9416e8e166e183))
* claude-review findings on PR [#54](https://github.com/ievo-ai/skills/issues/54) ([ccf620f](https://github.com/ievo-ai/skills/commit/ccf620f9e37128249cfb6a7edc63568c60a9b6f7))
* claude-review findings on PR [#55](https://github.com/ievo-ai/skills/issues/55) ([53b16b8](https://github.com/ievo-ai/skills/commit/53b16b84e079371937f884d24ef036c670e7f787))
* collision error message — drop misleading remediation hint ([54c6412](https://github.com/ievo-ai/skills/commit/54c6412ff0533ad349a061b5d91b7ab083a16567))
* deduplicate init skill suggestions + bump 0.1.5 ([05923ac](https://github.com/ievo-ai/skills/commit/05923ac8c717fb0f98ebd03837c85b00a6e7c42a))
* deduplicate init skill suggestions + bump 0.1.5 ([aa398a6](https://github.com/ievo-ai/skills/commit/aa398a62affbd17c8578ec1b76ec1592910c1c26))
* drop non-schema 'url' field from owner/author + bump 0.1.2 ([d0fc986](https://github.com/ievo-ai/skills/commit/d0fc986e0d22f6c0a6204c5ed0212bf6248f6ed1))
* explicit no-pause directive + per-repo checkpoint (0.2.5) ([3823d4a](https://github.com/ievo-ai/skills/commit/3823d4a2baf610e1382f011ed4f7312020b2db11))
* explicit no-pause directive + per-repo checkpoint (0.2.5) ([00ff37d](https://github.com/ievo-ai/skills/commit/00ff37d1f85caa2795911809881f3ee72ccd99f9))
* extract issue-handler prompt to separate file (v0.6.22) ([8b27f9a](https://github.com/ievo-ai/skills/commit/8b27f9a7557f3d4c83315ddd8c517bfff97279db))
* extract issue-handler prompt to separate file (v0.6.22) ([aa99921](https://github.com/ievo-ai/skills/commit/aa999219286d2dfa2b9fe9f74bfeec40a37b85af)), closes [#78](https://github.com/ievo-ai/skills/issues/78) [#79](https://github.com/ievo-ai/skills/issues/79)
* nested-fences message uses outerLabel for untagged outer fences ([5eab1d1](https://github.com/ievo-ai/skills/commit/5eab1d16c47069a71858f275b3adeddabca89d31))
* Pass 4 broader probes + soft-fail (0.1.14) ([b5ee60a](https://github.com/ievo-ai/skills/commit/b5ee60a123b8045a204231c9d9496ec549d1dde4))
* Pass 4 broader probes + soft-fail (keep on uncertain) — 0.1.14 ([098db45](https://github.com/ievo-ai/skills/commit/098db45960846fb103dcdddd3bf4c35002ab6061))
* pre-validate skill existence to drop stale skills.sh listings (0.1.9) ([2904696](https://github.com/ievo-ai/skills/commit/29046969dd862e8674b5190028e628e96d538729))
* remove non-schema 'url' field from owner/author + bump 0.1.2 ([9e7b4c8](https://github.com/ievo-ai/skills/commit/9e7b4c82f96dd065feff44e0522d58c07a2dcbe5))
* repo-indexer on sonnet, not haiku (0.3.2) ([bc92251](https://github.com/ievo-ai/skills/commit/bc922519954f5965dd6f38d51b81ee2885c26b04))
* repo-indexer on sonnet, not haiku (0.3.2) ([4503510](https://github.com/ievo-ai/skills/commit/450351063d94b99f435999df4c1ed5efb5ce8cf0))
* repository field must be string + bump 0.1.4 ([a2c8a27](https://github.com/ievo-ai/skills/commit/a2c8a27c084b8a23fe4f66ab5c9ea7776d0d0eb6))
* repository field must be string, not object + bump 0.1.4 ([9f4cd49](https://github.com/ievo-ai/skills/commit/9f4cd49fbd4894b83c12e063caa6ee051286332a))
* restore GH_TOKEN comment + add delimiter collision guard ([2aa6412](https://github.com/ievo-ai/skills/commit/2aa6412c0bcc76f1d0aeced6f84610e1002d4924))
* restructure plugin into ./plugins/ievo/ (compat with older Claude Code versions) ([659426f](https://github.com/ievo-ai/skills/commit/659426f04a87822ba0cb9b08adfe397e331f76bc))
* restructure plugin into ./plugins/ievo/ subdirectory ([e617a60](https://github.com/ievo-ai/skills/commit/e617a600c180f4251f97b0868324b475c8679cd1))

## v0.6.24

Add `effort:` frontmatter field to all 9 SKILL.md files, enabling Claude Code's status-bar effort display (fixed in v2.1.149). Values: `max` for init (full 6-stage pipeline), `high` for security-check (deep reasoning scan), `medium` for index-repos (repo filesystem scan), `low` for the remaining 6 skills (hooks-setup, overlay-status, evolution, feedback, debug-on, debug-off). Frontmatter-only change — no skill body content or script logic modified. Closes #83.

## v0.6.23

`discover.mjs` gains a `--help` flag that prints brief usage text and exits 0. Parsed before other argv (works without `--stack-file` or stdin), mirroring the v0.6.20 `--version` flag pattern. Useful for operators who need a quick reference of available flags and input modes without reading source. Closes #81.

## v0.6.22

Extracts the issue-handler's inline prompt (30KB, 600 lines) from the workflow YAML into `.github/prompts/issue-handler.md` and loads it via env var at runtime. The v0.6.21 changes nearly doubled the workflow file size (24KB to 46KB), which caused GitHub's workflow-file parser to reject it — the handler silently stopped firing on new issues. The workflow YAML drops from 773 lines (46KB) to 149 lines (7.4KB). Prompt content is unchanged; only the delivery mechanism changed. Verified by creating test issues #78 and #79 which both failed to trigger the handler before this fix.

## v0.6.21

Hardening pass on the v0.6.16 `issue-handler.yml` workflow — closes the autonomy gaps surfaced by the v0.6.20 cycle (PR #75 needed three human interventions: hotfix-restore-id-token v0.6.17, hotfix-allowlist-bot v0.6.19, manual rebase from v0.6.18 → v0.6.20 when main moved underneath). Phase 4f now queries main's *current* version at push time (not branch time) + scans open PRs for in-flight version claims to pick the next free slot atomically. Phase 4f.5 is new — mandatory CHANGELOG.md entry per the convention. Phase 4h now wraps push in a rebase loop (up to 3 attempts): if main moved while Phase 1-4 ran, auto-rebase + auto-resolve version-file conflicts only (escalates to issue thread on any non-version conflict — won't blindly resolve code conflicts). Phase 5 gains a 2.5 step that greps the claude-review run log for known structural failure patterns (Bad credentials, Workflow validation failed, non-human actor, OIDC fetch fail, App token exchange fail) and auto-retriggers via close+reopen without counting the round against the 3-attempt budget. Phase 5 also gains a 2.6 step that detects DIRTY/CONFLICTING PRs (no CI fires on those — GitHub Actions skips `pull_request` events when the PR can't merge cleanly) and re-runs the Phase 4h rebase loop to recover. Net result: future handler runs should be able to ship a clean PR end-to-end on their own across the realistic edge cases (parallel PRs, main moves, action-side flakes) instead of stalling silently and waiting for a human.

## v0.6.20

`discover.mjs` gains a `--version` flag that prints `SCRIPT_VERSION` and exits 0 (short-circuits before stdin/parseArgs so it works even without `--stack-file`). Useful for operators verifying which version of the script ships with their installed plugin — common need when debugging stale-version-coupling failures.

This PR was **the first feature autonomously generated by the v0.6.16 issue-handler workflow** (PR #75, response to issue #74). The handler did the implementation + tests + 4-file version bump on its own; humans intervened only to (a) ship the v0.6.17 / v0.6.19 hotfixes that unblocked the workflow itself, (b) rebase the branch when main moved during the handler's run (this PR was originally v0.6.18, bumped to v0.6.20 after v0.6.19 landed first), (c) add this CHANGELOG entry that the handler's Phase 4 prompt didn't yet include (gap to be closed in v0.6.21).

## v0.6.19

Hotfix companion to v0.6.16/v0.6.17: enable `claude[bot]` PRs to pass through `claude-code-review.yml`. The issue-handler workflow (v0.6.16) opens PRs as the `claude[bot]` App actor; `claude-code-action` defaults to rejecting bot actors with "Workflow initiated by non-human actor" before the review runs. Phase 5 of the handler's review-loop could never get a verdict to iterate on — first observed on PR #75 (the v0.6.18 handler-generated PR for issue #74), workflow run 26360560927. Added `allowed_bots: 'claude[bot]'` to `claude-code-review.yml` — narrow allowlist (not `'*'`) preserves the gate against arbitrary other bots while letting the org App through. Detailed comment block in the workflow points future maintainers at the failed run + the issue-handler dependency, so a `git blame` walk surfaces the rationale.

(v0.6.18 itself is the auto-generated `--version` flag from PR #75, still pending merge as of this entry. Once that merges, the chain v0.6.17 → v0.6.18 → v0.6.19 will be contiguous.)

## v0.6.17

Hotfix on v0.6.16's `issue-handler.yml`: restored `id-token: write` to the workflow's permissions block. The earlier rounds had stripped it on the assumption that `actions/create-github-app-token@v1` (the only OIDC-named consumer in the workflow source) doesn't need it — which is true for that action, but NOT for `anthropics/claude-code-action@v1` itself, which runs its own OIDC token exchange internally as part of startup. The first live test run on issue #72 failed immediately with `Unable to get ACTIONS_ID_TOKEN_REQUEST_URL` before any agent code executed. Added a detailed comment block documenting the requirement + linking to the failed run so a future maintainer doesn't repeat the strip-on-assumption mistake.

## v0.6.16

Closes #65 with new `issue-handler.yml` workflow: when a new GitHub issue opens, Claude (Opus) performs deep research and either closes the issue with explanation or implements a fix/feature PR with full test coverage. After PR creation, monitors `claude-code-review` and iterates on feedback (max 3 rounds) until green; never auto-merges (human must merge).

Safety rails: bot-loop prevention catches any `*[bot]` login generically (not just one well-known account name), scope lock (agent prompt confines edits to `plugins/ievo/`), authenticates via a GitHub App so PRs trigger downstream workflows. Privilege ceiling: only the minimum write permissions for the use case (contents / issues / pull-requests); deliberately no broader scopes.

Originally filed against the v0.6.12 baseline as PR #66; rebased onto v0.6.15 main and bumped to v0.6.16 (v0.6.14 slot was overtaken by v0.6.15 landing first via PR #70). 5 rounds of claude-review feedback applied — security: indirect-prompt-injection accepted-risk documented with mitigation enumeration, `Bash` in `--allowedTools` justified (no structured-tool equivalent for git ops), App credentials passed via step-level `env:` rather than JSON-interpolated into action settings; correctness: poll-loop case-normalized via `ascii_upcase`, `gh pr create` URL parsed into a PR number, poll budget reduced to fit inside the job wall clock with room for implementation work, `last.state` over `.[0].state` for rerun safety, exhaustion comment posted to BOTH issue + PR threads, sticky-comment endpoint correctly used.

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
