---
name: evo-auto-enable
description: "Enable auto-evolution mode for this project — iEvo accumulates \"corrections from the user\" as evolution candidates during a session and surfaces them for review via /ievo:evolution, without the user having to invoke evolution explicitly. Sets the project-local flag `.ievo/evo-auto.flag` and prepares the pending-candidate queue at `.ievo/evolution-candidates/`. Auto-mode writes ONLY unambiguous project-wide overlays; ambiguous or user-level matches are parked for manual review, never written silently. Trigger words — \"turn on auto evolution\", \"auto-evolve\", \"capture lessons automatically\", \"evo auto on\", \"evolve without asking\"."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Flag + queue are project-local (`.ievo/evo-auto.flag`, `.ievo/evolution-candidates/`). Requires write access to `.ievo/`, POSIX shell (bash/zsh) or the Write tool. Paired with `/ievo:evo-auto-disable`. The correction-capture hook and periodic-analysis nudge that populate and drain the queue ship as a follow-up; this skill establishes the flag and queue they read."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evo Auto Enable — turn on auto-evolution mode

Switches on **auto-evolution mode** for this project: iEvo watches for
**corrections from the user** during a session and accumulates them as evolution
candidates, so lessons get captured without the user explicitly running
`/ievo:evolution`. The mode is a project-local setting (lives in
`.ievo/evo-auto.flag`), so it survives sessions and — if committed — is shared
with teammates in the same repo, exactly like `/ievo:debug-on`'s flag.

Enabled here, disabled with `/ievo:evo-auto-disable`.

## Scope of this mode (read before enabling)

Auto-evolution is deliberately conservative — it never guesses at a silent write:

- **Signal (v1):** only **corrections from the user** — semantic, agent-judged
  ("actually, do X not Y"; "no, we always Z here"). Mechanical signals
  (non-zero exits, test failures) are intentionally out of scope for now.
- **Auto-write is project-wide only.** A candidate is written to the overlay
  automatically **only** when its scope is unambiguously **project-wide**
  (`.ievo/evolution/project.md` — see `/ievo:evolution` Step 1).
- **Everything else is parked, never silently written.** When scope is ambiguous
  or the target matches a **user-level-only** agent/skill, the candidate is
  appended to the **pending queue** (`.ievo/evolution-candidates/pending.md`) for
  manual review through the normal `/ievo:evolution` flow. Auto-mode never asks
  mid-session and never writes an agent/skill overlay silently.

## When to use

- User says "turn on auto evolution", "auto-evolve", "capture lessons automatically",
  "evolve without asking", "evo auto on"
- User wants corrections they make during a session to be remembered without
  stopping to run `/ievo:evolution` each time
- A project where the same corrections keep recurring and should accumulate

## Steps

### 1. Verify `.ievo/` exists

If the `.ievo/` directory is absent → init hasn't been run in this project. Tell
the user:

```
iEvo not initialized in this project. Run /ievo:init first.
Auto-evolution builds on the same overlay model — nothing to evolve yet.
```

Exit.

### 2. Write the flag file

Use the Write tool (NOT Bash) to create `<project>/.ievo/evo-auto.flag` with YAML
content (mirrors `.ievo/debug.flag`'s shape):

```
enabled: true
enabled_at: <ISO-8601 UTC timestamp>
enabled_by: <user identifier if known, else "user-invocation">
signal: corrections-only
auto_write_scope: project-wide-only
```

The file format is YAML for easy human reading. Presence of the file = mode
enabled; the correction-capture hook and the periodic-analysis nudge read it to
decide whether to accumulate and surface candidates.

### 3. Prepare the pending-candidate queue

Ensure `<project>/.ievo/evolution-candidates/` exists. If
`<project>/.ievo/evolution-candidates/pending.md` is absent, use the Write tool to
create it with this scaffold (do NOT overwrite an existing queue — it may already
hold parked candidates):

```
# Evolution candidates — pending review

Corrections captured while auto-evolution mode is ON, awaiting review via
`/ievo:evolution`. Auto-mode writes unambiguous project-wide lessons to the
overlay directly; anything ambiguous or user-level-only is parked HERE instead of
being written silently. Review with `/ievo:evolution`, then remove the entries
you have folded into an overlay.

Retention: candidates from the last 10 sessions are kept; older per-session
candidate files are cleaned up (suggest cleanup, never delete without asking).

Each parked candidate is appended below as:

## <ISO-8601 UTC> — session <session-id>
- Scope: ambiguous | user-level-only
- Correction: <verbatim user correction / lesson text>
```

### 4. Offer to gitignore the candidate queue

Captured candidates can contain verbatim conversation snippets. On first enable in
a project, ask via `AskUserQuestion` whether to append `.ievo/evolution-candidates/`
to `.gitignore` (default: yes — keep pre-review candidates local). The flag itself
(`.ievo/evo-auto.flag`, intent only) is fine to commit so teammates share the
setting; reviewed lessons land in the committed `.ievo/evolution/` overlays after
`/ievo:evolution`.

### 5. Confirm to user

Print:

```
🧬 iEvo auto-evolution mode ENABLED

Flag: .ievo/evo-auto.flag (commit to share the setting with teammates)
Pending queue: .ievo/evolution-candidates/pending.md

From now on, corrections you make during a session are captured as evolution
candidates. Unambiguous project-wide lessons are written to the overlay
automatically; ambiguous or user-level ones are parked in the pending queue for
review via /ievo:evolution — never written silently.

Review parked candidates any time: /ievo:evolution
Turn off: /ievo:evo-auto-disable
```

## What auto-evolution mode does while `evo-auto.flag` exists

This is the contract the correction-capture hook and periodic-analysis nudge honor
(the same way other iEvo skills honor `debug.flag`). Components that participate in
auto-evolution MUST:

1. **Accumulate, don't reason at teardown.** A session-teardown signal only
   *appends* candidate corrections to the per-session accumulator under
   `.ievo/evolution-candidates/` — no LLM analysis at session end.
2. **Analyze at the next session, with fresh context.** A `SessionStart` nudge
   ("N evolution candidates pending — review?") surfaces the backlog and folds
   review into `/ievo:evolution`'s existing Step 1 scope classification — the same
   nudge pattern `/ievo:hooks-setup`'s version-check uses.
3. **Write project-wide only; park the rest.** Only an unambiguously project-wide
   candidate may be written to `.ievo/evolution/project.md` automatically. Ambiguous
   or user-level-only candidates go to `pending.md` for manual review. Silent
   overlay writes stay forbidden for anything but the unambiguous project-wide case.
4. **Consume on write, cap retention.** A candidate folded into an overlay is
   removed from the queue; keep the last 10 sessions of candidates and suggest
   cleanup beyond that.

## Rules

- **Idempotent:** if auto-mode is already on, just refresh `enabled_at` and confirm.
  Never clobber an existing `pending.md`.
- **Never write silently outside project-wide scope:** ambiguity is parked, not
  guessed. This preserves `/ievo:evolution`'s human-in-the-loop reconciliation for
  agent/skill and user-level targets.
- **Corrections only (v1):** do not treat routine back-and-forth as a correction;
  when unsure whether a turn was a correction, do not capture it (a false capture
  pollutes the pending queue). Mechanical signals are out of scope until a later
  iteration.
- **Project-local:** the setting lives in `.ievo/`, not user config, so it is
  per-project and survives sessions.

## See also

- `/ievo:evo-auto-disable` — turn auto-evolution mode off (preserves the queue)
- `/ievo:evolution` — review parked candidates / capture a lesson manually
- `/ievo:debug-on` / `/ievo:debug-off` — the paired-toggle + project-local-flag
  pattern this skill follows
- `.ievo/evolution-candidates/pending.md` — where parked candidates accumulate
