# Codex hooks

**Different platform, different mechanism — this reference is documentation, not a further step.** `hooks-setup/SKILL.md` Steps 1–8 configure Claude Code's `.claude/settings.json`. Codex CLI (rust-v0.133.0+) uses its own native hook system — a `hooks.json` file, or inline `[hooks]` tables in `config.toml` — with a largely overlapping event catalog (below) but its own config shape and blocking model. A Codex user wanting the same iEvo-event notifications builds a Codex hooks config following the pattern below rather than running Steps 1–8.

## Full event catalog

Per the official [Codex hooks reference](https://developers.openai.com/codex/hooks) (redirects to the current docs host; read directly 2026-07-25), Codex supports **eleven** hook events:

`SessionStart`, `SessionEnd`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`

- `hookSpecificOutput.additionalContext` is accepted from `SessionStart`, `SubagentStart`, `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` hooks — "that `additionalContext` text is added as extra developer context."
- Every command hook receives JSON on stdin with `session_id`, `hook_event_name`, `cwd`, plus event-specific fields (`turn_id`, `tool_name`, `tool_input`, …).
- `SessionStart`'s `matcher` filters on the session `source` — `startup`, `resume`, `clear`, `compact` — the same values Claude Code's SessionStart matcher takes.
- `PermissionRequest` fires when a tool call needs approval (before the decision); a hook may decide it via `hookSpecificOutput.decision` (`{"behavior": "allow"}` / `{"behavior": "deny", ...}`; any deny wins). Codex has **no** `PostToolUseFailure` or `PermissionDenied` event — `PermissionRequest` is the closest analog, and it observes requests, not outcomes.
- Handlers are `{"type": "command", "command": "<single string>"}` — no Claude-Code-style exec-form `args` array; `commandWindows` optionally overrides on Windows. In `hooks.json` the layout is `{"hooks": {"<EventName>": [{"matcher": ..., "hooks": [...]}]}}`.

**Correction (issue #432):** an earlier revision of this reference described Codex as having "a different event catalog" and detailed only the three events below — which read as the full set and (wrongly) implied Codex lacks `SessionStart`/`UserPromptSubmit` equivalents. The catalog above is the verified, complete set; the sections below remain the deep-dive on the Codex-specific events and semantics.

## Config file location and scopes

Codex discovers hooks next to active config layers, in either format, highest precedence first ([hooks reference](https://developers.openai.com/codex/hooks)):

| Scope | Path | Notes |
|-------|------|-------|
| Project-local | `<repo>/.codex/hooks.json` or `<repo>/.codex/config.toml` (`[hooks]` tables) | Only loads when the `.codex/` layer is trusted — closest analog to hooks-setup's own project-scoped `.claude/settings.json` writes (Step 3) |
| User | `~/.codex/hooks.json` or `~/.codex/config.toml` | User-specific, applies globally |
| System/plugin | bundled with enabled Codex plugins (`hooks/hooks.json` in the plugin root, or a `hooks` entry in `.codex-plugin/plugin.json`) | Lowest precedence |

**This list is exhaustive (issue #461).** Codex reads hooks from these layers and nowhere else — in particular it does **not** read a `hooks:` field from a skill's `SKILL.md` frontmatter or an agent markdown file's frontmatter. Those are Claude Code's [skill/agent-scoped hooks](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents); Codex's own `SKILL.md` frontmatter is documented as `name`/`description` only. A hook that must fire on Codex has to live in one of the rows above, whatever tool name it matches — see § "Getting the `evolution-captured` notification on Codex" below for iEvo's own worked case.

## Sub-agent lifecycle hooks (rust-v0.133.0+)

Codex's Task-tool-equivalent sub-agent dispatch (`spawn_agent`/`send_input`/`resume_agent`/`wait_agent`/`close_agent` — see AGENTS.md § "Codex sub-agent delegation") fires two hook events: [PR #22782](https://github.com/openai/codex/pull/22782) added `SubagentStart` (merged 2026-05-19), [PR #22873](https://github.com/openai/codex/pull/22873) added `SubagentStop` (merged 2026-05-20) — the first stable Codex CLI release carrying both is rust-v0.133.0.

| Hook | Fires | Key input fields | Matcher filters by |
|------|-------|-------------------|---------------------|
| `SubagentStart` | when a subagent begins execution | `turn_id`, `agent_id`, `agent_type`, `permission_mode` | `agent_type` |
| `SubagentStop` | when a subagent finishes | `turn_id`, `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `last_assistant_message` | `agent_type` |

`SubagentStart` can inject developer context back into the subagent via `hookSpecificOutput.additionalContext` (plain text on stdout is also accepted as extra context). `SubagentStop` can request another pass by returning `{"decision": "block", "reason": "..."}` — the Claude Code Stop-hook analog (hooks-setup Step 5.5) has no equivalent "ask for another pass" mechanism; it is purely informational.

## PostToolUse and the code-mode blocking fix (rust-v0.141.0)

`PostToolUse` fires after a tool call completes (Bash, `apply_patch`, MCP calls) with `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`; its matcher filters by tool name. A blocking `PostToolUse` (exit code `2` with the reason on `stderr`, or `{"decision": "block", ...}` on stdout) does not undo the already-completed call — Codex records the feedback for the next turn instead. [rust-v0.141.0](https://github.com/openai/codex/releases/tag/rust-v0.141.0) fixed a gap where a blocking `PostToolUse` hook did not reject **code-mode** tool calls (tool calls issued from Codex's code-execution sandbox rather than directly) — before that release the block silently passed through. Verify your Codex CLI is v0.141.0+ if a `PostToolUse` hook is meant to gate code-mode tool use.

## `apply_patch` matcher aliases and matcher scope (issue #461)

For file edits through `apply_patch`, a `PreToolUse`/`PostToolUse` matcher may be configured as `apply_patch`, `Edit`, or `Write` — the [Codex hooks reference](https://developers.openai.com/codex/hooks) documents all three as equivalent inputs for the same underlying tool, and confirms the hook input Codex delivers to the handler always reports the canonical `tool_name: "apply_patch"` regardless of which alias the matcher used. Two consequences worth stating explicitly, both surfaced while fixing #461 (iEvo's `evolution-captured` notification is a Claude Code `Write` matcher; the Codex equivalent has to be authored from scratch, in a Codex hooks layer, against `apply_patch`):

- **The matcher filters on tool name only — never on a target path or argument.** A pattern like `Write(<path>)` (Claude Code's own `if:`-adjacent shorthand for a path-scoped permission rule) has no Codex equivalent; Codex's config schema has no field for it. A hook that needs to act only when `apply_patch` touched a *specific* path must do that check itself, inside the handler, against the hook's stdin JSON — matcher scoping alone cannot express it.
- **Prefer the native `apply_patch` name over the `Edit`/`Write` aliases.** `Write` and `Edit` are also literal *Claude Code* tool names, so an entry keyed on an alias reads ambiguously next to a Claude Code config and would match on both platforms if the two ever shared a file. `apply_patch` never collides, since Claude Code has no tool by that name — making it the unambiguous choice for a Codex-only entry.

`tool_input`'s exact shape for `apply_patch` isn't published as a field-level schema (Codex's own generated hook schemas type `tool_input` as "any JSON" — verified against `codex-rs/hooks/schema/generated/post-tool-use.command.input.schema.json`); a handler that needs to know which path a patch touched should match the raw stdin payload for the target path as a substring rather than assume a specific field name (e.g. `tool_input.path`) that isn't documented.

## Getting the `evolution-captured` notification on Codex (issue #461)

iEvo's zero-setup capture notification ships as a `hooks:` block in `evo/SKILL.md`'s and `agents/evolution.md`'s own YAML frontmatter — a **Claude Code** mechanism ([Hooks in skills and agents](https://code.claude.com/docs/en/hooks#hooks-in-skills-and-agents)). Codex never loads that block: hook config comes only from the layers in § "Config file location and scopes" above. This is a config-layer gap, not a matcher gap — adding an `apply_patch` matcher to the skill's frontmatter would not help, because the frontmatter itself is never read on Codex.

A Codex user (CLI or Desktop) gets the equivalent notification by putting the entry in a real Codex hooks layer — `<repo>/.codex/hooks.json` for this project only, or `~/.codex/hooks.json` globally:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "apply_patch",
        "hooks": [
          {
            "type": "command",
            "command": "sh -c 'input=$(cat); case \"$input\" in *\".ievo/hooks/evolution-captured\"*) echo \"iEvo: evolution overlay captured\" ;; esac'"
          }
        ]
      }
    ]
  }
}
```

The path check lives in the command body rather than the matcher, for the two reasons in § "`apply_patch` matcher aliases and matcher scope" above: Codex's `matcher` filters on tool name only (no path-scoped `if:` equivalent), and `apply_patch`'s `tool_input` has no published field-level schema, so the handler substring-matches the raw stdin payload for the signal path instead of guessing a field name. It exits `0` and prints nothing when the patch touched anything else, so it is a no-op outside the one write it exists for.

## Codex Desktop vs Codex CLI (issue #461)

Both are the same underlying Codex hook system — a Desktop session uses the identical `apply_patch`/`Edit`/`Write` matcher aliases and the identical event catalog above, so nothing in this reference is CLI-only. The one thing that differs is **client detection** upstream of hooks entirely: `$CODEX_CLI` is set in Codex CLI (terminal) sessions but is **not** set in Codex Desktop sessions (confirmed empirically, issue #461) — a skill that gates Claude-Code-vs-Codex behavior on `$CODEX_CLI` alone misdetects Codex Desktop as Claude Code. `init/SKILL.md` Step 1.5 is the canonical detection rule across this plugin: Codex if `$CODEX_CLI` is set, OR (when unset) a Codex Desktop signal is present — `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or (macOS only) `__CFBundleIdentifier=com.openai.codex`. Neither Desktop marker is part of Codex's public environment-variable reference — treat them as best-effort, not a guaranteed contract.

## Exit-code semantics

- `0` with JSON output — success; Codex applies the returned `hookSpecificOutput`/`decision` fields.
- `0` with no output — success; Codex continues.
- `2` — blocking decision; Codex reads the block reason from `stderr`.
- any other exit code or a timeout — hook failure; Codex fails open (continues as if no hook ran).

## Worked example

Project-scoped `<repo>/.codex/config.toml`, mirroring hooks-setup Step 5.5's "background agent complete" notification for Codex's own sub-agent dispatch:

```toml
[[hooks.SubagentStop]]
matcher = "*"

[[hooks.SubagentStop.hooks]]
type = "command"
command = "sh .ievo/hooks/scripts/codex-subagent-stop.sh"
timeout = 10
```

`.ievo/hooks/scripts/codex-subagent-stop.sh` — same shared-log-plus-bell pattern as the Claude Code Stop hook (Step 5.5), but fired once per subagent rather than once for the whole session: Codex has no session-wide "all subagents done" equivalent to Claude Code's `background_tasks`/`session_crons`-aware Stop hook.

```sh
#!/bin/sh
mkdir -p .ievo/log/hooks 2>/dev/null || true
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) codex-subagent-stop" >> .ievo/log/hooks/events.log
printf '\a'
exit 0
```

**Field names and the full event catalog verified against the Codex hooks docs on 2026-07-25** (catalog corrected per issue #432 — the previous "verified 2026-07-24" stamp sat on an under-counted catalog, so treat a verification stamp as covering only the claims it was checked against). Codex's hook config format has changed during rust-v0.13x's rapid iteration; re-check field names against current docs before relying on this table if your Codex CLI is materially older or newer than rust-v0.141.0.

**Not a hook: Codex's `TurnStartedEvent`.** A companion Codex delta researched alongside the sub-agent hooks above described `TurnStartedEvent` (which gained a `trace_id` field in [PR #23980](https://github.com/openai/codex/pull/23980), first shipped rust-v0.134.0) as part of the hook surface. Verified against current Codex docs, it is not: `TurnStartedEvent` is an **app-server protocol** event — the same programmatic/IDE-integration layer AGENTS.md's "Codex sub-agent delegation" section already distinguishes from the CLI's proactive sub-agent dispatch — used for distributed tracing across turn operations, not a lifecycle hook Codex fires a configured command against. Out of scope for this hooks-focused skill.

**Committed config, gitignored script — same mismatch as the Claude Code Stop hook.** As with `.cursor/hooks.json` (see the Cursor reference), a committed `config.toml`/`hooks.json` entry that shells out to a script under `.ievo/hooks/` references a path `/ievo:init` Step 10 gitignores — each teammate needs their own copy to activate the hook locally, and the failure mode is silent (Codex's exit-code contract above fails open on a missing/non-zero-exit command). Each teammate writes their own copy of the script once per clone to activate the hook locally.
