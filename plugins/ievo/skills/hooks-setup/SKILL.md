---
name: hooks-setup
description: Configure Claude Code lifecycle hooks for iEvo pipeline events — init complete, security RED verdict, and evolution captured. Writes hook entries to `.claude/settings.json` using exec-form (`args: string[]`) and optionally `terminalSequence` for desktop notifications. Use when the user asks "notify me when ievo finishes", "add hooks for ievo", "set up ievo notifications", or "configure ievo lifecycle hooks". Requires Claude Code v2.1.139+ (for `args` exec-form); `terminalSequence` notifications further require v2.1.141+ and an iTerm2/WezTerm-class terminal.
license: MIT
compatibility: Claude Code v2.1.139+ for the `args: string[]` exec-form hook field; v2.1.141+ for the `terminalSequence` notification field. Codex's hook schema may differ — run on Codex only if its settings.json honors the same fields. Other agentskills.io-compatible hosts: works only if they support the Claude Code hook schema for settings.json.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# iEvo Hooks Setup

Configure Claude Code lifecycle hooks that fire on iEvo pipeline events — so you can get notified when a long init finishes, when a security audit finds something RED, or when an evolution is captured.

Uses two Claude Code hook features (verified against [v2.1.139](https://github.com/anthropics/claude-code/releases/tag/v2.1.139) + [v2.1.141](https://github.com/anthropics/claude-code/releases/tag/v2.1.141) release notes):

- **Exec-form `args: string[]`** (v2.1.139+): spawns the command directly without a shell at the *outer* invocation — eliminates the shell-quoting injection surface when paths get interpolated into the matcher → args chain. (We still use `sh -c "..."` *inside* `args` for the `date`/`mkdir`/`echo` pipeline — that's intentional, and there's no user-controlled input in the inner shell string.)
- **`terminalSequence`** field on hook JSON output (v2.1.141+): emits desktop notifications, window titles, and bells without requiring a controlling terminal.

Hooks trigger on **signal files** that iEvo writes at well-known paths under `.ievo/hooks/`. Init, evolution, and the security-auditor agent each write their respective signal file as a final step (added in v0.6.9 alongside this skill); this skill configures the matching `PostToolUse` `Write(...)` hooks.

## Step 1: Ask the user which events to hook

Use `AskUserQuestion` (`multiSelect: true`) — let the user pick any combination of the three iEvo events:

```
Which iEvo pipeline events should fire hooks?
Options (multi-select):
- "init-complete"       — when /ievo:init finishes installing skills
- "security-red"        — when security-auditor returns a RED verdict
- "evolution-captured"  — when /ievo:evolution captures a lesson overlay
```

If user picks nothing, exit with: "No events selected — no hooks configured. Re-run `/ievo:hooks-setup` to pick events later."

## Step 2: Ask for notification preference

```
How do you want to be notified when a selected event fires?
Options (single-select):
- "terminal-bell"     — ring the terminal bell (universal; works in every terminal)
- "terminal-sequence" — desktop notification via terminalSequence (requires iTerm2 / WezTerm / similar; v2.1.141+ Claude Code)
- "custom-script"     — run a custom script (you provide the absolute path)
- "none"              — no notification; only log to .ievo/log/hooks/<timestamp>.log
```

If "custom-script" → follow-up `AskUserQuestion` for the absolute path. Validate the path exists + is executable (`test -x "$path"`); re-prompt or fall back to "none" on failure.

If "terminal-sequence" → follow-up `AskUserQuestion` for the terminal family:

```
Which terminal emulator do you use?
- "iTerm2"   — uses `]9;<msg>` escape sequence
- "WezTerm"  — uses `]777;notify;iEvo;<msg>` escape sequence
- "other"    — falls back to terminal-bell
```

## Step 3: Ask for settings.json scope

```
Where should the hooks be written?
- "project"  — .claude/settings.json (recommended; commits with the repo)
- "global"   — ~/.claude/settings.json (applies to every Claude Code session for this user)
```

## Step 4: Read the current settings.json

Read the target path (project or global from Step 3) using the Read tool. If the file doesn't exist, treat the current state as `{}`.

If the file exists and contains invalid JSON, halt with: "Existing settings.json is not valid JSON — fix the file manually before configuring hooks." Do NOT write — risk of clobbering manual edits.

## Step 5: Build hook entries (one per selected event)

For each event the user selected in Step 1, construct one `PostToolUse` hook entry that matches on `Write(.ievo/hooks/<event>)`. The matcher is the Write tool call writing to the iEvo-specific signal-file path; this is precise and portable (no broad-Bash-matcher false positives).

Template per event (replace `<event>` with `init-complete` / `security-red` / `evolution-captured`):

````json
{
  "matcher": "Write(.ievo/hooks/<event>)",
  "hooks": [
    {
      "type": "command",
      "args": ["sh", "-c", "mkdir -p .ievo/log/hooks && echo '<msg>' >> .ievo/log/hooks/$(date -u +%Y%m%dT%H%M%SZ).log"],
      "terminalSequence": "<seq>"
    }
  ]
}
````

Note the `mkdir -p .ievo/log/hooks &&` prefix in `args` — the bare `>>` redirect would fail on first fire if the directory doesn't exist; `mkdir -p` is idempotent and creates the parent dirs as needed.

Per-event message:

| Event | Message |
|-------|---------|
| `init-complete` | `iEvo: /ievo:init pipeline complete` |
| `security-red` | `iEvo: security RED verdict — check .ievo/security/` |
| `evolution-captured` | `iEvo: evolution overlay captured` |

`terminalSequence` field: Claude Code emits the string as-is to the terminal, so the JSON value must be a **complete** escape sequence including the leading ESC (``) and the trailing BEL (``) terminator on OSC variants. JSON-encode them as `\u001b` (ESC) and `\u0007` (BEL).

| Notification preference | `terminalSequence` JSON value |
|-------------------------|--------------------------------|
| `terminal-bell` | `"\u0007"` (BEL — rings the terminal bell on every host) |
| `terminal-sequence` (iTerm2) | `"\u001b]9;<msg>\u0007"` |
| `terminal-sequence` (WezTerm) | `"\u001b]777;notify;iEvo;<msg>\u0007"` |
| `terminal-sequence` (other) | falls back to `"\u0007"` (bell only) |
| `custom-script` | omit `terminalSequence`; `args` becomes `[user-path, "<event>"]` so the script receives the event identifier as its first positional argument |
| `none` | omit `terminalSequence`; keep the log-append-only `args` |

## Step 6: Merge entries into settings.json

Use the Read + Edit tools (NOT shell-based JSON edits — preserves existing comments and key order on Claude Code's tolerant JSON parser). Pseudo-procedure:

1. Read current settings.json (from Step 4, or `{}` if absent).
2. Ensure `hooks.PostToolUse` exists as an array; create if missing.
3. For each new hook entry, check if `matcher` already exists in `hooks.PostToolUse`. If yes, **do not duplicate** — print "Hook for `<event>` already configured; skipping. Edit `settings.json` manually to overwrite it."
4. Append the new entries to `hooks.PostToolUse`.

## Step 7: Confirm with the user

Display the final merged config (the entries being added, not the whole file) and ask:

```
The following hook entries will be added to <project|global>/.claude/settings.json:

[display new entries]

Existing hooks preserved. Proceed?
- "yes"  — write the file
- "no"   — abort; nothing written
```

## Step 8: Write the updated settings.json

Use the Write tool with the merged content. The `mkdir -p .ievo/log/hooks &&` prefix in the hook `args` handles directory creation lazily on first fire — no separate Step-8 dir-creation needed (and the Write tool can't create empty directories anyway).

For **project scope** with hooks at `.claude/settings.json`, also append `.ievo/log/hooks/` to `.gitignore` (after a user-confirm `AskUserQuestion`) — without it, every team member sees `.log` files in `git status` after each pipeline run. Signal files at `.ievo/hooks/*` are one-line markers; whether to commit them or also gitignore is a project decision worth a follow-up question.

Print a final confirmation:

```
✓ Configured <N> iEvo hook(s) at <path>.
Hooks fire on these signal-file writes:
  .ievo/hooks/init-complete       → after /ievo:init finishes
  .ievo/hooks/security-red        → after security-auditor returns RED
  .ievo/hooks/evolution-captured  → after /ievo:evolution writes an overlay
Logs accumulate at .ievo/log/hooks/<ISO-timestamp>.log.
```

## Rules

- **Never overwrite** existing `PostToolUse` entries — append only, with the dedup check in Step 6.3.
- **Project scope is recommended** for team-shared signal (the same hooks fire for everyone on the team after pulling). Global scope is for personal-machine-wide preferences.
- **Logs go to `.ievo/log/hooks/`** even when `none` is selected as the notification — silent operation, but the audit trail is still available.
- **Signal files are written by other iEvo skills** (init, evolution, security-auditor). Do NOT write them from this skill — that would falsely trigger hooks the user expected only on real pipeline completion.

## See also

- `init/SKILL.md` **Step 11.5** — writes `.ievo/hooks/init-complete` at the end of the pipeline.
- `evolution/SKILL.md` **Step 5.5** — writes `.ievo/hooks/evolution-captured` after the overlay append.
- `security-auditor.md` agent body **Step 6** — writes `.ievo/hooks/security-red` after returning a RED verdict.

## References

- [Claude Code v2.1.139 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.139) — `args: string[]` exec-form hook field
- [Claude Code v2.1.141 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.141) — `terminalSequence` desktop-notification field
- Signal-file trigger pattern (`PostToolUse` + `Write(<path>)` matcher) is portable across any host that matches Write-tool calls to a path pattern
