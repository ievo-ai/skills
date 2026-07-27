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

Check if the user specified a scope mode. Three user-selectable modes are supported, plus a committed-diff fallback the skill offers whenever there are no staged changes:

| Mode | Trigger | Git command |
|------|---------|-------------|
| **staged** (default) | `--staged`, or no flag | `git diff --staged` |
| **working** | `--working` | `git diff` |
| **range** | `--range <ref>..<ref>` | `git diff <ref>..<ref>` |
| **committed** (fallback) | not user-selectable — offered whenever staged is empty: alongside the working-tree option if the tree has unstaged content, on its own if it's clean | `git diff "$(git merge-base HEAD origin/<default-branch>)"..HEAD` |

**Working-tree scope also covers untracked files.** `git diff` alone never shows untracked paths — standard git behaviour, since it diffs the index against the working tree and an untracked file is in neither. Left uncovered, a brand-new file the user just created would get zero review coverage while the report still comes back clean. Step 2's working-tree row supplements the diff with `git ls-files -z --others --exclude-standard --full-name -- :/ | tr '\0' '\n'` so working mode reviews the whole tree, not just tracked edits. The `--full-name -- :/` pair is load-bearing, not decoration: bare `git ls-files` is scoped to the current directory and prints cwd-relative paths, while `git diff` takes no implicit cwd pathspec and prints root-relative ones — so invoked from a subdirectory the untracked half would silently cover less ground than the tracked half, reproducing #483's own bug class one level down. `-- :/` re-roots the pathspec at the repo top level; `--full-name` makes the printed paths root-relative, matching `git diff`. `-z` is load-bearing for the same reason: without it git C-quotes any path holding a non-ASCII byte, so `café.md` is listed as the literal `"caf\303\251.md"` — a name matching no file on disk, whose synthesized diff fails and leaves that file with zero coverage, #483's bug class reached through a filename instead of through tracking state. The `| tr '\0' '\n'` after it is load-bearing in turn: `-z` separates the paths with NUL bytes, and those do not survive tool output — they come back collapsed to spaces, so every listed path merges into one unusable string. `tr` restores one path per line without re-enabling git's quoting (Step 2 has the mechanics). The supplement is capped in Step 2 — an unignored `dist/` must not flood the reviewer's prompt — and a capped run always says so. Staged, range, and committed modes are unaffected — each already covers everything in its scope.

If the user didn't specify a mode, default to **staged**. If there are no staged changes in staged mode, check the working tree for unstaged content — tracked (`git diff`) or untracked (`git ls-files -z --others --exclude-standard --full-name -- :/ | tr '\0' '\n'`).

Before asking anything, resolve this branch's **committed diff** as well, so it can be offered *alongside* the working-tree option rather than only when the tree is spotless. A working tree that is clean apart from one stray untracked file — a scratch note, an editor backup, a generated artifact nothing ignores — is still the clean-PR-branch case, and gating the committed diff on "unstaged is empty" would hide the branch review behind that stray file. Resolve the remote default branch, then take its **merge base** with `HEAD` — the same merge-base form, and the same first two resolution tiers (`git symbolic-ref` → `gh repo view --json defaultBranchRef`), that `commands/vuln-scan.md`'s `--diff` scope uses. Deliberately drop that command's third tier, which warns and hardcodes `BASE_BRANCH="main"`: a scan that guesses a base and over-reports is recoverable, but a review silently diffing against a `main` the repo may not have would hand the reviewer a fabricated range — so an unresolvable default branch just makes the committed option unavailable instead of guessing. Never diff two-dot against `origin/<default-branch>` directly: on a branch that has fallen behind, `git diff origin/<b>..HEAD` renders the default-branch-only commits as reversed deletions and the reviewer reports them as findings.

```bash
# Try git symbolic-ref first (local), then the gh API
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
fi
MERGE_BASE=$(git merge-base HEAD "origin/$BASE_BRANCH" 2>/dev/null)
```

Call the committed diff **available** when `MERGE_BASE` resolved and `<merge-base>..HEAD` is non-empty. It is unavailable — and simply never offered — when the default branch doesn't resolve (detached HEAD, no `origin` remote, shallow clone without the symbolic ref, `gh` missing or unauthenticated), the merge base doesn't resolve (`origin/<default-branch>` not fetched locally, or no common ancestor), `<merge-base>..HEAD` is itself empty (branch has no commits ahead), or the diff command errors. The `gh` tier only fires when the local `git symbolic-ref` lookup comes up empty, so the common case stays local.

Then ask, based on what's present.

**Unstaged content present** (tracked edits, untracked files, or both):

```
No staged changes found. There are unstaged changes in the working tree.
Would you like to review those instead?
```

Use `AskUserQuestion`:
- **Question:** `No staged changes. Review unstaged working tree changes instead?`
- **Header:** `Scope`
- **Options:**
  - `Yes, review working tree` — description: `Run git diff, plus any untracked files (unstaged changes)`
  - `No, review committed changes` — description: `Run git diff "$(git merge-base HEAD origin/<default-branch>)"..HEAD` — include this option **only when the committed diff is available**
  - `Cancel` — description: `Nothing to review`

**Working tree clean** (staged, tracked-unstaged and untracked all empty) and the committed diff is available — the common case on a clean PR branch, where the changes to review are already committed and neither staged nor unstaged:

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

If the user picks the committed option in either question, treat the scope as **range** with `<range>` = `<merge-base>..HEAD` for Step 2 onward.

If the working tree is clean and the committed diff is unavailable, report cleanly and exit:

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
git ls-files -z --others --exclude-standard --full-name -- :/ | tr '\0' '\n'
```

`--full-name -- :/` is required for this to match `git diff`'s scope: without them `git ls-files` is scoped to the current directory and prints cwd-relative paths, so a run from a subdirectory would skip every untracked file outside it while the tracked half of the same diff stayed repo-wide.

`-z` is required too, for a failure that is harder to see. `core.quotePath` defaults to **on**, so without `-z` git C-quotes every path containing a non-ASCII byte, a double quote, a backslash, or a control character: `café.md` comes back as the literal `"caf\303\251.md"` — surrounding quotes and octal escapes included. Fed to a per-path `git diff --no-index`, that name matches nothing on disk, so git writes `error: Could not access ...` to stderr and **exits 1 — the same status it returns on a successful difference** (verified on git 2.54.0). Exit code alone therefore cannot distinguish the failure from the expected case, and the file silently gets zero coverage: #483's own bug class, reached through a filename rather than through tracking state. `-z` disables that quoting entirely and NUL-terminates each path instead — on this listing, and on the identical `git ls-files -z` that the synthesis loop below consumes directly.

`| tr '\0' '\n'` is required for the same reason `-z` is, and neither substitutes for the other. `-z`'s NUL terminators cannot be read back: raw NUL bytes do not survive tool output — they arrive collapsed to spaces (verified: `printf 'a\0b\0'` reads back as `a b`), so every path in the listing merges into one space-joined string, indistinguishable from a single filename containing spaces. That joined string is unusable as a count and as a name — #483's bug class again, since a listing you cannot split tells you nothing about what the tree holds. `tr` converts each NUL back to a newline, so **split the listing on newline** and carry each path through verbatim; `-z` still does its own job, suppressing the C-quoting, because it governs how git *writes* the path and `tr` only changes the separator. This listing is what tells you `M` — how many untracked paths exist — and gives you readable names for the report; it is *not* what the synthesis below iterates. One residual case is accepted rather than papered over: a filename containing a literal newline splits into fragments here, so it inflates `M` and can be misspelled in the truncation notice. The synthesis loop below re-reads the identical `git ls-files -z` NUL-delimited inside a single shell, so it still sees that filename intact — but it deliberately skips it rather than diffing it (see the injection paragraph after next): a newline embedded in the loop's own printed output would be indistinguishable from a second, forged line.

Synthesize the diffs with the single Bash call below, which reads its paths straight from `git ls-files -z`. **Never build a per-path command by substituting a filename into the command text** — not even a double-quoted one. A filename is attacker-controlled content: anyone who can drop a file in the tree (a dependency's postinstall script, an unpacked archive, a cloned repo you are about to review) chooses it, and double quotes do not neutralize `$`, a backtick, or `\`, so a file named `` `id` `` or `$(curl …|sh)` would *execute* the moment the command is parsed — verified: interpolating a `$(touch /tmp/PWNED)` path into that command creates the marker file, no filesystem access required. `-z` deliberately strips git's own C-quoting, so nothing upstream escapes the path either. Inside the loop the path only ever appears as `"$p"`: the shell substitutes a variable's stored bytes verbatim and does not re-parse them, so `$(…)`, backticks, `;` and `&&` in a filename stay inert — verified, the same path fed through the loop is reported as unreadable and the marker file is never created. Same rule `feedback/SKILL.md` applies to `--title "$TITLE"`, and AGENTS.md's "No untrusted free-text crosses into a shell".

```bash
# Working-tree mode — synthesize one "new file" diff per untracked path.
# Whole thing in a subshell: the cd is needed because --full-name makes the
# listed paths root-relative, and must not leak into your later commands.
(
  cd "$(git rev-parse --show-toplevel)" || exit 1
  n=0; total=0; inlined=""
  while IFS= read -r -d '' p; do        # NUL-delimited: never split on newline
    n=$((n + 1))
    if [ "$n" -gt 50 ]; then            # count cap — stop walking, don't print one line per excess path
      printf '### skipped-remaining (over the 50-path cap)\n'; break
    fi
    case $p in                          # embedded newline: can't be represented as one line below
      *$'\n'*) printf '### skipped %s (filename contains a newline, not inlined)\n' "$(printf '%s' "$p" | tr '\n' '?')"; continue ;;
    esac
    if [ -L "$p" ]; then                # symlink: never dereference — may point outside the repo
      printf '### skipped %s (symlink, not followed)\n' "$p"; continue
    fi
    d=$(LC_ALL=C git diff --no-index -- /dev/null "$p" 2>&1) # "$p": a variable, never command text
    case $d in                          # exit status can't tell failure from success
      error:*) printf '### skipped %s (could not be read)\n' "$p"; continue ;;
    esac
    sz=$(printf '%s' "$d" | wc -c)
    if [ $((total + sz)) -gt 262144 ]; then         # 256 KB budget
      printf '### skipped %s (over the 256 KB budget)\n' "$p"; continue
    fi
    total=$((total + sz))
    inlined="$inlined$p"$'\n'          # trusted record of what was actually inlined
    printf '### untracked %s\n%s\n' "$p" "$d"
  done < <(git ls-files -z --others --exclude-standard --full-name -- :/)
  printf '### inlined-paths\n%s' "$inlined"
)
```

Each inlined file arrives as a `### untracked <path>` marker followed by a standard "new file" unified diff (`diff --git a/<path> b/<path>` / `--- /dev/null` / `+++ b/<path>`, root-relative, matching `git diff`'s own headers); a binary file reports `Binary files /dev/null and b/<path> differ` and an empty file yields the header alone, both exactly as git renders them elsewhere. Read the diff bodies out of that output and append them to the `git diff` output captured above — the combined text is the working-tree diff for Step 4 — and read the `### skipped` markers as the truncation record below. The trailing `### inlined-paths` block is the **only** source for the untracked half of Step 2's `changed_files` list (below) — never derive it by scanning the diff bodies above for `### untracked` lines; see the injection paragraph after next for why. Nothing is staged: `git status` still reports every one of these paths as untracked afterward.

The loop tests each capture's *output*, never its exit status, and that is load-bearing: `git diff --no-index` exits 1 both when it found a difference (the expected case) and when it could not access the path (verified on git 2.54.0), so the status cannot tell the two apart, and per-path statuses are lost inside a loop anyway. Output starting with `error:` is a *failed* capture, not a covered file, so it is recorded among the skipped paths rather than passed off as reviewed — that is where a file deleted between the listing and the diff lands. `--exclude-standard` respects `.gitignore`, so ignored files stay excluded, matching every other mode's git-tracked-or-intentionally-untracked scope. The loop needs `bash` for `read -r -d ''` (Claude Code and Codex both run Bash-tool commands under bash; `read -d` is available back to bash 3.2, so macOS's system bash works too). The `error:*` match itself needs `LC_ALL=C` on the `git diff --no-index` call: git's error strings go through gettext and translate under a non-English `LANG`/`LC_MESSAGES`, and a translated message wouldn't match the literal English prefix — silently reclassifying a failed capture as a successful one, the same coverage loss the exit-code check above exists to prevent. Pinning the locale for just this one invocation keeps the match reliable regardless of the caller's environment.

**Untracked paths get two more checks before they're trusted, both closing a way this loop's own output could be turned against the reviewer it feeds.** First, `[ -L "$p" ]` skips symlinks without dereferencing them — an untracked symlink is not the same trust level as a tracked one (a tracked symlink requires the *user* to have `git add`ed it; an untracked one can be dropped into the tree by anything with write access, a dependency's postinstall script or an unpacked archive included) and `git diff --no-index` on a symlink still succeeds, so an unchecked loop would inline it, add it to `changed_files` below, and Step 4's `deep-reviewer` dispatch would `Read` the *target* the link resolves to — pulling arbitrary local files (an SSH key, a cloud credential) into the report, which Step 5 then prints to the user verbatim. Second, a `case $p in *$'\n'*)` guard skips any path whose bytes contain a literal newline (legal in a Linux filename) before it is ever folded into `$inlined` or a `### untracked` line: without it, one crafted filename could make the loop's own printed output contain an extra line that reads exactly like a legitimate marker or path — the same #483 coverage-loss bug class turned into a forgery vector instead. `$inlined` (accumulated only from `$p` at the moment a file is *actually* inlined, one path per iteration, never re-derived by scanning printed text afterward) and the newline guard together are what keep the trailing `### inlined-paths` block trustworthy as `changed_files`' untracked half.

**The loop's variables survive the `while`, unlike a bare pipe.** `git ls-files -z ... | while read ...; done` would run the loop in a subshell (bash forks the right side of a pipe), so `n`, `total`, and `inlined` would all reset to nothing the moment the loop ended — reading `$inlined` afterward would see nothing at all, not a partial list. Feeding the loop via process substitution instead (`done < <(git ls-files -z ...)`) keeps the `while` in the *current* shell, so the same three variables that accumulate across iterations are still there once the loop exits. Process substitution is a bashism, same as `read -r -d ''` above, and needs no version newer than what that already requires.

**Bound the supplement — count and size caps.** Untracked paths are unbounded in a way tracked edits are not: one unignored `dist/`, `node_modules/`, `target/`, or coverage-output directory yields thousands of them, and inlining each in full would blow out the Step 4 prompt on generated noise before the reviewer reaches a single real change. The loop above therefore caps the supplement at **50 paths** and **256 KB** of synthesized untracked-diff text — 50 mirrors `scripts/discover.mjs`'s `DEFAULT_TOTAL_LIMIT`, 256 KB mirrors the `MAX_SCAN_FILE_BYTES` / `MAX_VALIDATE_FILE_BYTES` ceiling `scripts/scan_repo.mjs` and the validators already use. It walks the paths in the order `git ls-files` returned them — sorted, so the same tree always yields the same selection — applying both caps as it goes:

- Inline nothing past the 50th path.
- Skip — never *partially* inline — any single file whose synthesized diff would push the running untracked-diff total past 256 KB, then keep walking: a later, smaller file still fits within the remaining budget. A truncated diff is worse than an omitted one, because it reads to the reviewer as a complete file.

Both caps bound the untracked supplement only; the tracked `git diff` half is not capped and is unchanged.

**A capped run must never read as full coverage.** The loop's `### skipped <path> (<reason>)` markers are that record — one per path it did not inline, with the reason attached (`over the 256 KB budget` / `could not be read` / `symlink, not followed` / `filename contains a newline, not inlined`) — and it has to reach both consumers — an untracked file that was never reviewed has to stay distinguishable from one that was reviewed and found clean. The one exception is the 50-path cap: once `n` exceeds 50 the loop prints a single `### skipped-remaining (over the 50-path cap)` line and stops walking, rather than one line per path past the cap — otherwise an unignored `dist/` or `node_modules/` with thousands of entries would make the skip notices themselves the same flood the cap exists to prevent. `M` (the total untracked count) still comes from the listing captured earlier, so the truncation notice below can still say how many were left out even though the loop itself stopped counting them individually.

- **Step 4** — pass the notice in the dispatch prompt as the `## Coverage caveats` section, so the deep-reviewer knows its input is partial. Its own contract (`agents/deep-reviewer.md` — `## Input`, and the `Complete checklist, over the input you were given` rule) then has it echo the caveat in its report: all 11 points are still reported, but as evaluated over the diff it received, never as coverage of files it never got.
- **Step 5** — surface the same notice to the user, above the findings.

Suggested wording — omit the block entirely when nothing was skipped:

```
⚠️ Untracked supplement truncated — N of M untracked files were not reviewed
(50-path cap / 256 KB budget / unreadable). Skipped: <first 10 skipped paths>, and K more.
Add generated output to .gitignore, or stage the files you want reviewed, then
re-run /ievo:deep-review.
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

**Working-tree mode only:** append the paths listed under the loop output's trailing `### inlined-paths` block — never the raw `git ls-files` listing, and never derived by scanning the diff bodies above for `### untracked` lines — to the `git diff --name-only` result. That distinction is load-bearing, not stylistic: the diff bodies are untrusted content (an untracked file's own name or contents could contain text that reads like a marker line), while `### inlined-paths` is built by the loop itself, one line per path, only at the moment that exact path was actually inlined — so it can't be spoofed by anything a file carries. Both halves are root-relative, so they concatenate into one consistent list, and that combined list is the working-tree `changed_files` for Step 4. Skipped paths stay out of it on purpose: a name in `changed_files` means the reviewer received a diff for that file, and the truncation notice is what accounts for the rest.

If the resulting diff is empty (combined diff for working-tree mode; possible with `--range` if the refs are identical), report and exit:

```
Empty diff — the specified range contains no changes.
```

One exception: in working-tree mode the combined diff can come out empty *because* every untracked path was skipped — no tracked edits, and every untracked file caught by a cap, a symlink/newline guard, or an unreadable path. That is not an empty diff, and reporting it as one would be the same silent coverage loss the caps exist to make visible. Print the truncation notice instead and exit without dispatching.

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

## Coverage caveats
<truncation notice from Step 2 — omit this whole section when nothing was skipped>

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

If Step 2 truncated the untracked supplement, print that notice **first**, above the report — including above the zero-findings block below. A clean verdict over a truncated input is not a clean verdict over the working tree, and the user has to be able to tell those apart.

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
- **Empty diff = clean exit.** Don't warn or suggest — just state the fact and exit. Exception: whenever staged is empty (Step 1), offer the committed merge-base fallback first (`git merge-base HEAD origin/<default-branch>`, then `<merge-base>..HEAD`) — as an extra option beside the working-tree one if the tree has unstaged content, or on its own if it's clean. Only exit immediately once that fallback is unavailable too (no resolvable default branch or merge base, or the range itself is empty), and the tree has nothing unstaged either.
- **A truncated supplement is never silent.** Working-tree mode caps the untracked supplement at 50 paths / 256 KB of synthesized diff (Step 2). Whenever a cap trips, the notice reaches both the deep-reviewer's prompt and the user's report — a file that was never reviewed must never be indistinguishable from one that was reviewed and found clean.
- **All 11 points, every time.** The checklist summary must show all 11 points evaluated. Skipping a point because "it doesn't apply" is not allowed — mark it clean instead.
