#!/bin/sh
# iEvo auto-evolution — tool-failure capture (PostToolUseFailure / PermissionDenied).
# Fires whenever a tool call fails or is denied. Purely mechanical -- no agent
# judgment needed, so (unlike correction-capture.sh) this script does the whole
# capture itself: extract the failure/denial from the hook's stdin JSON, build a
# compact one-line {event,tool,outcome,detail} record, pipe it through scrub.mjs,
# then append it via the accumulator's --scope tool-failure. Deliberately emits
# NO stdout -- there is nothing actionable for the agent mid-failure; analysis is
# deferred to the next SessionStart nudge same as corrections.
#
# Committed directly (skills#552 follow-up) -- this file IS the full logic,
# not a dispatcher to a gitignored companion. A plain `git clone` gets a
# working hook immediately, no per-clone /ievo:evo-auto-enable run required.
# The tradeoff this accepts: a PR to a project using this plugin can now edit
# this file's logic (including the scrub.mjs call it depends on -- also now
# committed alongside it, not gitignored) like any other committed code --
# see evo-auto-enable/SKILL.md's Step 3.5 security note for the full rationale.
#
# CONTRACT: fail-silent (mode off / signal not opted in / any error => exit 0,
# no output), non-blocking, fail-CLOSED for content -- a scrub failure or a
# missing scrub.mjs drops the record; a raw/unscrubbed record must NEVER reach
# disk, even transiently. NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0
grep -q '^signal: corrections+failures$' .ievo/evo-auto.flag || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present (freshest, e.g. a post-
# install plugin bugfix); else the copies committed alongside this file --
# never a baked plugin-cache literal, which dies on the next plugin update.
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/evolution_candidates.mjs"
SCRUB="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/scrub.mjs}"
[ -n "$SCRUB" ] && [ -f "$SCRUB" ] || SCRUB=".ievo/hooks/scripts/scrub.mjs"
[ -f "$ACC" ] && [ -f "$SCRUB" ] || exit 0

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
case "$sid" in "") sid="unknown" ;; esac
event=$(printf '%s' "$input" | jq -r '.hook_event_name // "unknown"' 2>/dev/null || echo unknown)

case "$event" in
  PostToolUseFailure) outcome=failed ;;
  PermissionDenied) outcome=denied ;;
  # Codex wiring (Step 3.6's .codex/hooks.json entry) -- fires when a tool call
  # needs approval, BEFORE the allow/deny decision, so the honest outcome is
  # "requested", never "failed"/"denied". Unreachable on Claude Code (this
  # script is only wired under PostToolUseFailure/PermissionDenied there).
  PermissionRequest) outcome=requested ;;
  *) exit 0 ;;
esac

# The Claude Code hooks reference (code.claude.com/docs/en/hooks) documents
# PostToolUseFailure's error payload as tool_error; some empirical probes have
# reported a top-level `error` string instead. Try tool_error first (doc-
# confirmed), then error, then reason, so a naming discrepancy across Claude
# Code versions doesn't silently drop the signal -- none of the three are
# documented for PermissionDenied, so detail there falls back to tool_input
# alone (same for Codex's PermissionRequest: no error field exists pre-decision;
# its stdin payload carries tool_name/tool_input). jq -c keeps the whole record
# to a single line.
record=$(printf '%s' "$input" | jq -c --arg outcome "$outcome" '{event: .hook_event_name, tool: (.tool_name // "unknown"), outcome: $outcome, detail: {error: (.tool_error // .error // .reason // null), tool_input}}' 2>/dev/null)
[ -n "$record" ] || exit 0

scrubbed=$(printf '%s' "$record" | node "$SCRUB" 2>/dev/null)
[ -n "$scrubbed" ] || exit 0

mkdir -p .ievo/hooks/tmp
tmp=.ievo/hooks/tmp/failure-pending.txt
printf '%s' "$scrubbed" > "$tmp" 2>/dev/null || exit 0

node "$ACC" append --session "$sid" --text-file "$tmp" --scope tool-failure >/dev/null 2>&1 || true
exit 0
