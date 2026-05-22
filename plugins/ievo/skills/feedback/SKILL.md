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

**(B) Skill-rejections feedback** — invoked from `/ievo:init` final feedback step (step 13 in v0.2.0+) with a list of skipped skills from the interview. The caller will provide context like:
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

## Step 3.75: Translate to English if needed

The `ievo-ai/skills` repo (and upstream `vercel-labs/skills`) is in English. Users may write feedback in their native language. Translate to English **before** building the issue body, but preserve the original verbatim for context.

### Detection

Look at the user's freeform text from Step 2 and any clarification answers from Step 3.5.

- If the text is **already English** → no translation needed. Skip this step.
- If the text is in **any other language** (Russian, Spanish, French, Chinese, Japanese, German, ...) → translate to English. Use your own multilingual capability — no external API.

### Translation rules

- **Preserve technical terms verbatim** — file names, command names, error messages, stack traces, library names. Don't translate `pyproject.toml`, `SimpleITK`, `/ievo:init`, etc.
- **Translate intent, not word-for-word.** The English version should read naturally to a native speaker.
- **No paraphrasing for "improvement".** Stay faithful to the user's content and tone. If they said "this is annoying", translate to "this is annoying" — not "this could be improved".

### Output format

Hold two versions:
- `body_en` — the English translation, used as the primary body
- `body_original` — the user's original text verbatim, included in collapsed `<details>` for context

If no translation was needed, `body_original` is empty and only `body_en` is used.

Structured rejection reasons (flow B options like "Not relevant to my stack") are already in English — no translation needed for those. Only the freeform note (if any) gets translated.

## Step 3.85: Offer to attach the latest init log (flow B and useful for flow A bug reports)

If a recent `.ievo/log/init-*.md` exists, ask the user once:

- **Question:** `Attach the latest /ievo:init log? (Helps maintainers diagnose what happened)`
- **Header:** `Attach log`
- **Options:**
  - `Attach (Recommended for bug reports)` — description: `Includes detected stack, discover.mjs queries + result counts, dedup outcomes, security-auditor verdicts, and your install/skip choices. No file contents, no secrets — see .ievo/log/<filename>.md to verify.`
  - `Don't attach` — description: `Keep the report short.`

If user picks `Attach`:
- Read the most recent `.ievo/log/init-*.md` (sort filenames lexicographically, take last).
- Cap at 16KB. If the log is larger, truncate from the middle with a `... <truncated N bytes> ...` marker so head + tail are preserved.
- Hold the log content for inclusion in the body in step 4.

If user picks `Don't attach` or no log exists, skip.

## Step 4: Build the issue body

### Flow A (generic) format

````markdown
## Feedback

<body_en — English translation from step 3.75, or the original if it was already English>

<if body_original is non-empty, also include:>

<details>
<summary>Original (untranslated)</summary>

<body_original — user's verbatim text in source language>

</details>

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- Claude Code: <claude --version output>
- OS: <uname output>
- Project stack: <manifest list>

<if init log was attached in step 3.85:>

<details>
<summary>Attached: /ievo:init run log</summary>

```markdown
<contents of the latest .ievo/log/init-*.md, truncated to 16KB if needed>
```

</details>

> Submitted via `/ievo:feedback` skill
````

### Flow B (skill rejections) format

````markdown
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
<freeform_en — translated if needed, or "(none)">

<if freeform_original is non-empty (user wrote in non-English), also include:>

<details>
<summary>Original note (untranslated)</summary>

<freeform_original verbatim>

</details>

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- Claude Code: <claude --version output>
- OS: <uname output>
- Project stack: <manifest list>

> Submitted via `/ievo:feedback` skill (rejections flow from `/ievo:init` final feedback step)

<if init log was attached in step 3.85:>

<details>
<summary>Attached: /ievo:init run log</summary>

```markdown
<contents of the latest .ievo/log/init-*.md, truncated to 16KB if needed>
```

</details>
````

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

**Write the body via the Write tool, NOT via `--body "..."` inline.** User-verbatim feedback may contain backticks, `$(...)`, or `${VAR}` patterns that shells interpolate if passed as an inline string argument. Write tool writes literal bytes; `--body-file` passes the file path without expansion.

```
# Step A — Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/feedback-body-<YYYYMMDDTHHMMSSZ>.md
#   content:   <body from step 4>   (literal string, no shell expansion)
```

Use ISO-8601 basic format for the timestamp (no colons — Windows-safe): `YYYYMMDDTHHMMSSZ`.

```bash
# Step B — file the issue via gh, passing the body file:
gh issue create \
  --repo ievo-ai/skills \
  --title "<title>" \
  --body-file <project>/.ievo/log/pending-reports/feedback-body-<YYYYMMDDTHHMMSSZ>.md \
  --label "<bug|enhancement|idea|question>" \
  --label "feedback"
```

For flow B add an extra label to Step B:
```bash
  --label "registry-quality"
```

The `pending-reports/` directory doubles as an audit trail — the filed body is preserved locally even after successful submission.

If `gh` is not installed or not authenticated:
- Catch the error
- Print the title and body to the user
- Print: `gh CLI not available. Open https://github.com/ievo-ai/skills/issues/new and paste the above.`
- Write the body to `.ievo/log/pending-reports/feedback-body-<YYYYMMDDTHHMMSSZ>.md` for the user to attach/paste manually

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
- **Verbatim user text — preserved in `<details>` block.** Do not paraphrase, "improve", or sanitize the user's words. If the original is non-English, translate the primary body to English (Step 3.75) but include the verbatim original in a collapsed `<details>` block so maintainers can verify the translation or fall back to it.
- **No secrets leak.** The auto-collect list is closed — version, OS, manifest names only. Do not include git remote URLs, branch names, or anything from environment variables.
- **Best-effort context.** If any Bash command in step 3 fails, omit that line. Never block submission on metadata collection.
- **Graceful gh-CLI fallback.** If `gh` is missing/unauthenticated, give the user a way to post manually — don't just say "failed".
