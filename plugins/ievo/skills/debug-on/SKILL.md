---
name: debug-on
description: "Use this skill when the user wants to debug an init, evo, or security-audit session, or wants to attribute iEvo token costs in a usage dashboard — trigger words \"turn on debug\", \"verbose mode\", \"log everything\", \"trace level\", \"debug logging\", \"cost monitoring\", \"OTel cost attribution\", \"OTEL_RESOURCE_ATTRIBUTES\", \"tag iEvo usage by team or project\". Enables verbose / trace-level logging across the iEvo pipeline — captures full prompts, full sub-agent returns, every Task tool dispatch, every gh/git/network call, environment dump — and documents how to label Claude Code's OTel metrics so iEvo token spend can be sliced separately from ordinary coding usage in an OTel-backed dashboard. Output goes to `.ievo/log/debug/<session-id>/` for post-mortem analysis. Activates by writing `.ievo/debug.flag` (project-level setting)."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Flag is project-local (`.ievo/debug.flag`). Requires write access to `.ievo/`, POSIX shell (bash/zsh), `gh`, `git`, `node` (18+). On Windows use Git Bash or WSL."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Debug On — enable verbose session logging

Activates trace-level logging for all subsequent iEvo skill invocations in this session and future sessions, until `/ievo:debug-off` is invoked. Flag is project-local (lives in `.ievo/debug.flag`), so teammates working in the same repo see it via git too.

> **Claude Code v2.1.181+ alternative.** For a quick one-off check, `/config verbose=true` ([release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.181)) toggles Claude Code's own verbose output inline — zero-install, no `.ievo/` write. It is not a substitute for this skill: the setting doesn't persist as a git-shareable project flag, doesn't write to `.ievo/log/debug/`, and covers Claude Code only — this skill also captures full sub-agent prompts/returns and works across Codex/Cursor/other agentskills.io platforms. See `/ievo:debug-off` for the matching `/config verbose=false` note.

## When to use

- User says "turn on debug", "verbose mode", "log everything", "trace level"
- User reports a bug in init/evo/security-audit and wants reproducible logs
- User wants to share a session for issue filing on ievo-ai/skills
- User wants to understand iEvo's internal decision-making
- **Documentation only — nothing is enabled:** user asks how to attribute, label, or slice iEvo token spend ("cost monitoring", "tag iEvo usage by team or project", `OTEL_RESOURCE_ATTRIBUTES`). Answer from § "Cost monitoring (Claude Code v2.1.161+)" and stop — see Step 0.

## Steps

### 0. Route the request — verbose logging, or cost monitoring?

The `description:` above activates this skill on two unrelated intents. Decide which one applies before touching the filesystem:

**(A) Enable verbose logging** — the user asked to turn on debug/verbose/trace logging, or wants reproducible logs for a bug report. Continue with Step 1.

**(B) Cost monitoring only** — the user asked how to attribute, label, or slice iEvo token spend ("cost monitoring", "tag iEvo usage by team or project", `OTEL_RESOURCE_ATTRIBUTES`) and did **not** ask for verbose logging. Answer from § "Cost monitoring (Claude Code v2.1.161+)" below, then stop: skip Steps 1-5 entirely — no `.ievo/` check, no `.ievo/debug.flag`, no log directory. That section documents Claude Code environment variables, so it needs no `.ievo/` and no initialized project (Step 1 would otherwise exit and leave the answer unreachable), and enabling trace logging would produce confidential logs (§ Rules) the user never asked for.

If the user asked for both, run flow A and answer the cost-monitoring question alongside Step 5's confirmation.

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
- OS: <Node-native, cross-platform: `${process.platform} ${os.release()} ${os.arch()}` — e.g. `darwin 24.1.0 arm64`, `linux 6.1.0 x64`, `win32 10.0.22631 x64`. Avoid `uname` (not available on native Windows).>
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
- /ievo:init — full discover.mjs stack JSON input + full raw output, every Task tool dispatch with full prompt, every sub-agent return JSON, every gh api call, every Write/Read
- /ievo:evo — full overlay diff, captured lesson + context
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
- **Secret redaction is best-effort, not a guarantee**: known credential env vars (`ANTHROPIC_API_KEY`, `GH_TOKEN`, `OPENAI_API_KEY`, `AWS_*`, `GITHUB_TOKEN`, `*_API_KEY`, `*_SECRET`, `*_TOKEN`) MUST be replaced with `[REDACTED]` before any write. But the denylist cannot catch every secret: source files, customer data, prompts, and `gh api` response bodies may contain credentials/PII/proprietary code that bypasses pattern matching. **Treat all debug logs as confidential by default.**
- **Sensitive-source guard**: when about to log full content of a file matching `*.env`, `*.env.*`, `*credentials*`, `*secret*`, `*key*` (case-insensitive), `*.pem`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `.npmrc`, `.netrc` → log the path + SHA-256 hash + size only, never the body. Same for any file flagged `secret`/`credential` by `security-check`. **The pattern list errs toward over-matching** (e.g. `keymap.json`, `monkey.test.mjs` also get the hash-only treatment) — fail-closed is intentional for a security guard: a false-positive forces the user to inspect the file manually, while a false-negative could leak a credential silently.
- **Default to gitignore**: when activating debug mode for the first time in a project, append `.ievo/log/debug/` to `.gitignore` (after asking user via AskUserQuestion) so logs don't accidentally enter version control. `.ievo/debug.flag` itself is fine to commit (intent only, no payload).
- **Size cap**: if any single log file exceeds 5MB, truncate to first 4.5MB + footer noting truncation. Saves disk + makes review tractable.
- **Commit-friendly (with review)**: `.ievo/debug.flag` and `.ievo/log/debug/` are project-scope artifacts. The flag itself (intent only) is committable as-is; the log directory is gitignored by default (see above), so sharing logs requires `git add -f .ievo/log/debug/<session-id>/` after the per-file review below — the force-add is the explicit consent step. When user wants to share logs (issue filing, teammate help): tell them explicitly to review every file in `.ievo/log/debug/<session-id>/` for secrets/PII before `git add -f` or attaching to an issue. Suggest running `grep -RiE '(api[_-]?key|secret|token|password|bearer|x-api)' .ievo/log/debug/<session-id>/` as a final sanity check.
- **Auto-cleanup of old sessions**: if `.ievo/log/debug/` contains more than 10 session subdirs, suggest user run cleanup. Don't delete without confirmation.

## Cost monitoring (Claude Code v2.1.161+)

Claude Code labels every metrics datapoint and event record with the key/value pairs from `OTEL_RESOURCE_ATTRIBUTES` ([v2.1.161 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.161), 2026-06-02), letting a team running iEvo across many repos slice usage-cost dashboards by iEvo skill, project, or any other custom dimension — separating iEvo token spend from ordinary coding usage. Requires an OTel-capable metrics backend; individual developers without one can skip this section.

```bash
export OTEL_RESOURCE_ATTRIBUTES="ievo_skill=security-check,project=myapp"
```

| iEvo operation | Suggested value before launching that session |
|-----------------|------------------------------------------------|
| Init / discovery | `ievo_skill=init,project=<project>` |
| Security audit | `ievo_skill=security-check,project=<project>` |
| Evolution capture | `ievo_skill=evo,project=<project>` |
| Vuln scan | `ievo_skill=vuln-scan,project=<project>` |

- **Binding time — one process per attribute set.** `OTEL_RESOURCE_ATTRIBUTES` is resolved once, at Claude Code process start, and applies to every metric for that process's entire lifetime — there is no in-session way to change it. This means **no iEvo skill can set this automatically when it activates**: by the time any skill runs, the process (and its resolved attributes) already exists. Export the variable, then start a fresh session or a one-shot `claude -p` run per operation you want labeled separately; never try to set/clear it mid-session — that recipe does not execute.
- **Prerequisites** (per [Claude Code's monitoring docs](https://code.claude.com/docs/en/monitoring-usage)): an OTel metrics pipeline — `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER` (e.g. `otlp`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc` / `http/json` / `http/protobuf`), `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` if the collector requires auth. `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` (default `true`) is the actual switch that puts these keys onto datapoints as queryable labels — if an administrator has set it `false` (e.g. to control cardinality), metrics keep flowing but every dashboard built on these labels silently returns nothing.
- **Org-wide enforcement is a managed-settings mechanism, not `.claude/settings.json`.** `.claude/settings.json` is project-scope and user-overridable. To enforce these env vars org-wide, an administrator distributes them via the managed settings file (`/etc/claude-code/managed-settings.json` on Linux/WSL, `/Library/Application Support/ClaudeCode/managed-settings.json` on macOS, `C:\Program Files\ClaudeCode\managed-settings.json` on Windows) through MDM — managed settings sit at the top of Claude Code's precedence chain and can't be overridden by a user's own env vars.
- **Scope.** Labels apply to ALL Claude Code token usage for that process, not just iEvo-dispatched sub-agents.

## See also

- `/ievo:debug-off` — disable verbose mode
- `/ievo:feedback` — when filing a bug report, attaches debug log if present
- `.ievo/log/debug/` — where logs accumulate
