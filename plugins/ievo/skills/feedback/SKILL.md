---
name: feedback
description: Use this skill when the user says "send feedback", "report a bug", "this didn't work", "I want to suggest a feature", "where do I file an issue for iEvo", or after iEvo has done something the user would want to comment on. Submits feedback about the iEvo plugin — bug reports, feature requests, suggestions, or general comments. Posts as a GitHub issue in `ievo-ai/skills` via `gh` CLI. When `/ievo:contributor-mode-on` has been enabled for this project, may also offer to attach the existing scrubbed tool-failure/permission-denial capture stream — still gated by the same Submit/Cancel confirmation as every other report.
argument-hint: "[title]"
license: MIT
effort: low
compatibility: "Requires `gh` CLI installed and authenticated. Falls back to printing the issue URL for manual creation if `gh` is unavailable. Always invoke with the full `ievo:` prefix (`/ievo:feedback`) — some non-CLI Claude surfaces don't autocomplete-suggest it, and a bare `feedback` can silently resolve to Claude Code's own built-in `/feedback` command instead, submitting to Anthropic support rather than this repo."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Feedback

Post user feedback as a GitHub issue in `ievo-ai/skills` so we can fix bugs, prioritize features, and improve the plugin.

## Step 0: Detect invocation context

This skill has three flows:

**(A) Generic feedback** — default. User invoked `/ievo:feedback` or expressed feedback intent freely. Go to Step 1.

**(B) Skill-rejections feedback** — invoked from `/ievo:init` final feedback step (step 13 in v0.2.0+) with a list of skipped skills from the interview. The caller will provide context like:
```
The user just completed /ievo:init interview. They installed N skills
and skipped these M skills: <list>. Collect reasons for the skips and
submit as feedback to ievo-ai/skills, copying reasons forward as
registry-improvement signal that can be relayed to vercel-labs/skills.
```

**(C) Pre-filled handoff** — the content to post is already known before this skill runs; two skills share this flow, across three trigger points:
  - **Evo handoff** — invoked from `/ievo:evo` Step 5.6 after a lesson was captured that looks like it's about the iEvo plugin itself, or from its Step 5.65 after a lesson Step 5.6 left local instead reads as a generally-reusable engineering practice (the two are mutually exclusive by Step 5.65's own gate, so a given lesson triggers at most one). Either way the caller passes the **verbatim lesson text already known** (the same text appended to the overlay, in the user's original language).
  - **Extract-best-practices handoff** — invoked from `/ievo:extract-best-practices` Phase 5 after a newly authored skill/agent package looks marketplace-worthy. The caller passes a short summary plus the **full authored package content** (already English — agent-synthesized, not user free-text) as the pre-filled body.

  Because the feedback text is already in hand either way, flow C **skips Step 2** (collect feedback text) — but runs everything else normally: Step 1 (classify type — a plugin gap is usually `Bug` or `Feature`/`Idea`; a package contribution is typically `Feature`), Step 3 (environment), Step 3.5 (clarify — usually skipped, the pre-filled content is already specific), Step 3.75 (translate to English **once, here** if needed — neither caller pre-translates, though the extract-best-practices case is agent-authored English and typically needs no translation), Step 4 (build body, flow-A format), and — critically — Step 5 (public-posting confirmation gate) **unchanged**. Nothing is posted until the user clears that gate.

If invoked in flow (B), **skip Step 1** (type is implicitly "Idea" / registry-improvement) and **jump to Step 1b** below. If invoked in flow (C), **skip Step 2** (feedback text is the pre-filled content) and otherwise proceed normally from Step 1. Otherwise (flow A) proceed with Step 1.

## Step 1: Classify the feedback type (flows A and C)

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

**Flow C (pre-filled handoff): skip this step** — the feedback text is the pre-filled content the caller already passed in (a verbatim lesson from evo, or a package writeup from extract-best-practices). Use it as-is (don't re-ask) and go to Step 3.

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
- **Detect the invoking client FIRST** (same rule as `/ievo:init` Step 1.5, **ordered**: `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code), then collect ONLY that client's own version — never run both commands, and never render the other client's label (issue #461: a Codex Desktop session that also happened to have Claude Code installed on the same machine previously reported `Claude Code: <version>` unconditionally — that number was accurate for an unrelated, uninvoked tool, which reads as misleading alongside a `Client surface: Codex Desktop app` line right next to it):
  - **Claude Code** (Step 1.5: no Codex signal) — `claude --version`
  - **Codex** (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal) — `codex --version` (the binary's own version — accurate whether invoked from a terminal or the Desktop app wrapper)
- **OS** — `uname -srm` (or `sw_vers -productVersion` on macOS)
- **Project stack** — top-level manifest files present (e.g. `pyproject.toml, package.json`)

Also infer, as a **reasoning step** (not a Bash command or env-var read):

- **Client surface** — based on the tools and context available to you in *this* session (surface-exclusive tool/MCP namespaces, explicit capability-availability/unavailability statements, product-identity signals in ambient context), state your best inference of the invoking client: `CLI terminal` / `Desktop app` / `IDE extension` / `web` / `uncertain`. This is a judgment call, not a lookup table — degrade to `uncertain` honestly whenever the signals are ambiguous or absent, rather than guessing.

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
- `body_en` — the English translation, used as the **only** body posted to the public issue
- `body_original` — the user's original text verbatim, retained **local-only** for the audit trail (Step 6). It is NEVER included in the public issue body — English is the only language that reaches GitHub.

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

## Step 3.9: Offer to attach captured tool-failure/permission-denial records (contributor mode only)

**Skip this entire step, silently, unless ALL of the following hold** — this
is Phase 1 of `ievo-ai/skills#448` ("contributor mode"), and every condition
below keeps it inside that scope:

1. **Flow A or flow C only.** Skip in flow B (rejections) — its type is
   always Idea/registry-quality, not a diagnosable malfunction.
2. **`<project>/.ievo/contributor.flag` exists.** This is the explicit,
   off-by-default opt-in from `/ievo:contributor-mode-on` — without it, never
   offer this attachment, regardless of what data exists.
3. **At least one captured record exists with `scope: "tool-failure"`.** Run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/evolution_candidates.mjs" list --project <project>
   ```
   This is the same accumulator `/ievo:evo-auto-enable`'s failure-capture hook
   already writes to (`.ievo/evolution-candidates/<session-id>.jsonl`) — every
   record's `.text` was scrubbed by `scrub.mjs` before it ever touched disk
   (see that skill's Step 3.6). Best-effort: if the command fails or
   `CLAUDE_PLUGIN_ROOT` is unset, treat as "no records" and skip silently —
   never block feedback submission on this.

Collect every candidate across all listed sessions where `scope ===
"tool-failure"`, sorted by `ts` descending (most recent first). If the
resulting list is empty, skip this step exactly like Step 3.85 skips when no
log exists — do not mention contributor mode was even checked.

If the list is non-empty, let `N = min(collected count, 20)` — the same cap
applied below — and ask the user once via `AskUserQuestion`:

- **Question:** `Attach <N> captured tool-failure/permission-denial record(s)? (Helps maintainers diagnose what happened — contributor mode is ON)`
- **Header:** `Attach records`
- **Options:**
  - `Attach (Recommended for bug reports)` — description: `Includes up to 20 most-recent scrubbed records: which tool failed/was denied, its error, and that call's own input arguments — so a denied Write/Edit record carries the start of the file text it was writing. scrub.mjs redacts secret-shaped values, rewrites $HOME paths, and caps each record at 500 characters; it does NOT strip code or file contents. Read them first at .ievo/evolution-candidates/*.jsonl.`
  - `Don't attach` — description: `Keep the report to environment context only.`

`<N>` in the question is always the post-cap count (`min(collected count,
20)`) — the same number the `Attach` option's own "up to 20" description
implies, so the two can never disagree even when the collected list is
longer than 20.

If user picks `Attach`:
- Take the `N` most-recent matching candidates (by `ts` descending).
- Format each as one line: `<ts> <text>` (the `.text` field is already the
  scrubbed, compact JSON record — do not re-parse or reformat its content,
  just cap the joined total).
- Cap the joined lines at 8KB. If larger, truncate from the end (oldest of
  the `N` kept), appending a `... <truncated N record(s)> ...` marker — the
  newest records matter most for diagnosing a current malfunction.
- **Fence containment.** Each record's `.text` originates from real tool
  call inputs/outputs (e.g. a denied `Write`/`Edit` call's content argument,
  or a failed command's output) — untrusted content that already passed
  through `scrub.mjs`'s secret/path/length transform but NOT through any
  Markdown-neutralizing step, so it can still plausibly contain a literal
  triple-backtick run. Since Step 4 embeds this block inside a fenced code
  span, before writing it: scan the joined lines for the longest run of
  consecutive backticks they contain, and fence the block with a backtick
  run **one character longer** than that (minimum 3, i.e. plain ` ``` ` when
  no backtick run is present) — so an embedded triple-backtick can never
  close the fence early and let the remainder render as live Markdown/HTML
  in the public issue. Same containment principle as this file's own
  "Identifier containment" note below (Step 4), applied to a multi-line
  fenced block instead of an inline span.
- Hold the formatted block, and the fence length it needs, for inclusion in
  Step 4.

If user picks `Don't attach` or the list was empty, skip — do not fabricate
an empty section in Step 4.

**This is read-only against the capture queue.** Attaching here never
consumes, prunes, or otherwise modifies `.ievo/evolution-candidates/` — that
queue remains exactly as `/ievo:evo`'s own review flow expects it.

**Out of scope, not built here (do not attempt):** a full session transcript
or distilled `.jsonl` export ("Phase 2" of `#448`) is a separate, larger,
security-sensitive capability with no design or approval yet — never
synthesize one in place of this step. Likewise, contributor mode never
removes Step 5's Submit/Cancel confirmation, on this report or any other.

## Step 4: Build the issue body

### Flow A (generic) format

````markdown
## Feedback

<body_en — English translation from step 3.75, or the original if it was already English>

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- <render exactly ONE line here, for whichever client Step 3 detected — never both, never the other client's label. Claude Code detected: the literal label "Claude Code: " followed by the `claude --version` output. Codex detected (CLI or Desktop): the literal label "Codex: " — never "Codex CLI:" — followed by the `codex --version` output, which per Step 3's note is accurate for both surfaces, so the CLI/Desktop distinction stays only in the Client surface line below.>
- OS: <uname output>
- Project stack: <manifest list>
- Client surface: <inference from Step 3, or "uncertain">

<if init log was attached in step 3.85:>

<details>
<summary>Attached: /ievo:init run log</summary>

```markdown
<contents of the latest .ievo/log/init-*.md, truncated to 16KB if needed>
```

</details>

<if tool-failure/permission-denial records were attached in step 3.9:>

<details>
<summary>Attached: N captured tool-failure/permission-denial record(s) (contributor mode)</summary>

<fence with a `text` language tag, using a backtick run one character longer
than the longest backtick run found in the record lines below — plain triple
backtick when none is found (Step 3.9's "Fence containment" rule)>
<the formatted, capped record lines from step 3.9 — already scrubbed>
<matching closing fence>

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
- `<owner/repo@skill>` — (no comment, accepted)
- ...

### Skipped with reasons
- `<owner/repo@skill>` — Reason: <Not relevant to my stack | Already using alternative | Low quality | Don't need right now>
- ...

### Note from user
<freeform_en — translated if needed, or "(none)">

---

## Environment

- iEvo plugin: <version> (<commit-sha>)
- <render exactly ONE line here, for whichever client Step 3 detected — never both, never the other client's label. Claude Code detected: the literal label "Claude Code: " followed by the `claude --version` output. Codex detected (CLI or Desktop): the literal label "Codex: " — never "Codex CLI:" — followed by the `codex --version` output, which per Step 3's note is accurate for both surfaces, so the CLI/Desktop distinction stays only in the Client surface line below.>
- OS: <uname output>
- Project stack: <manifest list>
- Client surface: <inference from Step 3, or "uncertain">

> Submitted via `/ievo:feedback` skill (rejections flow from `/ievo:init` final feedback step)

<if init log was attached in step 3.85:>

<details>
<summary>Attached: /ievo:init run log</summary>

```markdown
<contents of the latest .ievo/log/init-*.md, truncated to 16KB if needed>
```

</details>
````

**Identifier containment.** The `<owner/repo@skill>` values above come from a
skill/agent/plugin candidate's own frontmatter (attacker-influenced —
sourced from `discover.mjs`/skills.sh during `/ievo:init`, which feeds this
flow via its Step 13 rejection-reasons handoff), and this template becomes a
**public, auto-rendering** GitHub issue filed in `ievo-ai/skills` (Step 6
below). GitHub renders `![...](...)` and `[...](...)` the moment anyone
views the issue, so a crafted identifier could smuggle a live-rendering
exfiltration beacon or a spoofed link that fires with no further agent
action needed. Wrap each `<owner/repo@skill>` value in an inline code span
before writing it into the template — using a backtick run one character
longer than the longest backtick run already inside the identifier, so it
can't break out of its own span — rather than embedding it raw. The `skill`
half is NOT charset-constrained by anything upstream: `discover.mjs`'s
`skill.name` field only checks `typeof === "string"` (no agentskills.io
`[a-z0-9-]+` allowlist is applied at fetch time, whether the entry came from
skills.sh or the Codex marketplace path), and `install-protocol.md`'s own
naming check gates the INSTALL write, not this rejection-reasons render — so
a leading/trailing backtick in `skill` is reachable here. Pad with a single
literal space on BOTH sides when the identifier begins or ends with a
backtick (CommonMark strips the pad only when both ends carry one; a
one-sided pad would leave a stray space on display), and collapse every
CR/LF run in the identifier to a single space before measuring the backtick
run and wrapping (a blank line ends the list item before inline parsing
runs, same as every other multi-line excerpt in this file's sibling rules).
(Same pattern as `security-check/SKILL.md`'s "Excerpt containment" note and
`vuln-scan/SKILL.md`'s identical rule for `title`/`exploit_chain.*`.)

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

**Write the body via the Write tool, NOT via `--body "..."` inline.** User-verbatim feedback may contain backticks, `$(...)`, or `${VAR}` patterns that shells interpolate if passed as an inline string argument. Write tool writes literal bytes; `--body-file` passes the file path without expansion. (Same pattern enforced in `init/SKILL.md` Step 8b — see the **CRITICAL** note there.)

**The derived title needs the same protection — it is also built from user-verbatim feedback text, not a fixed string.** `gh issue create` has no `--title-file` flag, so the title can't be passed as a file path the way the body is. Instead: write the title to a file via the Write tool (Step A1 below, literal bytes, no shell), then in Step B read it into a shell variable with `TITLE=$(cat "$TITLE_FILE")` and pass it as `--title "$TITLE"` — always double-quoted. A double-quoted variable reference substitutes the stored bytes verbatim; it does not re-invoke the shell parser on them, so embedded `$(...)`, backticks, `;`, or `&&` in the title cannot execute. Never build `--title "<literal title text>"` as an inline Bash string — that string IS parsed by the shell before `gh` ever sees it.

```
# Step A — Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/feedback-body-<YYYYMMDDTHHMMSSZ>.md
#   content:   <body from step 4>   (literal string, no shell expansion)
#
# Step A1 — the derived title — Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/feedback-title-<YYYYMMDDTHHMMSSZ>.md
#   content:   <title from the Title format list above>   (literal string, no shell expansion)
#   Written for the same reason as the body: the title is derived from
#   user-verbatim feedback and must never be embedded raw into a Bash string.
#   Step B reads it back into a shell variable and passes it quoted.
#
# Step A2 — LOCAL-ONLY original (ONLY if Step 3.75 translated, i.e. body_original
#           is non-empty) — Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/feedback-original-<YYYYMMDDTHHMMSSZ>.md
#   content:   <body_original — user's verbatim source-language text>
#   This file is the local translation-QA reference. It is NEVER passed to
#   `gh issue create` (--body-file below points only at the feedback-body-*.md
#   from Step A), so the untranslated original stays on the user's machine and
#   never reaches the public issue.
```

Use ISO-8601 basic format for the timestamp (no colons — Windows-safe): `YYYYMMDDTHHMMSSZ`. Reuse the SAME `<YYYYMMDDTHHMMSSZ>` value for every file (body, title, and — when applicable — original) so they pair up.

```bash
# Step B — file the issue via gh, passing the body file and the title read
# back from its own file (Step A1) into a shell variable.
#
# The labels below are hard-coded, but nothing guarantees they exist in the
# target repo (a fresh clone/fork, or a label deleted upstream, reintroduces
# the gap). Two defenses, in order:
#   B1. Best-effort provision the labels that have been missing.
#   B2. If `gh issue create` still rejects the label set, retry WITHOUT labels
#       so the feedback text is never lost.

BODY_FILE="<project>/.ievo/log/pending-reports/feedback-body-<YYYYMMDDTHHMMSSZ>.md"
TITLE_FILE="<project>/.ievo/log/pending-reports/feedback-title-<YYYYMMDDTHHMMSSZ>.md"

# TITLE is captured via command substitution from a file the Write tool wrote
# (never from the raw derived-title text embedded in this script). The
# double-quoted "$TITLE" reference below substitutes those bytes verbatim —
# the shell does not re-parse a variable's stored content, so it cannot
# execute `$(...)`, backticks, `;`, or `&&` that a crafted feedback title
# might carry.
TITLE=$(cat "$TITLE_FILE")

# B1 — idempotent label provisioning. `|| true` swallows both "already exists"
# (label present → keep its current definition) and the permission error a
# non-maintainer hits when filing against ievo-ai/skills (they can't create
# labels, but B2 still lets their issue land). Only the two labels observed
# missing are provisioned here; existing labels (bug/enhancement/question/
# feedback) need no action.
gh label create "idea" --repo ievo-ai/skills \
  --color "d4c5f9" --description "General suggestion or design thought (via /ievo:feedback)" 2>/dev/null || true
gh label create "registry-quality" --repo ievo-ai/skills \
  --color "fbca04" --description "Signal to improve skill-registry recommendation quality" 2>/dev/null || true

# B2 — create the issue. Flow A: TYPE_LABEL is bug|enhancement|idea|question
# (from Step 1). Flow B: TYPE_LABEL is idea, plus registry-quality.
LABEL_ARGS=(--label "<bug|enhancement|idea|question>" --label "feedback")   # flow B: also add --label "registry-quality"

# Try with labels first; on ANY non-zero exit (unknown label, missing label,
# or no label-add permission) retry once with no labels so the submission
# survives. The title (`[bug]`/`[feature]`/…) and body already carry the
# classification, so a maintainer can re-apply labels during triage.
if ! ISSUE_URL=$(gh issue create \
      --repo ievo-ai/skills \
      --title "$TITLE" \
      --body-file "$BODY_FILE" \
      "${LABEL_ARGS[@]}" 2>&1); then
  echo "Label step failed — retrying without labels so the report still lands:" >&2
  echo "$ISSUE_URL" >&2
  ISSUE_URL=$(gh issue create \
    --repo ievo-ai/skills \
    --title "$TITLE" \
    --body-file "$BODY_FILE")
fi
# $ISSUE_URL is the created issue URL (report it in Step 7). If this second
# call also fails, fall through to the gh-unavailable handling below.
```

If the labels had to be dropped (B2 fallback fired), tell the user in Step 7 which labels couldn't be applied and that the classification is preserved in the title/body — so triage can restore them.

The `pending-reports/` directory doubles as an audit trail — the filed body, the filed title (`feedback-title-*.md` from Step A1), and — when a translation happened — the local-only `feedback-original-*.md` from Step A2 are all preserved locally even after successful submission. The `feedback-original-*.md` file is deliberately excluded from what `gh issue create` uploads — it exists only so a maintainer can verify the translation locally, never in the public issue.

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

On success but with labels dropped (Step 6 B2 fallback fired):
- Still report `✓ Submitted as <url>` — the issue landed.
- Add: `Note: couldn't apply labels (they may not exist in the repo or you lack label permission). The type is in the title/body, so a maintainer can re-label during triage.`

On failure (gh missing or network):
- Show the user the body to copy/paste manually
- Show the URL to create issues: https://github.com/ievo-ai/skills/issues/new

## Step 7.5: Offer a local evo handoff (flow A — a Bug about a specific agent or skill)

This is the mirror of the evo → feedback bridge (`evo/SKILL.md` Step 5.6, flow **(C)**): once a bug about an agent or skill has been filed upstream, the fix ships on the upstream repo's timeline — but the project stays exposed until then. Offer to capture a **local** workaround/lesson into this project's evolution overlay right now, so the project is protected immediately while the upstream fix is pending. On the next `/ievo:update`, that overlay entry can be revisited once the fixed version ships. Together the two directions form a two-way bridge: a lesson worth sharing goes upstream, and a reported bug gets an immediate local mitigation.

Run this only **after Step 7 reported a successful submission** (an issue URL exists — if the user cancelled at Step 5, the flow already ended there; if Step 6 failed, let the user finish filing manually first). **Never automatic — same explicit-gate philosophy as the rest of the plugin.** Offer at most once, and only when ALL of these hold:

1. **Flow A only.** Skip entirely in flow **(B)** (rejections — the type is Idea, not a bug) and in flow **(C)** (this feedback was itself invoked from `/ievo:evo` Step 5.6). The flow-C skip is the **loop guard**: a bug captured via evo → feedback must not immediately bounce back feedback → evo. It also breaks the forward loop — a handoff from this step lands in `evo`, whose own Step 5.6 may offer feedback again as flow **(C)**, where this step is skipped, so the bridge always terminates.
2. **Type == `Bug`** (from Step 1). A Feature / Idea / Question is not a defect to mitigate locally.
3. **The bug targets a specific agent or skill.** Reuse `evo/SKILL.md` Step 1's scope-classification signals — the feedback names or clearly describes a specific agent ("the `<x>` agent did/should…") or skill ("the `<x>` skill did/should…", "when working with `<x>`, it…"). A bug with no identifiable agent/skill target (e.g. a generic install or CLI problem) is **not** offered — there is no overlay scope to write into.

When any condition fails, **write nothing and ask nothing** — the offer simply wasn't applicable; the skill is done.

**If all hold, offer once via `AskUserQuestion` (never auto-capture):**

- **Question:** `Bug filed. Also capture a local workaround now, so this project is protected while the upstream fix is pending?`
- **Header:** `Local fix`
- **Options** (single-select):
  - `Capture locally (Recommended)` — description: `Hands off to /ievo:evo to add a mitigation to this project's overlay for the affected agent/skill. You still review and confirm the overlay entry there. Nothing is posted anywhere.`
  - `Skip` — description: `File the upstream bug only — no local overlay entry.`

If the user picks **Skip** (or the platform can't prompt / has no `evo` skill available): nothing is captured — the skill is done.

If the user picks **Capture locally:** hand off to the `evo` skill (`/ievo:evo`) with the lesson **pre-filled**:

- Pass the **English bug body** (`body_en` from Step 3.75 — already translated, the same text posted to the issue) as the lesson text, and set the **target** to the agent or skill the bug named (condition 3). Do **not** re-translate — `body_en` is already English.
- `evo` then runs its **Steps 1–5.6 unchanged**: scope confirmation (Steps 1 / 1.5), overlay append (Step 4), one-time marker injection, and its own Step 5.6 — same "the receiving skill still runs its own gates" pattern the reverse bridge uses. Nothing about this skill's public issue is affected.
- The public issue you just filed stands regardless of the local-capture outcome; likewise the local overlay entry (once captured) stands regardless of the issue.

Then report the outcome in one line so the audit trail is complete — e.g. `Local mitigation: captured via /ievo:evo (skills/<name>)`, or `Local mitigation: offered → skipped`. When the step wasn't applicable (conditions above not met), print nothing about it.

## Rules

- **Public posting requires explicit confirm.** Never skip step 5. Feedback is public on the internet; no surprises.
- **English-only in public issues; verbatim original kept local-only.** Do not paraphrase, "improve", or sanitize the user's words. If the original is non-English, translate the body to English (Step 3.75) and post **only** the English version to the public issue — never echo the source-language text into the issue body. The verbatim original is preserved for translation verification in `.ievo/log/pending-reports/feedback-original-*.md` (local audit trail only, Step 6), never on GitHub.
- **No secrets leak.** The Bash auto-collect list is closed — version, OS, manifest names only. Do not include git remote URLs, branch names, or anything from environment variables. Client surface is the one exception to "Bash only", and it is not an exception to "no env vars": it's a model-reasoning inference from session context, never a `$VAR` read. Step 3's client-detection read (`$CODEX_CLI` / Codex Desktop signals, same rule as `/ievo:init` Step 1.5) is control-flow only — it selects which version command to run and which label to render; the env var's own value is never included in the posted body, only the resulting `claude --version`/`codex --version` output.
- **Neutralize identifiers before they go public.** Flow B's `<owner/repo@skill>` values are filed as a public, auto-rendering GitHub issue — see § Step 4's "Identifier containment" note for the fencing rule.
- **Best-effort context.** If any Bash command in step 3 fails, omit that line. Never block submission on metadata collection.
- **Graceful gh-CLI fallback.** If `gh` is missing/unauthenticated, give the user a way to post manually — don't just say "failed".
- **A missing label never loses a submission.** Labels are best-effort metadata; the feedback text is the value. Provision missing labels idempotently, and if `gh issue create` still rejects the label set, retry without labels rather than dropping the report (Step 6, B1/B2).
- **Two-way bridge, gated and loop-safe both ways.** Step 7.5 offers a feedback → evo *local* capture only for a flow-A `Bug` about a specific agent/skill, and **never in flow (C)** — that single skip is the loop guard for both directions. It mirrors `evo/SKILL.md` Step 5.6's evo → feedback offer; both directions are `AskUserQuestion` offers, never automatic, and each receiving skill still runs its own gates.
- **Flow (C) has two callers, one contract.** `evo/SKILL.md` (Step 5.6, a lesson about iEvo itself, or Step 5.65, a generally-reusable lesson — a one-line lesson either way) and `extract-best-practices/SKILL.md` Phase 5 (a full package writeup) all pre-fill the body and skip Step 2, but neither bypasses Step 1, Step 3.5, or Step 5 — the receiving skill (this one) still runs its own gates regardless of what pre-filled it.
- **Contributor-mode payload widening is gated, additive, and never a shortcut around Step 5.** Step 3.9 offers the scrubbed tool-failure/permission-denial capture stream ONLY when `.ievo/contributor.flag` is present (`/ievo:contributor-mode-on`) AND at least one `scope: tool-failure` candidate exists — otherwise it is a silent no-op, same as Step 3.85's log-attach when no log exists. It never attaches a session transcript (that capability doesn't exist — see Step 3.9's own note) and never skips or weakens Step 5's Submit/Cancel confirmation.
