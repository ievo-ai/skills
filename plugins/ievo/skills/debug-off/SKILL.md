---
name: debug-off
description: Disable verbose / trace-level logging for the iEvo pipeline. Reverts to normal logging (concise `.ievo/log/init-*.md` only). Use when debugging is complete and user wants to stop accumulating large trace logs. Trigger words — "turn off debug", "stop verbose", "disable trace", "debug off", "выключи debug", "хватит логировать".
license: MIT
compatibility: "Works on any agent platform that supports the agentskills.io standard. Inverse of `/ievo:debug-on`. The current implementation uses POSIX shell commands (`rm -f`, `ls`, `du`); on Windows hosts run via WSL or Git Bash, or fall back to the Write/Read tool equivalents documented inline."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Debug Off — disable verbose session logging

Reverts iEvo skills to their default concise logging mode. Removes `.ievo/debug.flag`. Existing debug session logs in `.ievo/log/debug/<session-id>/` are NOT deleted — they're preserved as audit artifacts.

## When to use

- User says "turn off debug", "stop verbose", "disable trace", "debug off"
- After filing a bug report and no longer needs accumulating logs
- Disk pressure from large debug logs

## Steps

### 1. Check if debug is currently on

If `<project>/.ievo/debug.flag` does not exist → already off. Tell user:

```
iEvo debug mode is already OFF (no .ievo/debug.flag found).
Past debug logs (if any) remain in .ievo/log/debug/.
```

Exit.

### 2. Read flag content for the closing summary

Read `.ievo/debug.flag` and capture:
- `enabled_at` (when debug was turned on)
- `enabled_by`
- `reason`

### 3. Remove the flag

POSIX hosts (macOS / Linux / WSL) — use Bash with `rm -f` for idempotence:

```bash
rm -f <project>/.ievo/debug.flag
```

Windows hosts (PowerShell, no POSIX shell):

```powershell
Remove-Item -ErrorAction SilentlyContinue '<project>\.ievo\debug.flag'
```

Cross-platform fallback via the Bash tool if Node is available:

```bash
node -e "try { require('fs').unlinkSync('<project>/.ievo/debug.flag') } catch (e) { if (e.code !== 'ENOENT') throw e }"
```

(No Write-tool equivalent — there's no "delete" operation in Write. The narrow-scope rm/Remove-Item/unlink targets a specific named file with no glob, no recursion, and is idempotent — handles the race between Step 1's existence check and this step.)

### 4. Find the active session directory

`<project>/.ievo/log/debug/` may contain multiple session subdirs. Find the most recent (alphabetical sort = chronological since ISO basic format). That's the session being closed.

### 5. Drop a session end marker

Write `<project>/.ievo/log/debug/<latest-session-id>/99-session-end.md`:

```markdown
# Debug session ended — <ISO-8601 UTC>

- Started: <enabled_at from flag>
- Duration: <wall-clock>
- Closed by: <user invocation>
- Reason for closing: <if provided>

Logs preserved at: .ievo/log/debug/<session-id>/
```

### 6. Confirm to user

Print to user:

```
🔬 iEvo debug mode DISABLED

Session preserved at: .ievo/log/debug/<session-id>/
Session contents: <file count>, <total size>

If filing a bug: archive that directory (e.g. `tar czf debug-<session-id>.tgz .ievo/log/debug/<session-id>/` on POSIX, `Compress-Archive` on Windows) and attach.

Re-enable: /ievo:debug-on
```

For the file count + size, use whatever the host shell supports — `ls + du` on POSIX, `Get-ChildItem | Measure-Object` on Windows PowerShell, or Node `fs.readdirSync().length` + recursive walk if neither is available. The user-facing summary just needs a count and a size; the specific tooling is host-dependent.

## Rules

- **Non-destructive**: do NOT delete `.ievo/log/debug/` contents. The flag goes away, the logs stay.
- **Idempotent**: if already off, just say so. No error.
- **Preserve audit trail**: even if user later does debug-on again, prior sessions are kept under their own session-ids.

## See also

- `/ievo:debug-on` — enable verbose mode
- `.ievo/log/debug/` — archived debug sessions (gitignored by default; user can opt in to committing)
