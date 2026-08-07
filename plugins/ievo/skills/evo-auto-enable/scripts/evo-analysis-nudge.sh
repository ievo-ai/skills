#!/bin/sh
# iEvo auto-evolution — SessionStart analysis nudge.
# On a NEW session, when auto-evolution is ON, prune to the last 10 sessions and,
# if any candidates are pending, nudge the agent to review them via
# /ievo:evo. No LLM work happens here -- this only counts + surfaces.
#
# Committed directly (skills#552 follow-up) -- this file IS the full logic,
# not a dispatcher to a gitignored companion. A plain `git clone` gets a
# working hook immediately IF the gitignore reconciliation in evo-auto-enable
# Step 3.5.1 actually widened the negation to all five filenames -- but that
# is a prose-protocol step an LLM interprets, not compiled code, and Step
# 3.5.1's own install-time verification only runs once, at enable time. A
# stale/partial negation (an old three-filename block never upgraded, a
# manual .gitignore edit) can leave evolution_candidates.mjs/scrub.mjs
# gitignored while the three .sh files land committed -- capture then goes
# silently dead on any later clone, with nothing surfacing it, which is
# exactly the class of bug #551 exists to catch. So the file-presence check
# stays here too, every session, not just at enable time -- narrowed from
# the pre-#552 version (no separate fallback-copy subdirectory, no split
# between a dispatcher and its real-logic counterpart -- just a flat
# presence check on all five installed files).
#
# CONTRACT: fail-silent, context-only (SessionStart cannot block startup),
# ASCII-only additionalContext. NO `set -e`.

[ -f .ievo/evo-auto.flag ] || exit 0

# Prefer a runtime CLAUDE_PLUGIN_ROOT if present (freshest, e.g. a post-
# install plugin bugfix); else the copy committed alongside this file --
# never a baked plugin-cache literal, which dies on the next plugin update.
ACC="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/evolution_candidates.mjs}"
[ -n "$ACC" ] && [ -f "$ACC" ] || ACC=".ievo/hooks/scripts/evolution_candidates.mjs"

# Retention: keep the last 10 sessions of candidates (best-effort).
node "$ACC" prune --keep 10 >/dev/null 2>&1 || true

# A missing/broken accumulator must not silently swallow the whole nudge the
# way a bare early `exit 0` on a parse failure previously did -- fall back to
# 0 pending candidates and let the wiring check run regardless.
n=$(node "$ACC" count 2>/dev/null || echo 0)
case "$n" in ""|*[!0-9]*) n=0 ;; esac

# Wiring-integrity check -- same platform-detection rule as /ievo:init Step
# 1.5 (ordered, first match wins): $CLAUDECODE set with $CODEX_CLI unset ->
# Claude Code; else $CODEX_CLI set -> Codex; else a Codex Desktop signal
# (CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop, or macOS
# __CFBundleIdentifier=com.openai.codex) -> Codex; else Claude Code. This
# script's content is identical on both platforms (only the wiring differs),
# so it self-detects which config file its own session should have wired.
if [ -n "$CLAUDECODE" ] && [ -z "$CODEX_CLI" ]; then
  HOOKS_FILE=.claude/settings.json
elif [ -n "$CODEX_CLI" ]; then
  HOOKS_FILE=.codex/hooks.json
elif [ "$CODEX_INTERNAL_ORIGINATOR_OVERRIDE" = "Codex Desktop" ] || [ "$__CFBundleIdentifier" = "com.openai.codex" ]; then
  HOOKS_FILE=.codex/hooks.json
else
  HOOKS_FILE=.claude/settings.json
fi

missing=""
note_missing() {
  [ -z "$missing" ] && missing="$1" || missing="$missing, $1"
}
# Flat file-presence check on all five installed files. Deliberately checks
# all five, not just the two .mjs dependencies: a partial/corrupted install
# (a manual delete, a bad merge) is just as real a drift case as a stale
# gitignore, and this is cheap (five stat calls).
for f in correction-capture.sh evo-analysis-nudge.sh failure-capture.sh evolution_candidates.mjs scrub.mjs; do
  [ -f ".ievo/hooks/scripts/$f" ] || note_missing "$f"
done

# Presence-based, not event-placement-based: this confirms the path string
# is wired SOMEWHERE in the file, not that it sits under the correct event
# key (UserPromptSubmit/SessionStart/PostToolUseFailure+PermissionDenied on
# Claude Code; the Codex equivalents) -- a manual edit that moved an entry to
# the wrong event would still read as "wired" here. -qF (fixed-string, not
# regex) since these are literal paths, not patterns.
if [ -f "$HOOKS_FILE" ]; then
  grep -qF '.ievo/hooks/scripts/correction-capture.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "correction-capture hook entry in $HOOKS_FILE"
  grep -qF '.ievo/hooks/scripts/evo-analysis-nudge.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "evo-analysis-nudge hook entry in $HOOKS_FILE"
  grep -qF '.ievo/hooks/scripts/failure-capture.sh' "$HOOKS_FILE" 2>/dev/null || note_missing "failure-capture hook entry in $HOOKS_FILE"
else
  note_missing "$HOOKS_FILE itself (no hook config file at all)"
fi

# Separately check pending.md for autocommit-failed entries (evo/SKILL.md
# Step 5.4's headless-invocation fallback) -- these are already-classified
# overlay writes whose commit failed, not candidates awaiting scope
# classification, so the accumulator's own count above never sees them.
PENDING=".ievo/evolution-candidates/pending.md"
autocommit_note=""
if [ -f "$PENDING" ] && grep -q '^- Scope: autocommit-failed$' "$PENDING" 2>/dev/null; then
  autocommit_note=" Some entries in .ievo/evolution-candidates/pending.md are Scope: autocommit-failed -- a previous run captured a lesson successfully (the overlay entry is already written) but its auto-commit failed; review the entry for the file/branch/reason and commit it manually, do NOT re-run it through Step 0/1 classification. Delete the entry from pending.md once you have committed the file manually."
fi

[ "$n" -gt 0 ] || [ -n "$missing" ] || [ -n "$autocommit_note" ] || exit 0

if [ -n "$missing" ]; then
  # Deliberately hedged: this list covers partial drift too (one missing hook
  # entry still leaves the other capture paths working), so it must not claim
  # capture has stopped outright.
  drift_msg="iEvo auto-evolution: .ievo/evo-auto.flag is ON but the hook wiring is missing or incomplete (drift detected) -- ${missing}. Capture may be partly or entirely inactive. Re-run /ievo:evo-auto-enable to repair -- it is idempotent and safe to re-run on top of a partial install."
fi

if [ -n "$missing" ] && [ "$n" -gt 0 ]; then
  msg="${drift_msg} Separately, ${n} evolution candidate(s) captured in earlier sessions are still pending review -- offer /ievo:evo for those too once wiring is repaired."
elif [ -n "$missing" ]; then
  msg="$drift_msg"
elif [ "$n" -gt 0 ]; then
  msg="iEvo auto-evolution: ${n} evolution candidate(s) captured in earlier sessions are pending review. Offer to run /ievo:evo to fold them in -- for each candidate apply Step 1 scope classification: auto-write ONLY unambiguous project-wide lessons to .ievo/evolution/project.md; park anything ambiguous or user-level in .ievo/evolution-candidates/pending.md for manual review. Never write agent/skill or user-level overlays silently. Candidates with scope=tool-failure are captured mechanical tool signals (tool failures/denials on Claude Code, approval requests on Codex), not corrections -- apply a signal-then-fixed-vs-noise judgment before folding one in: a signal later resolved toward the same goal is learnable, a signal inside normal iteration is noise. Remove each candidate from its session file as you consume it."
else
  msg="iEvo auto-evolution:"
fi

msg="${msg}${autocommit_note}"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
