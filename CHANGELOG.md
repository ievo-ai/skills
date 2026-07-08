# Changelog

All notable shipped versions of `ievo-ai/skills`. Forward roadmap (planned items) lives in `AGENTS.md` § Roadmap.

Entries are reverse-chronological (newest first) and reference the merging PR + the Eva proposal / external trigger where applicable.

---

## v0.50.1

Gate `/ievo:update`'s upstream refresh behind a security re-audit when vendored content actually changed — closes #349.

- **Gap closed** — `/ievo:update` refreshed a vendored agent/skill by fetching upstream and overwriting the local copy with no re-audit of any kind, silently restoring executability (`chmod +x` on `.sh`/`.py`) of whatever the current upstream state happened to be. `/ievo:init`'s `security-auditor` gate is install-time only; a repo/path compromised after the original audit (maintainer account takeover, malicious commit) could re-poison a previously-trusted local copy on the next refresh with zero user-visible signal.
- **Fix** — `plugins/ievo/commands/update.md` now stages the upstream fetch instead of writing it directly (Step 2), diffs it against the current local copy (new Step 2.5), and only proceeds untouched when the bytes are identical. When they differ, it dispatches a fresh `security-auditor` sub-agent against the current upstream state — the same GREEN/YELLOW/RED gate `/ievo:init` Step 8 applies at install time. GREEN applies silently; YELLOW/RED stops before anything touches disk and requires explicit `AskUserQuestion` confirmation, with a decline leaving the local copy and the overlay's `source.commit_sha` untouched so the next update re-attempts. Unchanged content is never re-scanned, so the common no-op refresh stays as cheap as before. Added `Task` + `AskUserQuestion` to the command's `allowed-tools`. Report (Step 6) and the Rules section updated to reflect the new re-audit states.
- **Scope** — confined to `plugins/ievo/commands/update.md`; `security-auditor.md`'s existing `<owner>/<repo>@<name>` candidate-spec dispatch contract is reused as-is, no changes to the auditor itself.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits a plugin file under `plugins/ievo/**`); `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.50.0

Add a vendored `/ievo:consolidate` skill and teach `/ievo:evo` to offer extracting generalizable `project.md` clusters into a new skill or agent — closes #345.

- **New skill** — vendored `/consolidate` (verified byte-identical between the upstream `ievo-ai/cli` and `ievo-ai/marketplace` copies) into `plugins/ievo/skills/consolidate/SKILL.md`, converted to agentskills.io SKILL.md frontmatter. Preserves the original 5-phase, 3-checkpoint doc-graph consolidation flow (Discovery → Analysis → Proposal → Migration → Verification) as the default mode.
  - Adds a second, auto-detected **entry-cluster mode**: when the `--root` flag points at an iEvo overlay file (e.g. `.ievo/evolution/project.md`), the skill treats dated `## ` entries as the unit instead of files, judges (LLM reasoning, no mechanical entry-count threshold) whether 2+ entries describe the same recurring procedure or role, and — only after explicit approval at its own Checkpoint 1 (Proposal) and Checkpoint 2 (Migration) — authors a new project-local `.claude/skills/<name>/SKILL.md` and/or `.claude/agents/<name>.md` from scratch, then replaces the migrated overlay entries with a one-line redirect note. Full frontmatter templates and the registration mechanism live in the new `references/package-authoring.md`.
  - Nothing is ever deleted from an overlay before its Migration checkpoint is approved — matches `evo/SKILL.md`'s existing no-silent-override philosophy.
- **`evo/SKILL.md`** — new optional **Step 5.7**, structurally parallel to the existing Step 5.6 (upstream-feedback offer): after every append to the **project-wide** overlay (`.ievo/evolution/project.md`), runs the same cheap cluster-judgment check and, if a generalizable cluster is found, offers via `AskUserQuestion` to hand off to `/ievo:consolidate --root .ievo/evolution/project.md`. Default is silent — no cluster, no prompt. Agent/skill-scope captures are unaffected (out of scope for this proposal). Step 6's report gained a matching "Extraction offer" line; "See also" gained a `consolidate/SKILL.md` entry.
- **Design note** — per the issue's re-triaged scope: vendoring `/consolidate` was explicitly in-scope (not a prerequisite issue), the package-authoring logic lives inside `/consolidate` itself rather than reusing `/ievo:init`'s install step, and clustering is LLM judgment rather than a fixed `>=3` threshold (dropped from the original proposal during triage).
- **Version** — bump per AGENTS.md rules (`feat:` → minor, pre-1.0; adds a new plugin skill). `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.49.3

Fix a CWE-22 path-traversal gap in `scan_repo.mjs`'s `<owner>/<repo>` argument handling — closes #339.

- **Gap closed** — the only validation on `--repo` was `!args.repo.includes("/")`, which accepts any string containing at least one `/` with no character-set restriction and no rejection of `..` segments. Both places deriving a filesystem path from that argument — `checkoutOrRefresh`'s clone-target computation and `main()`'s output-file naming — used the non-global, first-match-only form of `String.prototype.replace("/", "-")`, so a payload like `../../../../tmp/evil/payload` survived mostly intact and `path.join` resolved the result outside the intended checkout/output directory.
- **Fix** — `main()` now validates `--repo` against a strict GitHub `<owner>/<repo>` slug (new `isValidOwnerRepo`/`OWNER_REPO_RE`), rejecting anything with extra `/` segments, out-of-charset characters, or an embedded `..` before any path is derived. Both `.replace("/", "-")` call sites now use a global replace, flattening every `/` into one literal path segment as defense-in-depth. A new `assertContained` helper asserts the resolved checkout target and both output-file paths stay inside their parent directory, throwing otherwise — mirrors the allowlist-sanitizer pattern already used by `evolution_candidates.mjs`'s `sanitizeSessionId`.
- **Tests** — added coverage for `isValidOwnerRepo` (valid slugs, multi-segment/traversal/oversized/malformed rejections) and `assertContained` (contained vs. escaping paths), plus regression tests exercising the exact reported payload through `checkoutOrRefresh`, `main()`, and the CLI entry point. `scan_repo.mjs` stays at 100/100/100.
- **Version** — bump per AGENTS.md rules (`fix:` → patch); `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. `scan_repo.mjs`'s own `SCRIPT_VERSION` (scanner output-format version) is intentionally left at `1.1.0` — this fix changes input validation and internal path safety only, not the `.md`/`.json` output format.

---

## v0.49.2

Make `/ievo:version`'s update instruction scope-aware and switch it to the `claude` CLI form — closes #332.

- **Gap closed** — Step 5's render and the Rules section hardcoded `/plugin update ievo` with no `-s/--scope` flag. `-s/--scope` defaults to `user` (per the CLI reference), so an install enabled only at **project** scope — one of `/ievo:init`'s own two documented install paths — made the rendered instruction fail outright. #319/#323 (v0.47.2) fixed the plugin-naming half of this render but missed the scope dimension entirely.
- **Verified empirically** (`claude plugin update` run live during implementation, matching the issue reporter's own live tests): the bare `ievo` name fails regardless of scope (`Plugin "ievo" not found`); the fully-qualified `ievo@ievo-skills` form succeeds once the correct `-s <scope>` is passed. Also re-verified against the current commands reference (`code.claude.com/docs/en/commands`): the interactive `/plugin` command documents `list`, `install`, `enable`, and `disable` as subcommands that "act directly" on arguments — `update` is not among them — so the previously-rendered `/plugin update ievo` slash form was never a documented, direct-acting command in the first place.
- **Fix** — `version/SKILL.md` Step 5 now detects the install scope before rendering: checks `.claude/settings.json` (project), `.claude/settings.local.json` (local), then `~/.claude/settings.json` (user), in that precedence order, for an `enabledPlugins` key matching `ievo`/`ievo@<marketplace>` with a `true` value, via the same read-only `jq` pattern the skill already uses (no new `allowed-tools` permission needed). Switches the recommended command from the interactive `/plugin update ievo` slash form to the documented, scope-aware `claude plugin update ievo@ievo-skills -s <scope>` CLI form; project/local-scope renders add a reminder to run it from the project root, since that scope resolves against the shell's cwd. Degrades honestly to a `claude plugin list` + manual-pick fallback when no scope match is found. The confidently-non-CLI branch (#328/v0.49.0) is unchanged — scope detection and the CLI form only apply to the CLI/uncertain branch.
- **Scope** — left the passive SessionStart version-check nudge (`hooks-setup/SKILL.md` Step 5.7) untouched; the issue's fix sketch scoped this to `version/SKILL.md` only.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits a plugin file under `plugins/ievo/**`); `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.49.1

Document CC v2.1.195's external plugin install consent gate fix as the minimum version for iEvo's dual-gate install protection — closes #264.

- **Gap closed** — `AGENTS.md` § Security model documented four model-selection bypass vectors but said nothing about install-authorization: iEvo's `/ievo:init` plugin path (Step 9) installs a candidate by merging `extraKnownMarketplaces` + `enabledPlugins` into `.claude/settings.json` — exactly the enablement path Claude Code v2.1.195 fixed a consent bug for.
- **Verified against the primary source** (`gh api repos/anthropics/claude-code/releases/tags/v2.1.195`, checked during implementation) — the release note is narrower than the initial proposal's paraphrase: it fixes "external plugins enabled only by project `.claude/settings.json` not requiring explicit install consent on every loader path," not a general "any external plugin install" bug. The added documentation uses this precise scope rather than the broader framing.
- **Fix** — added a new bullet to `AGENTS.md` § Security model (below the model bypass-vectors table, as its own paragraph rather than a table row — the table is model-selection-specific, this is a different concern) distinguishing iEvo's own `AskUserQuestion` consent gate (Step 7b/8) from CC's platform-level consent dialog, and naming **Claude Code v2.1.195+** as the minimum for both gates to be active. Extended `init/SKILL.md`'s `compatibility` frontmatter with a matching `v2.1.195+` note, trimming other clauses in the same field to stay under the agentskills.io 500-char limit (`validate_skills.mjs` enforces this). `README.md`'s "Plugin install" section documents the identical `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins` mechanism, so it gets a matching one-sentence cross-reference to the AGENTS.md paragraph — following the precedent set by the prior `classifyAllShell` doc-drift fix (v0.47.5) of updating both docs together.
- **Scope** — left `security-check/SKILL.md` unchanged: that skill only audits candidates, it doesn't perform the install step the consent gate protects, consistent with the issue's acceptance criteria.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits a plugin file under `plugins/ievo/**`); `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.49.0

Make `feedback` and `version` client-surface-aware — closes #328.

- **Feature** — `feedback/SKILL.md` Step 3 now also infers the invoking client surface (`CLI terminal` / `Desktop app` / `IDE extension` / `web` / `uncertain`) and renders it as a new `- Client surface: <...>` line in the auto-collected `## Environment` block (both flow A and flow B report formats).
- **Feature** — `version/SKILL.md` Step 5 now infers the same signal before rendering the "you're behind" message: a confidently CLI (or uncertain) session keeps today's `run /plugin update ievo` instruction; a confidently non-CLI session instead gets a generic `check your Claude client's plugin/extension update mechanism` instruction.
- **Design, per the approved issue discussion** — both fixes are a **model-reasoning step**, not a Bash/env-var read or a hardcoded tool-prefix lookup table. Live testing during the issue's research (Codex Desktop, a Claude-Desktop-style wrapper) found neither platform exposes a documented, stable "which surface" signal — both models had to infer their surface from indirect context (tool-namespace availability, capability-unavailability statements, product-identity strings). A reasoning instruction self-updates as platform internals change and degrades honestly to `uncertain` rather than asserting a wrong surface, so this also sidesteps `feedback/SKILL.md`'s existing "Do NOT collect: environment variables" rule entirely — no env var is read, the rule stands untouched.
- **Non-fabrication guard** — `version/SKILL.md` never asserts a specific unverified Desktop/VS Code/JetBrains menu path for the non-CLI branch, per the issue's explicit caution; the non-CLI instruction stays generic.
- **Version** — bump per AGENTS.md rules (`feat:` → minor, pre-1.0; adds new plugin-file capability). `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.48.0

Add zero-setup `hooks:` frontmatter to `evo`, `security-check`, and `init` for built-in completion notifications — closes #159.

- **Feature** — `evo/SKILL.md` and the `evolution` sub-agent it may delegate to (`agents/evolution.md`) each gained a `PostToolUse` hook that prints a one-line confirmation the moment the evolution signal file (`.ievo/hooks/evolution-captured`) is written; `security-check/SKILL.md` and `init/SKILL.md` each gained a `Stop` hook that prints a completion message when their turn ends. All four require zero configuration — no `/ievo:hooks-setup` run needed — and stay terminal-only (no `osascript`/`notify-send`) so they degrade identically on every platform.
- **Corrected from the original proposal** (per approval comment) — the drafted JS-style boolean matchers (`"tool_name == 'Write' && ..."`, `"background_tasks.length == 0"`) are not valid; `matcher` only accepts tool names (`"Write"`, `"Edit|Write"`, or a bare regex), verified against the current [hooks reference](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents). Path filtering uses the per-handler `if` field instead (permission-rule syntax, e.g. `if: "Write(.ievo/hooks/evolution-captured)"`); `Stop` hooks take neither `matcher` nor `if` (both are ignored/inert on that event) and fire unconditionally when their carrying skill's turn ends. Target file was also corrected from `evolution/SKILL.md` (renamed to `evo/SKILL.md` in v0.47.4) to the current path.
- **Added beyond the proposal's file list** — `agents/evolution.md` gained the same `PostToolUse` hook as `evo/SKILL.md`. `evo` delegates its capture to this sub-agent when available, and the actual `.ievo/hooks/evolution-captured` write happens inside that delegated sub-agent's own context — without a matching hook there, the notification would silently never fire on the (default, Claude-Code-with-iEvo) delegated path.
- **Scope note documented, not fixed** — `security-check`'s `Stop` hook converts to `SubagentStop` when the skill runs inside a parallel `security-auditor` sub-agent (the `/ievo:init` Step 8 path), firing once per candidate scanned rather than once for the whole batch; the existing session-level Stop hook (`hooks-setup/SKILL.md` Step 5.5, `background_tasks`-aware) remains the correct mechanism for a single "all scans done" signal.
- **`hooks-setup/SKILL.md`** documents the new tier as complementary to its own session-level `settings.json` hooks (richer notification styles, persists across sessions) vs. the new per-skill tier (zero setup, terminal-only, scoped to the carrying skill's lifecycle). Also flags (ticket-link-pending, not fixed here) that Step 5's own existing `PostToolUse` templates write the full `"Write(.ievo/hooks/<event>)"` string into `matcher` rather than `if` — the same invalid pattern the proposal was corrected away from — discovered as a byproduct of this work; fixing it also requires reworking Step 6's dedup-by-`matcher` logic, so it's left as a follow-up rather than bundled into this docs-scoped change.
- **Verification caveat** — the approval comment asked for each matcher to be verified against a real hook run before merging. This automated build environment has no interactive Claude Code session to fire a live hook in; verification here is against the current official hooks/permissions documentation (cited above) plus internal consistency with this repo's own `hooks-setup/SKILL.md` conventions (signal-file paths, non-blocking `exit 0` semantics). A live-fire check on a real session remains worth doing before broad reliance.
- **Version** — bump per AGENTS.md rules (`feat:` → minor, pre-1.0; adds new plugin-file capability). `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION`, `plugin.json`, `marketplace.json`, and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.5

Document CC v2.1.193's `autoMode.classifyAllShell` interaction with `/ievo:init`'s bash-heavy pipeline — closes #257.

- **Gap closed** — `init/SKILL.md` documented the Auto Mode classifier's default handling of `gh api`/`gh search` (Step 1's `permissions.allow` recommendation) but said nothing about `autoMode.classifyAllShell: true`, which suspends narrow Bash allow rules entirely while Auto Mode is active. A user with that setting on would have every one of the pipeline's 20+ bash calls routed through the classifier individually, with no indication this skill's existing permission guidance no longer applies. `README.md`'s "Permission pre-setup" section carries the same `permissions.allow` guidance and had the identical gap.
- **Verified against current docs** (`https://code.claude.com/docs/en/auto-mode-config`, fetched during implementation) — `autoMode.classifyAllShell` only affects Auto Mode sessions (no effect in other permission modes); when `true` it suspends *every* Bash/PowerShell allow rule for the duration, trading latency (a classifier round-trip per call) for coverage, rather than guaranteeing an interactive approval prompt per command as originally proposed. Requires Claude Code v2.1.193+.
- **Fix** — added a `v2.1.193+` note to `init/SKILL.md`'s `compatibility` frontmatter pointing at Step 1, and a new paragraph in Step 1's "Permission check (auto-mode classifier)" section explaining the interaction and the only available mitigation: disable `autoMode.classifyAllShell` for the init session, or accept the pipeline-wide per-call classifier cost. Added a matching one-sentence cross-reference to `README.md`'s "Permission pre-setup" section pointing at the same Step 1 detail, so the two docs stay consistent.
- **Scope** — skipped the proposal's optional Phase 0 preflight check (`claude config get autoMode.classifyAllShell`): that command doesn't exist in the current CLI (the documented inspection commands are `claude auto-mode config`/`defaults`/`critique`), and the proposal's own open question on hard-block vs. soft-note framing was never resolved — left as documentation-only per the acceptance criteria's optional marking.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits a plugin file under `plugins/ievo/**`); `discover.mjs` and `evolution_candidates.mjs` `SCRIPT_VERSION` (both coupled to `plugin.json` via their own tests, though AGENTS.md's "bump these four files" checklist only names `discover.mjs`) and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.4

Rename the "capture a lesson" skill invocation from `/ievo:evolution` to `/ievo:evo` for faster typing — closes #329.

- **Reason** — operator request: "evolution" is slow to type for a skill invoked often (any time a mistake, convention, or pattern is worth recording); a short alias lowers the friction to actually using it.
- **Fix** — `git mv plugins/ievo/skills/evolution/ plugins/ievo/skills/evo/`, updated its `name:` frontmatter to `evo` and its `# Evolution` heading to `# Evo`. Updated every live `/ievo:evolution` invocation and every `evolution/SKILL.md` path cross-reference to `/ievo:evo` / `evo/SKILL.md` across `README.md`, `AGENTS.md`, `coverage-audit.md`, `plugins/ievo/commands/uninstall.md`, `plugins/ievo/commands/update.md`, `plugins/ievo/skills/{overlay-status,init,feedback,evo-auto-enable,evo-auto-disable,hooks-setup,debug-on,handoff,schedule}/SKILL.md`, `plugins/ievo/agents/evolution.md`, and a comment in `plugins/ievo/scripts/evolution_candidates.mjs`.
- **Left untouched** — the general `.ievo/evolution/<scope>/<name>.md` overlay-path convention and terminology (directory layout, "evolution overlay"/"evolution candidates"/"auto-evolution mode" prose, the `evolution_candidates.mjs` script name) — a distinct, unrelated meaning of "evolution" that a blind find-and-replace would have corrupted. Also left untouched: the `evolution` sub-agent's own name/frontmatter/filename (`plugins/ievo/agents/evolution.md`, dispatched via `subagent_type: "evolution"`) — already decoupled from its calling skill's name, the same pattern as `security-check` → `security-auditor` and `deep-review` → `deep-reviewer`.
- **Backwards compatibility** — no alias/redirect added for `/ievo:evolution`. `AGENTS.md` documents no prior skill-rename precedent requiring one, and this is an internal plugin command with no external API contract — a clean rename is acceptable.
- **Namespace check** — confirmed `/ievo:evo` reads unambiguously alongside `/ievo:evo-auto-enable` / `/ievo:evo-auto-disable`: their descriptions and trigger words describe a distinct concept (toggling background auto-capture mode) from capturing a single lesson now, so no further rename was needed.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits plugin files under `plugins/ievo/**`); `discover.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.3

Warn that plugin skills always need the full `ievo:` prefix, since a bare name can silently misfire to a reserved Claude Code built-in — closes #325.

- **Gap closed** — a user typed a bare "feedback"-style command in the Claude desktop client; instead of resolving to `ievo:feedback` (or erroring), Claude Code's own built-in `/feedback` fired (aliases `/bug`, `/share`), submitting the report to Anthropic support instead of `ievo-ai/skills` — a real misdirected-submission incident, not just a discoverability nit. Confirmed workaround: typing the fully-qualified `/ievo:feedback` resolves correctly in the same client. Per current docs (`https://code.claude.com/docs/en/commands`), `/feedback` is a documented Claude Code built-in, and plugin skills are always namespaced (`plugin:skill`) precisely to avoid colliding with reserved built-ins — so a bare name typed where autocomplete doesn't surface the `ievo:` prefix was always going to risk this collision.
- **Fix** — added an explicit warning to `README.md` at the existing cross-platform-skills callouts (Quick start intro and the Codex/Claude Code usage section): always type the full `ievo:` prefix, since some non-CLI Claude surfaces don't autocomplete-suggest it and a bare name can silently resolve to an unrelated built-in instead. Added the same warning to `feedback/SKILL.md`'s `compatibility` field, since it's the skill with a confirmed real-world misfire.
- **Scope** — docs-only: `README.md` prose (two call-outs) + one `SKILL.md` `compatibility` field. No behavior, tooling, schema, or `allowed-tools` change.
- **Related** — same underlying autocomplete-discoverability gap as #320/#321/#322/#324 (still held pending confirmation of the exact affected client surface); this fix is scoped to advice that holds regardless of which non-CLI surface is involved.
- **Version** — bump per AGENTS.md rules (`fix:` → patch, edits a plugin file under `plugins/ievo/**`); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.2

Make `/ievo:version`'s suggested update command name the iEvo plugin explicitly, instead of Claude Code's generic `/plugin update` — closes #319.

- **Gap closed** — `version/SKILL.md` correctly reported the installed/latest version delta and told the user to run `/plugin update` when behind, but that's Claude Code's generic, no-argument form. A user with more than one plugin installed had no way to tell from the rendered output whether it would update iEvo specifically or prompt for a choice.
- **Fix** — Step 5's "Suggested format when behind" render template, the accompanying prose (intro paragraph, "When to use" bullet, and the "Read-only" rule), and the frontmatter `description` now say `/plugin update ievo` instead of the bare `/plugin update`. Added a new Rules bullet stating the skill always names the plugin explicitly, with the fully-qualified `/plugin update ievo@ievo-skills` form noted for the rare case of a same-named plugin from another marketplace.
- **Verified against current docs** (`https://code.claude.com/docs/en/plugins-reference` and `https://code.claude.com/docs/en/commands`, re-fetched during implementation) — `claude plugin update <plugin> [options]` takes `<plugin>` = plugin name or `plugin-name@marketplace-name`, the same argument form documented for `plugin install`/`enable`/`disable`; the interactive `/plugin [subcommand]` command passes subcommands straight through, and `/plugin install`/`enable`/`disable` are confirmed elsewhere in the docs to accept that identical `plugin-name@marketplace-name` form directly. `ievo` is confirmed as this plugin's own `name` (`plugins/ievo/.claude-plugin/plugin.json`) and `ievo-skills` as the marketplace `name` (`.claude-plugin/marketplace.json`).
- **Scope** — single-file prose change to `version/SKILL.md`; no behavior, tooling, or `allowed-tools` change (still read-only `jq`/`curl`/`git`).
- **Version** — bump per AGENTS.md rules (`fix:` → patch); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.1

Preload the vuln-scan skill into `vuln-scanner.md` via `skills:` frontmatter, and drop its unrestricted `Skill` tool access — closes #317.

- **Gap closed** — `vuln-scanner.md` Step 1 instructed a runtime, model-chosen `Skill("ievo:vuln-scan")` call to load its scan methodology; if the model skipped or mis-invoked it, or a future body edit dropped the instruction, the sub-agent would scan without the documented methodology (source-read → data-flow mapping → CWE detection → exploit-chain validation → structured output) and nothing platform-level would catch it.
- **Frontmatter change** — adds `skills: [ievo:vuln-scan]`, which preloads the full `vuln-scan/SKILL.md` content into the sub-agent's context at startup regardless of whether the model executes a `Skill()` call. Removes `Skill` from `tools:` — no longer needed once preloaded, and dropping it closes the "can invoke any installed skill" surface, narrowing the agent to its documented single-purpose design.
- **Verified against current docs** (`https://code.claude.com/docs/en/sub-agents`, `https://code.claude.com/docs/en/skills`, re-fetched during implementation) — `skills:` carries no "ignored for plugin subagents" caveat (unlike `permissionMode`/`mcpServers`/`hooks`, which are); `vuln-scan/SKILL.md` doesn't set `disable-model-invocation: true`, so it's preload-eligible; plugin skills use the documented `plugin-name:skill-name` namespace, confirmed against `plugins/ievo/.claude-plugin/plugin.json`'s `"name": "ievo"` — so `ievo:vuln-scan` is the correct qualified form, not a guess.
- **Step 1 body** — rewritten to describe the preloaded methodology instead of instructing a runtime `Skill()` call; the five-step methodology summary is unchanged.
- **Scope** — `security-auditor.md` was checked for the same gap and has none: it's fully self-contained with no `Skill` tool in its `tools:` list, so this change is scoped to `vuln-scanner.md` only.
- **Version** — bump per AGENTS.md rules (edits `plugins/ievo/agents/vuln-scanner.md`); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.47.0

Add a fixed stack-independent query group to `/ievo:init`'s discovery so general-purpose codebase-audit/planning-advisor meta-tools surface for any stack — closes #315.

- **Gap closed** — `discover.mjs`'s `buildQueries()` only ever emitted queries gated by detected stack signals (per-language, per-dep, per-category via `CATEGORY_QUERIES`, per-framework); there was no query group for general-purpose codebase-audit / planning-advisor meta-tools (e.g. `shadcn/improve`, ~17.6K skills.sh installs) since that class of skill isn't tied to any specific language, framework, or dependency. A live `/ievo:init` run against a Python/Click stack never surfaced it — none of the 37 stack-derived queries built for that run matched.
- **Fix** — added `STACK_INDEPENDENT_QUERIES` (`codebase audit`, `improve codebase`, `implementation plan`, `tech debt audit`, `senior advisor`), fired as an unconditional layer in `buildQueries()` whenever the stack produced at least one real signal — not gated behind `categories` the way every other layer is. Guarded on "some signal present" (rather than truly unconditional) so a completely empty `{}` stack — Step 4 manifest detection finding nothing at all — still yields zero queries, preserving `runDiscover`'s existing "no queries derived, abort init" contract for that distinct failure mode.
- **Categorization** — reused the existing `agent-tooling` category (`reference-tables.md`) rather than inventing a new bucket; Step 7c's per-category top-5 cap applies unchanged. Updated the category row's description to frame these as read-only auditors that produce plans/findings, not implementers, matching `shadcn/improve`'s own positioning, and updated `SKILL.md` Step 5b's query-count description to keep it accurate.
- **Tests** — added coverage asserting the new query group fires with any single one of languages/deps/categories/frameworks present, and is excluded entirely when the stack is empty. `discover.mjs` stays at 100/100/100 (lines/branches/functions).
- **Version** — bump per AGENTS.md rules (`feat:` → minor); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep.

---

## v0.46.3

Add `disallowedTools:` to `vuln-scanner.md` for defense-in-depth consistency with its sibling security agents — closes #312.

- **Gap closed** — `vuln-scanner.md` held the broadest raw tool access (`Bash`) of the repo's three security-critical scanning agents, but was the only one without a `disallowedTools:` denylist, despite explicitly anticipating adversarial file content (prompt injection in scanned source) in its own body.
- **Frontmatter change** — adds `disallowedTools: [Edit, Write, Bash(rm*), Bash(mv*), Bash(cp*), Bash(curl*), Bash(wget*), Bash(sudo*), Bash(chmod*), WebSearch]`, mirroring `security-auditor.md` and `deep-reviewer.md`. `Write` is denied (unlike `security-auditor.md`, which keeps it for one legitimate signal-file write) because `vuln-scanner.md`'s documented output contract is pure structured JSON with no legitimate file-write step.
- **Why it matters** — closes the same sub-agent tool-isolation gap AGENTS.md § Security model documents: a skill's `disallowed-tools` (kebab-case) does not propagate to a Task-tool-dispatched sub-agent, so `vuln-scanner.md` must self-enforce like its two siblings (skills#226, skills#266).
- **Version** — bump per AGENTS.md rules (edits `plugins/ievo/agents/vuln-scanner.md`); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep (both scripts' versions are coupled to `plugin.json` by their own test assertions). No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

## v0.46.2

Realign `/ievo:schedule` with the documented Routines surface — in-session `/schedule` replaces the nonexistent `claude schedule` shell CLI; adds one-off runs, the 1-hour cron minimum, and a connectors scope-down warning — closes #310.

- **Live-CLI verification (the proposal's acceptance step)** — on Claude Code v2.1.201, `schedule` is not a registered subcommand: `claude schedule --help` falls through to the top-level help (no `schedule` in the Commands list) and `claude schedule list` is parsed as a session *prompt*, not a management command. The skill's primary wizard path could therefore never work — every invocation was routed to the fallback (or, on a logged-in machine, silently started a junk session). Per the proposal's decision rule, the shell path is removed entirely rather than kept as a fallback.
- **Step 1 (availability probe)** — the `claude schedule list` probe is replaced by a preflight over the documented `/schedule` hide-causes: CLI older than v2.1.81 (`claude --version`), API-key-auth precedence (the two auth env vars and the `apiKeyHelper` setting, which override the required claude.ai login), and the four telemetry/feature-flag variables from the official troubleshooting list — checked both in the shell environment and in the `env` block of the user/project `settings.json`. The env check prints variable names only, never values. Causes not detectable from the session (plan tier, org-wide Routines toggle, web session) are enumerated in the fallback text; when blocked, the user picks Web UI / CI cron / cancel — the web UI works regardless of CLI configuration.
- **Step 6 (creation)** — hands off to in-session `/schedule`: the agent supplies the wizard-assembled name, schedule, and prompt when the conversational flow activates instead of re-asking, and notes `/schedule` creates scheduled routines only (API/GitHub triggers are web-side). Fallbacks: claude.ai/code/routines copy-paste block, then the Step 1b CI template. Monthly and custom-cron frequencies use the documented closest-preset-then-`/schedule update` path.
- **Step 3 (frequency)** — adds a one-off option (fires once, auto-disables, exempt from the daily routine run cap) and validates custom cron against the documented 1-hour minimum interval (minute field must be a single fixed value). Timezone framing corrected from "all times UTC" to the documented local-wall-clock conversion, with a per-routine stagger note.
- **Step 5 (confirm)** — new heads-up block: ALL account connectors attach by default with write access and no permission prompts (scope them down), pushes are restricted to `claude/`-prefixed branches by default, and recurring runs count against a daily per-account cap.
- **Step 7 + Rules** — management handed off via the documented `/schedule list` / `/schedule update` / `/schedule run`; a green run status is explained as infrastructure-success only. A rule pins the verified-absent shell CLI (v2.1.201, 2026-07-04) so it is not reintroduced from stale model memory.
- **Frontmatter + docs** — `compatibility` now records the research-preview status and the documented v2.1.81+ `/schedule` requirement (was v2.1.149+ with no caveat); `allowed-tools` narrowed to what the flow actually uses (drops `Write` and broad `Bash(claude*)`, adds `Read` and the names-only env probe). The stale version note in `coverage-audit.md`'s schedule row is updated to match.
- **Version** — bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep. No `plugins/ievo/scripts/` logic change — the 100% coverage gate is untouched.

---

## v0.46.1

Fix `/ievo:evolution`'s project-wide marker so Codex can read it: detect a thin-pointer `CLAUDE.md` and host the marker in `AGENTS.md`, and use an explicit, platform-neutral instruction instead of a bare `@import` — closes #304.

- **Bug** — the marker host-selection rule was `CLAUDE.md` → `AGENTS.md` → create `CLAUDE.md`, so on a project whose `CLAUDE.md` is a thin pointer that redirects to `AGENTS.md` (a common convention), the overlay marker was injected into `CLAUDE.md`. Codex reads `AGENTS.md`, not `CLAUDE.md`, so the marker — and every accumulated project-wide lesson behind it — was invisible to Codex sessions, breaking iEvo's cross-platform promise.
- **Host selection** — add a thin-pointer heuristic ahead of the existing priority: treat `CLAUDE.md` as a redirect stub (host the marker in `AGENTS.md` instead) only when it is short (≤ ~20 lines) **and** references `AGENTS.md` as the source of truth. Both conditions are required to avoid a false positive on a substantive `CLAUDE.md` that merely cites `AGENTS.md`. Single host, no dual-inject — `AGENTS.md` is the one file both platforms effectively read (Codex directly; Claude Code via the pointer).
- **Marker content** — replace the bare `@.ievo/evolution/project.md` import line with the explicit natural-language instruction already used by the agent/skill overlay markers ("read `.ievo/evolution/project.md` if it exists, and apply its rules"). Codex has no `@include` resolution (openai/codex#17401, still open), so the explicit instruction is platform-neutral and Claude Code follows it identically — nothing is lost.
- **Single-host guard** — because the host is re-derived from `CLAUDE.md`'s current shape on every capture, injection now checks **both** `CLAUDE.md` and `AGENTS.md` for an existing marker and skips if *either* has one. This keeps the no-dual-inject guarantee even when a `CLAUDE.md` grows from a thin pointer into a substantive file between two captures. The chosen host is also created if it does not yet exist.
- **Both dispatch paths fixed** — the same host-selection + marker change is applied to `plugins/ievo/skills/evolution/SKILL.md` (inline fallback) **and** `plugins/ievo/agents/evolution.md` (the `evolution` sub-agent that performs the injection on the Claude Code / Codex Task-dispatch path). Fixing only the skill would leave the primary sub-agent path still injecting the old bare marker into `CLAUDE.md`.
- **Not in scope** — projects already onboarded with the old bare-import marker in `CLAUDE.md` are not auto-migrated (injection stays skip-if-present); clearing a stale old marker there remains a manual step. New captures and new projects get the corrected behaviour.
- **Validation & version** — additive/edited instruction prose plus the version-string bump; no `plugins/ievo/scripts/` logic change, so the 100% coverage gate is untouched (`discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` bumped in lockstep with `plugin.json` to satisfy the coupling tests). Version bump per AGENTS.md rules; ledger header updated.

---

## v0.46.0

Close the feedback → evolution direction of the two-way bridge, so a bug filed about a specific agent or skill can also capture a local mitigation — closes #305.

- **Why** — previously only the reverse arrow existed: `/ievo:evolution` Step 5.6 (shipped v0.43.0, #298) offers to escalate a captured lesson upstream as feedback, but after `/ievo:feedback` filed a bug about a specific agent or skill there was no offer to capture a **local** mitigation, so the project stayed exposed on the upstream repo's fix timeline (the motivating case: a marker-host bug whose local workaround had to be applied by hand).
- **New Step 7.5** in `plugins/ievo/skills/feedback/SKILL.md` (after the Step 7 result report) — the mirror of evolution's Step 5.6. Runs only after a successful submission and only when ALL hold: **flow A** (skips flow B rejections and flow C evolution-handoffs), **type == `Bug`** (from Step 1), and the bug **targets a specific agent or skill** (reusing evolution Step 1's scope-classification signals).
  - When applicable it offers **once** via `AskUserQuestion` (`Capture locally` / `Skip`), never auto-capturing; on accept it hands off to `/ievo:evolution` with the already-translated English body (`body_en`, Step 3.75) pre-filled as the lesson and the named agent/skill as the target, so evolution runs its Steps 1–5.6 (scope confirmation, overlay append, marker injection) unchanged.
- **Loop guard** — the **flow-C skip is the single loop guard** for both directions: evolution → feedback lands as flow C (Step 7.5 skipped), and a forward handoff feedback → evolution → evolution.5.6 → feedback lands as flow C too (Step 7.5 skipped) — so the bridge always terminates. A Rules bullet documents the two-way, loop-safe bridge.
- **Validation & version** — additive instruction prose only; no `plugins/ievo/scripts/` change, so the 100% coverage gate is untouched; `validate_skills.mjs` / `yaml-frontmatter` / `nested-fences` pass (no frontmatter change). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`); `discover.mjs` + `evolution_candidates.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep.

---

## v0.45.0

Complete auto-evolution mode — the novel, higher-risk half the operator sequenced for separate review — closes #302 (**PR 2 of 2**; PR 1 = #293/#301, shipped in v0.44.0).

- Adds the three components PR 1's contract documented but deferred: a turn-content-aware correction-capture hook, a tested accumulator script, and a `SessionStart` analysis nudge.
- **New `plugins/ievo/scripts/evolution_candidates.mjs`** (Node, stdlib-only) — the per-session candidate accumulator:
  - `append` (records a correction verbatim to `.ievo/evolution-candidates/<session-id>.jsonl`, deduping identical `(scope, text)` within a session and sanitizing the session id against path escape), `count` (backlog size for the nudge), `list` (for the review pass), and `prune` (retention: keep the last 10 sessions per #293 Q4).
  - Built on the `discover.mjs` `isCliEntry` / injected-fs-deps pattern and covered to **100/100/100** by `tests/evolution_candidates.test.mjs`; registered in `.github/scripts/check-coverage.mjs` `REQUIRED`.
- **`evo-auto-enable/SKILL.md` Step 3.5** — bakes the accumulator's absolute path, writes two fail-silent, flag-gated, non-blocking hook scripts under `.ievo/hooks/scripts/`:
  - a `UserPromptSubmit` correction-capture nudge (asks the agent to self-judge "was that a correction?" and, if so, record it verbatim; captures corrections only per #293 Q1, no scope classification at capture time per #293 Q3);
  - a `SessionStart` analysis nudge (`prune` + `count`, then surfaces "N candidates pending — review?");
  - both wired into `.claude/settings.json` following `/ievo:hooks-setup`'s exec-form / dedup / read-first-halt-on-invalid-JSON conventions. `evo-auto-disable/SKILL.md` gains Step 3.5 to unwire both entries and delete the scripts (the candidate queue is preserved).
- **`evolution/SKILL.md` Step 0** (auto-evolution candidate intake) — drains the accumulator through the existing Step 1 scope classification with the #293 Q2 constraint: auto-write only unambiguous project-wide lessons to `.ievo/evolution/project.md`; park ambiguous or agent/skill/user-level candidates in `pending.md` for manual review, never written silently; consume each on write.
- **Self-flag exception** — because `UserPromptSubmit` is one of the hook shapes `/ievo:security-check` flags in *third-party* plugins, `security-check/SKILL.md` and README threat #7 now document iEvo's own flag-gated, `.ievo/`-scoped correction-capture hook as a known purpose-built exception so iEvo's own tooling doesn't self-flag it.
- **Version** — bump per AGENTS.md rules (adds a script + edits skills under `plugins/ievo/**`); `discover.mjs` `SCRIPT_VERSION` and the AGENTS.md compliance ledger updated in lockstep.

---

## v0.44.0

Add auto-evolution mode's low-risk half — the `/ievo:evo-auto-enable` / `/ievo:evo-auto-disable` toggle pair — closes #293 (**PR 1 of 2**; PR 2 lands the hook + accumulator + nudge).

- **PR sequence** — the operator approved this feature as two parts: the toggle skills plus pending-queue plumbing land here; the turn-content-aware correction-capture hook, the accumulator script, and the `SessionStart` analysis nudge follow in a separate, focused review (PR 2). Two new `SKILL.md` files under `plugins/ievo/skills/`, modeled directly on the `debug-on`/`debug-off` paired-toggle + project-local-flag pattern.
- **`evo-auto-enable/SKILL.md`** — writes the project-local flag `.ievo/evo-auto.flag` (YAML: `enabled`/`enabled_at`/`enabled_by`/`signal: corrections-only`/`auto_write_scope: project-wide-only`), prepares the pending-candidate queue at `.ievo/evolution-candidates/pending.md` (created only if absent — never clobbers parked candidates), offers to gitignore the pre-review queue, and documents the mode's contract:
  - v1 captures **corrections from the user only** (agent-judged, semantic — mechanical exit/test signals deferred);
  - auto-writes go to `.ievo/evolution/project.md` **only** when scope is unambiguously project-wide; anything ambiguous or user-level-only is **parked for manual review via `/ievo:evolution`, never written silently** — preserving evolution's existing human-in-the-loop reconciliation;
  - the contract section spells out what the follow-up hook/nudge must honor (accumulate-at-teardown, analyze-at-next-`SessionStart`, project-wide-only writes, consume-on-write with a last-10-sessions retention cap).
- **`evo-auto-disable/SKILL.md`** — removes exactly `.ievo/evo-auto.flag` (idempotent `rm -f` with Node `unlinkSync` + Windows `Remove-Item` variants) and is strictly **non-destructive**: the `.ievo/evolution-candidates/` queue is preserved so no captured correction is lost, and the closing summary reports how many candidates still await review.
- **Validation & version** — additive prose-only skills; no `plugins/ievo/scripts/` change, so the 100% coverage gate is untouched; `validate_skills.mjs`/`yaml-frontmatter`/`nested-fences` pass (frontmatter carries `name`, `description`, `effort: low`, `compatibility`, `license`, `metadata`). Version bump per AGENTS.md rules (adds skills under `plugins/ievo/**`); AGENTS.md "What this repo ships" tree updated with both skills.

---

## v0.43.0

Let `/ievo:evolution` offer to escalate a captured lesson upstream as public feedback — closes #298.

- **Why** — previously the evolution flow ended at its report step after appending the lesson to the overlay, with no path from a captured lesson to `/ievo:feedback`; a lesson describing a gap in the iEvo plugin itself (the trigger case: "deep review does not check inline GitHub review comments from bot reviewers") was recorded locally and never surfaced for upstream sharing. Prose-only change across two `SKILL.md` files and one agent `.md`.
- **`plugins/ievo/skills/evolution/SKILL.md` Step 5.6** (between the Step 5.5 signal file and the Step 6 report) — a cheap signal-word heuristic (no sub-agent dispatch, matching the "low effort" design) that classifies the lesson as **local** (the default — *no prompt*: project convention / tech-stack / team-role / codebase-specific mistake, even when it lives on an iEvo overlay) vs. **upstream-relevant** (names an iEvo capability *and* frames a shortcoming of its own behavior, or the vendored target resolved to an `ievo-ai/skills` file). Only in the upstream case does it offer **once** via `AskUserQuestion` (`Share as feedback` / `Skip`), never auto-posting; on accept it hands off to `/ievo:feedback` with the lesson **pre-filled**, and the Step 6 report gains an `Upstream escalation:` line.
- **`plugins/ievo/agents/evolution.md` Step 4.6** (parallel) — because a Task-dispatched sub-agent has no tool to prompt or launch another skill, it only *classifies* and surfaces the verdict (+ verbatim lesson) in its report, leaving the offer and hand-off to the caller's main session.
- **`plugins/ievo/skills/feedback/SKILL.md` Step 0** gains a third flow **(C) Evolution handoff** (alongside A and B) — the pre-filled lesson **skips Step 2** (collect text) but runs Step 1 / 3 / 3.5 / 3.75 / 4 and, critically, **Step 5 (public-posting confirmation gate) unchanged**. Translation is deliberately not duplicated: evolution passes the verbatim original and `feedback`'s Step 3.75 translates once. Public posting stays behind the existing explicit `Submit`/`Cancel` gate throughout — evolution never posts anything itself.
- **Validation & version** — additive instruction prose only; no `plugins/ievo/scripts/` change, so the 100% coverage gate is untouched; `validate_skills.mjs` / `validate_agents.mjs` / `yaml-frontmatter` pass (no frontmatter change). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.42.1

Stop `/ievo:feedback` from leaking non-English text into public issues — closes #294.

- **Why** — the skill previously translated non-English feedback to English but *also* embedded the user's verbatim source-language text in a collapsed `<details><summary>Original (untranslated)</summary>` block inside the public GitHub issue body (Step 4, both flow A and flow B), which published a Russian-language block to a public issue. Prose-only change to `plugins/ievo/skills/feedback/SKILL.md`.
- Removed the `<details>` "Original (untranslated)" / "Original note (untranslated)" blocks from both public issue templates — the public issue body is now English-only (`body_en`).
- Step 3.75 output-format reworded so `body_original` is retained strictly for the local audit trail, never the issue body.
- Step 6 gains a local-only Step A2 that, when a translation happened, writes the verbatim original to a sibling `.ievo/log/pending-reports/feedback-original-<ts>.md` (never passed to `gh issue create --body-file`, so it stays on the user's machine as translation-QA reference).
- The Rules bullet updated from "preserved in `<details>` block" to "English-only in public issues; verbatim original kept local-only".
- **Validation & version** — translation itself (Step 3.75) is unchanged — only the *publication* of the untranslated copy is removed. No `plugins/ievo/scripts/` change, so the 100% coverage gate is untouched; `validate_skills.mjs`/`yaml-frontmatter` pass (no frontmatter change). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.42.0

Add a `/ievo:version` skill — on-demand "which iEvo version am I on, and what would I gain by updating?" — closes #291.

- New `plugins/ievo/skills/version/SKILL.md` (read-only, no `scripts/`, following the `overlay-status` graceful-degradation pattern) with two capabilities:
  - **Show the installed version** — reads `.version` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (the same `CLAUDE_PLUGIN_ROOT` resolution `hooks-setup` Step 5.7.2 relies on), plus a best-effort short commit SHA via `git rev-parse` that degrades to "not available" when the installed plugin cache has no `.git`.
  - **Show the changelog window** between installed and latest — resolve the latest version from `plugins[0].version` in the marketplace manifest on `main` (same source as the SessionStart nudge), and when behind, fetch `CHANGELOG.md` from `main` and print every `## vX.Y.Z` section strictly newer than installed (reverse-chronological, semver-compared field-by-field so a missing exact-match header for an infra-only/no-entry version doesn't break selection).
- Complements the existing passive, throttled SessionStart version-check nudge (`hooks-setup` Step 5.7, v0.39.0): that only whispers "you're behind" once/day and only if hooks were configured; `/ievo:version` is the interactive, on-demand answer showing the version + full changelog.
- Every failure path degrades cleanly rather than erroring — unresolvable installed version, offline/rate-limited latest check, and unreachable/malformed changelog all report what they can and note what they can't.
- **Validation & version** — no `plugins/ievo/scripts/` script added, so the 100% coverage gate is untouched; the four-file version bump + AGENTS.md "What this repo ships" tree entry accompany it. `validate_skills.mjs`/`yaml-frontmatter` pass (frontmatter carries `name`, `description`, `effort: low`, narrowly-scoped `allowed-tools`). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.41.0

Guard dated append-only records against silent rot — closes #289. Two related prose-only gaps around evolution overlays' dated `## <date> — <title>` sections, which are appended verbatim and read live as instructions at every dispatch. **(1) Temporal anchoring** — `plugins/ievo/agents/evolution.md` and `plugins/ievo/skills/evolution/SKILL.md` gain a new **Temporal anchoring** rule alongside **Conflict surfacing**: a lesson that asserts *how the system currently works* in the present tense (e.g. "workflow X runs only on non-draft PRs") rots the moment the system changes, and the agent keeps applying the now-false rule. The rule steers such a lesson one of two ways before appending — anchor a point-in-time observation in time (past tense, scoped to its moment, with a date/PR anchor where available) so it stays true under any later change, or move a durable current-behavior claim into the owning agent/skill body or an overlay *rule* rather than a dated snapshot. It explicitly does NOT silently rewrite the verbatim lesson (that would violate the existing "Verbatim … text" rule) — it surfaces and steers, mirroring Conflict surfacing, and complements it: Conflict surfacing catches a new lesson contradicting an old one, Temporal anchoring catches the system moving out from under an old, unchallenged lesson. **(2) Deep-reviewer carve-out** — `plugins/ievo/agents/deep-reviewer.md` gains an explicit content-scope carve-out (a caveat under Point 5 "Documentation/paraphrase drift" plus a matching Rules bullet) excluding append-only dated records — evolution overlay sections under `.ievo/evolution/`, CHANGELOG-style version entries, incident/journal logs — from drift/staleness findings. A dated entry is a frozen snapshot of the repo as of its date, so its point-in-time paths and mechanics are intentionally correct-as-of-then; flagging them as stale is a false positive and "fixing" them rewrites history. At most the reviewer confirms a *new* dated entry was added when the change warranted one; it never proposes edits to an existing entry's body. Both fixes are additive prose in agent/skill instruction bodies — no code, schema, or CI surface — consistent with evolution's own "additive only" philosophy and deep-reviewer's itemized-Rules pattern; `validate_agents.mjs`/`validate_skills.mjs` continue to pass (no frontmatter change). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.40.0

Add a `disallowedTools:` denylist to `plugins/ievo/agents/deep-reviewer.md` — closes #266 (Eva proposal F-2026-06-29-001). The `deep-reviewer` agent (dispatched by `/ievo:deep-review`) is a read-only reviewer that declared only a `tools: [Read, Grep]` allowlist and no `disallowedTools:`, a gap versus the `security-auditor.md` precedent. Because a skill's kebab-case `disallowed-tools` does **not** propagate to a Task-tool-dispatched sub-agent (AGENTS.md § Security model), `deep-review/SKILL.md`'s `disallowed-tools` cannot restrict the dispatched agent — so the agent must self-enforce. The added denylist mirrors `security-auditor.md`'s destructive set (`Edit`, `Bash(rm*|mv*|cp*|curl*|wget*|sudo*|chmod*)`, `WebSearch`) and additionally denies `Write` (the reviewer, unlike the auditor's one signal-file write, never writes). `WebSearch` is denied for the same exfiltration rationale the auditor cites — a diff under review could carry adversarial content, and web search would open an exfiltration channel. This is defense-in-depth: the agent already only uses Read + Grep in practice, so behaviour is unchanged; the denylist is the guard against a future PR widening `tools:` (e.g. adding `Edit` for auto-fixup) silently granting destructive access. The issue's two operator-decision open questions are resolved conservatively: `Bash(curl*)`/`Bash(wget*)` are **included** (aligning with the security-auditor set — the agent has no `Bash` tool anyway, so the "may need it for referenced-URL fetches" concern is moot); `WebFetch` is **left off** (not in the `tools:` allowlist either, and the auditor keeps it — deferred to the operator). For skill-level parity, `deep-review/SKILL.md` also gains the matching `disallowed-tools` denylist (mirroring `security-check`/`vuln-scan`, including the `WebSearch` exfiltration denial) — grounding the AGENTS.md § Security model reference and guarding the skill's own read-only orchestration turn, even though (as above) that kebab-case denylist does not propagate to the dispatched sub-agent. Pure frontmatter addition — no body/script changes, `validate_agents.mjs`/`validate_skills.mjs` continue to pass (no new required fields). Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.39.0

Give users on a stale iEvo install a path to notice + update — leaning on what Claude Code already does natively — closes #247. **Part 1 (primary, native):** README § "Keep iEvo up to date" and `/ievo:init`'s final summary now recommend enabling native plugin **auto-update** for the `ievo-skills` marketplace (`/plugin` → **Marketplaces** → **Enable auto-update**), with the managed-settings `"autoUpdate": true` on the `extraKnownMarketplaces` entry for team installs. Third-party marketplaces default auto-update OFF (verified against the plugins docs, 2026-07-02), so this is the highest-leverage fix — once on, Claude Code updates iEvo at startup and prompts `/reload-plugins`. The `/ievo:update` summary line is also relabeled "update vendored skills/agents" to disambiguate it from plugin auto-update. **Part 2 (additive fallback):** `/ievo:hooks-setup` gains an optional **SessionStart version-check nudge** (new Step 5.7) for users who deliberately keep auto-update off. It writes a fail-silent `.ievo/hooks/scripts/version-check.sh` that reads the installed version from the plugin's `plugin.json`, compares it against `plugins[0].version` in the marketplace manifest on `main`, and injects a one-line `hookSpecificOutput.additionalContext` nudge only when behind. SessionStart is context-only (verified against the hooks reference — it cannot block or delay startup); the script throttles the network call to ≤once/24h via `~/.cache/ievo/version-check.json` (cache-hit path is fully offline), does a portable awk semver compare (no `sort -V`), and bakes the `plugin.json` path at setup time because a user-`settings.json` hook has no `CLAUDE_PLUGIN_ROOT`. Docs + skill-body change plus the four-file version bump — no `plugins/ievo/scripts/` scripts touched, so the 100% coverage gate is unaffected. Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.37.0

Document `/rewind` as a lighter same-session alternative in `handoff/SKILL.md` — closes #265 (Eva proposal F-2026-06-29-002). Claude Code v2.1.191 (2026-06-24) added `/rewind`, which restores a conversation to its pre-`/clear` state in the **same session** (verified verbatim against the v2.1.191 GitHub release notes: "Added /rewind support for resuming a conversation from before /clear was run"). The skill previously differentiated itself only from `/compact`, leaving a gap: a user who accidentally ran `/clear` might reach for `/ievo:handoff` — which cannot recover the current session's lost context, since it capsules the *now-cleared* state into a NEW session. Adds a "When not to use — lighter alternatives" table right after the "When to use" section, routing the accidental-`/clear` case to `/rewind`, the deep-but-same-session case to `/compact`, and the branch/parallelize/new-session case to `/ievo:handoff`. Doc-only change to the skill body — no scripts touched, so the 100% coverage gate is unaffected. Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.36.0

Add `disable-model-invocation: true` to `init` and `deep-review` — closes #270 (Eva proposal F-2026-06-30-003, narrowed in review). These heavyweight skills dispatch parallel sub-agents, so unintended auto-activation on description match carries real token and time cost. Setting `disable-model-invocation: true` makes them **user-invoke only**: the model can no longer trigger them from a natural-language description match, and (Claude Code v2.1.196+, verified against the official skills.md frontmatter reference) a scheduled task can no longer fire them when the skill is the task's prompt. Explicit `/ievo:<name>` invocation is unaffected. The proposal's other two candidates — `vuln-scan` and `security-check` — were EXCLUDED during PR review: both are loaded programmatically by sub-agents (`vuln-scanner` invokes `Skill("ievo:vuln-scan")` for its per-module worker instructions; `security-auditor` applies `security-check` via the skills system), and a Skill-tool call is a model invocation the flag suppresses — setting it there would break both pipelines. `AGENTS.md § Skills format` now documents `disable-model-invocation` as a supported optional field, including the v2.1.196 scheduled-task behavior and the do-not-set-on-agent-loaded-skills rule. Frontmatter + docs change — no scripts touched, so the 100% coverage gate is unaffected. Version bump per AGENTS.md rules (edits plugin files under `plugins/ievo/**`).

---

## v0.35.0

Document the `Notification` hook in `hooks-setup/SKILL.md` — closes #281 (member-authored re-file of Eva proposal #278). Claude Code v2.1.198 added background-agent notifications for `claude agents` sessions: a session that needs input or finishes now fires the `Notification` hook with matcher `agent_needs_input` / `agent_completed` (verified verbatim against the v2.1.198 GitHub release notes). Adds a new "Step 5.6" subsection after the Step 5.5 Stop-hook flow — matcher-value table, a worked desktop-notification example that surfaces the actionable `agent_needs_input` case (sound + "action needed" title) more prominently than the informational `agent_completed` case (silent banner), macOS `osascript` + Linux `notify-send -u critical/-u low` variants, and a merge/dedup-by-matcher step for `hooks.Notification[]`. An explicit scope note draws the distinction the issue asked for: Step 5.5 covers Task-tool sub-agents dispatched *within* one session (read-side Stop-hook polling that can't separate "still running" from "blocked waiting on input"), while Step 5.6 covers separate `claude agents` background sessions (per-transition Notification hook that can). The `compatibility` frontmatter gains a `v2.1.198+` clause and `## References` gains the v2.1.198 release-notes link. Doc-only change to the skill body + frontmatter — no scripts touched, so the 100% coverage gate is unaffected.

---

## v0.34.0

`validate_skills.mjs` parity with `validate_agents.mjs` — closes #258. `ALLOWED_MODELS` in the SKILL.md linter now accepts `fable` alongside `sonnet`/`opus`/`haiku`/`inherit`, mirroring the v0.21.0 change to the agent validator. The two `model:` error messages (`model-vendor-locked` + `model-not-allowed`) were both rewritten — the trailing "Skills should not declare model preferences" sentence was accurate before v0.32.0 but became misleading once turn-level pins like `model: sonnet` on `security-check` / `vuln-scan` / `deep-review` became an intentional pattern. New wording: "Use only vendor-neutral family aliases for turn-level pins; omit `model:` for skills without pinning needs." Pure allowlist widening — nothing that previously passed will now fail. The three existing `model: sonnet` security-tier pins were intentionally left as-is per the routing discussion.

---

## v0.33.0

Codex marketplace as a second discovery source in `discover.mjs` — closes #196. When the `codex` CLI is present, `discover.mjs` now also reads its marketplace catalog (`codex plugin list --json` → `available[]`, the uninstalled-plugins list) and merges those plugins into the candidate pool alongside skills.sh results. They flow through the same dedup + ranker (by `id`) and carry `source_origin: codex-marketplace`. Codex plugins expose no install metric, so the ranker gives them a visibility floor (≈ a 10-install skill) — enough to surface mid-pack rather than be sliced off by `--limit`, low enough that any 100+ install skills.sh skill still outranks them (visible, never dominant). The source is fully optional: absent `codex` binary, non-zero exit, or unparseable output → silently skipped, so Claude Code-only users see no behaviour change and the universal positioning is preserved. The `sources[]` array in the output now carries a per-origin entry (`skills.sh` + `codex-marketplace` with `available`/`raw_results`/`error`), and every candidate gains a `source_origin` field. Note: the discovery command is `codex plugin list`, NOT `codex plugin marketplace` (the latter manages marketplace *configs*, not plugins) — the original proposal's command was corrected during implementation. The codex call uses async `execFile` (not `spawnSync`) and runs concurrently with the skills.sh queries (`Promise.all`), so a slow/hung `codex` never blocks the event loop or adds to wall-clock time. Codex candidates are tagged `quality_tier: "unranked"` (no install count → install-based tiers don't apply). Full 100/100/100 coverage on the new `fetchCodexMarketplace` / `defaultCodexExec` paths (injectable `execImpl` for deterministic testing). `init` SKILL.md Step 5 + log-format §5 updated to document the new source.

---

## v0.32.0

Security hardening of the iEvo security tooling — closes #179, #221, #226, #198. (1) `model: sonnet` turn-pin added to `security-check`, `vuln-scan`, and `deep-review` SKILL.md so a **direct** invocation forces the audit/scan turn to Sonnet (Haiku misses indirection attacks) — a per-turn override (verified against the skills docs: reverts on the next prompt), complementing the agent-frontmatter routing for the dispatched path. (2) `WebSearch` added to the `disallowed-tools` of `security-check`/`vuln-scan` — it now works in sub-agents (CC v2.1.183) and a scan must never web-search about its target (exfiltration surface). (3) `security-auditor.md` hardened with a `disallowedTools` denylist (camelCase, per sub-agent frontmatter) — `Edit` + destructive `Bash` (rm/mv/cp/curl/wget/sudo/chmod) + `WebSearch`. `Write` is intentionally kept (the auditor's only file write is the RED-only `.ievo/hooks/security-red` lifecycle signal in its Step 6); `WebFetch` is kept for skills.sh signals. Skill-level `disallowed-tools` does NOT propagate to Task-dispatched sub-agents, so the agent self-enforces. (4) Added **Point 11 — Leaked secrets in the diff** to the `deep-reviewer` 11-point checklist (API-key prefixes, private-key material, credential assignments, committed dotenv — placeholders excluded). All four frontmatter facts verified against official Claude Code docs before shipping. (Sibling proposal #212 — domain-restricted `WebFetch(domain:*)` — parked: that syntax is not a documented Claude Code feature; would need a PreToolUse hook.)

## v0.31.0

Document the cross-platform migration path (Claude Code ↔ Codex) — closes #244. iEvo's `.ievo/` state (evolution overlays, repo index, config) is already platform-agnostic plain files on the shared filesystem, but there was no documented way to move between the two platforms iEvo supports. Adds a README "Migrating from Claude Code → Codex" section (use Codex `/import` v0.140.0+ for the platform config; `.ievo/` overlays transfer automatically; skip a fresh `/ievo:init`) plus a migration check in `init/SKILL.md` Step 2 that detects pre-existing `.ievo/evolution/` overlays, preserves them, and tells the user the state is already active. Directly serves iEvo's universal/cross-platform positioning.

---

## v0.30.0

Comment-triggered workflows now drop an immediate 👀 reaction (from the iEvo App) on the triggering comment. `issue-discussion.yml` (`@ievo-ai` mention), `issue-handler.yml` (`/implement`), and `fix-command.yml` (`/fix`) each add the reaction right after minting the App token — before the minutes-long research/implementation run posts anything — so the operator gets instant confirmation the bot picked the comment up instead of wondering whether anything triggered. The reaction step is non-fatal (a failed reaction never aborts the run) and uses `github.event.comment.id` via env (no untrusted input in the shell).

## v0.29.0

Harden `issue-handler.md` against comment-based prompt injection. The `/implement` handler reads the issue's comment thread, and previously treated non-author comments as "informational context" — meaning external comment text still reached the model. Now it fetches each comment's `authorAssociation` and **ignores the body of any comment from a non-member author** (`NONE`/`CONTRIBUTOR`/etc.) entirely — untrusted external data, never read as context, requirements, or instructions. Authoritative input is the issue body (a member vouched for it via `/implement`) plus member/owner comments and the verified discussion-bot analysis. The existing member/owner trigger gate + privilege ceiling already made the surface narrow; this closes the residual at the prompt layer.

## v0.28.0

Split `init/SKILL.md` (951 lines, ~190% of the agentskills.io ≤500-line recommendation — the flagship orchestrator and the only spec-violating skill) into progressive-disclosure references. Moved provably-static content out of the body — the seven run-log output templates (→ `references/log-format.md`), the manifest + category lookup tables (→ `references/reference-tables.md`), the rare RED-verdict report-to-source flow (→ `references/security-report-flow.md`), and the Step 9 install mechanics (→ `references/install-protocol.md`) — while keeping ALL happy-path execution, decision points, and the inline "log section N NOW — do not defer" cues in the body (the cues were deliberate anti-skip emphasis; only the verbose templates moved). Body now 638 lines (−33%). Note: literal ≤500 was not pursued — reaching it requires relocating execution-coupled instructions (interview shapes, permission logic) behind references, which would make the issue's own motivating case (a context-pressured agent skipping the load) WORSE; 638 is the floor before that trade. Closes #172.

## v0.27.0

Fix the issue-discussion trigger handle: `@ievo` -> `@ievo-ai`. `@ievo` is not our handle (it is a squat-able/foreign GitHub username); ours is the `ievo-ai` org. The `issue-discussion.yml` trigger matched `@ievo` (which works only as an accidental substring of `@ievo-ai`), and the docs/prompt instructed mentioning `@ievo` — every such mention pinged a foreign user instead of us. Updated the trigger condition, the workflow header comments, AGENTS.md Phase-1 docs, and the handler prompt to use `@ievo-ai`. Behavioural change: the discussion bot now triggers on `@ievo-ai`, not bare `@ievo`.

## v0.26.0

Add `notify-release.yml` — on merge to main with a plugin version change, announce the new `ievo-ai/skills` release to the iEvo community Telegram via a cross-repo `repository_dispatch(child-release)` into `ievo-ai/eva` (which owns the Telegram token; this public repo never holds it). Mirrors eva's documented cross-repo announce design; the `merged==true` guard lives here at the dispatch source. The (untrusted) PR title is JSON-escaped via `jq --arg`. Closes the gap where skills releases shipped silently while eva merges notified.

## v0.25.0

Add `effort:` frontmatter validation to `validate_agents.mjs` (parity with `validate_skills.mjs`, which already validates the field). `effort:` overrides the session effort level for a sub-agent (values: `low`/`medium`/`high`/`xhigh`/`max`); a mistyped value (`effort: medium-high`, `effort: fast`) silently does nothing at runtime and previously passed validation. The validator now errors on an invalid value. Scoped deliberately to **validate-if-present** (an absent `effort:` is fine), mirroring how this script already treats `model:` — rather than warning on absent like `validate_skills.mjs`, which would emit persistent non-actionable warnings on every agent file and require changing the script's exit semantics. Exports `VALID_EFFORT_VALUES` + `checkEffortField()`. 100% coverage maintained. Partially addresses #163 (the invalid-value gap; the optional absent-nudge is left for when `effort:` is added to agent files).

---

## v0.24.0

Document the complete set of model-bypass vectors in AGENTS.md § Security model. The section previously covered only `CLAUDE_CODE_SUBAGENT_MODEL`; three more settings can silently route `security-auditor` below its Sonnet-tier minimum: `availableModels` (the only hard enforcement — a managed allowlist excluding Sonnet silently drops `model: sonnet` to the inherited model; subagent overrides covered since v2.1.172), `enforceAvailableModels` (v2.1.175, locks the picker Default to the allowlist), and `fallbackModel` (v2.1.166, availability fallback that can degrade a scan mid-run when Sonnet is rate-limited). Adds a verified mechanism/effect/mitigation table with the operator-side guarantee (managed `availableModels` must include `sonnet`/`opus`). All facts verified against the official model-config docs (2026-06-27). Closes #238, #180, #195, #197.

---

## v0.23.0

Add the upstream `check-merge-conflict` hook (`pre-commit/pre-commit-hooks` `rev: v6.0.0`) to `.pre-commit-config.yaml`. The config previously had no guard against leftover merge-conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) reaching a commit — a real gap surfaced while landing the v0.20–v0.22 version-chain, which required several manual rebase conflict resolutions. Configured with `--assume-in-merge` so it fires after **rebase** resolutions too (`git rebase` does not set `MERGE_HEAD`), not only `git merge` conflicts. Runs in both the local hook and the `pre-commit-gate.yml` CI, so it cannot be bypassed with `--no-verify`. No script, skill, or workflow logic changed.

---

## v0.22.0

Fix `AGENTS.md` tree diagram to include `commands/vuln-scan.md` — the Glasswing-inspired `/ievo:vuln-scan` orchestrator command (phases 1-4, parallel sub-agents) was present in the filesystem but missing from the directory listing. AI agents reading `AGENTS.md` would not discover this command. No behaviour change — documentation correction only.

---

## v0.21.0

Add `fable` as a vendor-neutral model alias to `validate_agents.mjs`. Claude Fable 5 (Claude Code v2.1.170, June 2026) is the Mythos-class model now generally available. Agent files using `model: fable` would fail the vendor-neutrality validator before this change — now `fable` is recognized as a first-class family alias alongside `sonnet`, `opus`, `haiku`, and `inherit`. Updates AGENTS.md § Allowed values list. Closes #191.

---

## v0.20.0

Fix stale roadmap version target and compliance ledger version reference in AGENTS.md. The roadmap entry that read `**v0.7.0** — cortex A/B validation gate for evolutions; GitHub search source in discover.mjs` was never shipped and main has long since surpassed v0.7.0. Replaces the version pin with `**planned**` and adds a parenthetical noting the original target. The compliance ledger header read `v0.19.0`; bumped to `v0.20.0` to track the current shipped version. No functional change to any script, skill, or workflow.

---

## v0.19.0

Attribute automation commits to the iEvo GitHub App bot instead of the default Claude bot identity. The issue-handler, review-fixer, and `/fix` workflows already push as the App (the push token is what triggers downstream CI), but the commit *author* still surfaced the generic bot. Passing the App bot's identity to `claude-code-action` aligns the commit author with the pusher, so implementation and review-fix commits are now consistently attributed to the iEvo App. No behavioural change to the pipelines; commit signing (Verified badge) is out of scope.

---

## v0.17.0

Fix stale "seven validators" count in AGENTS.md pre-commit section. The count was introduced when there were 6 validators in `.github/scripts/validators/` plus `validate_agents.mjs` re-used from `plugins/ievo/scripts/` (total 7). When `validate_skills.mjs` was later re-used as an eighth validator the prose was not updated. The section now reads "Eight validators enforce quality — six in `.github/scripts/validators/` and two re-used from `plugins/ievo/scripts/`" which matches the actual validator inventory. No functional change.

---

## v0.15.0

Standalone conflict resolver workflow (`conflict-resolver.yml`). When main advances and open handler PRs become DIRTY (merge conflicts prevent CI from running), this workflow auto-rebases them onto latest main. Resolves `.github/prompts/*.md` conflicts by taking main's version; escalates non-infrastructure conflicts to a PR comment for operator review. Triggers on push to main, every 6 hours as safety net, and via manual workflow dispatch. No LLM needed — pure git operations. Closes #145.

## v0.14.0

Handler posts decision-log comments to PR thread during implementation. New Phase 4b.6 (research summary after Phase 2), Phase 4c.5 (key design trade-offs after Phase 4c), and Phase 4d.5 (test strategy after Phase 4d) — each posts a concise "Handler decision log" comment to the PR thread. The review-fixer reads these comments for implementation context, ensuring fixes align with the handler's intent. Improves audit trail and handoff to fixer/operator. Closes #147.

## v0.13.0

Two-phase issue lifecycle: `@ievo` discussion + `/implement` trigger. New `issue-discussion.yml` workflow triggers when an org member mentions `@ievo` in an issue comment — Claude does deep codebase research and posts a structured analysis (Understanding, Approach, Questions, Conflicts, Risks) without creating branches or modifying files. The existing `issue-handler.yml` now triggers on `/implement` comments instead of `issues: opened/reopened`, and validates the discussion thread before implementing. Discussion phase is optional — `/implement` works without prior `@ievo` discussion. Closes #153.

## v0.12.0

Add `effort:` field validation to `validate_skills.mjs`. All 13 iEvo SKILL.md files declare `effort:` (added in v0.6.24) and Claude Code v2.1.149+ renders it in the status bar, making it user-facing UI. The validator now warns on absent `effort:` (severity: warning, does not fail CI) and errors on invalid values (severity: error, fails CI). Valid values: `low`, `medium`, `high`, `xhigh`, `max`. Also introduces warning-vs-error severity distinction in the `main()` exit logic — warnings no longer cause exit 1, only errors do. Exports `VALID_EFFORT_VALUES` set and `checkEffortField()` function for reuse. Closes #141.

Add `disallowed-tools` frontmatter to `security-check/SKILL.md` and `vuln-scan/SKILL.md` for read-only enforcement during security assessments. Claude Code v2.1.152 introduced `disallowed-tools` in skill frontmatter, allowing skills to explicitly block specific tools during execution. The security-check skill now blocks `Write`, `Edit`, `Bash(rm*)`, `Bash(mv*)`, `Bash(cp*)`, `Bash(curl*)`, and `Bash(wget*)`; the vuln-scan skill blocks the same set. This is defense-in-depth: the sub-agents already declare limited `tools:` allowlists, but the skill-level wrapper previously had no such restriction. Closes #139.

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
