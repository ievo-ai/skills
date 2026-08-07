# Branch-Aware Auto-Commit for `/ievo:evo` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/ievo:evo` auto-commit an overlay-file write to the current feature branch (never the default branch, never pushed) so a lesson capture never needs a dedicated PR, and make the failure path safe for headless/autonomous invocations.

**Architecture:** A new **Step 5.4** in `evo/SKILL.md`, inserted after Step 5 (Trigger value resolved — the overlay entry's content is final at that point) and before Step 5.5 (signal file). It resolves the current branch and the repo's default branch via git, then either commits the single overlay file with `git commit --only` (feature branch), does nothing (default branch / not a git repo), or — on a failed commit in a headless context — parks a new `Scope: autocommit-failed` entry in the existing `.ievo/evolution-candidates/pending.md` queue. `evo-auto-enable/SKILL.md`'s `evo-analysis-nudge.local.sh` template is extended to surface that new entry type at the next interactive session's start.

**Tech Stack:** POSIX shell / git CLI commands described as agent-executed prose (both target files are `SKILL.md` markdown instructions, not compiled code — there is no runtime for these skills beyond the LLM agent following them).

## Global Constraints

- Never `git add -A` / `git add .` — stage only the specific overlay file path.
- Always `git commit --only <path>`, never a bare `git commit` — verified empirically that a bare commit sweeps in any unrelated pre-staged content.
- Never `git push` — local commit only, always.
- Never `--no-verify` / skip hooks — a rejected commit is a real signal.
- Fail closed on default-branch detection: whenever default-branch status can't be positively ruled out, treat the current branch as default and skip auto-commit.
- No signing/co-author conventions imposed — plain `git commit`, the user's own git config applies as-is.
- The new step is **Step 5.4**, inserted after Step 5 and before Step 5.5 — never between Step 4 and Step 5 (Step 4 writes the `Trigger` field as a literal placeholder; Step 5 fills it in).
- The headless-failure path reuses existing mechanisms only: Step 2.5's no-interactive-session detection convention, the `.ievo/evolution-candidates/pending.md` queue, and `evo-analysis-nudge.local.sh`'s SessionStart nudge — no new files, no new scripts.
- Spec: `docs/specs/2026-08-07-evo-branch-aware-autocommit-design.md` (this branch, `docs/evo-branch-aware-autocommit-spec`) is the approved source of truth; every git command below was verified against a real scratch repo while writing that spec, not assumed.

---

### Task 1: Insert Step 5.4 into `evo/SKILL.md` + update Step 6's report

**Files:**
- Modify: `plugins/ievo/skills/evo/SKILL.md` (insert new section after line 463, "If unclear from the conversation, default to..."; modify Step 6's report block, lines 587–596)

**Interfaces:**
- Consumes: the overlay file path Step 4 already wrote (`.ievo/evolution/project.md` | `.ievo/evolution/agents/<name>.md` | `.ievo/evolution/skills/<name>.md`) and the short title used in that entry's `##` heading — both already exist in Step 4's output, nothing new to produce there.
- Produces: on a failed headless commit, a `pending.md` entry in the exact format:
  ```
  ## <ISO-8601 UTC> — session <session-id>
  - Scope: autocommit-failed
  - Overlay file: <overlay-file-path>
  - Branch: <branch-name>
  - Reason: <failure reason, truncated to one line>
  ```
  Task 2's `evo-analysis-nudge.local.sh` update greps for the literal line `- Scope: autocommit-failed` — the field name and value here must match that exactly (case-sensitive, no extra whitespace).

- [ ] **Step 1: Read the current file to confirm the exact insertion anchor is unchanged**

Run: `sed -n '458,466p' plugins/ievo/skills/evo/SKILL.md`

Expected output (verbatim — if this doesn't match, the file has drifted since this plan was written; re-locate the anchor before proceeding):
```
- `agent self-correction: platform-detection mismatch` — set by `/ievo:init`
  Step 12.5 / `/ievo:evo-auto-enable` Step 5.5 when a skill's own platform
  self-check catches its printed output mismatching the detected platform
- `curator pattern (from N projects)` (future)

If unclear from the conversation, default to `user-observed mistake` or `user-defined convention` based on lesson tone.

## Step 5.5: Signal file for lifecycle hooks
```

- [ ] **Step 2: Insert the new Step 5.4 section**

Use the Edit tool with this exact `old_string`/`new_string` pair:

`old_string`:
```
If unclear from the conversation, default to `user-observed mistake` or `user-defined convention` based on lesson tone.

## Step 5.5: Signal file for lifecycle hooks
```

`new_string`:
````
If unclear from the conversation, default to `user-observed mistake` or `user-defined convention` based on lesson tone.

## Step 5.4: Auto-commit on a feature branch

By this point Step 4 has appended the lesson to the overlay file and Step 5
has resolved and filled in its `Trigger` field — the overlay entry's
content is now final. This step decides whether to fold that file change
into a git commit on the current branch, so a lesson capture never needs
its own dedicated branch/PR. It runs **after** Step 5, not between Step 4
and Step 5: Step 4's template writes `**Trigger:** <placeholder>` literally,
and committing before Step 5 fills that in would commit the placeholder
text instead of the real value.

This step needs no session context beyond the overlay file path Step 4
wrote to and the repo's current git state — it runs identically whether
the lesson came from a live manual `/ievo:evo` call or from Step 0's
review of an earlier session's auto-captured candidate.

1. **Resolve the current branch:**
   ```
   git branch --show-current
   ```
   Two distinct "can't proceed" signals, verified against real git
   behavior — check for both:
   - Inside a git repo but in detached HEAD: exits **0** with **empty
     stdout**. Check the output, not the exit code.
   - Outside a git repo entirely: exits **128** with a
     `fatal: not a git repository` stderr message.

   Either signal → skip the rest of this step entirely. Fall through to
   today's behavior: the overlay file stays edited/uncommitted, and
   Step 6 reports it as such.

2. **Resolve the repo's default branch — never hardcode `main`:**
   ```
   git symbolic-ref refs/remotes/origin/HEAD
   ```
   Strip the `refs/remotes/origin/` prefix from the output (e.g.
   `refs/remotes/origin/main` → `main`). When this succeeds, its result
   is authoritative — compare it directly against the current branch in
   step 3.

   When it **fails** (no remote configured, or a detached remote HEAD —
   exits 128 with `fatal: ref refs/remotes/origin/HEAD is not a symbolic
   ref`), there is no way to positively confirm the current branch is a
   non-default feature branch. In that case, check whether the current
   branch name is one of the common default names: `main`, `master`,
   `trunk`, `develop`.
   - Name matches → treat it as the default branch (skip auto-commit,
     same as a confirmed match in step 3).
   - Name does **not** match → still treat it as the default branch and
     skip auto-commit. Nothing here positively rules out default-branch
     status, and the fail-closed rule below applies precisely because
     `symbolic-ref` gave no answer at all.

   **Fail closed:** whenever default-branch status can't be positively
   ruled out, skip auto-commit. A missed auto-commit costs the user one
   manual `git add`/`commit`; a wrong auto-commit on a protected branch
   is the exact failure this step exists to prevent.

3. **If the current branch equals the resolved (or assumed) default
   branch** → do NOT auto-commit. Fall through to today's behavior — this
   is the protected-`main` case a PR-only repo relies on; auto-committing
   here would recreate the exact pain this feature exists to remove, from
   the opposite direction.

4. **If the current branch is a confirmed non-default feature branch:**
   ```
   git add <overlay-file-path>
   git commit --only <overlay-file-path> -m "docs(evolution): <short title from Step 4>"
   ```
   Replace `<overlay-file-path>` with the exact path Step 4 wrote to
   (`.ievo/evolution/project.md`, `.ievo/evolution/agents/<name>.md`, or
   `.ievo/evolution/skills/<name>.md`) and `<short title from Step 4>`
   with the same short title used in that overlay entry's `##` heading.

   **`--only` is required, not optional.** Verified empirically: a bare
   `git commit` after `git add <path>` commits the entire index, not just
   the path just staged — if the user already had unrelated work staged
   (mid-rebase, or their own separate `git add`), a bare commit would
   silently sweep that into this docs-only commit too. `git commit --only
   <path>` commits exactly that path and leaves everything else in the
   index untouched.

   Local commit only — **never `git push`** (see Rules). Committing
   locally is cheap to inspect and trivially reversible
   (`git reset --soft HEAD~1`) if the result isn't wanted; pushing is a
   visible, external action that stays entirely the user's own call.

5. **If the commit fails** (pre-commit hook rejects it, or any other
   non-zero exit) — non-fatal. Do not retry. Do not add `--no-verify`
   (see Rules). `git commit` is atomic — a failed commit never partially
   commits, so the overlay file's content is never lost, only left
   uncommitted/staged. What happens next depends on whether a human can
   read the outcome right now:

   - **Interactive session** — do nothing further here; Step 6 reports
     the failure reason, and the user sees it immediately and can
     fix/retry themselves.
   - **Headless/autonomous invocation** — same no-interactive-session
     detection Step 2.5 already uses (a self-contained invocation prompt
     like an `/ievo:schedule` Routine's "You are running a scheduled iEvo
     operation," or any other headless/CI context where nothing reads
     output synchronously): **never block or retry.** Append a new entry
     to `.ievo/evolution-candidates/pending.md` (create the file with
     `evo-auto-enable/SKILL.md` Step 3's scaffold first if it doesn't
     exist yet) in this format:
     ```markdown

     ## <ISO-8601 UTC> — session <session-id>
     - Scope: autocommit-failed
     - Overlay file: <overlay-file-path>
     - Branch: <branch-name>
     - Reason: <failure reason, truncated to one line>
     ```
     `Scope: autocommit-failed` is a distinct value from the existing
     `ambiguous`/`user-level-only` scopes — this candidate isn't awaiting
     scope classification, it's already-classified content that just
     needs a manual commit. Continue the calling flow immediately after
     appending; do not wait for the entry to be reviewed.
     `evo-analysis-nudge.sh`'s SessionStart nudge (`evo-auto-enable`
     Step 3.5.3) is what surfaces this to a human, the next time an
     interactive session starts in this repo.

6. **Update what Step 6 reports** — see Step 6's revised template below;
   it now states the auto-commit outcome precisely instead of always
   pointing at a manual `git diff`.

## Step 5.5: Signal file for lifecycle hooks
````

- [ ] **Step 3: Update Step 6's report block**

Use the Edit tool with this exact `old_string`/`new_string` pair:

`old_string`:
```
Otherwise, output a short summary to the user:

- **Scope + target:** project | agents/<name> | skills/<name>
- **Overlay file:** path
- **Marker injected:** yes (first evolution for this target) | no (already present)
- **Section title added:** "<title>"
- **Upstream escalation:** not applicable (local lesson) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Reusable-practice escalation:** not applicable (Step 5.6 already offered, or lesson classified local) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Extraction offer:** not applicable (no cluster detected) | offered → handed off to `/ievo:consolidate` | offered → skipped
- **Next:** "Review with `git diff .ievo/evolution/<scope>/<name>.md` and commit if satisfied."
```

`new_string`:
```
Otherwise, output a short summary to the user:

- **Scope + target:** project | agents/<name> | skills/<name>
- **Overlay file:** path
- **Marker injected:** yes (first evolution for this target) | no (already present)
- **Section title added:** "<title>"
- **Auto-commit (Step 5.4):** committed locally to branch `<name>` (not pushed) | left uncommitted on branch `<name>` (default branch — commit it yourself, e.g. as part of a future PR on this branch) | left uncommitted (not a git repository) | attempted and failed: `<reason>` (interactive: fix and retry yourself; headless: recorded in `.ievo/evolution-candidates/pending.md` as `Scope: autocommit-failed`)
- **Upstream escalation:** not applicable (local lesson) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Reusable-practice escalation:** not applicable (Step 5.6 already offered, or lesson classified local) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Extraction offer:** not applicable (no cluster detected) | offered → handed off to `/ievo:consolidate` | offered → skipped
- **Next:** if Step 5.4 committed: `"Committed locally to branch <name> (not pushed) — push whenever you push the rest of your work on this branch."` else: `"Review with `git diff .ievo/evolution/<scope>/<name>.md` and commit if satisfied."`
```

- [ ] **Step 4: Verify the file still parses as valid markdown and the anchor step count is sane**

Run: `grep -c '^## Step' plugins/ievo/skills/evo/SKILL.md`
Expected: **14** — the file has 13 `## Step` headings today (Step 0, 1, 1.5, 2, 2.5, 3, 4, 5, 5.5, 5.6, 5.65, 5.7, 6), one more than that after this task's insertion.

Run: `grep -n '^## Step 5' plugins/ievo/skills/evo/SKILL.md`
Expected: **6** lines, in this exact order — `## Step 5:`, `## Step 5.4:`, `## Step 5.5:`, `## Step 5.6:`, `## Step 5.65:`, `## Step 5.7:`. The point of this check is ordering (5.4 sits between 5 and 5.5, not before 5 or after 5.5) as much as the count.

- [ ] **Step 5: Commit**

```bash
git add plugins/ievo/skills/evo/SKILL.md
git commit -m "feat: auto-commit /ievo:evo overlay writes on a feature branch (skills#552)"
```

---

### Task 2: Update `evo-auto-enable/SKILL.md` for the `autocommit-failed` entry type

**Files:**
- Modify: `plugins/ievo/skills/evo-auto-enable/SKILL.md` (Step 3's `pending.md` scaffold; Step 3.5.3's `evo-analysis-nudge.local.sh` template)

**Interfaces:**
- Consumes: the exact `pending.md` entry format Task 1 produces (`- Scope: autocommit-failed`, verbatim, one entry per failure).
- Produces: an `evo-analysis-nudge.local.sh` that greps `pending.md` for that literal line and, if found, appends a fixed-text note to its `additionalContext` message — no new script, no new file, this is an edit to an existing embedded template.

- [ ] **Step 1: Update the `pending.md` scaffold in Step 3**

Use the Edit tool with this exact `old_string`/`new_string` pair (the scaffold is the fenced block inside Step 3 — match on its last four lines plus the closing fence, which is unique in the file):

`old_string`:
```
Retention: candidates from the last 10 sessions are kept; older per-session
candidate files are cleaned up (suggest cleanup, never delete without asking).

Each parked candidate is appended below as:

## <ISO-8601 UTC> — session <session-id>
- Scope: ambiguous | user-level-only
- Correction: <verbatim user correction / lesson text>
```
```

`new_string`:
```
Retention: candidates from the last 10 sessions are kept; older per-session
candidate files are cleaned up (suggest cleanup, never delete without asking).

Each parked candidate is appended below as one of two kinds:

Awaiting scope classification (from earlier auto-capture, reviewed via
`/ievo:evo`'s Step 0):

## <ISO-8601 UTC> — session <session-id>
- Scope: ambiguous | user-level-only
- Correction: <verbatim user correction / lesson text>

Already captured, only the commit failed (`evo/SKILL.md` Step 5.4's
headless-invocation fallback — the overlay entry was already written
successfully; this just needs a manual `git add` + `git commit --only`
on the noted file, never re-run through Step 0/1 classification):

## <ISO-8601 UTC> — session <session-id>
- Scope: autocommit-failed
- Overlay file: <path>
- Branch: <branch-name>
- Reason: <failure reason>
```
```

- [ ] **Step 2: Update the `evo-analysis-nudge.local.sh` template in Step 3.5.3**

Use the Edit tool with this exact `old_string`/`new_string` pair:

`old_string`:
```
n=$(node "$ACC" count 2>/dev/null || echo 0)
case "$n" in ""|*[!0-9]*) exit 0 ;; esac
[ "$n" -gt 0 ] || exit 0

msg="iEvo auto-evolution: ${n} evolution candidate(s) captured in earlier sessions are pending review. Offer to run /ievo:evo to fold them in -- for each candidate apply Step 1 scope classification: auto-write ONLY unambiguous project-wide lessons to .ievo/evolution/project.md; park anything ambiguous or user-level in .ievo/evolution-candidates/pending.md for manual review. Never write agent/skill or user-level overlays silently. Candidates with scope=tool-failure are captured mechanical tool signals (tool failures/denials on Claude Code, approval requests on Codex), not corrections -- apply a signal-then-fixed-vs-noise judgment before folding one in: a signal later resolved toward the same goal is learnable, a signal inside normal iteration is noise. Remove each candidate from its session file as you consume it."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
```

`new_string`:
```
n=$(node "$ACC" count 2>/dev/null || echo 0)
case "$n" in ""|*[!0-9]*) n=0 ;; esac

# Separately check pending.md for autocommit-failed entries (evo/SKILL.md
# Step 5.4's headless-invocation fallback) -- these are already-classified
# overlay writes whose commit failed, not candidates awaiting scope
# classification, so the accumulator's own count above never sees them.
PENDING=".ievo/evolution-candidates/pending.md"
autocommit_note=""
if [ -f "$PENDING" ] && grep -q '^- Scope: autocommit-failed$' "$PENDING" 2>/dev/null; then
  autocommit_note=" Some entries in .ievo/evolution-candidates/pending.md are Scope: autocommit-failed -- a previous run captured a lesson successfully (the overlay entry is already written) but its auto-commit failed; review the entry for the file/branch/reason and commit it manually, do NOT re-run it through Step 0/1 classification."
fi

[ "$n" -gt 0 ] || [ -n "$autocommit_note" ] || exit 0

msg="iEvo auto-evolution: ${n} evolution candidate(s) captured in earlier sessions are pending review. Offer to run /ievo:evo to fold them in -- for each candidate apply Step 1 scope classification: auto-write ONLY unambiguous project-wide lessons to .ievo/evolution/project.md; park anything ambiguous or user-level in .ievo/evolution-candidates/pending.md for manual review. Never write agent/skill or user-level overlays silently. Candidates with scope=tool-failure are captured mechanical tool signals (tool failures/denials on Claude Code, approval requests on Codex), not corrections -- apply a signal-then-fixed-vs-noise judgment before folding one in: a signal later resolved toward the same goal is learnable, a signal inside normal iteration is noise. Remove each candidate from its session file as you consume it.${autocommit_note}"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
```

Note the `case` branch changed from `exit 0` to `n=0`: a non-numeric accumulator count must no longer suppress the independent `autocommit_note` check — the two signals are unrelated and must not short-circuit each other.

- [ ] **Step 3: Verify the diff only touched the two intended blocks**

Run: `git diff plugins/ievo/skills/evo-auto-enable/SKILL.md`
Expected: two hunks — the `pending.md` scaffold in Step 3, and the script body in Step 3.5.3. No other lines changed.

- [ ] **Step 4: Commit**

```bash
git add plugins/ievo/skills/evo-auto-enable/SKILL.md
git commit -m "feat: surface autocommit-failed entries in the SessionStart nudge (skills#552)"
```

---

### Task 3: Dry-run validation across all four scenarios in a scratch repo

**Files:**
- Create (scratch, not committed to the plugin repo): a disposable git repo under the session scratchpad directory, deleted at the end of this task.

**Interfaces:**
- Consumes: Task 1's Step 5.4 prose and Task 2's nudge-script prose, executed by hand exactly as written (not paraphrased) to catch any place the written instructions are ambiguous or wrong when followed literally.
- Produces: nothing persisted — this is a verification task. If any scenario doesn't behave as designed, fix the SKILL.md prose in Task 1/2 (re-open those tasks) before proceeding to Task 4.

- [ ] **Step 1: Set up the scratch repo**

```bash
SCRATCH="$(mktemp -d)"
cd "$SCRATCH"
git init --quiet
git -c user.email=t@t.com -c user.name=t commit --allow-empty -q -m init
mkdir -p .ievo/evolution
echo "# Project — Evolution Overlay" > .ievo/evolution/project.md
git add .ievo/evolution/project.md
git commit --only .ievo/evolution/project.md -q -m "chore: seed overlay"
git checkout -b main --quiet 2>/dev/null || git branch -m main
```

Expected: a repo on branch `main` with a seeded `.ievo/evolution/project.md`, no remote configured (this is the "symbolic-ref fails, fall back to common-default-name check" path — `main` is in the common-default set, so this still correctly resolves to "treat as default").

- [ ] **Step 2: Scenario A — feature branch, commit succeeds**

```bash
git checkout -b feature/test-a --quiet
printf '\n## test entry A\n**Trigger:** test\n\ntest lesson A\n' >> .ievo/evolution/project.md
git add .ievo/evolution/project.md
git commit --only .ievo/evolution/project.md -m "docs(evolution): test entry A"
echo "exit: $?"
git log --oneline -1
git status --short
```

Expected: exit 0, `git log` shows the new commit, `git status --short` is empty (nothing left uncommitted). This confirms the Task 1 Step 4 command sequence works as written when followed literally.

- [ ] **Step 3: Scenario B — default branch, no commit attempted**

```bash
git checkout main --quiet
printf '\n## test entry B\n**Trigger:** test\n\ntest lesson B\n' >> .ievo/evolution/project.md
git symbolic-ref refs/remotes/origin/HEAD 2>&1; echo "symbolic-ref exit: $?"
git branch --show-current
```

Expected: `symbolic-ref` fails (no remote — exit 128), current branch is `main`, which is in the common-default set → per Task 1 Step 2's logic, treat as default → skip auto-commit. Confirm manually: `git status --short` should show `.ievo/evolution/project.md` as modified, uncommitted — this is the correct, intended outcome (do NOT run `git commit` in this scenario; the point is confirming the *branch that would trigger the skip*, not exercising a commit).

- [ ] **Step 4: Scenario C — pre-commit hook rejects, interactive**

```bash
git checkout -b feature/test-c --quiet
mkdir -p .git/hooks
printf '#!/bin/sh\necho "rejecting" >&2\nexit 1\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
printf '\n## test entry C\n**Trigger:** test\n\ntest lesson C\n' >> .ievo/evolution/project.md
git add .ievo/evolution/project.md
git commit --only .ievo/evolution/project.md -m "docs(evolution): test entry C"
echo "exit: $?"
git log --oneline -1
git status --short
```

Expected: non-zero exit, hook's stderr visible, `git log` still shows only the previous commits (nothing partially committed), `git status --short` shows the overlay file still staged/modified. Per Task 1 Step 5, an interactive session reports this in Step 6 and stops — no pending.md entry in this scenario.

- [ ] **Step 5: Scenario D — pre-commit hook rejects, headless: pending.md entry + nudge**

```bash
mkdir -p .ievo/evolution-candidates
cat > .ievo/evolution-candidates/pending.md << 'EOF'
# Evolution candidates — pending review

Corrections captured while auto-evolution mode is ON, awaiting review via
`/ievo:evo`.
EOF
cat >> .ievo/evolution-candidates/pending.md << 'EOF'

## 2026-08-07T12:00:00Z — session scratch-test
- Scope: autocommit-failed
- Overlay file: .ievo/evolution/project.md
- Branch: feature/test-c
- Reason: pre-commit hook rejected (exit 1)
EOF
grep -q '^- Scope: autocommit-failed$' .ievo/evolution-candidates/pending.md && echo "grep: FOUND (nudge would fire)" || echo "grep: NOT FOUND (bug)"
```

Expected: `grep: FOUND (nudge would fire)` — this is the exact `grep` pattern Task 2 Step 2 uses in `evo-analysis-nudge.local.sh`; running it here directly against the entry format Task 1 produces confirms the two tasks' interface (the exact `pending.md` line format) actually matches byte-for-byte.

- [ ] **Step 6: Clean up**

```bash
cd /
rm -rf "$SCRATCH"
```

- [ ] **Step 7: Commit (no-op if Steps 1–6 produced no tracked changes — this step exists only if a scenario above required fixing Task 1/2's prose)**

If any scenario above failed and required a fix to `plugins/ievo/skills/evo/SKILL.md` or `plugins/ievo/skills/evo-auto-enable/SKILL.md`, commit that fix now:

```bash
git add plugins/ievo/skills/evo/SKILL.md plugins/ievo/skills/evo-auto-enable/SKILL.md
git commit -m "fix: correct Step 5.4 / nudge prose found during dry-run validation"
```

---

### Task 4: Self-review both files + final consistency pass

**Files:**
- Read: `plugins/ievo/skills/evo/SKILL.md`, `plugins/ievo/skills/evo-auto-enable/SKILL.md`

**Interfaces:**
- Consumes: the final state of both files after Tasks 1–3.
- Produces: nothing new — this is a review pass. Fix inline if issues are found; no need to re-review after fixing (per the brainstorming/writing-plans self-review convention).

- [ ] **Step 1: Placeholder scan**

```bash
grep -n 'TBD\|TODO\|<owner>/<repo>' plugins/ievo/skills/evo/SKILL.md | grep -A0 -B0 'Step 5.4'
```

Expected: no output (the new Step 5.4 section introduces no placeholders — every `<...>` in it is a documented substitution the agent fills from Step 4's already-known values, not an unfinished spot).

- [ ] **Step 2: Cross-reference consistency**

Confirm every place that now mentions `autocommit-failed` uses the identical field names (`Scope`, `Overlay file`, `Branch`, `Reason`) in the identical order, across all three locations:

```bash
grep -A4 'Scope: autocommit-failed' plugins/ievo/skills/evo/SKILL.md
grep -A4 'Scope: autocommit-failed' plugins/ievo/skills/evo-auto-enable/SKILL.md
```

Expected: both show the same four-field block (`Scope`, `Overlay file`, `Branch`, `Reason`) in the same order. A mismatch here (e.g. `Overlay file:` vs `Overlay:`) is exactly the "type consistency" class of bug this self-review step exists to catch — fix inline if found.

- [ ] **Step 3: Confirm `See also` cross-references still make sense**

`evo/SKILL.md`'s `## See also` section (near the end of the file) references `evo-auto-enable/SKILL.md` for the Step 0 backlog-review relationship. Read that section and confirm it doesn't need a new bullet for Step 5.4 — Step 5.4 is purely mechanical (git commit), not a hand-off to another skill like Steps 5.6/5.7 are, so no new cross-reference entry is expected. If in doubt, add one sentence noting Step 5.4's existence there for discoverability.

- [ ] **Step 4: Final status check and commit if anything changed during self-review**

```bash
git status --short
```

If clean, this task is done with no new commit (Tasks 1–2 already committed their own changes). If Step 2 or 3 above required an edit, commit it:

```bash
git add plugins/ievo/skills/evo/SKILL.md plugins/ievo/skills/evo-auto-enable/SKILL.md
git commit -m "docs: fix cross-reference/consistency issue found in self-review"
```
