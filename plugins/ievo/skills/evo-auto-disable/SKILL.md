---
name: evo-auto-disable
description: "Use this skill when the user wants to stop iEvo from capturing lessons automatically — trigger words \"turn off auto evolution\", \"stop auto-evolve\", \"evo auto off\", \"stop capturing lessons automatically\". Disables auto-evolution mode for this project. Stops iEvo from accumulating \"corrections from the user\" as evolution candidates; reverts to explicit `/ievo:evo` only. Removes the project-local flag `.ievo/evo-auto.flag`. Non-destructive: already-parked candidates in `.ievo/evolution-candidates/` are preserved for review. Inverse of `/ievo:evo-auto-enable`."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Inverse of `/ievo:evo-auto-enable`. Uses POSIX shell (`rm -f`) with Node `fs.unlinkSync` and Windows `Remove-Item` fallbacks. Removes the flag, the auto-evolution hook entries from BOTH `.claude/settings.json` and `.codex/hooks.json` (whichever exist — either client may have written its own), their `.ievo/hooks/scripts/*.local.sh` companions, and the vendored fallback copies — the tracked dispatcher shims and the `.ievo/evolution-candidates/` queue are left intact."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evo Auto Disable — turn off auto-evolution mode

Reverts iEvo to **explicit-only** evolution: corrections stop being captured
automatically and lessons are only recorded when the user runs `/ievo:evo`.
Removes `.ievo/evo-auto.flag`. Any candidates already parked in
`.ievo/evolution-candidates/` are **kept** — they remain available for review.

Enabled with `/ievo:evo-auto-enable`, disabled here.

## When to use

- User says "turn off auto evolution", "stop auto-evolve", "evo auto off",
  "stop capturing lessons automatically"
- Auto-mode is producing noise (too many low-value candidates) and the user wants
  to return to manual capture
- Handing the repo to someone who should not have background capture running

## Steps

### 1. Check if auto-mode is currently on

If `<project>/.ievo/evo-auto.flag` does not exist → already off. Tell the user:

```
iEvo auto-evolution is already OFF (no .ievo/evo-auto.flag found).
Any parked candidates remain in .ievo/evolution-candidates/.
```

Exit.

### 2. Read flag content for the closing summary

Read `.ievo/evo-auto.flag` and capture `enabled_at` and `enabled_by` for the
confirmation message.

### 3. Remove the flag

POSIX hosts (macOS / Linux / WSL) — use Bash with `rm -f` for idempotence:

```
rm -f <project>/.ievo/evo-auto.flag
```

Windows hosts (PowerShell, no POSIX shell):

```
Remove-Item -ErrorAction SilentlyContinue '<project>\.ievo\evo-auto.flag'
```

Cross-platform fallback via the Bash tool if Node is available:

```
node -e "try { require('fs').unlinkSync('<project>/.ievo/evo-auto.flag') } catch (e) { if (e.code !== 'ENOENT') throw e }"
```

(There is no Write-tool "delete" operation. The narrow-scope rm/Remove-Item/unlink
targets one named file — no glob, no recursion — and is idempotent, so it handles
the race between Step 1's existence check and this step.)

### 3.5 Remove the correction-capture + analysis + failure-capture hooks

Auto-mode's hooks are gated on the flag, so removing the flag (Step 3) already
makes them no-ops. Still, unwire them so the project's `.claude/settings.json`,
`.codex/hooks.json`, and `.ievo/hooks/` don't accumulate dead entries. Clean
BOTH client configs, whichever exist — not just the invoking client's: on a
cross-platform team (or after a Claude Code ↔ Codex migration, issue #432)
`/ievo:evo-auto-enable` may have written either file, and disable means
disable everywhere:

- **`.claude/settings.json`** — Read it first; if absent or not valid JSON, skip
  this bullet (nothing to clean / don't risk clobbering manual edits). Otherwise,
  with the Read + Edit tools, remove every entry whose inner hook is
  `{"type": "command", "command": "sh", "args": [".ievo/hooks/scripts/correction-capture.sh"]}`
  (from `hooks.UserPromptSubmit`),
  `{"type": "command", "command": "sh", "args": [".ievo/hooks/scripts/evo-analysis-nudge.sh"]}`
  (from `hooks.SessionStart`), and
  `{"type": "command", "command": "sh", "args": [".ievo/hooks/scripts/failure-capture.sh"]}`
  (from BOTH `hooks.PostToolUseFailure` and `hooks.PermissionDenied`). Leave
  every other hook untouched; if a `hooks.*` array becomes empty, you may drop
  the empty array. If none of these entries are present, there is nothing to
  remove.
- **`.codex/hooks.json`** — same rules (Read first; skip if absent or invalid
  JSON; Read + Edit only). Remove every handler whose `command` string is
  `sh .ievo/hooks/scripts/correction-capture.sh` (from `hooks.UserPromptSubmit`),
  `sh .ievo/hooks/scripts/evo-analysis-nudge.sh` (from `hooks.SessionStart`), or
  `sh .ievo/hooks/scripts/failure-capture.sh` (from `hooks.PermissionRequest`) —
  the entries `/ievo:evo-auto-enable` Step 3.5.4/3.6 writes on Codex. Leave
  every other hook untouched; a `hooks.<Event>` array left empty may be
  dropped.
- **Per-clone companion scripts + vendored fallback copies** — since #446,
  `.ievo/hooks/scripts/correction-capture.sh`, `evo-analysis-nudge.sh`, and
  `failure-capture.sh` are **tracked, static dispatcher shims**
  (`/ievo:evo-auto-enable` Step 3.5.1b) — identical content on every project,
  committed alongside `.claude/settings.json`/`.codex/hooks.json` precisely so
  a clean clone's wired command always exists. Do NOT delete them: removing a
  tracked file leaves the working tree dirty for no benefit, since a shim with
  no companion already behaves exactly like "no capture happening" (it
  `test -f`s the companion and no-ops when absent). Delete instead the
  per-clone `.local.sh` companions that hold the actual capture logic, then
  remove the vendored fallback copy directory those companions fell back to
  (`/ievo:evo-auto-enable` Step 3.5.1) — safe to remove wholesale since nothing
  else references it once every companion above is gone:

```
rm -f .ievo/hooks/scripts/correction-capture.local.sh .ievo/hooks/scripts/evo-analysis-nudge.local.sh .ievo/hooks/scripts/failure-capture.local.sh
rm -rf .ievo/hooks/scripts/vendor
```

The tracked shims themselves are left in place, unmodified — with their
companion gone they already no-op, and leaving them avoids a spurious
tracked-file deletion in `git status`. Do NOT touch `.ievo/evolution-candidates/`
— captured candidates are preserved (Step 4). Re-enabling with
`/ievo:evo-auto-enable` regenerates the companions (and refreshes the vendored
copies).

### 4. Report the pending queue (do NOT delete it)

If `<project>/.ievo/evolution-candidates/pending.md` exists, count its parked
candidates (the `## ` entries) so the user knows what still awaits review. Do not
modify or remove the queue — disabling capture must not discard captured work.

### 5. Confirm to user

Print:

```
🧬 iEvo auto-evolution mode DISABLED

Was enabled: <enabled_at from flag>
Corrections (and, if opted in, tool failures/denials) are no longer captured
automatically — use /ievo:evo to record lessons manually.

Pending candidates preserved: <count> in .ievo/evolution-candidates/pending.md
Review them any time with /ievo:evo.

Re-enable: /ievo:evo-auto-enable
```

## Rules

- **Non-destructive:** do NOT delete `.ievo/evolution-candidates/`. The flag goes
  away; parked candidates stay so no captured correction is lost.
- **Idempotent:** if already off, just say so — no error.
- **Flag + its hooks only:** this skill removes `.ievo/evo-auto.flag`, the
  auto-evolution hook entries from `.claude/settings.json` AND
  `.codex/hooks.json` (whichever exist), the (up to) three per-clone
  `.ievo/hooks/scripts/*.local.sh` companions, and the vendored fallback copy
  directory those companions read from — nothing else. The
  `.ievo/evolution-candidates/` queue and every other hook are left intact.
- **Never delete the tracked dispatcher shims (skills#446).**
  `.ievo/hooks/scripts/{correction-capture,evo-analysis-nudge,failure-capture}.sh`
  are committed alongside `.claude/settings.json`/`.codex/hooks.json` so a
  clean clone's wired command never 127s — deleting them here would leave the
  working tree dirty and undo that guarantee for no behavioral benefit (a shim
  with its companion removed already no-ops).

## See also

- `/ievo:evo-auto-enable` — turn auto-evolution mode back on
- `/ievo:evo` — review parked candidates / capture a lesson manually
- `.ievo/evolution-candidates/pending.md` — parked candidates, preserved across
  enable/disable
