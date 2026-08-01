---
name: hooks-setup
description: "Use this skill when the user asks \"notify me when ievo finishes\", \"add hooks for ievo\", \"set up ievo notifications\", \"tell me when background agents are done\", \"configure ievo lifecycle hooks\", or \"nudge me when ievo is out of date\" — not for the full iEvo installation pipeline (use /ievo:init for that). Configures Claude Code lifecycle hooks for iEvo pipeline events — init complete, security RED verdict, evolution captured, and (optional) all-background-agents-complete via a Stop hook. Writes PostToolUse and Stop hook entries to `.claude/settings.json` using exec-form (`args: string[]`) and optionally `terminalSequence` for desktop notifications. Requires Claude Code v2.1.139+ (exec-form); v2.1.141+ for `terminalSequence` (iTerm2/WezTerm-class terminal); v2.1.145+ for the optional background-complete Stop hook (`background_tasks`/`session_crons` fields). Also installs an optional fail-silent SessionStart nudge when the installed iEvo plugin is behind latest."
license: MIT
effort: low
allowed-tools:
  - Read
  - Edit
  - Write
  - AskUserQuestion
  - Bash(test*)
  - Bash(chmod*)
  - Bash(claude*)
  - Bash(echo*)
compatibility: "Claude Code v2.1.139+ (exec-form `args: string[]` hook field); v2.1.141+ (`terminalSequence` notifications); v2.1.145+ (Stop `background_tasks`/`session_crons`); v2.1.163+ (Stop/SubagentStop `additionalContext`); v2.1.176+ (`if:` Read/Edit/Write paths fixed); v2.1.195+ (hyphenated matchers exact-match); v2.1.198+ (`Notification` `agent_needs_input`/`agent_completed`). Cursor v3.11+: `.cursor/hooks.json` (below). Codex rust-v0.133.0+: `hooks.json`/`config.toml`, 11-event catalog (below)."
# No `paths:` gate here, deliberately — `.claude/settings.json` looks like a
# genuinely predictive file-context signal, but this skill's PRIMARY case is
# the run where that file does not exist yet: Step 4 treats an absent settings
# file as `{}` and Step 8 has a dedicated Write-tool branch to create it. Per
# the docs, `paths` means Claude "loads the skill automatically only when
# working with files matching the patterns"
# (code.claude.com/docs/en/skills) — so gating on the settings file makes the
# skill un-activatable in exactly the first-run session that most needs it,
# while a user asking "notify me when ievo finishes" typically has no
# settings file and no SKILL.md in context at all. Per AGENTS.md § Skills
# format, wrong gating is worse than none (skills#157/#175).
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# iEvo Hooks Setup

> **Safe-mode caveat.** Running Claude Code with `--safe-mode` or `CLAUDE_CODE_SAFE_MODE=1` ([v2.1.169](https://github.com/anthropics/claude-code/releases/tag/v2.1.169)) disables ALL customizations at startup, including hooks — none of the entries this skill configures fire in that mode. Completion notifications for a long `/ievo:init` run or a parallel security scan will silently not trigger; verify safe mode is off if you rely on these notifications.

Configure Claude Code lifecycle hooks that fire on iEvo pipeline events — so you can get notified when a long init finishes, when a security audit finds something RED, or when an evolution is captured.

Uses two Claude Code hook features (verified against [v2.1.139](https://github.com/anthropics/claude-code/releases/tag/v2.1.139) + [v2.1.141](https://github.com/anthropics/claude-code/releases/tag/v2.1.141) release notes):

- **Exec-form `args: string[]`** (v2.1.139+): spawns the command directly without a shell at the *outer* invocation — eliminates the shell-quoting injection surface when paths get interpolated into the matcher → args chain. (We still use `sh -c "..."` *inside* `args` for the `date`/`mkdir`/`echo` pipeline — that's intentional, and there's no user-controlled input in the inner shell string.)
- **`terminalSequence`** field on hook JSON output (v2.1.141+): emits desktop notifications, window titles, and bells without requiring a controlling terminal.

Hooks trigger on **signal files** that iEvo writes at well-known paths under `.ievo/hooks/`. Init, evo, and the security-auditor agent each write their respective signal file as a final step (added in v0.6.9 alongside this skill); this skill configures the matching `PostToolUse` `Write(...)` hooks.

## Two complementary hook tiers — this skill vs. per-skill built-ins

This skill (`/ievo:hooks-setup`) is one of **two** hook tiers iEvo offers; they coexist and don't conflict:

- **Session-level, opt-in (this skill).** Writes durable entries into `.claude/settings.json` (project or global scope) that fire across every future session, with a full menu of notification styles: terminal bell, `terminalSequence` desktop popups (iTerm2/WezTerm), a custom script, the background-agents-complete `Stop` hook (Step 5.5), `claude agents` `Notification` hooks (Step 5.6), and the version-check `SessionStart` nudge (Step 5.7). Requires running this skill once and persists across sessions.
- **Per-skill, zero-setup (built-in, v0.48.0+), skills only — not the sub-agents they may delegate to.** `evo/SKILL.md`, `security-check/SKILL.md`, and `init/SKILL.md` each carry their own `hooks:` frontmatter field ([Hooks in skills and agents](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents)) that prints a plain one-line completion message with no configuration at all, scoped to that skill's own lifecycle and cleaned up when it finishes. This does NOT cover `evo`'s delegated path to the `evolution` sub-agent: plugin-shipped agents ignore `hooks:` frontmatter entirely (see `agents/evolution.md`'s own frontmatter comment), so that agent's `hooks:` block never fires, on any platform, when the capture is delegated to it. They intentionally stay terminal-only (no `osascript`/`notify-send` popups) so they degrade identically on every platform; use this skill's Step 2 for a richer, popup-style notification on the same signal files. This tier is **Claude-Code-only** (issue #461) even where it does work: Codex loads hook config from `.codex/hooks.json`, `[hooks]` tables in `.codex/config.toml`, or a Codex plugin's bundled `hooks/hooks.json` — never from a skill's or agent's own frontmatter — so no matcher added to a `hooks:` frontmatter block, `apply_patch` included, can fire on Codex CLI or Codex Desktop. A Codex user, or anyone on the delegated-to-agent path on either platform, gets the same `evolution-captured` notification only via a `PostToolUse` entry configured through this skill's Step 5 (fires at the session level regardless of which component performed the write — but see this section's own "Known gap" note below: Step 5's template currently writes the path pattern into `matcher` rather than `if`, which the current hooks reference documents as invalid) or the equivalent Codex hooks-config entry: see [references/codex-hooks.md § "Getting the `evolution-captured` notification on Codex"](references/codex-hooks.md#getting-the-evolution-captured-notification-on-codex-issue-461).

Practical implications of the per-skill tier's scoping (neither is a bug, both follow directly from how skill/agent-scoped hooks work):
- `evo`'s `PostToolUse` hook filters with the `if` field (`if: "Write(.ievo/hooks/evolution-captured)"`), not `matcher` — `matcher` only accepts tool names (`"Write"`, `"Edit|Write"`, or a bare regex), never a parenthesized path pattern like `"Write(...)"`; the path filter belongs in `if`, which uses full permission-rule syntax.
- `Stop` hooks (`security-check`, `init`) never take a `matcher` or `if` — those fields are silently ignored / never run on non-tool events, so the hook fires unconditionally whenever its carrying skill's turn ends, and the command itself must do the deciding.
- `security-check`'s `Stop` hook is converted to `SubagentStop` when the skill runs inside a `security-auditor` sub-agent (the normal `/ievo:init` Step 8 path) — it fires once per candidate scanned, not once for the whole parallel batch. The batch-level "all scans done" signal is this skill's own Step 5.5 Stop hook, which is genuinely session-scoped and can see `background_tasks` across every dispatched sub-agent.

**Known gap, not addressed here (ticket-link-pending):** the `matcher` restriction above (tool names only, never a parenthesized `Tool(pattern)`) applies to every hook config format — session `settings.json` entries included, not just skill/agent frontmatter. Step 5's own template below predates this constraint and writes the full `"Write(.ievo/hooks/<event>)"` string directly into `matcher`, which the current hooks reference documents as invalid; the per-event `if` field is where that path pattern belongs instead. Fixing it also touches Step 6's dedup-by-`matcher` logic (today's three events share the tool name `"Write"` once `matcher` is corrected, so dedup would need to key on the `if` value instead) — out of scope for this docs-only pass; left as a follow-up.

## Step 1: Ask the user which events to hook

Use `AskUserQuestion` (`multiSelect: true`) — let the user pick any combination of the three iEvo events:

```
Which iEvo pipeline events should fire hooks?
Options (multi-select):
- "init-complete"       — when /ievo:init finishes installing skills
- "security-red"        — when security-auditor returns a RED verdict
- "evolution-captured"  — when /ievo:evo captures a lesson overlay
```

If user picks nothing, do NOT exit yet — Steps 5.5, 5.6, and 5.7 below offer independent hook flows (a Stop hook, a `claude agents` Notification hook, and a SessionStart version-check nudge). Only exit once Step 5.7 is done, and only if Step 1, Step 5.5, Step 5.6, and Step 5.7 all produced zero hook entries.

## Step 2: Ask for notification preference

```
How do you want to be notified when a selected event fires?
Options (single-select):
- "terminal-bell"     — ring the terminal bell (universal; works in every terminal)
- "terminal-sequence" — desktop notification via terminalSequence (requires iTerm2 / WezTerm / similar; v2.1.141+ Claude Code)
- "custom-script"     — run a custom script (you provide the absolute path)
- "none"              — no notification; only log to .ievo/log/hooks/events.log
```

If "custom-script" → follow-up `AskUserQuestion` for the absolute path. Validate it's a **regular file** AND executable (`test -f "$path" && test -x "$path"` — `test -x` alone returns true for executable directories, which would pass validation but fail at hook fire time); re-prompt or fall back to "none" on failure.

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

**Important:** per [Claude Code's hooks reference](https://code.claude.com/docs/en/hooks), the `terminalSequence` field belongs in the **hook command's JSON output (stdout)**, NOT as a static field in `settings.json`. The hook command emits `{"terminalSequence": "<escape>"}` to stdout; Claude Code reads stdout, parses the JSON, and emits the sequence through its own terminal write path (hooks run without a controlling terminal, so direct `/dev/tty` writes fail). Restricted to OSC `0`/`1`/`2`/`9`/`99`/`777` and BEL — values outside the allowlist are silently ignored.

Template per event (replace `<event>` with `init-complete` / `security-red` / `evolution-captured`; `<msg>` with the per-event string from the table below; `<seq-printf>` with the per-preference printf format from the second table):

````json
{
  "matcher": "Write(.ievo/hooks/<event>)",
  "hooks": [
    {
      "type": "command",
      "args": ["sh", "-c", "mkdir -p .ievo/log/hooks && echo \"$(date -u +%Y-%m-%dT%H:%M:%SZ) <msg>\" >> .ievo/log/hooks/events.log && printf '{\"terminalSequence\":\"<seq-printf>\"}'"]
    }
  ]
}
````

The `args` pipeline does three things on every fire:
1. `mkdir -p .ievo/log/hooks` — idempotent, creates parent dirs if missing
2. `echo "<ISO-8601 timestamp> <msg>" >> .ievo/log/hooks/events.log` — append timestamped audit entry to a single rotating log file (one per project, NOT per-fire — easier to `tail -f` / `grep`)
3. `printf '{"terminalSequence":"..."}'` — emit JSON to stdout so Claude Code reads it and fires the notification

Per-event message (substitute for `<msg>`):

| Event | Message |
|-------|---------|
| `init-complete` | `iEvo: /ievo:init pipeline complete` |
| `security-red` | `iEvo: security RED verdict — see .ievo/log/init-*.md §8` |
| `evolution-captured` | `iEvo: evolution overlay captured` |

Per-preference `<seq-printf>` content (replace `<msg>` with the per-event message; escape characters are JSON-encoded inside the printf format so they round-trip through `sh -c` → `printf` → JSON parser):

| Notification preference | `<seq-printf>` |
|-------------------------|-----------------|
| `terminal-bell` | `\u0007` (BEL — rings the terminal bell on every host) |
| `terminal-sequence` (iTerm2) | `\u001b]9;<msg>\u0007` (OSC 9 — iTerm2 system notification) |
| `terminal-sequence` (WezTerm) | `\u001b]777;notify;iEvo;<msg>\u0007` (OSC 777 — WezTerm notify) |
| `terminal-sequence` (other) | `\u0007` (falls back to bell) |
| `custom-script` | keep the `mkdir -p` + `echo >> events.log` portion; replace the `printf '{"terminalSequence":...}'` tail with `exec "$1" "$2"` and pass the user path + event as POSITIONAL `sh -c` arguments (never interpolate raw into the shell string — paths with spaces / single quotes / `$()` would break or inject). Final form: `["sh", "-c", "mkdir -p .ievo/log/hooks && echo \"$(date -u +%Y-%m-%dT%H:%M:%SZ) <msg>\" >> .ievo/log/hooks/events.log && exec \"$1\" \"$2\"", "_", "<user-path>", "<event>"]` — `_` is the conventional `$0` placeholder, `$1` = user path, `$2` = event identifier. The script receives the event identifier as its first positional argument and is responsible for its own notification UX. |
| `none` | omit the `printf ...` portion; keep only `mkdir -p` + `echo >> .log` |


## Step 5.5: Optional — Stop hook for "all background agents complete"

**Different mechanism** from Steps 1–5. The signal-file hooks above are *write-side* `PostToolUse` matchers that fire when a Write call lands on a known path. The Stop hook is a *read-side* hook: Claude Code pipes a JSON object to the hook's stdin every time the main session is about to stop, and the hook decides whether to fire a notification. Claude Code v2.1.145+ ([release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.145)) added `background_tasks` and `session_crons` fields to that JSON — the hook fires its notification only when both are empty, i.e. when all parallel subagents (e.g. `security-auditor` / `repo-indexer` dispatched by `/ievo:init`) have actually finished.

### Step 5.5.1: Ask whether to configure

```
Configure background-agents-complete notification (read-side Stop hook)?
- "yes"  — write .ievo/hooks/scripts/on-stop.sh + register Stop hook entry
- "no"   — skip (you can re-run /ievo:hooks-setup later)
```

If "no" → skip to Step 5.6 (with whatever signal-file entries Step 5 built). The graceful "No hooks configured. Re-run `/ievo:hooks-setup` to pick events later." exit is deferred to Step 5.7.1, the final opt-in.

### Step 5.5.2: Ask for notification command

```
Which notification to fire when all background agents complete?
- "macos"   — osascript -e 'display notification "..." with title "iEvo"' (macOS only; fires a real desktop notification independent of TTY)
- "linux"   — notify-send "iEvo" "..." (requires libnotify; freedesktop.org notification spec)
- "bell"    — printf '\a' (terminal BEL fallback; reliability depends on the terminal's handling of hook-process stdout)
- "custom"  — user-provided shell command (validated the same way as Step 2's custom-script path: `test -f "$path" && test -x "$path"` — regular file AND executable; `test -x` alone accepts directories which would exec-fail at hook fire time)
```

### Step 5.5.3: Write the Stop hook script

Use the Write tool to create `.ievo/hooks/scripts/on-stop.sh` (Write tool creates parent dirs). The body is parameterised on the Step 5.5.2 choice — substitute `<notify-cmd>` with one of:

| Choice | `<notify-cmd>` |
|--------|----------------|
| `macos`  | `osascript -e 'display notification "iEvo: all background agents complete" with title "iEvo"'` |
| `linux`  | `notify-send "iEvo" "all background agents complete"` |
| `bell`   | `printf '\a'` |
| `custom` | `"<validated-path>"` — **write-time placeholder**: substitute `<validated-path>` with the actual absolute path the user supplied + validated in Step 5.5.2 (e.g. `"$HOME/bin/notify-ievo"` or any other absolute path the user owns). The path is embedded as a string literal in the generated `.ievo/hooks/scripts/on-stop.sh` at write time; do NOT leave a `$VAR` reference here — the script has no `USER_NOTIFY_CMD=...` assignment, so a runtime variable would be unset and the notification would silently never fire (saved only by the trailing `|| true`). **Do NOT use `exec`** — `exec` replaces the shell process when the target succeeds, so the `exit 0` at the bottom of the script would never run and the Stop hook would exit with whatever code the custom command returned (a non-zero return would then count against `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). The other three options (`osascript`, `notify-send`, `printf '\a'`) fork-and-wait so they reach `exit 0` naturally; `custom` must do the same — invoke the user's command as a normal foreground call (e.g. `"<validated-path>" || true`), let it return, then the script's own `exit 0` runs. |

Script template:

```bash
#!/bin/sh
# iEvo Stop hook — fires a notification only when all background work is done.
# stdin: JSON from Claude Code (v2.1.145+ includes background_tasks + session_crons).
# Exit 0 always — this hook is informational, never blocks the turn. A blocking
# Stop hook is force-released after CLAUDE_CODE_STOP_HOOK_BLOCK_CAP consecutive
# blocks (default 8, v2.1.143+); iEvo's hook never blocks at all.
#
# Note: NO `set -e` — that would turn any per-line failure (full disk, EACCES
# on project root, jq absent, etc.) into a non-zero exit, contradicting the
# non-blocking guarantee. Each line that can fail is individually guarded
# with `|| true` or `2>/dev/null || ...` so the final `exit 0` is reachable
# always.

mkdir -p .ievo/log/hooks 2>/dev/null || true

input=$(cat)
# jq is a hard dependency of `gh`, which iEvo already requires; fall back to 0 if jq absent.
bg=$(printf '%s' "$input" | jq '.background_tasks | length' 2>/dev/null || echo 0)
cron=$(printf '%s' "$input" | jq '.session_crons | length' 2>/dev/null || echo 0)

printf '%s stop-hook bg=%s cron=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$bg" "$cron" \
  >> .ievo/log/hooks/events.log 2>/dev/null || true

if [ "$bg" = "0" ] && [ "$cron" = "0" ]; then
  <notify-cmd> || true
fi

exit 0
```

Then make it executable. Use Bash: `chmod +x .ievo/hooks/scripts/on-stop.sh`.

**Field availability:** On Claude Code <v2.1.145, `background_tasks` and `session_crons` are absent from the stdin JSON. `jq '.background_tasks | length'` returns `0` directly in that case (jq's `null | length` evaluates to `0` with exit code `0` — the `|| echo 0` guard does NOT fire on missing fields; it only fires when `jq` itself is unavailable or the input is unparseable JSON). Both counts become 0, so the notification fires on every Stop. Warn the user if `claude --version` (run via Bash in Step 5.5.3) returns a version below 2.1.145 — they can still install the hook, but it will fire on every stop instead of "all background agents done".

### Step 5.5.4: Build the Stop hook entry

For Step 6's merge stage, build this entry (to be added to `hooks.Stop[]`):

```json
{
  "hooks": [
    {
      "type": "command",
      "args": ["sh", ".ievo/hooks/scripts/on-stop.sh"]
    }
  ]
}
```

Stop hook entries don't have a `matcher` field — Claude Code calls every Stop hook on every stop, the script itself decides whether to act. Dedup at merge time by checking whether an existing entry has the same `args` array.

### Step 5.5.5: Optional — feedback via `additionalContext` (v2.1.163+)

Claude Code v2.1.163+ ([release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.163)) lets `Stop` **and** `SubagentStop` hooks also return `hookSpecificOutput.additionalContext` — a string injected back into the model's conversation, "to give Claude feedback and keep the turn going without being labeled a hook error." This is separate from the notification Steps 5.5.1–5.5.4 configure (sound/banner only, nothing reaches the model); Claude Code below v2.1.163 simply ignores the field. To report a one-line status alongside (or instead of) the notification, have the Step 5.5.3 script's success branch also print, after `<notify-cmd>`, a single line of JSON:

```json
{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"iEvo: all background agents complete."}}
```

The four `<notify-cmd>` choices (`osascript`, `notify-send`, `printf '\a'`, and a well-behaved `custom` command per Step 5.5.3's table) emit nothing to stdout on success, so this JSON line stays the hook's only stdout output — verify a custom notification command does the same before combining the two, since any stray stdout ahead of it would break the JSON parse.

Applies equally to `SubagentStop` output (`"hookEventName":"SubagentStop"`) — relevant because `security-check`'s own per-skill `Stop` hook (see "Two complementary hook tiers" above) converts to `SubagentStop` when it runs inside a parallel `security-auditor` sub-agent dispatch. This skill does not wire that up today (that hook ships with `security-check/SKILL.md` itself, not `/ievo:hooks-setup`) — noted here as a pointer for anyone extending it.

## Step 5.6: Optional — Notification hook for `claude agents` background sessions

**Different agent-dispatch model from Step 5.5 — read this scope note first.** Step 5.5's Stop hook and this Notification hook are NOT interchangeable; they cover two genuinely different dispatch models:

- **Step 5.5 (Stop hook)** applies to **Task-tool sub-agents dispatched *within* one session** (e.g. the `security-auditor` / `repo-indexer` that `/ievo:init` fans out). It is *read-side polling at session-stop*: Claude Code hands the hook the current session's `background_tasks`/`session_crons` queues and the hook fires only when both are empty. It sees a single point in time and cannot tell "still running" apart from "blocked waiting on input".
- **Step 5.6 (Notification hook)** applies to **background sessions launched with `claude agents`** — separate sessions, not Task-tool sub-agents of the current one. Claude Code v2.1.198+ ([release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.198)) fires the `Notification` hook *per transition* for these sessions, with a matcher that separates the actionable case from the informational one — the distinction the Stop hook's single "queue empty?" check cannot draw.

Keep Step 5.5 for in-session Task sub-agents; use Step 5.6 for `claude agents` background sessions. They can coexist.

**Matcher values** (Notification hook, v2.1.198+):

| Matcher | Fires when | Actionable? |
|---------|------------|-------------|
| `agent_needs_input` | a `claude agents` background session is blocked waiting on input | **Yes** — the session is stalled until you respond |
| `agent_completed`   | a `claude agents` background session finishes | No — informational status update |

**Audited against v2.1.195's hyphenated-matcher fix** ([release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.195)): hook matchers with hyphenated identifiers (e.g. `code-reviewer`, `mcp__brave-search`) now exact-match instead of substring-match — use `mcp__brave-search__.*` to match a whole hyphenated MCP server's tool family. Neither matcher this skill writes is hyphenated (`agent_needs_input`/`agent_completed` here; `startup` in Step 5.7; the Step 5 signal-file event names like `init-complete` sit inside a `Write(...)` argument, not the bare `matcher` value this fix changes — see the existing Known-gap note above), so this is a compatibility note, not a functional fix.

### Step 5.6.1: Ask whether to configure

```
Configure claude-agents background-session notifications (Notification hook, requires Claude Code v2.1.198+)?
- "yes"  — register Notification hook entries for agent_needs_input / agent_completed
- "no"   — skip (you can re-run /ievo:hooks-setup later)
```

If "no" → skip to Step 5.7 (with whatever entries Steps 5 and 5.5 built). The graceful "No hooks configured" exit is deferred to Step 5.7.1, the final opt-in.

Run `claude --version` via Bash: if it is below **v2.1.198**, warn the user that the `Notification` matchers `agent_needs_input`/`agent_completed` are unavailable on their version — offer to skip, since the entries would never fire.

### Step 5.6.2: Build the Notification hook entries

Register **one entry per matcher** under `hooks.Notification[]` (a top-level key alongside `hooks.PostToolUse` and `hooks.Stop`). Surface `agent_needs_input` **more prominently** than `agent_completed`: the first needs you *now* and the session is blocked until you act; the second is a status update you can glance at later.

macOS example (`osascript`) — the actionable entry plays a sound and titles itself "action needed"; the informational entry is a plain, silent banner:

````json
{
  "matcher": "agent_needs_input",
  "hooks": [
    {
      "type": "command",
      "args": ["sh", "-c", "mkdir -p .ievo/log/hooks && echo \"$(date -u +%Y-%m-%dT%H:%M:%SZ) agent_needs_input\" >> .ievo/log/hooks/events.log && osascript -e 'display notification \"A claude agents session is waiting on your input\" with title \"iEvo — action needed\" sound name \"Ping\"' || true"]
    }
  ]
}
````

````json
{
  "matcher": "agent_completed",
  "hooks": [
    {
      "type": "command",
      "args": ["sh", "-c", "mkdir -p .ievo/log/hooks && echo \"$(date -u +%Y-%m-%dT%H:%M:%SZ) agent_completed\" >> .ievo/log/hooks/events.log && osascript -e 'display notification \"A claude agents session finished\" with title \"iEvo\"' || true"]
    }
  ]
}
````

The prominence difference is deliberate: `agent_needs_input` carries a sound + an "action needed" title so it interrupts; `agent_completed` is a quiet banner (log line + plain notification, no sound). Linux equivalents keep the same split via `notify-send` urgency: `notify-send -u critical "iEvo — action needed" "A claude agents session is waiting on your input"` for `agent_needs_input` vs `notify-send -u low "iEvo" "A claude agents session finished"` for `agent_completed`. Both entries end with `|| true` so a missing `osascript`/`notify-send` never turns the hook into a non-zero exit (the notification is best-effort; the log line is the durable record). As in Step 5, each `args` line first appends a timestamped entry to the shared `.ievo/log/hooks/events.log`.

### Step 5.6.3: Merge the Notification entries

For Step 6, ensure `hooks.Notification` exists as an array (create if missing), then for each of the two entries dedup by **`matcher`**: if an entry with the same `matcher` (`agent_needs_input` / `agent_completed`) already exists in `hooks.Notification`, do not duplicate — print "Notification hook for `<matcher>` already configured; skipping. Edit `settings.json` manually to overwrite it." Otherwise append. The entries then flow through Step 7's confirmation and Step 8's apply like any other.

## Step 5.7: Optional — SessionStart version-check nudge (iEvo behind latest)

**A different trigger from every hook above.** Steps 5 / 5.5 / 5.6 all fire on iEvo *pipeline* events (a signal-file Write, a session Stop, a `claude agents` transition). This one fires on **session start** and answers a different question: *is the installed iEvo plugin behind the marketplace's latest version?* It exists for users who keep native plugin **auto-update off** (third-party marketplaces default to off — see README § "Keep iEvo up to date"); users who enable auto-update don't need it, because Claude Code then updates iEvo at startup natively.

Mechanism (verified against the [SessionStart hook reference](https://code.claude.com/docs/en/hooks), 2026-07-02):

- **SessionStart is context-only** — it *cannot* block or delay startup (exit code is ignored for flow control). A `command` hook's job is to optionally emit `hookSpecificOutput.additionalContext`, which is injected into the model's context before the first prompt. So the hook must be fast and **fail-silent**: any error (offline, missing tool, parse failure, up-to-date) emits nothing and exits 0.
- **Throttle (required).** SessionStart runs every session, so the script self-throttles the *network* call to **≤ once per 24h** via a cache file (`${XDG_CACHE_HOME:-$HOME/.cache}/ievo/version-check.json` holding `{checked_at, latest_version}`). On a cache hit within 24h it uses the cached latest and makes **no network call**; the compare is a cheap local read, so the cache-hit path adds no measurable startup latency.
- **Source of truth** for "latest" is the marketplace manifest on the default branch — `plugins[0].version` in `https://raw.githubusercontent.com/ievo-ai/skills/main/.claude-plugin/marketplace.json` (a single unauthenticated `GET`; the once/day cache keeps well under GitHub's unauthenticated rate limit). "Installed" is `.version` from the plugin's own `plugin.json`.
- **Other SessionStart return fields exist but are unused here** (v2.1.152+, [release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.152)): `reloadSkills: true` (re-scans skill directories so a hook-installed skill becomes usable the same session) and `hookSpecificOutput.sessionTitle` (sets the session title). Neither applies to a version-check nudge — noted for anyone extending this hook to also install/update skills or brand the session.

### Step 5.7.1: Ask whether to configure

```
Configure a SessionStart version-check nudge (reminds you at most once/day when iEvo is behind latest)?
- "yes"  — write .ievo/hooks/scripts/version-check.sh + register a SessionStart hook entry
- "no"   — skip
```

If "no" → proceed to Step 6 with whatever entries Steps 5, 5.5, and 5.6 built. If **all** of Step 5, Step 5.5, Step 5.6, and Step 5.7 produced zero entries, exit gracefully with "No hooks configured. Re-run `/ievo:hooks-setup` to pick events later." and stop.

**Recommend enabling native auto-update instead / as well.** Tell the user the higher-leverage fix is to turn on native plugin auto-update (`/plugin` → **Marketplaces** → `ievo-skills` → **Enable auto-update**); this nudge is the fallback for when they deliberately keep it off. Both can coexist — if auto-update is on, the installed version stays current and the nudge simply never fires.

### Step 5.7.2: Resolve and bake the plugin.json path

The generated script reads the installed version from the plugin's `plugin.json`. A hook in the **user's** `settings.json` does **not** get `CLAUDE_PLUGIN_ROOT` set at fire time (that variable is only populated for hooks shipped inside a plugin), so resolve the absolute path **now**, at setup time, while this skill *is* running inside the plugin, and bake it into the script as a string literal.

Run via Bash (both allowed by this skill's `allowed-tools`):

```bash
test -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" && echo "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
```

Use the printed absolute path as `<plugin-json-abs-path>` in the template below. If the `test` fails (empty output), the plugin root couldn't be resolved — tell the user the nudge can't be configured right now and skip to Step 6 (do not write a script with an unresolved path).

### Step 5.7.3: Write the version-check script

Use the Write tool to create `.ievo/hooks/scripts/version-check.sh` (Write creates parent dirs). Substitute `<plugin-json-abs-path>` with the Step 5.7.2 result — a **write-time placeholder**, embedded as a literal, NOT a runtime `$VAR`:

```sh
#!/bin/sh
# iEvo SessionStart version-check nudge — reminds you when the installed iEvo
# plugin is behind the marketplace's latest version.
#
# CONTRACT (see hooks-setup/SKILL.md Step 5.7):
#   - Fail-silent: any error or "up to date" => emit nothing, exit 0. SessionStart
#     is context-only and cannot block startup; this hook never delays a session.
#   - Network throttled to <= once / 24h via a cache file. Cache-hit path makes
#     NO network call and adds no measurable latency.
#   - NO `set -e`: every fallible step is individually guarded so `exit 0` is
#     always reachable and a partial failure never surfaces to the user.
#   - Untrusted input: `installed`/`latest` (local plugin.json, but `latest` can
#     come from a network fetch or a cache file, either tamperable) are rejected
#     unless they're a strict X.Y.Z SemVer form BEFORE being cached, compared, or
#     placed in the SessionStart additionalContext the model reads as instructions.
#     Output JSON is built with `jq -n`/`--arg`, never raw string interpolation.

MARKETPLACE_URL="https://raw.githubusercontent.com/ievo-ai/skills/main/.claude-plugin/marketplace.json"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/ievo"
CACHE="$CACHE_DIR/version-check.json"
TTL=86400  # 24h, in seconds

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the path baked at setup.
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json}"
[ -n "$PLUGIN_JSON" ] && [ -f "$PLUGIN_JSON" ] || PLUGIN_JSON="<plugin-json-abs-path>"

# Strict X.Y.Z SemVer gate (this repo's own version convention — no
# pre-release/build metadata). Reject empty, any byte outside [0-9.], a
# leading/trailing/doubled dot, or a component count other than 3.
is_semver() {
  case "$1" in
    ""|*[!0-9.]*|.*|*.|*..*) return 1 ;;
  esac
  case "$1" in
    *.*.*.*) return 1 ;;
    *.*.*) return 0 ;;
    *) return 1 ;;
  esac
}

# jq is a hard dependency of gh, which iEvo already requires; bail silently if absent.
installed=$(jq -r '.version // empty' "$PLUGIN_JSON" 2>/dev/null) || exit 0
is_semver "$installed" || exit 0

now=$(date +%s 2>/dev/null) || exit 0
case "$now" in ""|*[!0-9]*) exit 0 ;; esac

latest=""
# Cache hit within TTL -> use cached latest, NO network call.
if [ -f "$CACHE" ]; then
  checked_at=$(jq -r '.checked_at // 0' "$CACHE" 2>/dev/null || echo 0)
  case "$checked_at" in ""|*[!0-9]*) checked_at=0 ;; esac
  age=$((now - checked_at))
  if [ "$age" -ge 0 ] && [ "$age" -lt "$TTL" ]; then
    latest=$(jq -r '.latest_version // empty' "$CACHE" 2>/dev/null || echo "")
    is_semver "$latest" || latest=""
  fi
fi

# Cache miss / stale -> one throttled network fetch, then refresh the cache.
if [ -z "$latest" ]; then
  latest=$(curl -fsS --max-time 5 "$MARKETPLACE_URL" 2>/dev/null \
    | jq -r '.plugins[0].version // empty' 2>/dev/null || echo "")
  is_semver "$latest" || exit 0
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  jq -n --argjson checked_at "$now" --arg latest_version "$latest" \
    '{checked_at: $checked_at, latest_version: $latest_version}' \
    > "$CACHE" 2>/dev/null || true
fi

[ -n "$latest" ] || exit 0

# Behind? Numeric semver compare (installed < latest) in awk — portable, no `sort -V`
# (macOS BSD sort lacked -V for years). Prints 1 iff installed is strictly older.
behind=$(awk -v a="$installed" -v b="$latest" 'BEGIN{
  na=split(a,x,"."); nb=split(b,y,".");
  n=(na>nb)?na:nb;
  for(i=1;i<=n;i++){ai=(i<=na)?x[i]+0:0; bi=(i<=nb)?y[i]+0:0;
    if(ai<bi){print 1; exit} if(ai>bi){print 0; exit}}
  print 0}' 2>/dev/null || echo 0)

[ "$behind" = "1" ] || exit 0

# Behind -> inject a nudge as SessionStart additionalContext. The message is
# read by the model, which relays it to the user. Built with `jq -n --arg` (a
# real JSON encoder), not string interpolation — installed/latest are already
# semver-validated above, but the encoder is the actual guarantee, not an
# unenforced formatting assumption.
msg="iEvo plugin update available: installed ${installed}, latest ${latest}. Tell the user they can enable native plugin auto-update (/plugin -> Marketplaces -> ievo-skills -> Enable auto-update) so Claude Code keeps iEvo current automatically, or update now by re-running /plugin install ievo@ievo-skills, then /reload-plugins."
jq -n --arg msg "$msg" '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$msg}}' 2>/dev/null
exit 0
```

Then make it executable via Bash: `chmod +x .ievo/hooks/scripts/version-check.sh`.

### Step 5.7.4: Build the SessionStart hook entry

For Step 6's merge stage, build this entry (added to `hooks.SessionStart[]`). Matcher `startup` targets brand-new sessions — the least-noisy signal; `resume`/`clear`/`compact` are deliberately excluded so a mid-work compaction never injects the nudge:

```json
{
  "matcher": "startup",
  "hooks": [
    {
      "type": "command",
      "args": ["sh", ".ievo/hooks/scripts/version-check.sh"]
    }
  ]
}
```

Dedup at merge time by checking whether an existing `hooks.SessionStart` entry has both the same `matcher` (`startup`) and the same inner `args`.

**Scope note (like the Stop hook):** the check is machine-level (the plugin install and the `~/.cache/ievo` throttle file are per-user, not per-project), so **global scope suits it best** — recommend it if the user chose `project` in Step 3. The generated `version-check.sh` lives at `.ievo/hooks/scripts/version-check.sh`, which `/ievo:init` Step 10's `.ievo/hooks/scripts/*` line keeps gitignored (Step 10's negations carve out only the three `evo-auto-enable` dispatcher shims, by name — never this file), so a project-scoped SessionStart entry would reference a script teammates don't have — Claude Code logs a cosmetic hook-launch error (SessionStart is non-blocking, so session flow is unaffected). Each teammate re-runs `/ievo:hooks-setup` once per clone to write their own copy.

## Step 6: Merge entries into settings.json

Use the Read + Edit tools (NOT shell-based JSON edits — preserves existing comments and key order on Claude Code's tolerant JSON parser). Pseudo-procedure:

1. Read current settings.json (from Step 4, or `{}` if absent).
2. For signal-file entries (Step 5): ensure `hooks.PostToolUse` exists as an array; create if missing. For each new entry, check if `matcher` already exists in `hooks.PostToolUse`. If yes, **do not duplicate** — print "Hook for `<event>` already configured; skipping. Edit `settings.json` manually to overwrite it." Otherwise append.
3. For the Stop hook entry (Step 5.5, if Step 5.5.1 = "yes"): ensure `hooks.Stop` exists as an array; create if missing. Stop hook entries have no `matcher`, so dedup by comparing the inner `hooks[0].args` array — if an existing entry's args matches `["sh", ".ievo/hooks/scripts/on-stop.sh"]`, skip with "Stop hook already configured; skipping." Otherwise append.
4. For the SessionStart entry (Step 5.7, if Step 5.7.1 = "yes"): ensure `hooks.SessionStart` exists as an array; create if missing. Dedup on both `matcher` (`startup`) and inner `hooks[0].args` (`["sh", ".ievo/hooks/scripts/version-check.sh"]`) — if a matching entry exists, skip with "Version-check nudge already configured; skipping." Otherwise append.

## Step 7: Confirm with the user

Display the final merged config (the entries being added, not the whole file) and ask:

```
The following hook entries will be added to <.claude/settings.json | ~/.claude/settings.json — substitute the actual path from Step 3 scope>:

[display new entries]

Existing hooks preserved. Proceed?
- "yes"  — write the file
- "no"   — abort; nothing written
```

## Step 8: Apply the merged settings.json

If the file existed in Step 4: use the **Edit** tool to apply the new hook entries — preserves existing comments, key order, and unrelated entries (Claude Code's settings.json parser is tolerant of comments). Step 6's "Read + Edit" guidance applies here for consistency.

If the file did NOT exist in Step 4: use the **Write** tool to create it (Edit requires the file to exist first). The `mkdir -p .ievo/log/hooks &&` prefix in the hook `args` handles directory creation lazily on first fire — no separate Step-8 dir-creation needed (Write tool would create parent dirs anyway, but the hook itself runs without a guaranteed cwd context).

**Gitignore note**: `/ievo:init` Step 10 already adds `.ievo/log/` plus a six-line, **negation-capable** `.ievo/hooks/` block — everything under `.ievo/hooks/` ignored, with exactly the three tracked dispatcher shims `/ievo:evo-auto-enable` Step 3.5.1b commits carved back out (skills#446). If init was run before hooks-setup (the typical install path), no further gitignore action is needed: this skill's own `on-stop.sh` and `version-check.sh` are already covered by that block's `.ievo/hooks/scripts/*` line.

**Never write a blanket `.ievo/hooks/` line here either.** git cannot re-include a file whose parent directory is excluded ("you cannot re-include a file if a parent directory of that file is excluded"), and a bare directory-form entry wins over any negation that follows it — so appending one would silently re-ignore the shims a previous `/ievo:evo-auto-enable` or `/ievo:init` run had already carved out, reintroducing the exact clean-clone `exit 127` those negations exist to prevent. The block below is byte-identical to the one `/ievo:init` Step 10 and `evo-auto-enable/SKILL.md` Step 3.5.1 write, so all three skills converge on the same `.gitignore` state whichever runs first.

If hooks-setup runs in a project that never ran init (unusual but possible if hooks-setup is invoked standalone), read `.gitignore` and decide before writing anything:
- If `.ievo/log/` and the six `.ievo/hooks/` lines below are all already present, skip the prompt entirely — nothing to do.
- If it contains a blanket `.ievo/hooks/` line (a pre-#446 init run, a pre-#446 run of this skill, or a hand-written entry), prompt the user via `AskUserQuestion` to REPLACE that one line with the six lines below via the Edit tool, leaving every other line untouched. Replace, never append alongside — a bare `dir/` entry still wins over later negations, so leaving both would keep the shims ignored.
- Otherwise prompt via `AskUserQuestion` to append whichever is missing: `.ievo/log/` and/or the six-line block (creating `.gitignore` first if the project lacks one).

```
.ievo/hooks/*
!.ievo/hooks/scripts/
.ievo/hooks/scripts/*
!.ievo/hooks/scripts/correction-capture.sh
!.ievo/hooks/scripts/evo-analysis-nudge.sh
!.ievo/hooks/scripts/failure-capture.sh
```

Print a final confirmation:

```
✓ Configured <N> iEvo hook(s) at <path>.
Hooks fire on these signal-file writes (PostToolUse):
  .ievo/hooks/init-complete       → after /ievo:init finishes
  .ievo/hooks/security-red        → after security-auditor returns RED
  .ievo/hooks/evolution-captured  → after /ievo:evo writes an overlay
[If Step 5.5 configured:]
Stop hook (read-side, .ievo/hooks/scripts/on-stop.sh):
  fires once per session-stop, ONLY when background_tasks=0 AND session_crons=0
  (i.e. all parallel subagents from /ievo:init are done; requires Claude Code v2.1.145+)
[If Step 5.7 configured:]
SessionStart hook (.ievo/hooks/scripts/version-check.sh, matcher=startup):
  fires on new sessions; fail-silent; checks the marketplace <=once/24h and nudges
  ONLY when the installed iEvo plugin is behind latest. Enable native auto-update
  (/plugin -> Marketplaces -> ievo-skills) to keep iEvo current without the nudge.
Logs accumulate at .ievo/log/hooks/events.log (single append-only file; `tail -f` / `grep` it).
```

## Rules

- **Never overwrite** existing `PostToolUse` entries — append only, with the dedup check in Step 6.3.
- **Project scope is recommended** for team-shared signal (the same hooks fire for everyone on the team after pulling). Global scope is for personal-machine-wide preferences.
- **Logs go to `.ievo/log/hooks/`** even when `none` is selected as the notification — silent operation, but the audit trail is still available.
- **Signal files are written by other iEvo skills** (init, evo, security-auditor). Do NOT write them from this skill — that would falsely trigger hooks the user expected only on real pipeline completion.
- **Version-check nudge is fail-silent + throttled.** `.ievo/hooks/scripts/version-check.sh` emits nothing on any error or when up to date, makes at most one network call per 24h (cache-hit path is offline), and — SessionStart being context-only — can never block or delay a session. Recommend native plugin auto-update as the primary fix; the nudge is the keep-auto-update-off fallback. Its `plugin.json` path is baked at setup time because a user-`settings.json` hook has no `CLAUDE_PLUGIN_ROOT`.
- **Stop hook is non-blocking always.** `.ievo/hooks/scripts/on-stop.sh` exits 0 unconditionally. A blocking Stop hook is force-released after `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` consecutive blocks (default 8, v2.1.143+); iEvo's hook never blocks, so the block-cap is informational only.
- **Stop hook script is local, not team-shared.** Notification commands are OS- and preference-specific (macOS osascript vs Linux notify-send vs custom path), so `.ievo/hooks/scripts/on-stop.sh` is intentionally written under `.ievo/hooks/scripts/`, which `/ievo:init` Step 10's `.ievo/hooks/scripts/*` line keeps gitignored (only the three named `evo-auto-enable` dispatcher shims are carved back out; this script is not one of them). The Stop hook entry in `settings.json` is project-scope-tracked, but the script it references is not — when a team member pulls a project that uses the Stop hook, Claude Code will log a hook-launch error if their `.ievo/hooks/scripts/on-stop.sh` is absent. The error is cosmetic (Stop hook is non-blocking by design; the missing-script `sh` exit is also non-blocking on session flow). To activate the hook locally, each team member re-runs `/ievo:hooks-setup` once per clone to write their own copy of the script.

## Cursor hooks

**Different platform, different mechanism — not a further step in Steps 1–8.** Cursor (v3.11+, "Cloud Agent Hooks") uses its own `.cursor/hooks.json` schema, distinct from the Claude Code `.claude/settings.json` mechanism Steps 1–8 configure. Full reference — config scopes, the `stop`/`afterAgentResponse` hook types, stdin/stdout contract, exit-code semantics, and a worked example — lives in **[references/cursor-hooks.md](references/cursor-hooks.md)**.

## Codex hooks

**Different platform, different mechanism — not a further step in Steps 1–8.** Codex CLI (rust-v0.133.0+, [PR #22782](https://github.com/openai/codex/pull/22782) / [PR #22873](https://github.com/openai/codex/pull/22873)) ships its own native hook system, distinct from the Claude Code `.claude/settings.json` mechanism Steps 1–8 configure — closer in shape (JSON or TOML config, `matcher` + `hooks[]` entries, a stdin/stdout JSON contract) but with its own event catalog, config paths, and blocking semantics. Codex Desktop uses the identical hook system and event catalog (issue #461) — the two surfaces differ in client *detection* upstream of hooks, not in the hook mechanism itself; see the reference below. Full reference — config scopes, the `SubagentStart`/`SubagentStop`/`PostToolUse` event schemas, the exit-code contract, `apply_patch` matcher aliases, Desktop-vs-CLI detection, and a worked example — lives in **[references/codex-hooks.md](references/codex-hooks.md)**.

## See also

- `init/SKILL.md` **Step 11.5** — writes `.ievo/hooks/init-complete` at the end of the pipeline.
- `evo/SKILL.md` **Step 5.5** — writes `.ievo/hooks/evolution-captured` after the overlay append.
- `security-auditor.md` agent body **Step 6** — writes `.ievo/hooks/security-red` after returning a RED verdict.

## References

- [Claude Code v2.1.139 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.139) — `args: string[]` exec-form hook field
- [Claude Code v2.1.141 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.141) — `terminalSequence` desktop-notification field
- [Claude Code v2.1.143 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.143) — `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` env var (default 8) for blocking Stop hooks
- [Claude Code v2.1.145 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.145) — Stop + SubagentStop hook input gains `background_tasks` and `session_crons` fields
- [Claude Code v2.1.152 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.152) — new `MessageDisplay` hook event (transforms/hides assistant message text as displayed; not configured by this skill); SessionStart hooks gain `reloadSkills`/`hookSpecificOutput.sessionTitle` (Step 5.7 note above); new `/reload-skills` command for the manual re-scan path
- [Claude Code v2.1.163 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.163) — Stop/SubagentStop hooks may return `hookSpecificOutput.additionalContext` (Step 5.5.5 above)
- [Claude Code v2.1.169 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.169) — `--safe-mode`/`CLAUDE_CODE_SAFE_MODE` disables all customizations including hooks (safe-mode caveat above); `disableBundledSkills`/`CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` hides only Claude Code's own bundled skills and does not affect this skill's hooks
- [Claude Code v2.1.176 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.176) — fixed hook `if:` conditions for Read/Edit/Write tool paths: documented patterns like `Edit(src/**)`, `Read(~/.ssh/**)`, and `Read(.env)` now match correctly; before this, `if:` path-pattern filtering on file tools was silently ignored (see "Two complementary hook tiers" `if` usage above, and the Known-gap note's `matcher`→`if` guidance)
- [Claude Code v2.1.183 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.183) — auto mode blocks the agent's own destructive git tool calls (`git reset --hard`, `git checkout -- .`, `git clean -fd`, `git stash drop`, out-of-session `git commit --amend`) and `terraform`/`pulumi`/`cdk destroy` unless explicitly requested. Verified against the hooks reference: this gates the agent's Bash **tool calls** via the auto-mode classifier, not hook-subprocess execution — this skill's generated scripts (`on-stop.sh`, `version-check.sh`) run as host subprocesses outside that gate and are unaffected. It does matter for a hook whose `additionalContext` recommends the model run one of these commands next — that recommendation becomes a normal Bash tool call and can be silently blocked by the same classifier
- [Claude Code v2.1.195 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.195) — hook matchers with hyphenated identifiers now exact-match instead of substring-match (Step 5.6 audit note above)
- [Claude Code v2.1.198 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.198) — `Notification` hook fires for `claude agents` background sessions with matchers `agent_needs_input` / `agent_completed`
- [Claude Code hooks reference — SessionStart](https://code.claude.com/docs/en/hooks) — `command`/`mcp_tool` only, context-only (cannot block), `hookSpecificOutput.additionalContext` injected before the first prompt; matchers `startup`/`resume`/`clear`/`compact` (Step 5.7 version-check nudge)
- [Claude Code plugins — configure auto-updates](https://code.claude.com/docs/en/discover-plugins#configure-auto-updates) — third-party marketplaces default auto-update OFF; the Step 5.7 nudge is the fallback for users who keep it off
- [Claude Code hooks reference — Hooks in skills and agents](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents) — the per-skill `hooks:` frontmatter tier documented above (`evo`, `security-check`, `init`); confirms `matcher` is tool-name-only and the per-handler `if` field carries permission-rule path patterns
- Signal-file trigger pattern (`PostToolUse` + `Write(<path>)` matcher) is portable across any host that matches Write-tool calls to a path pattern
- [Cursor changelog — v3.11](https://www.cursor.com/changelog) — "Cloud Agent Hooks": `beforeSubmitPrompt`, `afterAgentResponse`, `afterAgentThought`, `stop`, `subagentStart` added to the agent-conversation hook surface
- [Cursor hooks reference](https://cursor.com/docs/hooks) — full hook catalog, `hooks.json` config scopes (Enterprise/Team/Project/User), stdin/stdout contract, exit-code semantics (Cursor hooks section above)
- [Codex hooks reference](https://developers.openai.com/codex/hooks) — full event catalog (`SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `UserPromptSubmit`, `PreCompact`, `PostCompact`, `Stop`), config scopes, stdin/stdout contract (Codex hooks section above)
- [Codex PR #22782](https://github.com/openai/codex/pull/22782) / [PR #22873](https://github.com/openai/codex/pull/22873) — `SubagentStart` / `SubagentStop` hooks added, merged 2026-05-19/20 (first stable release carrying both: rust-v0.133.0)
- [Codex rust-v0.141.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.141.0) — blocking `PostToolUse` hooks now correctly reject code-mode tool calls (previously passed through silently)
- [Codex PR #23980](https://github.com/openai/codex/pull/23980) — `trace_id` added to `TurnStartedEvent`; verified this is a Codex **app-server protocol** event, not part of the hook system documented above — out of scope for this skill (references/codex-hooks.md)
