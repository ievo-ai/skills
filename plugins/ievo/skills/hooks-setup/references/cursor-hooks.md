# Cursor hooks

**Different platform, different mechanism — this reference is documentation, not a further step.** `hooks-setup/SKILL.md` Steps 1–8 configure Claude Code's `.claude/settings.json`. Cursor (v3.11+, "Cloud Agent Hooks", [changelog](https://www.cursor.com/changelog)) uses its own `.cursor/hooks.json` schema with a different event catalog, config scopes, and stdin/stdout contract — a Cursor user wanting the same iEvo-event notifications builds `.cursor/hooks.json` following the pattern below rather than running Steps 1–8.

## Config file location and scopes

Cursor resolves hooks from four scopes, highest priority first ([hooks reference](https://cursor.com/docs/hooks)):

| Scope | Path | Notes |
|-------|------|-------|
| Enterprise | macOS `/Library/Application Support/Cursor/hooks.json`; Linux/WSL `/etc/cursor/hooks.json`; Windows `C:\ProgramData\Cursor\hooks.json` | MDM-managed, system-wide |
| Team | Web dashboard (Enterprise only) | Cloud-distributed to team members |
| Project | `<project-root>/.cursor/hooks.json` | Committed to version control — closest analog to hooks-setup's own project-scoped `.claude/settings.json` writes (Step 3) |
| User | `~/.cursor/hooks.json` | User-specific, applies globally |

## Relevant hook types for iEvo notifications

Cursor's full catalog covers 20+ event types (tool execution, file ops, MCP, subagents, tab completions, ...); two map onto this skill's notification use case:

| Hook | Fires | Input (stdin) | Output (stdout) | Claude Code analog |
|------|-------|----------------|-------------------|---------------------|
| `stop` | when the agent loop ends | `{"status": "completed"\|"aborted"\|"error", "loop_count": <n>}` | optional `{"followup_message": "<text>"}` | hooks-setup Step 5.5 `Stop` hook |
| `afterAgentResponse` | after the agent completes an assistant message | `{"text": "<assistant final text>"}` | none (logged, not used) | hooks-setup Step 5 `PostToolUse` signal-file pattern |

**Key structural difference from Claude Code:** Cursor has no `matcher`/`if` equivalent that filters on a tool call's path argument (the mechanism Step 5's `Write(.ievo/hooks/<event>)` `PostToolUse` matcher relies on). Both `stop` and `afterAgentResponse` fire unconditionally on every loop-end / assistant-message; a Cursor hook script that wants to react to a specific iEvo event must check for the corresponding `.ievo/hooks/<event>` signal file itself — the same "the script does the deciding" shape hooks-setup already uses for the Claude Code `Stop` hook (Step 5.5) and `SessionStart` nudge (Step 5.7).

## Stdin/stdout contract and exit codes

Every Cursor hook receives a JSON object on stdin (base fields plus the hook-specific fields above) and may emit a JSON object on stdout (hook-specific response fields). Exit code semantics:

- `0` — success; Cursor reads and applies the stdout JSON output.
- `2` — block the action (equivalent to returning `permission: "deny"`). Not meaningful for `stop`/`afterAgentResponse` (nothing left to block at loop-end / after a message is already sent) but applies to Cursor's other hook types (e.g. `preToolUse`, `beforeShellExecution`).
- any other code — hook failed; Cursor fails open (the action proceeds as if no hook ran).

## Worked example

Project-scoped `.cursor/hooks.json`, mirroring hooks-setup Step 2's terminal-bell notification preference — rings the bell and appends to the same shared log Step 5 already writes to (`.ievo/log/hooks/events.log`) whenever the agent loop ends with an iEvo signal file present:

```json
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": ["sh", ".ievo/hooks/scripts/cursor-stop.sh"]
      }
    ]
  }
}
```

`.ievo/hooks/scripts/cursor-stop.sh`:

```sh
#!/bin/sh
# Cursor stop hook — checks iEvo signal files when the agent loop ends.
# Cursor's `stop` fires unconditionally (no PostToolUse-style path matcher),
# so this script does the deciding, same shape as hooks-setup Step 5.5.
mkdir -p .ievo/log/hooks 2>/dev/null || true
for event in init-complete security-red evolution-captured; do
  [ -f ".ievo/hooks/$event" ] || continue
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $event" >> .ievo/log/hooks/events.log
  printf '\a'
done
exit 0
```

Swap `printf '\a'` (terminal bell) for `osascript`/`notify-send` to match Step 5.5's richer notification styles. This checks all three signal files on every loop-end without clearing them, so it re-notifies on a stale signal file left over from an earlier session unless `.ievo/hooks/` is cleared between runs; route `command` to a separate script for `afterAgentResponse`-based per-message checks instead if that granularity matters more than `stop`'s lower fire frequency.

**Committed config, gitignored script — same mismatch as the Claude Code Stop hook.** `.cursor/hooks.json` is committed (Project scope, above), but the `cursor-stop.sh` it references lives under `.ievo/hooks/`, which `/ievo:init` Step 10 gitignores — the identical split hooks-setup documents for `.ievo/hooks/scripts/on-stop.sh` (see hooks-setup's Rules section, "Stop hook script is local, not team-shared"). A teammate who pulls the repo without their own copy of `cursor-stop.sh` gets a silent no-op, not even a cosmetic error: Cursor's exit-code contract above fails open on a missing/non-zero-exit command. Each teammate writes their own copy of the script once per clone to activate the hook locally.
