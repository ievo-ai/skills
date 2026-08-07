#!/bin/sh
# iEvo auto-evolution — correction-capture nudge (UserPromptSubmit).
# Fires on each user prompt WHEN auto-evolution mode is ON (.ievo/evo-auto.flag
# present). Injects a conservative self-assessment nudge as additionalContext so
# the agent can decide whether the user's message is a correction and, if so,
# record it VERBATIM via a Write-tool temp file + the accumulator's
# --text-file flag -- NEVER by embedding the raw correction text inside a
# Bash argument (a prior version did that with naive single-quoting, which an
# apostrophe or shell metacharacter in the correction could break out of --
# CWE-78, closed in #373). It does NOT classify scope or write overlays --
# analysis is deferred to the next SessionStart.
#
# Committed directly (skills#552 follow-up) -- this file IS the full logic,
# not a dispatcher to a gitignored companion. A plain `git clone` gets a
# working hook immediately, no per-clone /ievo:evo-auto-enable run required.
# The tradeoff this accepts: a PR to a project using this plugin can now
# edit this file's logic like any other committed code -- see evo-auto-enable/
# SKILL.md's Step 3.5 security note for the full rationale.
#
# CONTRACT: fail-silent (mode off / any error => emit nothing, exit 0),
# non-blocking, ASCII-only additionalContext (no double quotes). NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present (freshest, e.g. a post-
# install plugin bugfix); else the copy committed alongside this file --
# never a baked plugin-cache literal, which dies on the next plugin update.
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/evolution_candidates.mjs"

# session_id comes from the hook's stdin JSON. jq is a hard dependency of gh,
# which iEvo already requires; fall back to "unknown" if absent/unparseable.
sid=$(cat | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
case "$sid" in "") sid="unknown" ;; esac

msg="iEvo auto-evolution is ON. If the message you are about to answer is a genuine correction of your prior approach or output (the user telling you a rule or preference you got wrong -- e.g. 'no, we always X here', 'stop doing Y'), then AFTER you respond, record it as an evolution candidate WITHOUT ever putting its text inside a shell command: first use the Write tool (NOT Bash) to write the correction verbatim, one line, to .ievo/hooks/tmp/correction-pending.txt, then run this exact fixed command: node ${ACC} append --session ${sid} --text-file .ievo/hooks/tmp/correction-pending.txt. Never substitute the correction text itself into the command. Do NOT classify scope or write overlays now -- that happens at the next session's review. Capture ONLY genuine corrections; ignore routine questions, clarifications, and normal back-and-forth. If it was not a correction, do nothing and do not mention this."
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$msg"
exit 0
