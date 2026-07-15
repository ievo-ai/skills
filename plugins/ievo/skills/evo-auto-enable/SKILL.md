---
name: evo-auto-enable
description: "Enable auto-evolution mode for this project — iEvo accumulates \"corrections from the user\" as evolution candidates during a session and surfaces them for review via /ievo:evo, without the user having to invoke evo explicitly. Sets the project-local flag `.ievo/evo-auto.flag` and prepares the pending-candidate queue at `.ievo/evolution-candidates/`. Auto-mode writes ONLY unambiguous project-wide overlays; ambiguous or user-level matches are parked for manual review, never written silently. Trigger words — \"turn on auto evolution\", \"auto-evolve\", \"capture lessons automatically\", \"evo auto on\", \"evolve without asking\"."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Flag + queue are project-local (`.ievo/evo-auto.flag`, `.ievo/evolution-candidates/`). Requires write access to `.ievo/`, POSIX shell (bash/zsh) or the Write tool. Paired with `/ievo:evo-auto-disable`. Installs a UserPromptSubmit correction-capture hook + a SessionStart analysis nudge into `.claude/settings.json` (Claude Code hook schema; the hook scripts need `node` and `jq`, both already required by iEvo)."
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

- **Signal (v1):** only **corrections from the user** — semantic, agent-judged
  ("actually, do X not Y"; "no, we always Z here"). Mechanical signals
  (non-zero exits, test failures) are intentionally out of scope for now.
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

### 2. Write the flag file

Use the Write tool (NOT Bash) to create `<project>/.ievo/evo-auto.flag` with YAML
content (mirrors `.ievo/debug.flag`'s shape):

```
enabled: true
enabled_at: <ISO-8601 UTC timestamp>
enabled_by: <user identifier if known, else "user-invocation">
signal: corrections-only
auto_write_scope: project-wide-only
```

The file format is YAML for easy human reading. Presence of the file = mode
enabled; the correction-capture hook and the periodic-analysis nudge read it to
decide whether to accumulate and surface candidates.

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

### 3.5 Install the correction-capture + analysis hooks

This is what makes auto-evolution actually capture and surface corrections. Two
hooks are wired into the project's `.claude/settings.json`, both **gated on
`.ievo/evo-auto.flag`** so they are no-ops the moment the mode is off (or
`/ievo:evo-auto-disable` removes the flag), and both **fail-silent and
non-blocking**. They follow `/ievo:hooks-setup`'s conventions — exec-form
`args: string[]`, `additionalContext` emitted from the hook command's stdout
JSON, no `set -e`. Verified against the [Claude Code hooks
reference](https://code.claude.com/docs/en/hooks) (UserPromptSubmit +
SessionStart both support `hookSpecificOutput.additionalContext`; SessionStart is
context-only and cannot block startup).

The hooks call the per-session accumulator
`plugins/ievo/scripts/evolution_candidates.mjs` (Node, stdlib-only) for
`append` / `count` / `prune`. It only ACCUMULATES — it never classifies scope or
writes overlays; analysis is deferred to the next session (Step 3.5.4 / the
contract below).

#### 3.5.1 Resolve and bake the accumulator path

A hook in the project's `.claude/settings.json` does **not** get
`CLAUDE_PLUGIN_ROOT` set at fire time, so resolve the accumulator's absolute path
**now**, while this skill is running inside the plugin, and bake it into the
scripts as a string literal. Run via Bash:

```
test -f "${CLAUDE_PLUGIN_ROOT}/scripts/evolution_candidates.mjs" && echo "${CLAUDE_PLUGIN_ROOT}/scripts/evolution_candidates.mjs"
```

Use the printed path as `<accumulator-abs-path>` below. If the `test` fails
(empty output), the plugin root couldn't be resolved — tell the user auto-mode's
capture hooks can't be configured right now, and skip to Step 4 (the flag + queue
from Steps 2–3 still stand; the user can re-run once resolved).

#### 3.5.2 Write the correction-capture hook (UserPromptSubmit)

Use the Write tool to create `.ievo/hooks/scripts/correction-capture.sh`
(substitute `<accumulator-abs-path>` with the Step 3.5.1 result):

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

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the path baked at setup.
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC="<accumulator-abs-path>"

# session_id comes from the hook's stdin JSON. jq is a hard dependency of gh,
# which iEvo already requires; fall back to "unknown" if absent/unparseable.
sid=$(cat | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
case "$sid" in "") sid="unknown" ;; esac

msg="iEvo auto-evolution is ON. If the message you are about to answer is a genuine correction of your prior approach or output (the user telling you a rule or preference you got wrong -- e.g. 'no, we always X here', 'stop doing Y'), then AFTER you respond, record it as an evolution candidate WITHOUT ever putting its text inside a shell command: first use the Write tool (NOT Bash) to write the correction verbatim, one line, to .ievo/hooks/tmp/correction-pending.txt, then run this exact fixed command: node ${ACC} append --session ${sid} --text-file .ievo/hooks/tmp/correction-pending.txt. Never substitute the correction text itself into the command. Do NOT classify scope or write overlays now -- that happens at the next session's review. Capture ONLY genuine corrections; ignore routine questions, clarifications, and normal back-and-forth. If it was not a correction, do nothing and do not mention this."
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$msg"
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/correction-capture.sh`.

The temp file lives under `.ievo/hooks/` (gitignored by `/ievo:init` Step 10, same as
the hook scripts themselves) at a **fixed** path — `.ievo/hooks/tmp/correction-pending.txt`
— never a path built from the correction text or any other untrusted value, so the
Write tool call itself can't be steered by a crafted correction either. Each capture
overwrites the same file; only the latest pending write matters until the agent
appends it.

#### 3.5.3 Write the SessionStart analysis nudge

Use the Write tool to create `.ievo/hooks/scripts/evo-analysis-nudge.sh` (same
`<accumulator-abs-path>` substitution):

```sh
#!/bin/sh
# iEvo auto-evolution — SessionStart analysis nudge.
# On a NEW session, when auto-evolution is ON, prune to the last 10 sessions and,
# if any candidates are pending, nudge the agent to review them via
# /ievo:evo. No LLM work happens here -- this only counts + surfaces.
#
# CONTRACT: fail-silent, context-only (SessionStart cannot block startup),
# ASCII-only additionalContext. NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0

ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC="<accumulator-abs-path>"

# Retention: keep the last 10 sessions of candidates (best-effort).
node "$ACC" prune --keep 10 >/dev/null 2>&1 || true

n=$(node "$ACC" count 2>/dev/null || echo 0)
case "$n" in ""|*[!0-9]*) exit 0 ;; esac
[ "$n" -gt 0 ] || exit 0

msg="iEvo auto-evolution: ${n} evolution candidate(s) captured in earlier sessions are pending review. Offer to run /ievo:evo to fold them in -- for each candidate apply Step 1 scope classification: auto-write ONLY unambiguous project-wide lessons to .ievo/evolution/project.md; park anything ambiguous or user-level in .ievo/evolution-candidates/pending.md for manual review. Never write agent/skill or user-level overlays silently. Remove each candidate from its session file as you consume it."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/evo-analysis-nudge.sh`.

#### 3.5.4 Wire both hooks into `.claude/settings.json`

Read the project's `.claude/settings.json` first (treat absent as `{}`); if it
exists but is **not valid JSON**, halt without writing (do not clobber manual
edits) and tell the user to fix it. Merge with the **Read + Edit** tools (not
shell JSON edits — preserves comments and key order), appending these two entries
and deduping by the inner `command` + `args` pair (skip if an identical entry
already exists), using the same Read + Edit merge mechanics `/ievo:hooks-setup`
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

The generated scripts live under `.ievo/hooks/` (gitignored by `/ievo:init`
Step 10) — machine-local, like `/ievo:hooks-setup`'s scripts. If `.ievo/hooks/`
is not yet in `.gitignore` (init never ran), offer to add it. Because the scripts
are local, each teammate who wants auto-mode active re-runs `/ievo:evo-auto-enable`
once per clone; the committed flag (Step 2) shares the *intent*, the local scripts
do the *work*.

**A note on `security-check`:** a `UserPromptSubmit` hook is one of the patterns
`/ievo:security-check` flags when auditing *third-party* plugins (it can prompt-
inject). This is iEvo's own first-party, flag-gated hook that only injects a
self-assessment nudge and writes solely under `.ievo/` — a known, purpose-built
exception, documented in `security-check/SKILL.md` so iEvo's own tooling does not
self-flag it.

### 4. Offer to gitignore the candidate queue

Captured candidates can contain verbatim conversation snippets. On first enable in
a project, ask via `AskUserQuestion` whether to append `.ievo/evolution-candidates/`
to `.gitignore` (default: yes — keep pre-review candidates local). The flag itself
(`.ievo/evo-auto.flag`, intent only) is fine to commit so teammates share the
setting; reviewed lessons land in the committed `.ievo/evolution/` overlays after
`/ievo:evo`.

### 5. Confirm to user

Print:

```
🧬 iEvo auto-evolution mode ENABLED

Flag: .ievo/evo-auto.flag (commit to share the setting with teammates)
Pending queue: .ievo/evolution-candidates/pending.md
Hooks (local, in .claude/settings.json):
  UserPromptSubmit → .ievo/hooks/scripts/correction-capture.sh (capture corrections)
  SessionStart      → .ievo/hooks/scripts/evo-analysis-nudge.sh (surface backlog + prune)

From now on, corrections you make during a session are captured as evolution
candidates. At the next session start you'll be nudged to review them: unambiguous
project-wide lessons are written to the overlay automatically; ambiguous or
user-level ones are parked in the pending queue for review via /ievo:evo —
never written silently.

Review parked candidates any time: /ievo:evo
Turn off: /ievo:evo-auto-disable
```

## What auto-evolution mode does while `evo-auto.flag` exists

This is the contract the correction-capture hook
(`.ievo/hooks/scripts/correction-capture.sh`) and the SessionStart analysis nudge
(`.ievo/hooks/scripts/evo-analysis-nudge.sh`) honor, both backed by the
`evolution_candidates.mjs` accumulator (the same way other iEvo skills honor
`debug.flag`). Components that participate in auto-evolution MUST:

1. **Accumulate, don't reason at teardown.** In-session capture only *appends*
   candidate corrections (verbatim) to the per-session accumulator under
   `.ievo/evolution-candidates/<session-id>.jsonl` via the accumulator's `append`
   — no scope classification, no overlay write, no LLM analysis mid-capture.
2. **Analyze at the next session, with fresh context.** The `SessionStart` nudge
   ("N evolution candidates pending — review?") counts via the accumulator and
   folds review into `/ievo:evo`'s existing Step 1 scope classification —
   the same nudge pattern `/ievo:hooks-setup`'s version-check uses.
3. **Write project-wide only; park the rest.** Only an unambiguously project-wide
   candidate may be written to `.ievo/evolution/project.md` automatically. Ambiguous
   or user-level-only candidates go to `pending.md` for manual review. Silent
   overlay writes stay forbidden for anything but the unambiguous project-wide case.
4. **Consume on write, cap retention.** A candidate folded into an overlay is
   removed from the queue; keep the last 10 sessions of candidates and suggest
   cleanup beyond that.

## Rules

- **Idempotent:** if auto-mode is already on, just refresh `enabled_at` and confirm.
  Never clobber an existing `pending.md`.
- **Never write silently outside project-wide scope:** ambiguity is parked, not
  guessed. This preserves `/ievo:evo`'s human-in-the-loop reconciliation for
  agent/skill and user-level targets.
- **Corrections only (v1):** do not treat routine back-and-forth as a correction;
  when unsure whether a turn was a correction, do not capture it (a false capture
  pollutes the pending queue). Mechanical signals are out of scope until a later
  iteration.
- **Project-local:** the setting lives in `.ievo/`, not user config, so it is
  per-project and survives sessions.

## See also

- `/ievo:evo-auto-disable` — turn auto-evolution mode off (preserves the queue)
- `/ievo:evo` — review parked candidates / capture a lesson manually
- `/ievo:debug-on` / `/ievo:debug-off` — the paired-toggle + project-local-flag
  pattern this skill follows
- `.ievo/evolution-candidates/pending.md` — where parked candidates accumulate
