---
name: feedback
description: Submit feedback about the iEvo plugin — bug reports, feature requests, suggestions, or general comments. Posts as a GitHub issue in `ievo-ai/skills` via `gh` CLI. Use when the user says "send feedback", "report a bug", "this didn't work", "I want to suggest a feature", "where do I file an issue for iEvo", or after iEvo has done something the user would want to comment on.
license: MIT
compatibility: Requires `gh` CLI installed and authenticated. Falls back to printing the issue URL for manual creation if `gh` is unavailable.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Feedback

Post user feedback as a GitHub issue in `ievo-ai/skills` so we can fix bugs, prioritize features, and improve the plugin.

## Step 0: Detect invocation context

This skill has two flows:

**(A) Generic feedback** — default. User invoked `/ievo:feedback` or expressed feedback intent freely. Go to Step 1.

**(B) Skill-rejections feedback** — invoked from `/ievo:init` step 10 with a list of skipped skills from the interview. The caller will provide context like:
```
The user just completed /ievo:init interview. They installed N skills
and skipped these M skills: <list>. Collect reasons for the skips and
submit as feedback to ievo-ai/skills, copying reasons forward as
registry-improvement signal that can be relayed to vercel-labs/skills.
```

If invoked in flow (B), **skip Step 1** (type is implicitly "Idea" / registry-improvement) and **jump to Step 1b** below. Otherwise proceed with Step 1.

## Step 1: Classify the feedback type (flow A only)

Ask the user using `AskUserQuestion`:

- **Question:** `What kind of feedback?`
- **Header:** `Type`
- **Options** (single-select):
  - `Bug` — description: `Something broke or didn't work as expected.`
  - `Feature` — description: `A new capability you'd like to see.`
  - `Idea` — description: `General suggestion or design thought.`
  - `Question` — description: `You're stuck and want help / clarification.`

Map to GitHub label: `bug` / `enhancement` / `idea` / `question`.

## Step 1b: Collect per-skill rejection reasons (flow B only)

For each skipped skill (batched in groups of 4 — `AskUserQuestion` supports up to 4 questions per call), ask:

- **Question:** `Why did you skip <skill-name>?`
- **Header:** `<short-tag, max 12 chars>`
- **Options** (single-select):
  - `Not relevant to my stack` — description: `Doesn't apply to the languages/frameworks in this project.`
  - `Already using alternative` — description: `I have something else that does this.`
  - `Low quality` — description: `Install count too low, unknown author, or description was unclear.`
  - `Don't need right now` — description: `Maybe useful later, not today.`

(Cannot use freeform "Other" easily — keep to 4 options. If a user has a different reason, they can elaborate in Step 2.)

After all per-skill questions, also ask once via `AskUserQuestion`:
- **Question:** `Anything else to add about the suggestions?`
- **Header:** `Notes`
- **Options:**
  - `No, that's all` — description: `Submit with just the structured reasons above.`
  - `Yes, add a note` — description: `Open a freeform text prompt.`

If user picks `Yes, add a note`, collect freeform text per Step 2.

Use **type = idea** and **labels = feedback, registry-quality** for flow B.

## Step 2: Collect the feedback text

Ask the user for the actual feedback. Use a clear prompt like:

```
What would you like to share? Be as specific as you can:
- What were you trying to do?
- What happened vs what you expected?
- (Optional) Any error messages or commands that misbehaved?
```

Let them write freeform. Do not enforce any template — the value is the user telling us what's wrong in their words.

## Step 3: Auto-collect environment context

Gather these via Bash, all best-effort (skip silently if a command fails):

- **Plugin version** — read from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` field `version`
- **Plugin commit SHA** (if installed via git) — `git -C ${CLAUDE_PLUGIN_ROOT} rev-parse --short HEAD`
- **Claude Code version** — `claude --version`
- **OS** — `uname -srm` (or `sw_vers -productVersion` on macOS)
- **Project stack** — top-level manifest files present (e.g. `pyproject.toml, package.json`)

Do NOT collect:
- Project file contents
- Environment variables (may contain secrets)
- Git URLs, branch names
- Anything from `.env`, `.git/config`, `~/.ssh/`, etc.

## Step 3.5: Analyze feedback and ask clarifying questions

Before building the issue, review what the user provided. The goal is to **catch missing context that would make the issue useful**, without turning into a bureaucratic form. Apply a type-specific checklist (mental, not visible to user):

### For Bug reports
- [ ] What command/action triggered it?
- [ ] What was expected to happen?
- [ ] What actually happened (error message verbatim if possible)?
- [ ] Reproducible or one-off?

### For Feature requests
- [ ] What problem does the feature solve?
- [ ] How is the user working around it now?
- [ ] Concrete example of usage?

### For Ideas
- [ ] What's the underlying problem or opportunity?
- [ ] Any alternatives the user considered?

### For Questions
- [ ] What has the user already tried?
- [ ] What outcome are they hoping for?

### For Rejections (flow B)
- Per-skill reasons are already structured (4 options). Skip the checklist.
- If user opted to add a freeform note, lightly review it for clarity — only ask clarification if the note is highly ambiguous (e.g. "they're all bad" with no specifics).

## Clarifying question rules

If 2+ checklist items are missing OR critical for the issue to be actionable, ask **up to 3** clarifying questions via `AskUserQuestion`. Critical-but-missing examples:
- Bug with no error message and no reproduction → ask both
- Feature request with no use case → ask once
- Idea without underlying problem stated → ask once

Question framing:
- Make answers easy: prefer single-select options + "Other" / "Skip"
- Or open-ended "What would you like to add about <gap>?" with options like:
  - `<concrete option from inference>`
  - `Skip — submit as is`

**Hard cap:** one round of clarifications. After the user answers (or skips), proceed to Step 4. Do not loop "analyze → ask → analyze → ask".

**Skip the analysis if** the feedback is already detailed and specific (e.g. user wrote 200+ words covering steps, expected, actual). Don't drag a complete report through unnecessary questions.

## Step 4: Build the issue body

### Flow A (generic) format

```markdown
## Feedback

<the user's text from step 2 — quote verbatim>

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- Claude Code: <claude --version output>
- OS: <uname output>
- Project stack: <manifest list>

> Submitted via `/ievo:feedback` skill
```

### Flow B (skill rejections) format

```markdown
## Init interview — skill rejection reasons

After running `/ievo:init`, the user installed <N> of <M> suggested skills.
Below are the reasons for the rejections, useful as signal to improve
recommendation quality (both for iEvo and upstream skills.sh).

### Installed
- <owner/repo@skill> — (no comment, accepted)
- ...

### Skipped with reasons
- <owner/repo@skill> — Reason: <Not relevant to my stack | Already using alternative | Low quality | Don't need right now>
- ...

### Note from user
<freeform from step 2, or "(none)">

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- Claude Code: <claude --version output>
- OS: <uname output>
- Project stack: <manifest list>

> Submitted via `/ievo:feedback` skill (rejections flow from `/ievo:init` step 10)
```

## Step 5: Preview and confirm

Show the user the full title and body that will be posted. Use `AskUserQuestion`:

- **Question:** `Post this to github.com/ievo-ai/skills/issues?`
- **Header:** `Submit`
- **Description before question:** show the title + body preview (separately, in markdown formatting)
- **Options**:
  - `Submit (Recommended)` — description: `Creates a public GitHub issue. Your feedback will be visible to anyone.`
  - `Cancel` — description: `Don't post. Drop the feedback.`

Make sure the user understands: **this will be public on GitHub**. Their text appears as-is in a public issue.

## Step 6: Submit via gh CLI

If user confirmed Submit:

Title format:
- Bug → `[bug] <short summary derived from feedback, 6-10 words>`
- Feature → `[feature] <short summary>`
- Idea → `[idea] <short summary>`
- Question → `[question] <short summary>`
- Flow B (rejections) → `[feedback/rejections] <stack name>: <N>/<M> skills declined`

Run:
```bash
gh issue create \
  --repo ievo-ai/skills \
  --title "<title>" \
  --body "<body from step 4>" \
  --label "<bug|enhancement|idea|question>" \
  --label "feedback"
```

For flow B add an extra label:
```bash
  --label "registry-quality"
```

If `gh` is not installed or not authenticated:
- Catch the error
- Print the title and body to the user
- Print: `gh CLI not available. Open https://github.com/ievo-ai/skills/issues/new and paste the above.`
- Optionally: write the body to a temp file and tell the user the path

## Step 7: Report the result

On success:
- Print the issue URL returned by `gh issue create`
- Confirm: `✓ Submitted as <url>`
- Brief thanks: `Thanks — this will help iEvo evolve. The repo is at github.com/ievo-ai/skills.`

On failure (gh missing or network):
- Show the user the body to copy/paste manually
- Show the URL to create issues: https://github.com/ievo-ai/skills/issues/new

## Rules

- **Public posting requires explicit confirm.** Never skip step 5. Feedback is public on the internet; no surprises.
- **Verbatim user text.** Do not paraphrase, "improve", or sanitize the user's words. Their voice is the value.
- **No secrets leak.** The auto-collect list is closed — version, OS, manifest names only. Do not include git remote URLs, branch names, or anything from environment variables.
- **Best-effort context.** If any Bash command in step 3 fails, omit that line. Never block submission on metadata collection.
- **Graceful gh-CLI fallback.** If `gh` is missing/unauthenticated, give the user a way to post manually — don't just say "failed".
