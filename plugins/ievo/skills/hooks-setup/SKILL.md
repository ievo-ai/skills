---
name: hooks-setup
description: Configure Claude Code lifecycle hooks for iEvo pipeline events — init complete, security RED verdict, and evolution captured. Writes hook entries to `.claude/settings.json` using exec-form (args array) and optionally terminalSequence for desktop notifications. Use when the user asks "notify me when ievo finishes", "add hooks for ievo", "set up ievo notifications", or "configure ievo lifecycle hooks". Requires Claude Code or another host that supports settings.json hook configuration.
license: MIT
compatibility: Designed for Claude Code (which supports settings.json hooks). The exec-form `args: string[]` and `terminalSequence` hook fields require Claude Code v2.1.139+. Other platforms that honor settings.json hook schemas will also work if they support these fields.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# iEvo Hooks Setup

Configure Claude Code lifecycle hooks that fire on iEvo pipeline events — so you can get notified when a long init finishes, when a security audit finds something RED, or when an evolution is captured.

Uses two Claude Code hook features:
- **Exec-form `args: string[]`** (v2.1.139+): spawn commands directly without shell quoting — no injection surface from interpolated values
- **`terminalSequence`** (v2.1.141+): send desktop notification-style terminal output without needing a controlling terminal

## Step 1: Ask the user which events to hook

Use `AskUserQuestion` to confirm which iEvo hook events they want:

```
Which iEvo events should fire hooks?
Options (multiple select):
- "init-complete"     — fires when /ievo:init finishes installing skills
- "security-red"      — fires when security-auditor returns a RED verdict
- "evolution-captured"— fires when /ievo:evolution captures a lesson overlay
- "all"               — add hooks for all three
```

## Step 2: Ask for notification preference

```
How do you want to be notified?
Options:
- "terminal-bell"     — ring the terminal bell (works everywhere)
- "terminal-sequence" — send a system notification via terminalSequence (requires iTerm2/WezTerm/similar)
- "custom-script"     — run a custom script (you provide the path)
- "none"              — no notification; just log to .ievo/log/hooks/
```

## Step 3: Read current settings.json

Read `.claude/settings.json` in the current project (create it if absent).

```bash
cat .claude/settings.json 2>/dev/null || echo '{}'
```

## Step 4: Build hook entries

### Hook trigger pattern for iEvo events

iEvo pipeline steps are identifiable via the tool call patterns they emit. The recommended approach is to match on `Bash` tool calls containing iEvo markers:

**Exec-form hook template (v2.1.139+ preferred — no shell quoting issues):**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "args": ["node", "-e", "process.env.TOOL_OUTPUT?.includes('ievo:init complete') && process.exit(0)"],
            "terminalSequence": "]9;iEvo init complete"
          }
        ]
      }
    ]
  }
}
```

**TODO (operator decision required before production use):**
- The `matcher` pattern above triggers on ALL Bash calls — needs a more specific trigger once the host supports regex matchers or named hook groups. Options:
  a. Add a dedicated iEvo "signal file" (e.g., `.ievo/hooks/init-complete`) that a final step of init writes, and hook on `Write` tool targeting that path
  b. Wait for Claude Code to ship `pattern:` field on PostToolUse hooks for exact string matching
  c. Use the current broad matcher with a cheap Node.js guard in `args` that reads `TOOL_OUTPUT` env var and exits 0/1 to control notification firing

**Signal file approach (recommended, portable):**

Init, evolution, and security-check already write files to `.ievo/`. A hook on Write tool targeting specific `.ievo/` paths is more precise:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write(.ievo/hooks/init-complete)",
        "hooks": [
          {
            "type": "command",
            "args": ["sh", "-c", "echo 'iEvo init complete'"],
            "terminalSequence": "]9;iEvo: init complete"
          }
        ]
      },
      {
        "matcher": "Write(.ievo/hooks/security-red)",
        "hooks": [
          {
            "type": "command",
            "args": ["sh", "-c", "echo 'iEvo security RED — check .ievo/security/ for details'"],
            "terminalSequence": "]9;iEvo: security RED verdict"
          }
        ]
      },
      {
        "matcher": "Write(.ievo/hooks/evolution-captured)",
        "hooks": [
          {
            "type": "command",
            "args": ["sh", "-c", "echo 'iEvo evolution captured'"],
            "terminalSequence": "]9;iEvo: evolution captured"
          }
        ]
      }
    ]
  }
}
```

**TODO (operator decisions required):**
- **Signal file integration**: `init/SKILL.md`, `evolution/SKILL.md`, and `security-auditor.md` must each be updated to write their respective `.ievo/hooks/<event>` signal file as a final step. This is a cross-skill change.
- **terminalSequence escape sequences**: `]9;MESSAGE` is the iTerm2 notification format. WezTerm uses `]777;notify;TITLE;BODY`. A cross-terminal approach needs a capability detection step or a user preference to set the format.
- **Custom script path**: if the user chose "custom-script" in Step 2, prompt for the absolute path and replace the `args` array.

## Step 5: Merge hook entries into settings.json

Use the Read + Edit tools to merge the new hooks into the existing settings.json. Do NOT overwrite existing hook entries — append inside the relevant hook type array.

```bash
# Read current hooks
cat .claude/settings.json
```

Use the Edit tool to merge the new `PostToolUse` entries with any pre-existing ones in the same `PostToolUse` array.

## Step 6: Confirm with the user

Show the final merged hook configuration and confirm before writing:

```
The following hook entries will be added to .claude/settings.json:
[display the new entries]

Proceed?
```

## Step 7: Write updated settings.json

Use the Write tool to save the updated settings.json.

## What this skill does NOT do

- It does not modify `init/SKILL.md`, `evolution/SKILL.md`, or `security-auditor.md` to add signal file writes — that requires a separate PR to each skill (see TODOs above).
- It does not support global hooks (`~/.claude/settings.json`) yet — only project-scope. TODO: add a step asking project vs global scope.
- It does not validate that the host Claude Code version supports `terminalSequence` — if the field is ignored, the notification simply doesn't fire; no error.

## References

- [Claude Code hook exec form (v2.1.139)](https://github.com/anthropics/claude-code/releases) — `args: string[]` field
- [Claude Code terminalSequence (v2.1.141)](https://github.com/anthropics/claude-code/releases) — desktop notifications from hooks
- Signal-file trigger pattern is portable: works on any host that can match Write tool calls to a path pattern
