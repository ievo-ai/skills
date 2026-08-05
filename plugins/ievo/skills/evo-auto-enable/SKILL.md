---
name: evo-auto-enable
description: "Use this skill when the user wants to capture lessons automatically without invoking /ievo:evo explicitly — trigger words \"turn on auto evolution\", \"auto-evolve\", \"capture lessons automatically\", \"evo auto on\", \"evolve without asking\". Enables auto-evolution mode for this project — iEvo accumulates \"corrections from the user\" as evolution candidates during a session and surfaces them for review via /ievo:evo. Sets the project-local flag `.ievo/evo-auto.flag` and prepares the pending-candidate queue at `.ievo/evolution-candidates/`. Asks whether to also capture tool failures/denials (opt-in, scrubbed for privacy). Auto-mode writes ONLY unambiguous project-wide overlays; ambiguous or user-level matches are parked for manual review, never written silently."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Flag + queue are project-local (`.ievo/evo-auto.flag`, `.ievo/evolution-candidates/`). Needs write access to `.ievo/`, POSIX shell or the Write tool; hook scripts need `node` + `jq`. Paired with `/ievo:evo-auto-disable`. Hooks — Claude Code: `.claude/settings.json` (UserPromptSubmit + SessionStart + opt-in PostToolUseFailure/PermissionDenied). Codex (CLI/Desktop): `.codex/hooks.json` (UserPromptSubmit + SessionStart, Step 3.5.4; opt-in PermissionRequest, Step 3.6)."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evo Auto Enable — turn on auto-evolution mode

Switches on **auto-evolution mode** for this project: iEvo watches for
**corrections from the user** during a session and accumulates them as evolution
candidates, so lessons get captured without the user explicitly running
`/ievo:evo`. The mode is a project-local setting (lives in
`.ievo/evo-auto.flag`), so it survives sessions and — if committed — is shared
with teammates in the same repo, exactly like `/ievo:debug-on`'s flag.

Enabled here, disabled with `/ievo:evo-auto-disable`.

## Scope of this mode (read before enabling)

Auto-evolution is deliberately conservative — it never guesses at a silent write:

- **Signal:** always **corrections from the user** — semantic, agent-judged
  ("actually, do X not Y"; "no, we always Z here"). Optionally, ALSO **tool
  failures and permission denials** (`PostToolUseFailure` / `PermissionDenied`;
  on Codex, which has neither event, the closest true analog is approval
  **requests** via `PermissionRequest` — a narrower signal, disclosed as such
  in Step 3.6) — a purely mechanical signal captured verbatim with no agent
  judgment involved, opt-in via Step 2's `AskUserQuestion`, scrubbed for
  privacy before it ever touches disk. Off by default
  (`signal: corrections-only`); an absent or pre-existing flag with no
  `signal:` line behaves the same way.
- **Auto-write is project-wide only.** A candidate is written to the overlay
  automatically **only** when its scope is unambiguously **project-wide**
  (`.ievo/evolution/project.md` — see `/ievo:evo` Step 1).
- **Everything else is parked, never silently written.** When scope is ambiguous
  or the target matches a **user-level-only** agent/skill, the candidate is
  appended to the **pending queue** (`.ievo/evolution-candidates/pending.md`) for
  manual review through the normal `/ievo:evo` flow. Auto-mode never asks
  mid-session and never writes an agent/skill overlay silently.

## When to use

- User says "turn on auto evolution", "auto-evolve", "capture lessons automatically",
  "evolve without asking", "evo auto on"
- User wants corrections they make during a session to be remembered without
  stopping to run `/ievo:evo` each time
- A project where the same corrections keep recurring and should accumulate

## Steps

### 1. Verify `.ievo/` exists

If the `.ievo/` directory is absent → init hasn't been run in this project. Tell
the user:

```
iEvo not initialized in this project. Run /ievo:init first.
Auto-evolution builds on the same overlay model — nothing to evolve yet.
```

Exit.

### 2. Ask about failure/denial capture, then write the flag file

If `<project>/.ievo/evo-auto.flag` already exists, read its current `signal:`
value first (treat an absent line, or any value other than
`corrections+failures`, as `corrections-only`) and preselect the matching
option below — this re-run is a refresh, not a fresh opt-in choice.

Ask via `AskUserQuestion`:

```
Also capture tool failures and permission denials as evolution candidates?
- "corrections-only"     — capture only explicit user corrections (default)
- "corrections+failures" — also capture failed/denied tool calls
  (PostToolUseFailure + PermissionDenied), scrubbed for privacy, for later
  fixed-vs-noise review via /ievo:evo
```

Use the Write tool (NOT Bash) to create `<project>/.ievo/evo-auto.flag` with YAML
content (mirrors `.ievo/debug.flag`'s shape), `signal:` set to the answer above:

```
enabled: true
enabled_at: <ISO-8601 UTC timestamp>
enabled_by: <user identifier if known, else "user-invocation">
signal: <corrections-only | corrections+failures>
auto_write_scope: project-wide-only
```

The file format is YAML for easy human reading. Presence of the file = mode
enabled; the correction-capture hook and the periodic-analysis nudge read it to
decide whether to accumulate and surface candidates. The failure-capture hook
(Step 3.6) additionally gates on the `signal:` value — flipping it later (edit
the flag, or re-run this skill) takes effect on the next hook fire, no
re-install needed.

### 3. Prepare the pending-candidate queue

Ensure `<project>/.ievo/evolution-candidates/` exists. If
`<project>/.ievo/evolution-candidates/pending.md` is absent, use the Write tool to
create it with this scaffold (do NOT overwrite an existing queue — it may already
hold parked candidates):

```
# Evolution candidates — pending review

Corrections captured while auto-evolution mode is ON, awaiting review via
`/ievo:evo`. Auto-mode writes unambiguous project-wide lessons to the
overlay directly; anything ambiguous or user-level-only is parked HERE instead of
being written silently. Review with `/ievo:evo`, then remove the entries
you have folded into an overlay.

Retention: candidates from the last 10 sessions are kept; older per-session
candidate files are cleaned up (suggest cleanup, never delete without asking).

Each parked candidate is appended below as:

## <ISO-8601 UTC> — session <session-id>
- Scope: ambiguous | user-level-only
- Correction: <verbatim user correction / lesson text>
```

### 3.5 Install the correction-capture + analysis + failure-capture hooks

This is what makes auto-evolution actually capture and surface corrections (and,
opt-in, tool failures/denials). Three hooks are wired into the **invoking
client's own hook config** — Claude Code: the project's `.claude/settings.json`;
Codex: the project's `.codex/hooks.json` (detect the client per `/ievo:init` Step
1.5's rule, **ordered**: `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code; never the bare `$CODEX_CLI` var in isolation, and never `command -v codex`). Writing
Claude Code hooks from a Codex session enables nothing: Codex never reads
`.claude/settings.json`, which left auto-mode claiming "ENABLED" with only a flag
and queue on disk (issue #432). All three hooks are **gated on
`.ievo/evo-auto.flag`** so they are no-ops the moment the mode is off (or
`/ievo:evo-auto-disable` removes the flag), and all **fail-silent and
non-blocking**. The generated scripts are identical on both platforms — only the
wiring differs (Step 3.5.4): Claude Code uses `/ievo:hooks-setup`-convention
exec-form `args: string[]`; Codex handlers take a single `command` string. The
correction-capture and analysis-nudge hooks emit `additionalContext` from the
hook command's stdout JSON, the failure-capture hook (Step 3.6) emits no stdout
at all (nothing for the agent to act on mid-failure). Verified against the
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
(UserPromptSubmit + SessionStart both support
`hookSpecificOutput.additionalContext`; SessionStart is context-only and cannot
block startup; PostToolUseFailure's error payload field is `tool_error`, NOT a
top-level `error` — see Step 3.6's note on this) and against the
[Codex hooks reference](https://developers.openai.com/codex/hooks)
(same `hookSpecificOutput.additionalContext` support on UserPromptSubmit +
SessionStart; same `session_id`/`hook_event_name` stdin JSON; hooks fail open on
errors/timeouts).

The correction-capture and analysis-nudge hooks call the per-session accumulator
`plugins/ievo/scripts/evolution_candidates.mjs` (Node, stdlib-only) for
`append` / `count` / `prune`. It only ACCUMULATES — it never classifies scope or
writes overlays; analysis is deferred to the next session (Step 3.5.3 / the
contract below). The failure-capture hook (Step 3.6) also calls
`plugins/ievo/scripts/scrub.mjs` to redact the record before it ever reaches
disk.

#### 3.5.1 Resolve the plugin root and vendor a stable fallback copy

A hook fired from the project's own config (`.claude/settings.json` on Claude
Code, `.codex/hooks.json` on Codex) does **not** get
`CLAUDE_PLUGIN_ROOT` set at fire time, so every generated script below prefers a
live `CLAUDE_PLUGIN_ROOT` when present and otherwise falls back to a
**project-local vendored copy** — never a path baked from `CLAUDE_PLUGIN_ROOT` at
setup time. That literal would point into the versioned plugin cache
(`~/.claude/plugins/cache/...`); it goes stale on the very next plugin update
(orphaned cache directories are purged ~14 days later) and the scripts'
fail-silent contracts hide the resulting silent death — a baked-path generator
was found dead in the wild this way (#422). This rule applies to every script
generated by this skill, not just the new one.

**Security precondition — gitignore `.ievo/hooks/` (except the tracked
dispatcher shims, Step 3.5.1b) BEFORE vendoring.** The `scrub.mjs` copied below
is the privacy-redaction engine itself. The old baked fallback pointed at the
plugin cache *outside* the repo, so it was never committable; a project-local
copy under a **git-tracked** `.ievo/hooks/` could be committed and then altered
in a PR to defeat scrubbing — a real escalation this vendoring introduces. So
before copying anything, ensure `.ievo/hooks/` is git-ignored except the three
dispatcher-shim filenames Step 3.5.1b tracks — a security gate here, not the
convenience offer Step 3.5.1b makes for those shims.

A blanket `.ievo/hooks/` line ignores the whole directory as one opaque unit,
and git's own semantics make that form impossible to selectively un-ignore
later ("you cannot re-include a file if a parent directory of that file is
excluded"), so this skill needs a **negation-capable** pattern instead:
everything under `.ievo/hooks/` stays ignored by default, with exactly the
three tracked shim filenames carved out. `/ievo:init` Step 10 writes this same
six-line block (kept byte-identical there, so the two skills converge on one
`.gitignore` state whichever runs first, and an init re-run after an enable can
never re-ignore the shims); a project initialised before #446, or one with a
hand-written entry, can still carry the old blanket line. Read the project's
`.gitignore` (absent = nothing to check, fall through to the append below):

- If it already contains the six-line block below, nothing to do.
- If it contains a blanket `.ievo/hooks/` line instead (a pre-#446 `/ievo:init`
  Step 10 run, a pre-#446 run of this skill, or a hand-written entry), REPLACE
  that one line with the block below via the Edit tool — leave every other line
  untouched. The blanket line must be replaced, not left alongside the new one:
  a bare `dir/` entry still wins over later negations for paths inside it, so
  leaving both would silently keep the shims ignored.
- If `.ievo/hooks/` is not mentioned at all, append the block (creating
  `.gitignore` first if the project lacks one).

```
.ievo/hooks/*
!.ievo/hooks/scripts/
.ievo/hooks/scripts/*
!.ievo/hooks/scripts/correction-capture.sh
!.ievo/hooks/scripts/evo-analysis-nudge.sh
!.ievo/hooks/scripts/failure-capture.sh
```

Verify with `git check-ignore -q .ievo/hooks/scripts/vendor` (exit 0 — still
ignored) AND `git check-ignore -q .ievo/hooks/scripts/correction-capture.sh`
(exit 1 — NOT ignored, so it is trackable) before proceeding. Only skip this
whole precondition when the project is not a git repo
(`git rev-parse --is-inside-work-tree` fails — nothing to track, so nothing
PR-tamperable). Never vendor `scrub.mjs` into a location git would track.

Run via Bash, using the plugin root this skill itself is running from:

```
mkdir -p .ievo/hooks/scripts/vendor
cp "${CLAUDE_PLUGIN_ROOT}/scripts/evolution_candidates.mjs" .ievo/hooks/scripts/vendor/evolution_candidates.mjs 2>/dev/null && \
cp "${CLAUDE_PLUGIN_ROOT}/scripts/scrub.mjs" .ievo/hooks/scripts/vendor/scrub.mjs 2>/dev/null && \
echo ok
```

If this does NOT print `ok` (empty/unset `CLAUDE_PLUGIN_ROOT`, or either source
script missing), the plugin root couldn't be resolved — tell the user auto-mode's
capture hooks can't be configured right now, and skip to Step 4 (the flag + queue
from Steps 2–3 still stand; the user can re-run once resolved).

The vendored copies live at the **fixed, non-versioned, relative** paths
`.ievo/hooks/scripts/vendor/evolution_candidates.mjs` and
`.ievo/hooks/scripts/vendor/scrub.mjs` — every generated script below bakes in
these literal relative paths as its fallback, never a `CLAUDE_PLUGIN_ROOT`-derived
absolute one, so no per-project substitution is needed. Hook scripts always run
with `cwd` = the project root (the existing `.ievo/evo-auto.flag` relative-path
check in Step 3.5.2 already relies on this), so a relative fallback path is
sufficient. Re-running `/ievo:evo-auto-enable` refreshes both vendored copies to
the currently-installed plugin version; between a plugin update and the next
re-run the vendored fallback can lag the live version by one release — the same
staleness window every other vendored file in this plugin already accepts (see
`/ievo:update`), and a live `CLAUDE_PLUGIN_ROOT` (when the platform does expose it
to a project hook) is always preferred first.

#### 3.5.1b Write the tracked dispatcher shims (closes #446)

`.claude/settings.json` (Step 3.5.4) wires its hook entries to fixed paths —
`.ievo/hooks/scripts/correction-capture.sh`, `evo-analysis-nudge.sh`,
`failure-capture.sh`. Before #446 those exact paths held the FULL generated
script (Step 3.5.2/3.5.3/3.6) and were entirely gitignored, so a project that
committed the flag + `.claude/settings.json` (as Step 5 recommends) without a
teammate ever running this skill locally shipped hook entries pointing at
files that don't exist on a fresh clone — `sh .ievo/hooks/scripts/
correction-capture.sh` exits 127, and `UserPromptSubmit` fires on *every*
message, so the failure is not a one-time cosmetic error like
`hooks-setup`'s Stop hook precedent.

The fix: these three wired paths now hold a **tracked, static dispatcher
shim** — identical content on every project, carrying nothing project-specific
or version-specific, so it is safe to commit and needs no per-clone
regeneration. (Static means "does not vary by project", not "frozen forever":
the shim bodies below are the current ones and can change between plugin
versions — #551 changed the `SessionStart` one. A project keeps whatever it
committed until someone re-runs this skill, which overwrites all three
unconditionally; an older shim is merely older, never broken, since the
companion holds the behavior.) Steps 3.5.2/3.5.3/3.6 write the actual
generated logic to a **different, still-gitignored** `.local.sh` companion
path; the shim `exec`s that companion when present, else no-ops silently. A
clean clone always has the shim (tracked), so the wired command always
exists — the companion is what still needs a per-clone run to appear.

One deliberate exception (#551): the **SessionStart** shim, instead of
no-opping, emits a drift warning when `.ievo/evo-auto.flag` is present but
its companion is not. That combination is exactly the fresh-clone /
half-finished-enable drift Step 3.5.3's wiring check exists to surface — and
the one case that check can never surface itself, since a missing companion
is a companion that never runs. The tracked shim is the only always-present
file on that path, so the check has to live here to fire at all. The other
two shims stay bare no-ops: `UserPromptSubmit` fires on every message (a
warning there would repeat all session), and `SessionStart` is already the
channel this skill uses for exactly this kind of once-per-session notice.

Use the Write tool to create the three shims (paths match Step 3.5.4's wiring
exactly — do not rename):

```sh
#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (UserPromptSubmit), skills#446.
# Committed so a clean clone of `.claude/settings.json` + this file never
# 127s. Delegates to the per-clone companion when present; otherwise a
# silent no-op (correction-capture.sh's stdout is parsed as hook JSON, so
# this never prints anything of its own). Static and identical across every
# project -- safe to overwrite unconditionally on every enable/re-enable.
# CONTRACT: fail-silent, non-blocking. NO `set -e`.
# `sh "$REAL"` needs no exec bit on the companion, so there is deliberately
# no `[ -x ]` guard -- one would silently no-op if the chmod never stuck.

REAL=.ievo/hooks/scripts/correction-capture.local.sh
[ -f "$REAL" ] && exec sh "$REAL"
exit 0
```

```sh
#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (SessionStart), skills#446.
# Same contract as correction-capture.sh's shim above -- see that file for
# the full rationale. Static and identical across every project.
# CONTRACT: fail-silent, non-blocking. NO `set -e`.
#
# Unlike the other two shims this one does NOT no-op silently when its
# companion is absent (skills#551). The companion is gitignored, so "flag
# committed, per-clone regeneration never run" -- the exact drift the
# companion's own wiring check exists to report -- is precisely the case in
# which that check cannot run at all: a fresh clone would stay silent for a
# whole session, which IS the reported bug. This shim is the only tracked,
# always-present file on that path, so it owns the one check the companion
# structurally cannot make about itself: flag ON, companion missing. Every
# richer check (vendored copies, sibling companions, wired hook entries,
# pending-candidate count) stays in the companion, which runs whenever it
# exists. SessionStart stdout is parsed as hook JSON, so the warning rides
# the same additionalContext channel the companion already uses, and the
# ASCII / no-double-quotes contract applies here too.

REAL=.ievo/hooks/scripts/evo-analysis-nudge.local.sh
[ -f "$REAL" ] && exec sh "$REAL"

[ -f .ievo/evo-auto.flag ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' 'iEvo auto-evolution: .ievo/evo-auto.flag is ON but this clone has no generated hook logic (drift detected) -- .ievo/hooks/scripts/evo-analysis-nudge.local.sh is missing, so capture may be partly or entirely inactive. The generated companions are gitignored and must be regenerated once per clone: run /ievo:evo-auto-enable to repair -- it is idempotent and safe to re-run on top of a partial install.'
exit 0
```

```sh
#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (PostToolUseFailure /
# PermissionDenied / Codex PermissionRequest), skills#446. Same contract as
# correction-capture.sh's shim above. Static and identical across every
# project.
# CONTRACT: fail-silent, non-blocking. NO `set -e`.

REAL=.ievo/hooks/scripts/failure-capture.local.sh
[ -f "$REAL" ] && exec sh "$REAL"
exit 0
```

Then make all three executable via Bash:
`chmod +x .ievo/hooks/scripts/correction-capture.sh .ievo/hooks/scripts/evo-analysis-nudge.sh .ievo/hooks/scripts/failure-capture.sh`.

These three files are the ONLY thing this skill writes outside `.ievo/hooks/
scripts/vendor/` that is meant to be committed — call this out explicitly to
the user in Step 5 so `git add` picks them up. Idempotent and safe to
overwrite unconditionally: the content above never varies by project, and
carries no generated or per-clone state, so re-running this step on an
already-set-up project (one on an older shim, or one migrating from a
pre-#446 install where the wired path already holds a full generated script)
simply replaces whatever was there with the current shim — the
next sub-step immediately regenerates the real logic at the `.local.sh`
companion path, so nothing is lost.

**Security note — committing these makes them a review-gated exec path.**
Before #446 every script under `.ievo/hooks/scripts/` was gitignored, so what
ran on a teammate's machine could only ever be what *they* generated locally.
Tracking the three shims changes that: they are now code in the repo that
`.claude/settings.json`/`.codex/hooks.json` execute on every prompt and every
session start, on every clone that pulls them — so a pull request touching
them is a pull request touching everyone's execution path (the classic
committed-hook-script tradeoff, and the reason the bodies above are kept to a
four-line dispatch). One consequence to state to the user in Step 5 (its
confirmation block says this in one line), plus the tradeoff behind it:

- Review any diff to `.ievo/hooks/scripts/*.sh` as executable code, not as
  config. The shim content is **static** — identical on every project, and
  carrying no generated, machine-local, or per-clone content — so a diff to
  it is never routine project churn. Exactly one legitimate cause exists:
  someone re-ran this skill on a plugin version whose shim body changed
  (#551 changed the `SessionStart` one), which reproduces this step's
  fenced blocks byte-for-byte. Anything that does not match the installed
  plugin's own shim body is suspicious by default — especially from an
  untrusted contributor.
- The tradeoff is deliberate and bounded: the alternative (wiring committed
  hook config at a path no clone has) is the 127-on-every-message bug this
  step exists to close, and the shims deliberately hold no capture logic —
  the real, generated logic stays in the gitignored `.local.sh` companions,
  which are never committed and so never travel with a PR.

#### 3.5.2 Write the correction-capture hook (UserPromptSubmit)

Use the Write tool to create `.ievo/hooks/scripts/correction-capture.local.sh`
— the `.local.sh` companion Step 3.5.1b's tracked shim `exec`s when present.
Never write this content to the plain `correction-capture.sh` name; that path
is the tracked shim and must keep its static content:

```sh
#!/bin/sh
# iEvo auto-evolution — correction-capture nudge (UserPromptSubmit).
# Fires on each user prompt WHEN auto-evolution mode is ON (.ievo/evo-auto.flag
# present). Injects a conservative self-assessment nudge as additionalContext so
# the agent can decide whether the user's message is a correction and, if so,
# record it VERBATIM via a Write-tool temp file + the accumulator's
# --text-file flag -- NEVER by embedding the raw correction text inside a
# Bash argument (a prior version did that with naive single-quoting, which an
# apostrophe or shell metacharacter in the correction could break out of --
# CWE-78, closed in #373). It does NOT classify scope or write overlays --
# analysis is deferred to the next SessionStart.
#
# CONTRACT: fail-silent (mode off / any error => emit nothing, exit 0),
# non-blocking, ASCII-only additionalContext (no double quotes). NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the vendored fallback
# copy Step 3.5.1 refreshes on every enable/re-enable (never a baked
# plugin-cache literal -- that path dies on the next plugin update).
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/vendor/evolution_candidates.mjs"

# session_id comes from the hook's stdin JSON. jq is a hard dependency of gh,
# which iEvo already requires; fall back to "unknown" if absent/unparseable.
sid=$(cat | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
case "$sid" in "") sid="unknown" ;; esac

msg="iEvo auto-evolution is ON. If the message you are about to answer is a genuine correction of your prior approach or output (the user telling you a rule or preference you got wrong -- e.g. 'no, we always X here', 'stop doing Y'), then AFTER you respond, record it as an evolution candidate WITHOUT ever putting its text inside a shell command: first use the Write tool (NOT Bash) to write the correction verbatim, one line, to .ievo/hooks/tmp/correction-pending.txt, then run this exact fixed command: node ${ACC} append --session ${sid} --text-file .ievo/hooks/tmp/correction-pending.txt. Never substitute the correction text itself into the command. Do NOT classify scope or write overlays now -- that happens at the next session's review. Capture ONLY genuine corrections; ignore routine questions, clarifications, and normal back-and-forth. If it was not a correction, do nothing and do not mention this."
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$msg"
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/correction-capture.local.sh`.

The temp file lives under `.ievo/hooks/` (gitignored by Step 3.5.1's pattern —
which supersedes `/ievo:init` Step 10's original blanket line when present —
same as the `.local.sh` companion itself) at a **fixed** path —
`.ievo/hooks/tmp/correction-pending.txt`
— never a path built from the correction text or any other untrusted value, so the
Write tool call itself can't be steered by a crafted correction either. Each capture
overwrites the same file; only the latest pending write matters until the agent
appends it.

#### 3.5.3 Write the SessionStart analysis nudge

Use the Write tool to create `.ievo/hooks/scripts/evo-analysis-nudge.local.sh`
— same `.local.sh` companion convention as Step 3.5.2; never write this
content to the plain `evo-analysis-nudge.sh` name (the tracked shim). Besides
the existing pending-candidate count, this script now ALSO asserts the
wiring itself is genuinely installed (closes #551) — a hand-written
`.ievo/evo-auto.flag`, or a `/ievo:evo-auto-enable` run that died partway
through Step 3/3.5, can leave the flag claiming ENABLED with none of the
vendored fallback copies, `.local.sh` companions, or wired hook-config
entries actually on disk, and nothing surfaced that mismatch — not a
SessionStart nudge, not an error — for the length of an entire session
(the reported failure mode). Checked every SessionStart rather than only at
enable time, since the same drift can appear later too (a teammate wipes
`.ievo/hooks/` locally, a manual `settings.json` edit drops an entry, a stale
clone never ran the per-clone regeneration Step 3.5.4 describes).

One half of that check does NOT live here: this file is gitignored, so it
cannot report its own absence — the case where the flag is committed and no
companion was ever regenerated on this clone. Step 3.5.1b's tracked
`evo-analysis-nudge.sh` shim covers that one, and everything below assumes
this script is running, i.e. that the companion exists:

```sh
#!/bin/sh
# iEvo auto-evolution — SessionStart analysis nudge.
# On a NEW session, when auto-evolution is ON, prune to the last 10 sessions and,
# if any candidates are pending, nudge the agent to review them via
# /ievo:evo. No LLM work happens here -- this only counts + surfaces.
#
# Also verifies the wiring itself is actually installed (skills#551): the flag
# can exist -- claiming ENABLED -- with none of the vendored fallback copies,
# `.local.sh` companions, or wired hook-config entries actually on disk (a
# hand-written flag file, or a `/ievo:evo-auto-enable` run that died partway
# through Step 3/3.5). Checked every SessionStart, not just at enable time,
# since the same drift can appear later too (a teammate wipes `.ievo/hooks/`
# locally, a manual settings.json edit drops an entry, a stale clone that
# never ran the per-clone regeneration). This is what actually surfaces the
# "flag present but no hook files found on disk" mismatch every session,
# closing the gap the reporter hit: a whole session with zero capture and
# zero warning.
#
# CONTRACT: fail-silent, context-only (SessionStart cannot block startup),
# ASCII-only additionalContext. NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the vendored fallback
# copy Step 3.5.1 refreshes on every enable/re-enable (never a baked
# plugin-cache literal -- that path dies on the next plugin update).
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/vendor/evolution_candidates.mjs"

# Retention: keep the last 10 sessions of candidates (best-effort).
node "$ACC" prune --keep 10 >/dev/null 2>&1 || true

# A missing/broken accumulator (itself a symptom of the drift this script now
# checks for below) must not silently swallow the whole nudge the way a bare
# early `exit 0` on a parse failure previously did -- fall back to 0 pending
# candidates and let the wiring check run regardless.
n=$(node "$ACC" count 2>/dev/null || echo 0)
case "$n" in ""|*[!0-9]*) n=0 ;; esac

# Wiring-integrity check -- same platform-detection rule as /ievo:init Step
# 1.5 (ordered, first match wins): $CLAUDECODE set with $CODEX_CLI unset ->
# Claude Code; else $CODEX_CLI set -> Codex; else a Codex Desktop signal
# (CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop, or macOS
# __CFBundleIdentifier=com.openai.codex) -> Codex; else Claude Code. This
# script's content is identical on both platforms (only the wiring differs),
# so it self-detects which config file its own session should have wired.
if [ -n "$CLAUDECODE" ] && [ -z "$CODEX_CLI" ]; then
  HOOKS_FILE=.claude/settings.json
elif [ -n "$CODEX_CLI" ]; then
  HOOKS_FILE=.codex/hooks.json
elif [ "$CODEX_INTERNAL_ORIGINATOR_OVERRIDE" = "Codex Desktop" ] || [ "$__CFBundleIdentifier" = "com.openai.codex" ]; then
  HOOKS_FILE=.codex/hooks.json
else
  HOOKS_FILE=.claude/settings.json
fi

missing=""
note_missing() {
  [ -z "$missing" ] && missing="$1" || missing="$missing, $1"
}
[ -f .ievo/hooks/scripts/vendor/evolution_candidates.mjs ] || note_missing "vendored evolution_candidates.mjs"
[ -f .ievo/hooks/scripts/vendor/scrub.mjs ] || note_missing "vendored scrub.mjs"
[ -f .ievo/hooks/scripts/correction-capture.local.sh ] || note_missing "correction-capture.local.sh"
[ -f .ievo/hooks/scripts/failure-capture.local.sh ] || note_missing "failure-capture.local.sh"
# Deliberately NOT checked here: `evo-analysis-nudge.local.sh` itself. This
# script IS that file -- when it is absent nothing here runs, so a check for
# it could only ever report the one state it cannot observe. The tracked
# shim `evo-analysis-nudge.sh` (Step 3.5.1b) owns that check instead: it is
# committed, so it is present even on a clone that never regenerated the
# companions, which is exactly when that state occurs.
# Presence-based, not event-placement-based: this confirms the path string
# is wired SOMEWHERE in the file, not that it sits under the correct event
# key (UserPromptSubmit/SessionStart/PostToolUseFailure+PermissionDenied on
# Claude Code; the Codex equivalents) -- a manual edit that moved an entry to
# the wrong event would still read as "wired" here. -qF (fixed-string, not
# regex) since these are literal paths, not patterns.
if [ -f "$HOOKS_FILE" ]; then
  grep -qF '.ievo/hooks/scripts/correction-capture.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "correction-capture hook entry in $HOOKS_FILE"
  grep -qF '.ievo/hooks/scripts/evo-analysis-nudge.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "evo-analysis-nudge hook entry in $HOOKS_FILE"
  grep -qF '.ievo/hooks/scripts/failure-capture.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "failure-capture hook entry in $HOOKS_FILE"
else
  note_missing "$HOOKS_FILE itself (no hook config file at all)"
fi

[ "$n" -gt 0 ] || [ -n "$missing" ] || exit 0

if [ -n "$missing" ]; then
  # Deliberately hedged: this list covers partial drift too (one missing hook
  # entry still leaves the other capture paths working), so it must not claim
  # capture has stopped outright.
  drift_msg="iEvo auto-evolution: .ievo/evo-auto.flag is ON but the hook wiring is missing or incomplete (drift detected) -- ${missing}. Capture may be partly or entirely inactive. Re-run /ievo:evo-auto-enable to repair -- it is idempotent and safe to re-run on top of a partial install."
fi

if [ -n "$missing" ] && [ "$n" -gt 0 ]; then
  msg="${drift_msg} Separately, ${n} evolution candidate(s) captured in earlier sessions are still pending review -- offer /ievo:evo for those too once wiring is repaired."
elif [ -n "$missing" ]; then
  msg="$drift_msg"
else
  msg="iEvo auto-evolution: ${n} evolution candidate(s) captured in earlier sessions are pending review. Offer to run /ievo:evo to fold them in -- for each candidate apply Step 1 scope classification: auto-write ONLY unambiguous project-wide lessons to .ievo/evolution/project.md; park anything ambiguous or user-level in .ievo/evolution-candidates/pending.md for manual review. Never write agent/skill or user-level overlays silently. Candidates with scope=tool-failure are captured mechanical tool signals (tool failures/denials on Claude Code, approval requests on Codex), not corrections -- apply a signal-then-fixed-vs-noise judgment before folding one in: a signal later resolved toward the same goal is learnable, a signal inside normal iteration is noise. Remove each candidate from its session file as you consume it."
fi

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/evo-analysis-nudge.local.sh`.

**Why a nudge, not a blocking error:** `SessionStart` cannot block startup on
either platform, and this script's own contract (like every other hook this
skill writes) is fail-silent — so a drift finding is surfaced as
`additionalContext` for the agent to relay, exactly like the existing
pending-candidate count, never a hard failure. This mirrors ask #2 from
issue #551 ("a way to verify auto-mode is genuinely wired end-to-end") while
ask #1 (self-healing re-run) was already satisfied by this skill's existing
idempotency — re-running `/ievo:evo-auto-enable` after this nudge fires
repairs exactly the drift it names.

#### 3.5.4 Wire the correction-capture + analysis hooks into the client's hook config

**On Claude Code** (`/ievo:init` Step 1.5: no Codex signal) — read the project's
`.claude/settings.json` first (treat absent as `{}`); if it
exists but is **not valid JSON**, halt without writing (do not clobber manual
edits) and tell the user to fix it. Merge with the **Read + Edit** tools (not
shell JSON edits — preserves comments and key order), appending these two entries
(a third, for failure-capture, is Step 3.6) and deduping by the inner `command` +
`args` pair (skip if an identical entry already exists), using the same Read +
Edit merge mechanics `/ievo:hooks-setup`
Step 6 uses (that skill's own hook entries still lack `command` as of this
writing — see the `hooks-setup/SKILL.md` scope note in CHANGELOG.md — so the
dedup *key* differs; only the merge mechanics are shared). Claude Code's hook
schema requires `command` even in exec form — it holds the executable;
`args` holds only the argument vector, never the executable itself (a prior
version of this step omitted `command`, which Claude Code's settings validator
rejects at write time with `hooks.UserPromptSubmit.0.hooks.0.command: Expected
string, but received undefined` — closed in #384):

Under `hooks.UserPromptSubmit[]` (no `matcher` — fires on every prompt; the
script itself gates on the flag):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "sh",
      "args": [".ievo/hooks/scripts/correction-capture.sh"]
    }
  ]
}
```

Under `hooks.SessionStart[]` with `matcher: "startup"` (new sessions only, so a
mid-work resume/compact never re-injects the nudge):

```json
{
  "matcher": "startup",
  "hooks": [
    {
      "type": "command",
      "command": "sh",
      "args": [".ievo/hooks/scripts/evo-analysis-nudge.sh"]
    }
  ]
}
```

**On Codex** (`/ievo:init` Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal) — wire the SAME two scripts into the project's
`.codex/hooks.json` instead. Codex's native hook system supports both events
with the same semantics ([Codex hooks reference](https://developers.openai.com/codex/hooks)):
`UserPromptSubmit` and `SessionStart` are first-class Codex events, both accept
`hookSpecificOutput.additionalContext`, hooks receive the same
`session_id`-bearing JSON on stdin, and the `SessionStart` matcher filters by
source with the same `startup` value (possible values: `startup`, `resume`,
`clear`, `compact`). Differences from the Claude Code entries: a Codex handler
takes a single `command` **string** (no exec-form `args` array), and the
top-level key layout is `{"hooks": {<EventName>: [...]}}`.

Read `.codex/hooks.json` first (treat absent as `{"hooks": {}}`); if it exists
but is not valid JSON, halt without writing and tell the user to fix it — same
no-clobber rule as above. Merge with Read + Edit, deduping by the handler's
`command` string:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "sh .ievo/hooks/scripts/correction-capture.sh"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "sh .ievo/hooks/scripts/evo-analysis-nudge.sh"
          }
        ]
      }
    ]
  }
}
```

Two Codex-specific caveats — state both to the user rather than claiming
unconditional success (the "claims enabled while nothing captures" failure is
this skill's issue #432 bug class):

- **Trust gate:** Codex loads project-local `.codex/` hooks only when that
  config layer is trusted. If the user hasn't trusted this project's `.codex/`
  layer, the hooks sit inert until they do.
- **Relative paths:** the entries use project-root-relative script paths — the
  same pattern as the worked Codex example in
  `hooks-setup/references/codex-hooks.md`. Codex hooks fail open (a failing
  hook never blocks the session), so a session started outside the project
  root degrades to no capture, not an error.

**Functional check (both platforms), before claiming success — (1) here,
(2) and (3) at the end of Step 3.6:** after writing the config, (1) re-read it
and parse it as JSON (`node -e
'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <file>` —
malformed config is a silent kill on a fail-open platform). Run this one now,
against the write you just made.

The other two — **(2)** dry-run each wired command and confirm exit 0, and
**(3)** assert every `.local.sh` companion is on disk — both run at the **end
of Step 3.6**, and both for the same reason: Step 3.6 writes
`failure-capture.local.sh` and wires its own hook entries, so at this point in a
linear enable run neither exists yet. Run here, (3) would print a spurious
`MISSING: failure-capture.local.sh`, and (2)'s dry-run of
`evo-analysis-nudge.sh` would reach that script's own wiring-integrity check
(Step 3.5.3) and print a spurious `... the hook wiring is missing or incomplete
(drift detected) -- failure-capture.local.sh, failure-capture hook entry in
<config file> ...`. Both name artifacts this run is about to write, against a
step whose own rule is "do NOT claim success" — false failures on the happy
path. Do not claim success, and do not report drift to the user, until Step
3.6's checks (2) and (3) have run and passed there.

Only hooks Codex/Claude Code fire on a real session boundary can prove
end-to-end delivery — say so in Step 5's confirmation instead of implying the
capture loop was already observed working.

The wired paths (`.ievo/hooks/scripts/correction-capture.sh`,
`evo-analysis-nudge.sh`, `failure-capture.sh`) are the **tracked dispatcher
shims** from Step 3.5.1b — committed, static, present on every clone. The
`.local.sh` companions holding the actual capture logic live under
`.ievo/hooks/` too, but stay gitignored (Step 3.5.1 already ensured that
except for the three shim filenames) — machine-local, like
`/ievo:hooks-setup`'s scripts. Because the companions are local, each teammate
who wants auto-mode active re-runs `/ievo:evo-auto-enable` once per clone; the
committed flag (Step 2) and shims (Step 3.5.1b) share the *intent* (and, for
the shims, a safe no-op default), the local `.local.sh` companions do the
*work*.

**A note on `security-check`:** a `UserPromptSubmit` hook is one of the patterns
`/ievo:security-check` flags when auditing *third-party* plugins (it can prompt-
inject). This is iEvo's own first-party, flag-gated hook that only injects a
self-assessment nudge and writes solely under `.ievo/` — a known, purpose-built
exception, documented in `security-check/SKILL.md` so iEvo's own tooling does not
self-flag it. The separate question of the now-*committed* dispatcher shims
being a repo-resident exec path — and how to review a diff to one — is covered
in Step 3.5.1b's security note.

### 3.6 Write + wire the failure-capture hook (opt-in, `PostToolUseFailure` + `PermissionDenied`; on Codex: `PermissionRequest`)

Unlike the two hooks above, this one needs no agent judgment at all — a tool
call either failed/was denied or it didn't, so the hook script does the whole
capture itself (extract → build a compact record → scrub → append) and never
emits `additionalContext`. It always installs (so flipping `signal:` in the flag
takes effect immediately, no re-run needed) but is a no-op unless
`signal: corrections+failures` is set — mirroring how every other hook here
self-gates on the flag rather than being conditionally wired.

**Platform semantics differ here — disclose, don't paper over.** Claude Code
fires `PostToolUseFailure` (a tool call failed) and `PermissionDenied` (a call
was denied). Codex has **neither** event — its verified catalog
([Codex hooks reference](https://developers.openai.com/codex/hooks)) offers
`PermissionRequest` as the closest true analog, and it fires when a tool call
*needs approval* — BEFORE the allow/deny decision, whose outcome the hook never
sees. So on Codex this signal records "an approval was requested"
(`outcome: requested`), not "a call failed/was denied". That is a real,
narrower signal (approval friction points), captured under the same
fixed-vs-noise review contract — never describe it to the user as
failure/denial capture. The script emits no stdout, so it can never influence
the permission decision itself (Codex only reads a decision from an explicit
`hookSpecificOutput.decision` output, which this script never produces).

Use the Write tool to create `.ievo/hooks/scripts/failure-capture.local.sh`
— same `.local.sh` companion convention as Step 3.5.2/3.5.3; never write this
content to the plain `failure-capture.sh` name (the tracked shim):

```sh
#!/bin/sh
# iEvo auto-evolution — tool-failure capture (PostToolUseFailure / PermissionDenied).
# Fires whenever a tool call fails or is denied. Purely mechanical -- no agent
# judgment needed, so (unlike correction-capture.sh) this script does the whole
# capture itself: extract the failure/denial from the hook's stdin JSON, build a
# compact one-line {event,tool,outcome,detail} record, pipe it through scrub.mjs,
# then append it via the accumulator's --scope tool-failure. Deliberately emits
# NO stdout -- there is nothing actionable for the agent mid-failure; analysis is
# deferred to the next SessionStart nudge same as corrections.
#
# CONTRACT: fail-silent (mode off / signal not opted in / any error => exit 0,
# no output), non-blocking, fail-CLOSED for content -- a scrub failure or a
# missing scrub.mjs drops the record; a raw/unscrubbed record must NEVER reach
# disk, even transiently. NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0
grep -q '^signal: corrections+failures$' .ievo/evo-auto.flag || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the vendored fallback
# copies Step 3.5.1 refreshes on every enable/re-enable (never a baked
# plugin-cache literal -- that path dies on the next plugin update).
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/vendor/evolution_candidates.mjs"
SCRUB="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/scrub.mjs}"
[ -n "$SCRUB" ] && [ -f "$SCRUB" ] || SCRUB=".ievo/hooks/scripts/vendor/scrub.mjs"
[ -f "$ACC" ] && [ -f "$SCRUB" ] || exit 0

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
case "$sid" in "") sid="unknown" ;; esac
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "unknown"' 2>/dev/null || echo unknown)

case "$event" in
  PostToolUseFailure) outcome=failed ;;
  PermissionDenied) outcome=denied ;;
  # Codex wiring (Step 3.6's .codex/hooks.json entry) -- fires when a tool call
  # needs approval, BEFORE the allow/deny decision, so the honest outcome is
  # "requested", never "failed"/"denied". Unreachable on Claude Code (this
  # script is only wired under PostToolUseFailure/PermissionDenied there).
  PermissionRequest) outcome=requested ;;
  *) exit 0 ;;
esac

# The Claude Code hooks reference (code.claude.com/docs/en/hooks) documents
# PostToolUseFailure's error payload as tool_error; some empirical probes have
# reported a top-level `error` string instead. Try tool_error first (doc-
# confirmed), then error, then reason, so a naming discrepancy across Claude
# Code versions doesn't silently drop the signal -- none of the three are
# documented for PermissionDenied, so detail there falls back to tool_input
# alone (same for Codex's PermissionRequest: no error field exists pre-decision;
# its stdin payload carries tool_name/tool_input). jq -c keeps the whole record
# to a single line.
record=$(printf '%s' "$input" | jq -c --arg outcome "$outcome" '{event: .hook_event_name, tool: (.tool_name // "unknown"), outcome: $outcome, detail: {error: (.tool_error // .error // .reason // null), tool_input}}' 2>/dev/null)
[ -n "$record" ] || exit 0

scrubbed=$(printf '%s' "$record" | node "$SCRUB" 2>/dev/null)
[ -n "$scrubbed" ] || exit 0

mkdir -p .ievo/hooks/tmp
tmp=.ievo/hooks/tmp/failure-pending.txt
printf '%s' "$scrubbed" > "$tmp" 2>/dev/null || exit 0

node "$ACC" append --session "$sid" --text-file "$tmp" --scope tool-failure >/dev/null 2>&1 || true
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/failure-capture.local.sh`.

Same fixed-path rationale as `correction-capture.local.sh`'s temp file (Step 3.5.2): the
record is built and scrubbed entirely inside this script, then handed to the
accumulator via `--text-file` at the **fixed** path
`.ievo/hooks/tmp/failure-pending.txt` — never `--text` with the record
interpolated into a Bash argument, so nothing a failing tool printed can break out
of shell quoting (the same CWE-78 class closed in #373 for corrections).

**On Claude Code**, wire it into `.claude/settings.json` with the same Read +
Edit merge mechanics as
Step 3.5.4, under BOTH `hooks.PostToolUseFailure[]` and `hooks.PermissionDenied[]`
(no `matcher` — fires on every tool; the script itself gates on flag + signal):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "sh",
      "args": [".ievo/hooks/scripts/failure-capture.sh"]
    }
  ]
}
```

**On Codex** (`/ievo:init` Step 1.5's detection rule), wire it into `.codex/hooks.json` with Step
3.5.4's Codex merge mechanics, under `hooks.PermissionRequest[]` (no `matcher`;
same flag + signal self-gating). The script's `PermissionRequest` case records
`outcome: requested` — see the platform-semantics disclosure at the top of this
step:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "sh .ievo/hooks/scripts/failure-capture.sh"
    }
  ]
}
```

Re-parse the file as JSON after this merge, the same way Step 3.5.4's check (1)
does — this step's edit is the last write either config file receives, and the
dry-run below invokes what it wires.

**Checks (2) and (3) — run both here, now the install is complete.** They are
the remaining two parts of Step 3.5.4's functional check, deferred to this step
because *this* step writes the last companion (`failure-capture.local.sh`) and
wires the last hook entries. Run both from the project root.

**(2) — every wired command dry-runs to exit 0.** These are the same commands
`.claude/settings.json`/`.codex/hooks.json` will actually invoke, so this proves
each wired path resolves and the tracked shim runs without a 127:

```sh
for f in correction-capture evo-analysis-nudge failure-capture; do
  sh ".ievo/hooks/scripts/$f.sh" < /dev/null
  echo "$f.sh exit=$?"
done
```

Confirm all three print `exit=0`. Run back in 3.5.4 instead, the
`evo-analysis-nudge.sh` line would reach that script's own wiring-integrity
check (Step 3.5.3) and report `failure-capture.local.sh` plus the
failure-capture hook entry as drift — artifacts Step 3.6 had not written yet.
Run *here*, after a complete enable, that dry-run should be either silent or a
plain pending-candidate count: any `drift detected` line is now a real finding,
and enable must not claim success while one prints.

**(3) — every `.local.sh` companion is on disk**, once all three have been
written:

```sh
for f in correction-capture evo-analysis-nudge failure-capture; do
  [ -f ".ievo/hooks/scripts/$f.local.sh" ] || echo "MISSING: $f.local.sh"
done
```

**(3) is not redundant with (2)** — it is the half that makes the check mean
anything. The tracked shim exits 0 *by design* when its companion is absent:
that silent no-op IS the clean-clone contract (Step 3.5.1b). So a green exit
code says nothing about whether Steps 3.5.2/3.5.3/3.6 ever wrote the real logic;
enable could report success on a project where nothing captures — precisely
issue #432's "says ENABLED, captures nothing". Only (2) **and** (3) together
show the tracked-shim → `.local.sh`-companion delegation chain is complete on
disk, and even then only its two halves individually: the shim's `exec` of a
present companion is exercised by the test suite
(`.github/scripts/validators/tests/evo-auto-hooks-lifecycle.test.mjs`), not by
this check.

All three companions are written by a full enable — including
`failure-capture.local.sh`, which installs unconditionally and self-gates on
the flag's `signal:` value (this step) — so any `MISSING:` line is a real
failure, not an opt-out. If one prints, do NOT claim success: name the missing
companion to the user and re-run the step that writes it (3.5.2 / 3.5.3 / 3.6
respectively).

### 4. Offer to gitignore the candidate queue

Captured candidates can contain verbatim conversation snippets. On first enable in
a project, ask via `AskUserQuestion` whether to append `.ievo/evolution-candidates/`
to `.gitignore` (default: yes — keep pre-review candidates local). The flag itself
(`.ievo/evo-auto.flag`, intent only) is fine to commit so teammates share the
setting; reviewed lessons land in the committed `.ievo/evolution/` overlays after
`/ievo:evo`.

### 5. Confirm to user

The hooks block is platform-conditional — never print the other client's file
or events (claiming `.claude/settings.json` hooks from a Codex session is the
exact "says ENABLED, captures nothing" bug this skill shipped — issue #432).

**On Claude Code**, print:

```
🧬 iEvo auto-evolution mode ENABLED

Flag: .ievo/evo-auto.flag (commit to share the setting with teammates)
Signal: <corrections-only | corrections+failures, from Step 2's answer>
Pending queue: .ievo/evolution-candidates/pending.md
Hooks, wired in .claude/settings.json (commit this + the three shim scripts
below so a fresh clone never hits "command not found" — skills#446):
  UserPromptSubmit               → .ievo/hooks/scripts/correction-capture.sh (capture corrections)
  SessionStart                    → .ievo/hooks/scripts/evo-analysis-nudge.sh (surface backlog + prune; also verifies wiring is genuinely installed, warning if it drifts — #551)
  PostToolUseFailure/PermissionDenied → .ievo/hooks/scripts/failure-capture.sh
    (installed either way; active only when Signal is corrections+failures)
  These three are tracked, static dispatcher shims — safe to commit, identical
  on every clone. Each delegates to a same-named *.local.sh companion that
  holds the real capture logic; the companions stay gitignored (machine-local,
  like /ievo:hooks-setup's scripts) — re-run this skill once per clone to
  regenerate them.
  Because they are committed, they also run on every teammate's machine: their
  content is static, so review any future diff to them as executable code.

From now on, corrections you make during a session are captured as evolution
candidates. At the next session start you'll be nudged to review them: unambiguous
project-wide lessons are written to the overlay automatically; ambiguous or
user-level ones are parked in the pending queue for review via /ievo:evo —
never written silently.
```

**On Codex** (`/ievo:init` Step 1.5's detection rule), print instead:

```
🧬 iEvo auto-evolution mode ENABLED (Codex)

Flag: .ievo/evo-auto.flag (commit to share the setting with teammates)
Signal: <corrections-only | corrections+failures, from Step 2's answer>
Pending queue: .ievo/evolution-candidates/pending.md
Hooks, wired in .codex/hooks.json (loads once this project's .codex/ layer is
trusted in Codex — commit this file + the three shim scripts below so a fresh
clone never hits "command not found": skills#446):
  UserPromptSubmit  → .ievo/hooks/scripts/correction-capture.sh (capture corrections)
  SessionStart      → .ievo/hooks/scripts/evo-analysis-nudge.sh (surface backlog + prune; also verifies wiring is genuinely installed, warning if it drifts — #551)
  PermissionRequest → .ievo/hooks/scripts/failure-capture.sh
    (installed either way; active only when Signal is corrections+failures.
    Codex has no failed-tool/denied event — this records approval REQUESTS,
    a narrower signal than Claude Code's failure/denial capture)
  These three are tracked, static dispatcher shims — safe to commit, identical
  on every clone. Each delegates to a same-named *.local.sh companion that
  holds the real capture logic; the companions stay gitignored (machine-local)
  — re-run this skill once per clone to regenerate them.
  Because they are committed, they also run on every teammate's machine: their
  content is static, so review any future diff to them as executable code.

From now on, corrections you make during a session are captured as evolution
candidates. First end-to-end proof is the next session start (hook configs
load on session boundaries): expect the review nudge there when candidates
are pending. Unambiguous project-wide lessons are written to the overlay
automatically; ambiguous or user-level ones are parked in the pending queue
for review via /ievo:evo — never written silently.
```

Then, if `signal: corrections+failures`, print one more line — on Claude Code:
"Also capturing tool failures/denials (scrubbed for privacy) — reviewed the
same way."; on Codex: "Also capturing tool approval requests (scrubbed for
privacy) — reviewed the same way." Finally, always print:

```
Review parked candidates any time: /ievo:evo
Turn off: /ievo:evo-auto-disable
```

### 5.5 Platform-mismatch self-check (issue #433)

Same self-check pattern as `init/SKILL.md` Step 12.5 (read that step for the
full rationale, including its contrastive-mention carve-out — this is the
delta, not a re-derivation) — applied to the confirmation block Step 5 just
printed instead of init's Step 12 one. This is the skill whose
Codex/`.claude/settings.json` mismatch was the second concrete example in issue
#432: the confirmation claimed hooks were "ENABLED" while describing
`.claude/settings.json` entries wired from a Codex run, which Codex never
reads.

Re-check what Step 5 just printed against Step 3.5.4's detection rule (`/ievo:init`
Step 1.5 — `$CODEX_CLI`, or a Codex Desktop signal), judging each phrase by
what its sentence claims **this run wired**
rather than by substring match: a Claude Code run's confirmation must not
present `.codex/hooks.json` or a Codex-only event (`PermissionRequest`,
"approval requests") as this run's wiring; a Codex run's confirmation must not
present `.claude/settings.json` or a Claude-Code-only event
(`PostToolUseFailure`/`PermissionDenied`, "tool failures/denials") as this
run's wiring. Also cross-check that the printed file (`.claude/settings.json`
vs `.codex/hooks.json`) matches whichever file Step 3.5.4 actually wrote to.

**Carve-out — a deliberate contrastive mention is NOT a mismatch**, same rule
as init Step 12.5. Step 5's Codex block names the Claude Code events on purpose,
to scope the narrower signal Codex can offer: "Codex has no failed-tool/denied
event — this records approval REQUESTS, a narrower signal than Claude Code's
failure/denial capture". That line is correct output on every
healthy Codex run — it states what Codex does *not* have, and the wiring it
describes (`PermissionRequest` → `.codex/hooks.json`) is the Codex-correct one.
Flag only when the block presents the other platform's file or event as what
this run actually wired; otherwise the check would fire on every healthy Codex
run, writing a spurious overlay entry and offering to file an upstream issue
about a non-existent bug.

**No mismatch (expected):** do nothing, continue.

**Mismatch found:** hand off to `/ievo:evo` immediately, same no-question-first
contract as init Step 12.5:

- **Target:** `evo-auto-enable` (skill scope — this skill), passed as **given**.
  `/ievo:evo`'s Step 1 carve-out for this handoff takes scope/target from the
  caller and skips matching, so it cannot ask — including on Codex, where Step
  1 scans only `.agents/skills/*` and a plugin-shipped skill never appears.
- **Lesson text (verbatim English)**, e.g.: "`/ievo:evo-auto-enable` Step 5
  printed '<the offending phrase>' on Codex (per Step 1.5's detection rule), which names a
  Claude-Code-only config/event. Detected platform was Codex; hooks were
  actually wired into <file Step 3.5.4 wrote>." Name `/ievo:evo-auto-enable`
  explicitly (not just "Step 5") so the text literally satisfies Step 5.6's
  "names an iEvo capability" signal, same reasoning as init Step 12.5.
- **Trigger value:** `agent self-correction: platform-detection mismatch`
  (same value as init Step 12.5 — one convention, two call sites).

Same overlay-only handoff as init Step 12.5, and for the same reason — see it
for the full rationale. `/ievo:evo` takes scope/target as given, appends the
overlay entry (its Step 4), and skips Steps 1.5/2/2.5 unconditionally, so this
skill never vendors itself into `.claude/skills/`|`.agents/skills/` (which
would shadow the running plugin copy) and never triggers Step 2.5's re-audit
confirmation. Its Step 3 (marker injection) is **conditional** on the same test
Step 2 makes: skipped in the normal case, where this skill runs from the plugin
with no copy in the project's load path; run only against a
`.claude/skills/evo-auto-enable/`|`.agents/skills/evo-auto-enable/` copy the
user had already vendored themselves, where it is idempotent and shadows
nothing new. Same accepted trade in that normal case: without a local copy
there is no marker reading `.ievo/evolution/skills/evo-auto-enable.md`, so it
is a record rather than an applied rule, and the upstream escalation is the
actionable path.

Up to two conditional confirmations follow, both `/ievo:evo`'s own: Step 5.6's
upstream-feedback offer (this lesson does classify as upstream-relevant), and
Step 5.7's extraction offer if that overlay already holds a cluster — never on
a first capture. Once `/ievo:evo` returns, this skill's own turn is already
done (Step 5.5 is the last step) — nothing further to continue to.

## What auto-evolution mode does while `evo-auto.flag` exists

This is the contract the correction-capture hook
(`.ievo/hooks/scripts/correction-capture.sh`, dispatching to its
`correction-capture.local.sh` companion), the SessionStart analysis nudge
(`evo-analysis-nudge.sh` → `evo-analysis-nudge.local.sh`), and — opt-in — the
failure-capture hook (`failure-capture.sh` → `failure-capture.local.sh`) honor,
all backed by the `evolution_candidates.mjs` accumulator (the same way other
iEvo skills honor `debug.flag`). Components that participate in auto-evolution
MUST:

1. **Accumulate, don't reason at teardown.** In-session capture only *appends*
   candidate corrections (verbatim) — or, if opted in, scrubbed tool-failure
   records under `--scope tool-failure` — to the per-session accumulator under
   `.ievo/evolution-candidates/<session-id>.jsonl` via the accumulator's `append`
   — no scope classification, no overlay write, no LLM analysis mid-capture.
2. **Analyze at the next session, with fresh context.** The `SessionStart` nudge
   ("N evolution candidates pending — review?") counts via the accumulator and
   folds review into `/ievo:evo`'s existing Step 1 scope classification —
   the same nudge pattern `/ievo:hooks-setup`'s version-check uses. `scope:
   tool-failure` candidates get an extra failure-then-fixed-vs-noise judgment
   call (Step 3.5.3's nudge text) before folding one in.
3. **Write project-wide only; park the rest.** Only an unambiguously project-wide
   candidate may be written to `.ievo/evolution/project.md` automatically. Ambiguous
   or user-level-only candidates go to `pending.md` for manual review. Silent
   overlay writes stay forbidden for anything but the unambiguous project-wide case.
4. **Consume on write, cap retention.** A candidate folded into an overlay is
   removed from the queue; keep the last 10 sessions of candidates and suggest
   cleanup beyond that.
5. **Scrub before persisting (failure-capture only).** A tool-failure/denial
   record is built from untrusted tool output, so it is piped through
   `scrub.mjs` before it ever reaches disk; if scrubbing fails or `scrub.mjs`
   itself is unavailable, the record is dropped — fail-closed for content, never
   a raw record written even transiently.
6. **Verify wiring integrity every session, not just at enable time (#551).**
   The `SessionStart` path also checks that the vendored fallback copies, the
   `.local.sh` companions, and the invoking client's own wired hook entries
   are actually present on disk. A flag present with none of that installed —
   e.g. a hand-written `.ievo/evo-auto.flag`, or drift introduced after
   enable — surfaces as a drift warning in the same `additionalContext`
   channel, naming exactly what is missing and pointing at re-running
   `/ievo:evo-auto-enable` (already idempotent/self-healing) to repair it.
   The check is split across both files on that path, because a gitignored
   script cannot report its own absence: the **tracked** `evo-analysis-nudge.sh`
   shim (Step 3.5.1b) warns when the flag is on but its companion was never
   regenerated on this clone — the fresh-clone case — and the companion
   (Step 3.5.3) checks everything else whenever it does run. Never a blocking
   error — `SessionStart` cannot block startup, and both share the same
   fail-silent contract as every other hook here.

## Rules

- **Wire the invoking client only:** detect via `/ievo:init` Step 1.5's rule
  (`$CODEX_CLI`, or a Codex Desktop signal when unset) — Claude Code hooks go to `.claude/settings.json`,
  Codex hooks to `.codex/hooks.json`. Never write the other client's config,
  never claim the mode is enabled beyond what the invoking client will
  actually fire, and never describe Codex's `PermissionRequest` capture as
  failure/denial capture (issue #432).
- **Idempotent:** if auto-mode is already on, just refresh `enabled_at` and confirm.
  Never clobber an existing `pending.md`.
- **Never write silently outside project-wide scope:** ambiguity is parked, not
  guessed. This preserves `/ievo:evo`'s human-in-the-loop reconciliation for
  agent/skill and user-level targets.
- **Corrections, always; tool failures/denials, opt-in only:** corrections are
  agent-judged — do not treat routine back-and-forth as a correction, and when
  unsure, do not capture it (a false capture pollutes the pending queue).
  Tool-failure/denial capture is the one mechanical signal in scope, and only
  when `signal: corrections+failures` — captured verbatim (post-scrub), no
  agent judgment applied at capture time, judgment deferred to review.
- **Never bake a versioned path.** Every generated hook script resolves its
  script dependencies at run time — prefer a live `CLAUDE_PLUGIN_ROOT`, else the
  vendored fallback copy under `.ievo/hooks/scripts/vendor/` (Step 3.5.1) —
  never a `CLAUDE_PLUGIN_ROOT`-derived literal baked in at setup time.
- **Tracked shims stay static; never write real capture logic to their
  filenames (skills#446).** `.ievo/hooks/scripts/{correction-capture,
  evo-analysis-nudge,failure-capture}.sh` are committed dispatcher shims —
  their content (Step 3.5.1b) never varies by project or plugin version. All
  real logic goes in the gitignored `*.local.sh` companion Steps
  3.5.2/3.5.3/3.6 write. This is what keeps a clean clone (flag +
  `.claude/settings.json`/`.codex/hooks.json` + shims, all committed) safe:
  the wired command always exists, and no-ops until a teammate re-runs this
  skill once to generate the companions. Being committed also makes them a
  repo-resident exec path — a diff to one changes what runs on every
  teammate's machine, so review any such diff as executable code, never as
  config (Step 3.5.1b's security note).
- **Project-local:** the setting lives in `.ievo/`, not user config, so it is
  per-project and survives sessions — except the three tracked shims above,
  which are deliberately committed so a fresh clone is never missing the
  wired command.

## See also

- `/ievo:evo-auto-disable` — turn auto-evolution mode off (preserves the queue)
- `/ievo:evo` — review parked candidates / capture a lesson manually
- `/ievo:debug-on` / `/ievo:debug-off` — the paired-toggle + project-local-flag
  pattern this skill follows
- `.ievo/evolution-candidates/pending.md` — where parked candidates accumulate
- `plugins/ievo/scripts/scrub.mjs` — the privacy scrub every failure-capture
  record is piped through before it touches disk
