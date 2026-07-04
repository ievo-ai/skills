---
name: evo-auto-disable
description: "Disable auto-evolution mode for this project. Stops iEvo from accumulating \"corrections from the user\" as evolution candidates; reverts to explicit `/ievo:evolution` only. Removes the project-local flag `.ievo/evo-auto.flag`. Non-destructive: already-parked candidates in `.ievo/evolution-candidates/` are preserved for review. Inverse of `/ievo:evo-auto-enable`. Trigger words — \"turn off auto evolution\", \"stop auto-evolve\", \"evo auto off\", \"stop capturing lessons automatically\"."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Inverse of `/ievo:evo-auto-enable`. Uses POSIX shell (`rm -f`) with a Node `fs.unlinkSync` fallback and a Windows `Remove-Item` variant; on Windows run via WSL/Git Bash or use the Node fallback. Only the flag is removed — the `.ievo/evolution-candidates/` queue is left intact."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evo Auto Disable — turn off auto-evolution mode

Reverts iEvo to **explicit-only** evolution: corrections stop being captured
automatically and lessons are only recorded when the user runs `/ievo:evolution`.
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

### 4. Report the pending queue (do NOT delete it)

If `<project>/.ievo/evolution-candidates/pending.md` exists, count its parked
candidates (the `## ` entries) so the user knows what still awaits review. Do not
modify or remove the queue — disabling capture must not discard captured work.

### 5. Confirm to user

Print:

```
🧬 iEvo auto-evolution mode DISABLED

Was enabled: <enabled_at from flag>
Corrections are no longer captured automatically — use /ievo:evolution to record
lessons manually.

Pending candidates preserved: <count> in .ievo/evolution-candidates/pending.md
Review them any time with /ievo:evolution.

Re-enable: /ievo:evo-auto-enable
```

## Rules

- **Non-destructive:** do NOT delete `.ievo/evolution-candidates/`. The flag goes
  away; parked candidates stay so no captured correction is lost.
- **Idempotent:** if already off, just say so — no error.
- **Flag only:** this skill removes exactly `.ievo/evo-auto.flag` and nothing else.

## See also

- `/ievo:evo-auto-enable` — turn auto-evolution mode back on
- `/ievo:evolution` — review parked candidates / capture a lesson manually
- `.ievo/evolution-candidates/pending.md` — parked candidates, preserved across
  enable/disable
