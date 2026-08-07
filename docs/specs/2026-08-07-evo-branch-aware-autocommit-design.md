# Design: branch-aware auto-commit for `/ievo:evo` overlay writes

- **Date:** 2026-08-07
- **Status:** approved (design), pending implementation
- **Relates to:** [skills#552](https://github.com/ievo-ai/skills/issues/552) — sub-project 1 of 3

## Context

skills#552 was filed as a single proposal ("replace overlay-file writes with
GitHub issues, consolidated later") to fix a real pain: a repo with a
PR-only `main` needed 6+ separate PRs in under an hour for small, doc-only
`/ievo:evo` overlay appends. Discussion (godfather session, 2026-08-07)
found the original framing conflated three independent pains with three
independent fixes:

1. **You're already working on a branch with a PR** — the overlay write
   should ride that same PR, never spawn a dedicated one. *(this doc)*
2. **You're not currently on any active branch** — you want a cheap,
   PR-free way to record a lesson (the original skills#552 ask: file a
   `gh issue`, consolidate later). *(separate sub-project, not built here)*
3. **You're in a submodule and the lesson is about the umbrella repo, not
   this one** — you need to hand it off cross-repo without touching the
   umbrella repo yourself (generalizing `/ievo:feedback`'s hardcoded
   `ievo-ai/skills` target to a configurable per-project target).
   *(separate sub-project, not built here)*

This document scopes **only pain 1**. `/ievo:evo` already never runs git
commands itself (`evo/SKILL.md` Step 4 just edits the overlay file; Step 6
tells the user to `git diff` and commit manually) — so today's actual
failure mode is that the overlay edit sits as an unstaged/uncommitted
change with no explicit signal that it should ride the current branch,
and a user working across many short lesson-captures ends up opening a
fresh branch+PR per lesson instead.

## Design

Insert a new **Step 4.5** in `evo/SKILL.md`, immediately after Step 4
(append the lesson to the overlay file) and before Step 5 (determine
Trigger value). Because Step 0 (auto-evolution candidate intake) already
runs each candidate through "Steps 1–5.7 as its own lesson," this step is
automatically inherited by the auto-capture path with no separate case
needed — manual `/ievo:evo` and auto-write both funnel through the same
Step 4 → 4.5 sequence.

**Step 4.5 — Auto-commit on a feature branch:**

1. Resolve the current branch: `git branch --show-current`. Empty output
   (detached HEAD) or a non-zero exit (not a git repo) → skip this step
   entirely, fall through to today's behavior (leave the file edited,
   Step 6 reports it as an uncommitted change).
2. Resolve the repo's default branch — never hardcode `main`. Prefer
   `git symbolic-ref refs/remotes/origin/HEAD` (strip the `refs/remotes/origin/`
   prefix) — when this succeeds, its result is authoritative; compare it
   directly against the current branch in step 3. When it **fails** (no
   remote, detached remote HEAD), there is no way to positively confirm
   the current branch is a non-default feature branch. In that case:
   check whether the current branch name is in the common-default set
   (`main`, `master`, `trunk`, `develop`) — if it matches, treat it as
   default (skip auto-commit, same as a confirmed match). If it does
   **not** match either — i.e. `symbolic-ref` failed AND the branch name
   isn't a common default name, so nothing positively confirms *or*
   rules out default-branch status — still treat it as default and skip
   auto-commit. **Fail closed toward not auto-committing whenever
   default-branch status can't be positively ruled out** — the safe
   direction, since the costly mistake is an unwanted commit on a
   protected branch, not a missed convenience commit.
3. **If the current branch equals the resolved default branch** → do NOT
   auto-commit. This is exactly the protected-`main` case skills#552
   described; auto-committing there is the failure mode, not the fix. Fall
   through to today's behavior.
4. **If the current branch is a non-default feature branch** → stage and
   commit ONLY the overlay file this invocation touched (the exact path
   Step 3/4 wrote to — never `git add -A`/`git add .`, which could sweep up
   unrelated in-progress work): `git add <overlay-file-path> && git commit
   -m "docs(evolution): <short title from Step 4>"`. Local commit only —
   **never `git push`**. Pushing is a visible, external action; committing
   locally is cheap to inspect and trivially reversible
   (`git reset --soft HEAD~1`) if the user doesn't want it.
5. **If the commit fails** (pre-commit hook rejects it, nothing to commit
   because the file was already staged/committed by something else, or any
   other non-zero exit) — this is non-fatal. Do not retry, do not force
   (`--no-verify` is explicitly out of scope — see Rules). Report the
   failure reason to the user in Step 6 and leave the file as whatever
   state the failed commit attempt left it in (git commit is atomic — a
   failed commit never partially commits).
6. Step 6's report is updated to state the outcome precisely: committed
   locally to branch `<name>` (not pushed) / left as an uncommitted change
   on branch `<name>` (default branch or no-git-repo case) / commit
   attempted and failed (reason shown).

## Rules (mirrors `evo/SKILL.md`'s existing Rules section conventions)

- **Never `git add -A` or `git add .`.** Stage only the single overlay
  file path this invocation wrote to.
- **Never push.** The commit is local; pushing stays entirely the user's
  own action, same as today.
- **Never `--no-verify` / skip hooks.** If a project's pre-commit hooks
  reject the overlay file for a real reason (e.g. a lint/format check),
  that's a real signal, not friction to bypass.
- **Fail closed on default-branch detection.** When the default branch
  can't be confidently resolved, treat the current branch AS the default
  (skip auto-commit) rather than guessing it's a feature branch. A missed
  auto-commit costs the user one manual `git add`+`commit`; a wrong
  auto-commit on a protected branch is the exact failure mode this design
  exists to avoid.
- **No signing/co-author conventions imposed.** `git commit` uses the
  user's own git config as-is (signing, commit templates, hooks all apply
  normally) — this skill ships across many projects with different
  conventions and must not hardcode any single project's commit
  requirements (e.g. this very project's `Co-Authored-By: iEVO` rule is
  godfather-specific, not universal).

## Alternatives considered

- **Always tell the user to commit manually (status quo + stronger
  wording only).** Cheapest, but doesn't fix the actual failure mode —
  reminders get skipped under load, which is exactly how the "6+ PRs in
  an hour" pain happened in the first place. Rejected as insufficient on
  its own, though the improved Step 6 report text is kept as the fallback
  for the cases where auto-commit doesn't apply.
- **Auto-commit unconditionally, including on the default branch.**
  Rejected outright — this recreates the protected-`main` pain from the
  opposite direction (an unreviewed direct commit to a branch that's
  supposed to be PR-only).
- **Auto-commit AND auto-push.** Rejected — push is a visible, effectively
  irreversible-in-spirit action (rewriting shared history to undo it is
  worse than just not doing it) and belongs to the user's own judgment,
  same boundary this project's own CLAUDE.md draws for git safety.

## Testing / validation

`evo/SKILL.md` is prose the agent executes, not compiled code — there is
no existing test file for it (checked: no `tests/*evo*` matches other than
`evo-auto-*`/`evolution-*` fixtures, which cover a different skill). Validate
by:
1. Self-review pass on the new step for placeholders/ambiguity (per the
   brainstorming skill's own spec-review checklist).
2. A manual dry run on a scratch branch in a disposable repo: capture a
   lesson while on a feature branch (expect a local commit, no push),
   again on the default branch (expect no auto-commit, file left edited),
   and a run where a pre-commit hook is set up to reject the file (expect
   a reported failure, no partial state).

## Out of scope (tracked separately)

- Issue-based lesson capture for the no-active-branch case (skills#552
  pain 2).
- Configurable per-project feedback target for cross-repo/submodule
  reporting (skills#552 pain 3, generalizing `/ievo:feedback`).
