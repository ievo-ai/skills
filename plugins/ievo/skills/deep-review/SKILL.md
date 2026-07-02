---
name: deep-review
description: Structured 11-point gap-detection review of a diff before commit. Spawns a deep-reviewer subagent for independent eyes (fresh context, separate token budget). Catches issues that survive pre-commit hooks, linters, and test suites but surface in human PR review — completeness gaps, test/impl drift, dead code from partial refactors, naming/behaviour mismatch, doc-paraphrase drift, cross-file consistency, error-path coverage, API contract fidelity, security surface, concurrency/state, and leaked secrets. Supports scope modes — staged changes (default), working tree, or arbitrary git range. Use before committing significant changes, after a refactor, or when you want a second opinion on a diff.
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
compatibility: "Requires git CLI for diff generation. Subagent dispatch (Task tool) available on Claude Code and Codex with the iEvo plugin — other agentskills.io-compatible platforms execute the deep-reviewer steps inline. Designed for Sonnet-tier reasoning via the deep-reviewer agent frontmatter and this skill's own `model: sonnet` pin."
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

Check if the user specified a scope mode. Three modes are supported:

| Mode | Trigger | Git command |
|------|---------|-------------|
| **staged** (default) | `--staged`, or no flag | `git diff --staged` |
| **working** | `--working` | `git diff` |
| **range** | `--range <ref>..<ref>` | `git diff <ref>..<ref>` |

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

If both staged and unstaged are empty, report cleanly and exit:

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

Also capture the list of changed files:

```bash
# Staged
git diff --staged --name-only

# Working tree
git diff --name-only

# Range
git diff --name-only <range>
```

If the diff is empty (possible with `--range` if the refs are identical), report and exit:

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

If Task tool dispatch is not available, execute the deep-reviewer's steps inline:

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

## Rules

- **Never skip the subagent dispatch.** The independent context is the core value proposition. Only fall back to inline execution when Task tool is genuinely unavailable on the platform.
- **Never modify the diff.** The review is read-only. Do not stage, unstage, commit, or edit files.
- **Present findings verbatim.** Do not filter, suppress, or editorialize the deep-reviewer's output. The user decides what to act on.
- **Default to staged.** If the user says `/ievo:deep-review` with no flags, review staged changes. This matches the pre-commit mental model.
- **Empty diff = clean exit.** Don't warn or suggest — just state the fact and exit.
- **All 11 points, every time.** The checklist summary must show all 11 points evaluated. Skipping a point because "it doesn't apply" is not allowed — mark it clean instead.
