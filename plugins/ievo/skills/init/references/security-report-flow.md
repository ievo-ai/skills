# Step 8b — Report-to-source flow

Invoked only when a candidate gets a **RED** verdict in Step 8 **and** the user
picks **"Report to `<owner>/<repo>`"**. The `security-auditor` sub-agent
returned a `report_template` field (`available: true`) with a pre-filled `title`
and `body`. Walk the user through filing, then remove the candidate from the
install queue (`skip` semantics).

## 1. Preview

Show the pre-filled issue via `AskUserQuestion`:

```
Question: "Preview of issue to file at <owner>/<repo>:

Title: <report_template.title>

<body preview — first 30 lines of report_template.body>

File this issue?"

Options:
  - "File it" — invokes `gh issue create` with the prefilled content
  - "Edit body first" — opens preview in tmp file for user to edit, then re-asks
  - "Cancel" — drops the report, candidate stays skipped
```

## 2. File via `gh issue create`

**CRITICAL — write the body with the Write tool, NOT `echo "..." > file`.** The
body may contain `$(...)`, backticks, or `${VAR}` patterns from cited malicious
code excerpts — shell interpolation during `echo` would execute these. The Write
tool writes literal bytes.

**Filename safety:** use ISO-8601 *basic* format (no colons) for the timestamp —
`YYYYMMDDTHHMMSSZ` (e.g. `20260520T075958Z`). Windows filesystems reject `:`.

```
# Step A — Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/issue-body-<YYYYMMDDTHHMMSSZ>.md
#   content:   <report_template.body>   (literal string, no expansion)

# Step B — file the issue, passing the body file:
gh issue create --repo <owner>/<repo> \
  --title <report_template.title> \
  --body-file <project>/.ievo/log/pending-reports/issue-body-<YYYYMMDDTHHMMSSZ>.md
```

Quote `--title` safely — single quotes, or `--title="$TITLE"` with the title in
an env var. Never substitute the title directly via shell.

Capture the returned issue URL. The `pending-reports/` dir doubles as an audit
trail — even successful filings keep a local copy.

## 3. Show result

```
✓ Filed: <issue-url>

Thanks for contributing to community security.
```

## 4. Handle failures (candidate stays skipped in all cases)

- `gh` not authenticated → show error, fall back to copying body to clipboard with manual instructions.
- API rate limit → save body to `<project>/.ievo/log/pending-reports/<owner>-<repo>-<timestamp>.md`, tell user to file manually later.
- Repo has Issues disabled → save body, show repo URL, tell user to find an alternative reporting channel.

## Why offer Report

- **Community defense** — maintainer notified within minutes, not weeks.
- **Crowd-sourced audit** — N users × M findings = collective security signal.
- **Accountability** — GitHub issues are public; pressure to respond.
- **Low effort** — the security-auditor already prepared the text; user just confirms.
