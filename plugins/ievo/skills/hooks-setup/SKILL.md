---
name: hooks-setup
description: "Configure Claude Code lifecycle hooks for iEvo pipeline events — init complete, security RED verdict, evolution captured, and (optional) all-background-agents-complete via a Stop hook. Writes PostToolUse and Stop hook entries to `.claude/settings.json` using exec-form (`args: string[]`) and optionally `terminalSequence` for desktop notifications. Use when the user asks \"notify me when ievo finishes\", \"add hooks for ievo\", \"set up ievo notifications\", \"tell me when background agents are done\", or \"configure ievo lifecycle hooks\". Requires Claude Code v2.1.139+ (for `args` exec-form); `terminalSequence` notifications further require v2.1.141+ and an iTerm2/WezTerm-class terminal. The optional Stop hook for background-complete requires v2.1.145+ for the `background_tasks` and `session_crons` fields in the Stop hook input. Also installs an optional fail-silent SessionStart nudge when the installed iEvo plugin is behind latest — asked \"nudge me when ievo is out of date\"."
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
compatibility: "Claude Code v2.1.139+ (exec-form `args: string[]` hook field); v2.1.141+ (`terminalSequence` desktop notifications); v2.1.145+ (Stop hook `background_tasks`/`session_crons` fields — on older versions the hook installs but fires on every stop instead of only when background agents are clear); v2.1.198+ (`Notification`, `claude agents`: `agent_needs_input`/`agent_completed`). Codex hook schema may differ. Other agentskills.io platforms: only if settings.json honors the Claude Code hook schema."
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

MARKETPLACE_URL="https://raw.githubusercontent.com/ievo-ai/skills/main/.claude-plugin/marketplace.json"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/ievo"
CACHE="$CACHE_DIR/version-check.json"
TTL=86400  # 24h, in seconds

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present; else the path baked at setup.
PLUGIN_JSON="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json}"
[ -n "$PLUGIN_JSON" ] && [ -f "$PLUGIN_JSON" ] || PLUGIN_JSON="<plugin-json-abs-path>"

# jq is a hard dependency of gh, which iEvo already requires; bail silently if absent.
installed=$(jq -r '.version // empty' "$PLUGIN_JSON" 2>/dev/null) || exit 0
[ -n "$installed" ] || exit 0

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
  fi
fi

# Cache miss / stale -> one throttled network fetch, then refresh the cache.
if [ -z "$latest" ]; then
  latest=$(curl -fsS --max-time 5 "$MARKETPLACE_URL" 2>/dev/null \
    | jq -r '.plugins[0].version // empty' 2>/dev/null || echo "")
  [ -n "$latest" ] || exit 0
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  printf '{"checked_at":%s,"latest_version":"%s"}\n' "$now" "$latest" \
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
# read by the model, which relays it to the user. ASCII only + no double quotes,
# so the values interpolate safely into the JSON string below.
msg="iEvo plugin update available: installed ${installed}, latest ${latest}. Tell the user they can enable native plugin auto-update (/plugin -> Marketplaces -> ievo-skills -> Enable auto-update) so Claude Code keeps iEvo current automatically, or update now by re-running /plugin install ievo@ievo-skills, then /reload-plugins."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
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

**Scope note (like the Stop hook):** the check is machine-level (the plugin install and the `~/.cache/ievo` throttle file are per-user, not per-project), so **global scope suits it best** — recommend it if the user chose `project` in Step 3. The generated `version-check.sh` lives under `.ievo/hooks/` (gitignored by `/ievo:init` Step 10), so a project-scoped SessionStart entry would reference a script teammates don't have — Claude Code logs a cosmetic hook-launch error (SessionStart is non-blocking, so session flow is unaffected). Each teammate re-runs `/ievo:hooks-setup` once per clone to write their own copy.

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

**Gitignore note**: `/ievo:init` Step 10 already adds both `.ievo/log/` and `.ievo/hooks/` to `.gitignore`. If init was run before hooks-setup (the typical install path), no further gitignore action is needed. If hooks-setup runs in a project that never ran init (unusual but possible if hooks-setup is invoked standalone), check whether `.ievo/log/` and `.ievo/hooks/` are already listed in `.gitignore`; if either is missing, prompt the user via `AskUserQuestion` whether to append the missing entries. Skip the prompt entirely if both are already there.

Print a final confirmation:

```
✓ Configured <N> iEvo hook(s) at <path>.
Hooks fire on these signal-file writes (PostToolUse):
  .ievo/hooks/init-complete       → after /ievo:init finishes
  .ievo/hooks/security-red        → after security-auditor returns RED
  .ievo/hooks/evolution-captured  → after /ievo:evolution writes an overlay
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
- **Signal files are written by other iEvo skills** (init, evolution, security-auditor). Do NOT write them from this skill — that would falsely trigger hooks the user expected only on real pipeline completion.
- **Version-check nudge is fail-silent + throttled.** `.ievo/hooks/scripts/version-check.sh` emits nothing on any error or when up to date, makes at most one network call per 24h (cache-hit path is offline), and — SessionStart being context-only — can never block or delay a session. Recommend native plugin auto-update as the primary fix; the nudge is the keep-auto-update-off fallback. Its `plugin.json` path is baked at setup time because a user-`settings.json` hook has no `CLAUDE_PLUGIN_ROOT`.
- **Stop hook is non-blocking always.** `.ievo/hooks/scripts/on-stop.sh` exits 0 unconditionally. A blocking Stop hook is force-released after `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` consecutive blocks (default 8, v2.1.143+); iEvo's hook never blocks, so the block-cap is informational only.
- **Stop hook script is local, not team-shared.** Notification commands are OS- and preference-specific (macOS osascript vs Linux notify-send vs custom path), so `.ievo/hooks/scripts/on-stop.sh` is intentionally written under `.ievo/hooks/` (gitignored by `/ievo:init` Step 10). The Stop hook entry in `settings.json` is project-scope-tracked, but the script it references is not — when a team member pulls a project that uses the Stop hook, Claude Code will log a hook-launch error if their `.ievo/hooks/scripts/on-stop.sh` is absent. The error is cosmetic (Stop hook is non-blocking by design; the missing-script `sh` exit is also non-blocking on session flow). To activate the hook locally, each team member re-runs `/ievo:hooks-setup` once per clone to write their own copy of the script.

## See also

- `init/SKILL.md` **Step 11.5** — writes `.ievo/hooks/init-complete` at the end of the pipeline.
- `evolution/SKILL.md` **Step 5.5** — writes `.ievo/hooks/evolution-captured` after the overlay append.
- `security-auditor.md` agent body **Step 6** — writes `.ievo/hooks/security-red` after returning a RED verdict.

## References

- [Claude Code v2.1.139 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.139) — `args: string[]` exec-form hook field
- [Claude Code v2.1.141 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.141) — `terminalSequence` desktop-notification field
- [Claude Code v2.1.143 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.143) — `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` env var (default 8) for blocking Stop hooks
- [Claude Code v2.1.145 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.145) — Stop + SubagentStop hook input gains `background_tasks` and `session_crons` fields
- [Claude Code v2.1.198 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.198) — `Notification` hook fires for `claude agents` background sessions with matchers `agent_needs_input` / `agent_completed`
- [Claude Code hooks reference — SessionStart](https://code.claude.com/docs/en/hooks) — `command`/`mcp_tool` only, context-only (cannot block), `hookSpecificOutput.additionalContext` injected before the first prompt; matchers `startup`/`resume`/`clear`/`compact` (Step 5.7 version-check nudge)
- [Claude Code plugins — configure auto-updates](https://code.claude.com/docs/en/discover-plugins#configure-auto-updates) — third-party marketplaces default auto-update OFF; the Step 5.7 nudge is the fallback for users who keep it off
- Signal-file trigger pattern (`PostToolUse` + `Write(<path>)` matcher) is portable across any host that matches Write-tool calls to a path pattern
