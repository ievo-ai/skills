---
name: contributor-mode-off
description: "Use this skill when the user wants to revoke iEvo 'contributor mode' for this project — trigger words \"turn off contributor mode\", \"disable contributor mode\", \"stop sharing diagnostics\", \"revoke contributor mode\". Removes the project-local flag `.ievo/contributor.flag`. Reverts `/ievo:feedback` to its default payload — it stops offering to attach the tool-failure/permission-denial capture stream. Non-destructive: the underlying `.ievo/evolution-candidates/` capture data (if any) is untouched. Inverse of `/ievo:contributor-mode-on`."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Inverse of `/ievo:contributor-mode-on`. Uses POSIX shell (`rm -f`) with Node `fs.unlinkSync` and Windows `Remove-Item` fallbacks."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Contributor Mode Off — revoke widened `/ievo:feedback` diagnostics

Reverts `/ievo:feedback` to its default payload: environment context only,
no offer to attach the tool-failure/permission-denial capture stream.
Removes `.ievo/contributor.flag`. Any candidates already accumulated in
`.ievo/evolution-candidates/` (by `/ievo:evo-auto-enable`, independent of this
flag) are left exactly as they were.

Enabled with `/ievo:contributor-mode-on`, disabled here.

## When to use

- User says "turn off contributor mode", "disable contributor mode", "stop
  sharing diagnostics", "revoke contributor mode"
- Handing the project to someone who should not have the widened
  `/ievo:feedback` attachment option available

## Steps

### 1. Check if contributor mode is currently on

If `<project>/.ievo/contributor.flag` does not exist → already off. Tell the
user:

```
iEvo contributor mode is already OFF (no .ievo/contributor.flag found).
/ievo:feedback only ever offers its default environment-context payload.
```

Exit.

### 2. Read flag content for the closing summary

Read `.ievo/contributor.flag` and capture `enabled_at` for the confirmation
message.

### 3. Remove the flag

POSIX hosts (macOS / Linux / WSL) — use Bash with `rm -f` for idempotence:

```bash
rm -f <project>/.ievo/contributor.flag
```

Windows hosts (PowerShell, no POSIX shell):

```powershell
Remove-Item -ErrorAction SilentlyContinue '<project>\.ievo\contributor.flag'
```

Cross-platform fallback via the Bash tool if Node is available:

```bash
node -e "try { require('fs').unlinkSync('<project>/.ievo/contributor.flag') } catch (e) { if (e.code !== 'ENOENT') throw e }"
```

(There is no Write-tool "delete" operation. The narrow-scope
rm/Remove-Item/unlink targets one named file — no glob, no recursion — and is
idempotent, so it handles the race between Step 1's existence check and this
step.)

### 4. Confirm to user

Print:

```
🧬 iEvo contributor mode DISABLED

Was enabled: <enabled_at from flag>
/ievo:feedback no longer offers to attach the tool-failure/permission-denial
capture stream — back to environment context only.

Any candidates already captured under .ievo/evolution-candidates/ (via
/ievo:evo-auto-enable) are untouched and still available for /ievo:evo review.

Re-enable: /ievo:contributor-mode-on
```

## Rules

- **Non-destructive:** do NOT touch `.ievo/evolution-candidates/` — that
  capture stream belongs to `/ievo:evo-auto-enable`, not this flag, and
  disabling this flag must not discard anything captured there.
- **Idempotent:** if already off, just say so — no error.
- **Flag only:** this skill removes `.ievo/contributor.flag` and nothing
  else.

## See also

- `/ievo:contributor-mode-on` — turn contributor mode back on
- `/ievo:feedback` — the skill whose payload this flag widens/narrows
- `/ievo:evo-auto-enable` / `/ievo:evo-auto-disable` — control the underlying
  tool-failure/permission-denial capture stream independently of this flag
