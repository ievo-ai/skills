---
name: deep-review
description: Use this skill before committing significant changes, after a refactor, or when you want a second opinion on a diff — not for auditing a third-party skill/plugin's safety before install (use /ievo:security-check for that). Structured 11-point gap-detection review of a diff before commit. Spawns a deep-reviewer subagent for independent eyes (fresh context, separate token budget). Catches issues that survive pre-commit hooks, linters, and test suites but surface in human PR review — completeness gaps, test/impl drift, dead code from partial refactors, naming/behaviour mismatch, doc-paraphrase drift, cross-file consistency, error-path coverage, API contract fidelity, security surface, concurrency/state, and leaked secrets. Supports scope modes — staged changes (default), working tree, or arbitrary git range.
argument-hint: "[--staged|--working|--range <ref>..<ref>]"
license: MIT
effort: medium
# Heavyweight skill — dispatches a deep-reviewer sub-agent in fresh context
# (separate token budget), so it is user-invoke only. Prevents costly
# auto-activation on description match, and (Claude Code v2.1.196+) blocks
# scheduled tasks from firing it. Explicit `/ievo:deep-review` still works.
disable-model-invocation: true
# Turn-level model pin (per-turn override; reverts next prompt) — the 11-point
# gap-detection review needs reasoning depth beyond Haiku on direct invocation.
model: sonnet
compatibility: "Requires git CLI for diff generation. Subagent dispatch (Task tool) available on Claude Code and Codex with the iEvo plugin — other agentskills.io-compatible platforms execute the deep-reviewer steps inline. Designed for Sonnet-tier reasoning via the deep-reviewer agent frontmatter and this skill's own `model: sonnet` pin. Cursor v3.7+: native `/review` (Bugbot) is a faster platform alternative (~90s); prefer `/ievo:deep-review` for the structured 11-point checklist."
disallowed-tools:
  - Write
  - Edit
  - Bash(rm*)
  - Bash(mv*)
  - Bash(cp*)
  - Bash(curl*)
  - Bash(wget*)
  - Bash(sudo*)
  - Bash(chmod*)
  # WebSearch works in sub-agents as of CC v2.1.183 — a read-only review must never
  # web-search about the diff it is analyzing (a diff carrying prompt injection
  # could turn it into an exfiltration channel).
  - WebSearch
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Deep Review — structured gap-detection before commit

A structured 11-point review of your diff by an independent reviewer (fresh context, separate token budget). Catches the class of issues that automated tooling misses but humans find in PR review:

- Completeness gaps (spec says X, code does Y)
- Test/impl drift (test asserts old behaviour after code changed)
- Dead code from partial refactors
- Naming/behaviour mismatch
- Doc-paraphrase drift
- Cross-file consistency breaks

## When to use

- Before committing a significant change
- After a refactor — to catch leftover artifacts
- When you want a second opinion on a diff
- Before opening a PR — catch issues before reviewers do

## Step 1: Determine scope

Check if the user specified a scope mode. Three user-selectable modes are supported, plus a committed-diff fallback the skill offers when the tree is clean:

| Mode | Trigger | Git command |
|------|---------|-------------|
| **staged** (default) | `--staged`, or no flag | `git diff --staged` |
| **working** | `--working` | `git diff` |
| **range** | `--range <ref>..<ref>` | `git diff <ref>..<ref>` |
| **committed** (fallback) | not user-selectable — offered when staged and unstaged are both empty | `git diff "$(git merge-base HEAD origin/<default-branch>)"..HEAD` |

**Working-tree scope also covers untracked files.** `git diff` alone never shows untracked paths — standard git behaviour, since it diffs the index against the working tree and an untracked file is in neither. Left uncovered, a brand-new file the user just created would get zero review coverage while the report still comes back clean. Step 2's working-tree row supplements the diff with `git ls-files --others --exclude-standard` so working mode reviews the whole tree, not just tracked edits. Staged, range, and committed modes are unaffected — each already covers everything in its scope.

If the user didn't specify a mode, default to **staged**. If there are no staged changes in staged mode, check for unstaged changes and ask:

```
No staged changes found. There are unstaged changes in the working tree.
Would you like to review those instead?
```

Use `AskUserQuestion`:
- **Question:** `No staged changes. Review unstaged working tree changes instead?`
- **Header:** `Scope`
- **Options:**
  - `Yes, review working tree` — description: `Run git diff (unstaged changes)`
  - `Cancel` — description: `Nothing to review`

If both staged and unstaged are empty, fall back to the committed diff on this branch before giving up — the common case on a clean PR branch, where the changes to review are already committed and neither staged nor unstaged. Resolve the remote default branch, then take its **merge base** with `HEAD` — the same merge-base form, and the same first two resolution tiers (`git symbolic-ref` → `gh repo view --json defaultBranchRef`), that `commands/vuln-scan.md`'s `--diff` scope uses. Deliberately drop that command's third tier, which warns and hardcodes `BASE_BRANCH="main"`: a scan that guesses a base and over-reports is recoverable, but a review silently diffing against a `main` the repo may not have would hand the reviewer a fabricated range — so an unresolvable default branch falls through to the clean exit below instead of guessing. Never diff two-dot against `origin/<default-branch>` directly: on a branch that has fallen behind, `git diff origin/<b>..HEAD` renders the default-branch-only commits as reversed deletions and the reviewer reports them as findings.

```bash
# Try git symbolic-ref first, then the gh API
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
fi
MERGE_BASE=$(git merge-base HEAD "origin/$BASE_BRANCH" 2>/dev/null)
```

If a merge base resolves and `<merge-base>..HEAD` is non-empty, ask:

```
No staged or unstaged changes. Review the committed changes on this branch
(since it diverged from origin/<default-branch>) instead?
```

Use `AskUserQuestion`:
- **Question:** `No staged or unstaged changes. Review this branch's committed changes since it diverged from origin/<default-branch>?`
- **Header:** `Scope`
- **Options:**
  - `Yes, review committed changes` — description: `Run git diff "$(git merge-base HEAD origin/<default-branch>)"..HEAD`
  - `Cancel` — description: `Nothing to review`

If confirmed, treat the scope as **range** with `<range>` = `<merge-base>..HEAD` for Step 2 onward.

Otherwise — the default branch doesn't resolve (detached HEAD, no `origin` remote, shallow clone without the symbolic ref, `gh` missing or unauthenticated), the merge base doesn't resolve (`origin/<default-branch>` not fetched locally, or no common ancestor), `<merge-base>..HEAD` is itself empty (branch has no commits ahead), or the diff command errors — report cleanly and exit:

```
Nothing to review — no staged or unstaged changes detected.
```

## Step 2: Capture the diff and changed files

Run the appropriate git command based on the scope from Step 1:

```bash
# Staged (default)
git diff --staged

# Working tree
git diff

# Range
git diff <range>
```

**Working-tree mode only — supplement with untracked files.** List non-ignored untracked paths and synthesize a diff for each, without touching the index:

```bash
git ls-files --others --exclude-standard
```

For each path returned:

```bash
git diff --no-index -- /dev/null <path>
```

This prints a standard "new file" unified diff (`--- /dev/null` / `+++ b/<path>`) and exits 1 — expected, the same nonzero exit `git diff --no-index` always returns when a difference exists, not an error. `--exclude-standard` respects `.gitignore`, so ignored files stay excluded, matching every other mode's git-tracked-or-intentionally-untracked scope; a binary untracked file reports `Binary files /dev/null and b/<path> differ`, same as git already does for binary changes elsewhere. Append each generated diff to the `git diff` output captured above — the combined text is the working-tree diff for Step 4. Nothing is staged: `git status` still reports these paths as untracked afterward.

Also capture the list of changed files:

```bash
# Staged
git diff --staged --name-only

# Working tree
git diff --name-only

# Range
git diff --name-only <range>
```

**Working-tree mode only:** append the `git ls-files --others --exclude-standard` output captured above to the `git diff --name-only` result — the combined list is the working-tree `changed_files` for Step 4.

If the resulting diff is empty (combined diff for working-tree mode; possible with `--range` if the refs are identical), report and exit:

```
Empty diff — the specified range contains no changes.
```

## Step 3: Gather repo context

Collect brief context about the repository to help the reviewer understand the codebase:

```bash
# Language/framework detection from manifest files
ls package.json pyproject.toml Cargo.toml go.mod pom.xml build.gradle Gemfile mix.exs 2>/dev/null

# Brief repo description
head -5 README.md 2>/dev/null || echo "(no README)"
```

Build a one-line summary: e.g., "Node.js project with package.json, TypeScript" or "Python project with pyproject.toml, FastAPI".

## Step 4: Dispatch the deep-reviewer subagent

### On Claude Code or Codex with the iEvo plugin

Dispatch via Task tool with `subagent_type: "deep-reviewer"`. Pass:

```
Review the following diff for gaps, drift, and consistency issues.

## Repo context
<repo context from Step 3>

## Changed files
<file list from Step 2>

## Diff
<full diff from Step 2>
```

The deep-reviewer runs in a fresh context with separate token budget. It executes the 11-point checklist independently and returns a structured report.

### On other agentskills.io-compatible platforms

If Task tool dispatch is not available, execute the deep-reviewer's steps inline, bound by that agent's own `## Rules` — on this path you are the reviewer, so its finding-scope rules apply to you:

1. Read the full content of every changed file (not just the diff hunks)
2. Execute all 11 checklist points against the changes
3. Build the structured output

The inline path is functionally identical but shares context with the caller (no isolation benefit).

## Step 5: Present the review results

The deep-reviewer returns a structured report with findings and a checklist summary. Present it to the user as-is — do not editorialize, filter, or reorder findings.

If the review found **zero findings**:

```
## Deep Review — clean

All 11 checklist points evaluated. No issues found.

Your diff looks ready to commit.
```

If the review found findings, present them grouped by severity (blockers first, then warnings, then notes), followed by the full checklist coverage summary.

After presenting results, suggest next steps based on severity:

- **Has blockers:** `Fix the blocker(s) above before committing. Run /ievo:deep-review again after fixes to verify.`
- **Warnings only:** `Consider addressing the warnings above. None are blockers — commit at your discretion.`
- **Notes only:** `Minor notes only — safe to commit as-is. Address at your convenience.`

## Scope boundary (MVP boundary)

Draft findings, cite evidence, explain impact — one concrete suggestion per finding. This skill drafts and verifies; it does not merge, deploy, or own the outcome.

**Out of scope — never return:**
- Merge, release, or deployment timing recommendations ("this is ready to merge", "deploy to staging first") — *commit* readiness is in scope and expected of a pre-commit review, so Step 5's "ready to commit" line and its severity-based next-step suggestions stand as written; this boundary starts at what happens *after* the commit.
- Architecture refactors beyond the diff under review
- Sprint/backlog priority suggestions
- Unqualified approval with no findings — even a clean diff gets the full Step 5 "clean" report and checklist, never a bare "LGTM"

Lint and type-checker diagnostics are out of scope too, but that boundary is enforced in `agents/deep-reviewer.md`'s `## Rules`, not here: findings originate in the reviewer, and this skill is explicitly forbidden from filtering them (Step 5, and **Present findings verbatim** below). On Step 4's inline fallback the boundary reaches you directly — that path runs the deep-reviewer's steps under its `## Rules`.

## Rules

- **Never skip the subagent dispatch.** The independent context is the core value proposition. Only fall back to inline execution when Task tool is genuinely unavailable on the platform.
- **Never modify the diff.** The review is read-only. Do not stage, unstage, commit, or edit files.
- **Present findings verbatim.** Do not filter, suppress, or editorialize the deep-reviewer's output. The user decides what to act on.
- **Default to staged.** If the user says `/ievo:deep-review` with no flags, review staged changes. This matches the pre-commit mental model.
- **Empty diff = clean exit.** Don't warn or suggest — just state the fact and exit. Exception: when staged AND unstaged are both empty (Step 1), offer the committed merge-base fallback first (`git merge-base HEAD origin/<default-branch>`, then `<merge-base>..HEAD`) — only exit immediately once that fallback is unavailable too (no resolvable default branch or merge base, or the range itself is empty).
- **All 11 points, every time.** The checklist summary must show all 11 points evaluated. Skipping a point because "it doesn't apply" is not allowed — mark it clean instead.
