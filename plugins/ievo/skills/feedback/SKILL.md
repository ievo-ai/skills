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

## Step 1: Classify the feedback type

Ask the user using `AskUserQuestion`:

- **Question:** `What kind of feedback?`
- **Header:** `Type`
- **Options** (single-select):
  - `Bug` — description: `Something broke or didn't work as expected.`
  - `Feature` — description: `A new capability you'd like to see.`
  - `Idea` — description: `General suggestion or design thought.`
  - `Question` — description: `You're stuck and want help / clarification.`

Map to GitHub label: `bug` / `enhancement` / `idea` / `question`.

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

## Step 4: Build the issue body

Format the issue body like this:

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

Run:
```bash
gh issue create \
  --repo ievo-ai/skills \
  --title "<title>" \
  --body "<body from step 4>" \
  --label "<bug|enhancement|idea|question>" \
  --label "feedback"
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
