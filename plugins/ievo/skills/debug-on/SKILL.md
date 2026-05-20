---
name: debug-on
description: Enable verbose / trace-level logging across the iEvo pipeline. Use when the user wants to debug an init, evolution, or security-audit session — captures full prompts, full sub-agent returns, every Task tool dispatch, every gh/git/network call, environment dump. Output goes to `.ievo/log/debug/<session-id>/` for post-mortem analysis. Activates by writing `.ievo/debug.flag` (project-level setting). Trigger words — "turn on debug", "verbose mode", "log everything", "trace level", "debug logging", "включи debug", "подробный лог".
license: MIT
compatibility: Works on any agent platform that supports the agentskills.io standard — flag is a project-local file, not a Claude Code-specific setting. Requires write access to `.ievo/`.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Debug On — enable verbose session logging

Activates trace-level logging for all subsequent iEvo skill invocations in this session and future sessions, until `/ievo:debug-off` is invoked. Flag is project-local (lives in `.ievo/debug.flag`), so teammates working in the same repo see it via git too.

## When to use

- User says "turn on debug", "verbose mode", "log everything", "trace level"
- User reports a bug in init/evolution/security-audit and wants reproducible logs
- User wants to share a session for issue filing on ievo-ai/skills
- User wants to understand iEvo's internal decision-making

## Steps

### 1. Verify `.ievo/` exists

If `.ievo/` directory is absent → init hasn't been run in this project. Tell user:

```
iEvo not initialized in this project. Run /ievo:init first.
Debug mode applies to existing iEvo workflows — nothing to debug yet.
```

Exit.

### 2. Write the flag file

Use the Write tool (NOT Bash) to create:

```
file_path: <project>/.ievo/debug.flag
content:
  enabled: true
  enabled_at: <ISO-8601 UTC timestamp>
  enabled_by: <user identifier if known, else "user-invocation">
  reason: <optional — if user mentioned why>
```

The file format is YAML for easy human reading. Other iEvo skills check for the file's existence (presence = enabled), and may parse content for context.

### 3. Create debug log directory

```
<project>/.ievo/log/debug/<session-id>/
```

Where `<session-id>` is a fresh ISO-8601 basic timestamp: `YYYYMMDDTHHMMSSZ` (no colons — Windows-safe).

This directory accumulates per-session debug logs. Each iEvo skill that runs while debug is on appends to it.

### 4. Drop a session start marker

Write `<project>/.ievo/log/debug/<session-id>/00-session-start.md`:

```markdown
# Debug session — <ISO-8601 UTC>

- Platform: <Claude Code | Codex | other (from $CLAUDECODE / $CODEX_CLI / detection)>
- Plugin version: <read from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json>
- Plugin path: <CLAUDE_PLUGIN_ROOT value>
- Node version: <output of `node --version`>
- gh version: <output of `gh --version | head -1`>
- git version: <output of `git --version`>
- OS: <output of `uname -srm`>
- CWD: <process.cwd()>
- Reason: <if provided by user>
```

### 5. Confirm to user

Print:

```
🔬 iEvo debug mode ENABLED

Logs going to: .ievo/log/debug/<session-id>/
Flag: .ievo/debug.flag (commit to git to share session context with teammates)

What gets logged from now on:
- /ievo:init — full find-skills prompt + raw response, every Task tool dispatch with full prompt, every sub-agent return JSON, every gh api call, every Write/Read
- /ievo:evolution — full overlay diff, captured lesson + context
- /ievo:security-check — full file contents scanned, full reasoning chain, all flag candidates evaluated
- security-auditor sub-agents — entered fully, not just summary verdict

Turn off: /ievo:debug-off
```

## What other skills should do when debug.flag exists

When invoked, other iEvo skills MUST:

1. **Check** for `<project>/.ievo/debug.flag` file before any major step
2. **If present**, write expanded log to `<project>/.ievo/log/debug/<session-id>/<NN>-<step-name>.md`:
   - Full prompts sent to sub-agents (not abbreviated)
   - Full responses received (not just summary)
   - Every Tool tool call (Read, Write, Bash, etc.) with full args
   - Every `gh api` invocation with response body (truncated if > 50KB)
   - Every AskUserQuestion full payload + user answer
   - Environment context (env vars relevant to the step)
3. **Resolve session-id** from the most recent `.ievo/log/debug/*/` directory (alphabetical sort = chronological since ISO basic format)
4. **Normal log** (`.ievo/log/init-*.md`) is **also** written — debug mode is additive, not a replacement

## Rules

- **Idempotent**: if debug already on, just update `enabled_at` and confirm.
- **No secrets in logs**: even in debug mode, redact `ANTHROPIC_API_KEY`, `GH_TOKEN`, `OPENAI_API_KEY`, etc. Use `[REDACTED]` placeholder.
- **Size cap**: if any single log file exceeds 5MB, truncate to first 4.5MB + footer noting truncation. Saves disk + makes review tractable.
- **Commit-friendly**: `.ievo/debug.flag` and `.ievo/log/debug/` are project-scope artifacts. Mention in user-facing message that they can commit these to git when filing issues, but should review for accidentally-logged sensitive context first.
- **Auto-cleanup of old sessions**: if `.ievo/log/debug/` contains more than 10 session subdirs, suggest user run cleanup. Don't delete without confirmation.

## See also

- `/ievo:debug-off` — disable verbose mode
- `/ievo:feedback` — when filing a bug report, attaches debug log if present
- `.ievo/log/debug/` — where logs accumulate
