---
name: inspect
description: "Use this skill when the user asks \"what does owner/repo contain\", \"inspect this skill before install\", \"show me what's in owner/repo\", \"summarise owner/repo without installing\", \"what skills does this repo have\", or invokes /ievo:inspect <owner>/<repo> — not for listing your own project's already-installed evolution overlays (use /ievo:overlay-status for that). Pre-install structured summary of a remote skill/plugin repo. Fetches the repo tree and key files via gh API, then renders a human-readable capability overview — skills, agents, commands, scripts, permission footprint — without triggering discovery, security scan, or install."
argument-hint: "[owner/repo] [ref]"
license: MIT
effort: low
allowed-tools:
  - Bash(gh *)
compatibility: "Requires `gh` CLI for GitHub API access (authenticated). Works on any agentskills.io platform that supports Bash tool with gh CLI. Read-only — no files written, no install, no security scan."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Inspect — pre-install structured summary of a remote repo

Produce a structured capability summary of a remote GitHub repo that hosts skills, agents, or plugins — before committing to the full `/ievo:init` pipeline. Answers "what does this repo contain?" typically in under a minute with zero side effects.

## When to use

- User is evaluating a plugin/skill repo and wants a quick overview before running `/ievo:init`
- User received a recommendation and wants to understand the permission footprint before granting security scan time
- Onboarding a collaborator to an already-installed plugin — they need to understand what it does
- User explicitly invokes `/ievo:inspect <owner>/<repo>`
- User asks "what does `owner/repo` contain?", "inspect this skill before install", "show me what's in `owner/repo`"

## Inputs

- **Required:** `<owner>/<repo>` — a GitHub repository identifier (e.g. `ievo-ai/skills`, `anthropics/claude-skills`, `wshobson/agents`)
- **Optional:** `<ref>` — a branch, tag, or commit SHA. Defaults to `HEAD` (the repo's default branch)

Parse the input from the user's message. Accept forms like:
- `/ievo:inspect owner/repo`
- `/ievo:inspect owner/repo@ref`
- `inspect owner/repo`
- `what does owner/repo contain?`

## Step 1: Resolve the repo and default ref

Verify the repo exists and resolve the default branch if no ref was provided:

```bash
gh api "repos/<owner>/<repo>" --jq '.default_branch'
```

If the API call fails, report clearly based on the error:

- **404** — `Repository '<owner>/<repo>' not found. Check the repo name and spelling.`
- **403** — `Access denied to '<owner>/<repo>'. Check that 'gh' is authenticated with sufficient token scope (repo access for private repos).`
- **429** — `GitHub API rate limit hit. Wait a few minutes and try again.`
- **Any other error** — report the raw error message from `gh api`, fenced per § Step 5's "Excerpt containment" rule before rendering it (collapse line breaks, measure the longest backtick run, pad if it starts/ends with a backtick, wrap) — this text originates from GitHub's own API response body for an unclassified error, not from an allowlist-validated field, so it is not assumed safe by default.

Exit cleanly on any failure. Do NOT retry or guess alternative names.

Store the resolved ref (default branch name, or user-provided ref) for all subsequent API calls.

**Validate the ref before any further use.** Whether `<ref>` came from the user or from the API's `default_branch`, treat it as untrusted — `git check-ref-format` permits backtick, `$`, `(`, `)`, `;`, `|`, and quote characters in a legal branch/tag name, any of which would execute as shell metacharacters if interpolated into a Bash command. Before `<ref>` is used in Step 2 or any later `gh api` call, check it against this allowlist:

- Matches `^[A-Za-z0-9._/-]+$` (letters, digits, `.`, `_`, `-`, `/` only)
- Does not start with `-` (would be parsed as a flag)
- Does not contain `..` or `@{`

If `<ref>` fails any check, report `` Ref `<ref>` contains invalid characters — refusing to use it in a shell command. `` and exit cleanly — `<ref>` itself fenced per § Step 5's "Excerpt containment" rule (collapse line breaks, measure the longest backtick run, pad if it starts/ends with a backtick, wrap) before interpolating it into that message. This is exactly the site the exemption elsewhere in this file for an already-validated `<ref>` does NOT cover: it fires precisely when `<ref>` has just FAILED that same allowlist, and `<ref>` can be the target repo's own `default_branch` (fetched in Step 1 from the target's GitHub settings, not the user's typed argument), where `git check-ref-format` permits `` ` ``, `<`, `>`, and other Markdown metacharacters. Do NOT interpolate an unvalidated ref into any Bash command.

## Step 2: Fetch the repo tree

Enumerate all files recursively using the git trees API. Fetch the raw JSON (no `--jq` filter) so the top-level `truncated` field is preserved:

```bash
gh api "repos/<owner>/<repo>/git/trees/<ref>?recursive=1"
```

From the response JSON, extract:
1. **`truncated`** (boolean) — if `true`, the tree listing is incomplete (very large repos). Store this flag for the output footer.
2. **File paths** — `.tree[] | select(.type=="blob") | .path` — every file path in the repo at the given ref. Store the full list for classification in Step 3.

If the API call fails (non-zero exit or empty output), the ref is likely invalid. Report: `Ref '<ref>' not found in <owner>/<repo>. Check the branch name, tag, or commit SHA.` Exit cleanly.

## Step 3: Classify the repo structure

Scan the file list from Step 2 to detect the repo layout and categorise items. Look for these patterns:

### 3a. Plugin detection

- `.claude-plugin/plugin.json` or `*/.claude-plugin/plugin.json` — Claude Code plugin
- `.codex-plugin/marketplace.json` or `*/.codex-plugin/marketplace.json` — Codex plugin
- Marketplace-level manifest: a root `.claude-plugin/marketplace.json` with a `plugins` array indicates a multi-plugin marketplace repo

### 3b. Skill detection

- `*/SKILL.md` or `SKILL.md` at any depth — agentskills.io-compliant skills
- Skills inside plugins typically live at `plugins/<name>/skills/<skill-name>/SKILL.md`
- **Exclude** paths under `tests/`, `test/`, `fixtures/`, `__tests__/`, and `spec/` directories — these are likely test fixture copies, not real skills. Including them would inflate the skill count and pollute the Permission Footprint with synthetic `allowed-tools`.

### 3c. Agent detection

- `*/agents/*.md` files — sub-agents (Claude Code / Codex Task tool)
- Filter out non-agent `.md` files by checking if they're inside an `agents/` directory

### 3d. Command detection

- `*/commands/*.md` files — slash commands (Claude Code-specific)

### 3e. Script detection

- `*/scripts/*.mjs`, `*/scripts/*.js`, `*/scripts/*.sh`, `*/scripts/*.py` — helper scripts

### 3f. Hook detection

- `*/hooks/hooks.json` or `hooks.json` — lifecycle hooks
- `*/hooks/scripts/*` — hook script files

### 3g. MCP detection

- `.mcp.json` or `*/.mcp.json` — MCP server configurations

Record each detected item with its path for fetching in Step 4.

## Step 4: Fetch key file contents

For each detected item, fetch its content to extract metadata. Prioritise breadth over depth — fetch frontmatter and first lines, not entire file bodies.

Prioritise fetches in this order: plugin manifests first, then SKILL.md files, then agent `.md` files, then command files, then hooks, then scripts last. When the total item count exceeds the 30-fetch cap, skip lower-priority categories.

If any fetch returns null content (file over 1MB) or exits non-zero, skip the item and note the skipped `<path>` in the output footer — using the same fenced-path form as the validation-skip note below, since this `<path>` is exactly as untrusted, whether or not it happened to pass the allowlist.

**Validate each `<path>` before fetching.** Every `<path>` used in 4a-4e comes from the target repo's own (attacker-controlled) tree listing in Step 2, so it is untrusted the same way `<ref>` is (Step 1). Before any `<path>` is interpolated into a `gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>"` call, check it against the same allowlist: matches `^[A-Za-z0-9._/-]+$`, does not start with `-`, does not contain `..` or `@{`. If a `<path>` fails validation, skip that item — do NOT interpolate it into any Bash command — and note it in the output footer as `` `<path>` skipped: invalid characters ``, with `<path>` itself fenced per § Step 5's "Excerpt containment" rule (collapse line breaks, measure the longest backtick run, pad if it starts/ends with a backtick, wrap) before interpolating it into that footer line. A path that just failed THIS validation is the most likely of any placeholder in this file to carry the exact Markdown-metacharacter payload that rule exists to contain.

### 4a. Plugin manifests

For each detected `plugin.json`:

```bash
gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" --jq '(.content // empty) | @base64d'
```

Extract: `name`, `version`, `description`, `author`, `license`, `keywords`.

### 4b. Skill frontmatter

For each detected `SKILL.md`, fetch and parse the YAML frontmatter (the `---`-delimited block at the top):

```bash
gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" --jq '(.content // empty) | @base64d'
```

Extract from frontmatter: `name`, `description`, `allowed-tools`, `compatibility`, `effort`, `license`.

Limit the content to the first 100 lines — frontmatter and description are at the top. No need to read the full skill body for an inspect.

### 4c. Agent frontmatter

For each detected agent `.md`, fetch and parse YAML frontmatter.

Extract: `name` (or filename minus `.md`), `description`, `model`.

### 4d. Command files

For each detected command `.md`, fetch the first 20 lines to extract the command name (from filename or frontmatter) and a one-line description.

### 4e. Hook manifests

If `hooks.json` is found, fetch and parse it.

Extract: event types (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, etc.) and the commands they run.

### 4f. README

If `README.md` exists at the repo root, fetch the first 40 lines for a project-level summary. If `gh api` exits non-zero (e.g. 403 for files over 1MB), skip the README summary and note it was too large to fetch.

**Fetch cap:** Cap file content fetches at 30 to keep the inspect fast. Note in the output if some items were skipped.

## Step 5: Render the capability summary

Produce a structured Markdown summary. Use this format:

```markdown
## Inspect: <owner>/<repo> (ref: <ref>)

<One-paragraph summary from README or plugin description, if available.>

### Plugin(s)

| Name | Version | License | Description |
|------|---------|---------|-------------|
| <name> | <version> | <license> | <description> |

<If no plugins detected: "(no plugin manifests found)">

### Skills (<N> found)

| Name | Description | Effort | Allowed Tools |
|------|-------------|--------|---------------|
| <name> | <description, truncated at 120 chars> | <effort> | <allowed-tools list or "—"> |

<If no skills detected: "(no agentskills.io SKILL.md files found)">

### Agents (<N> found)

| Name | Model | Description |
|------|-------|-------------|
| <name> | <model alias> | <description, truncated at 120 chars> |

<If no agents detected: "(no agent definitions found)">

### Commands (<N> found)

| Name | Description |
|------|-------------|
| <name> | <one-line description> |

<If no commands detected: "(no slash commands found)">

### Scripts (<N> found)

- `<path>` — <brief purpose from filename or first comment line>

<If no scripts detected: "(no scripts found)">

### Hooks

<If hooks.json found, list event → command mappings. Otherwise: "(no hooks defined)">

### MCP Servers

<If .mcp.json found, list server names and transport types. Otherwise: "(no MCP servers defined)">

### Permission Footprint

Aggregate `allowed-tools` across ALL skills into a deduplicated list:

**Tools requested by skills in this repo:**
- `Read` — used by <N> skill(s)
- `Bash(gh *)` — used by <N> skill(s)
- `Write` — used by <N> skill(s)
- ...

<If no skills have allowed-tools: "No skills in this repo declare `allowed-tools` in their frontmatter.">

<If any skill has broad permissions like `Bash(*)`, `Write(*)`, or `Edit(*)`, flag it:>
> **Note:** <skill-name> requests broad access (`Bash(*)` / `Write(*)` / `Edit(*)`). Review its SKILL.md body before installing.

---

**Ref inspected:** `<ref>` (`<commit SHA if available>`)
**Files in repo:** <total file count from tree>
**Items fetched:** <number of files whose content was read> / <total items detected>
<If tree was truncated: "**Note:** Repository tree was truncated by the API — some files may not appear above.">

**Next steps:**
- To install: run `/ievo:init` and select this repo when it appears, or add it manually
- For a security verdict first: run `/ievo:security-check <owner>/<repo>@<skill-name>` (e.g. `/ievo:security-check ievo-ai/skills@evo` — here `evo` is the skill name, not a git branch)
- To index the full repo structure: run `/ievo:index-repos <owner>/<repo>`
```

**Excerpt containment.** Every value interpolated into the template above that
originates from the target repo's own (unvetted) files — fetched in Step 4 —
is untrusted content by construction: `/ievo:inspect` is explicitly the
pre-vetting entry point, "without triggering discovery, security scan, or
install", so this is the first surface that content reaches. The summary
renders directly in the chat UI the moment it is displayed, and GitHub-flavored
Markdown clients render `![...](...)` and `[...](...)` on sight — a crafted
`description:`/README/`hooks.json` command containing either would render live
with no further agent action needed. Wrap each such value in an inline code
span before writing it into the template — using a backtick run one character
longer than the longest backtick run already inside the value, so it can't
break out of its own span — rather than embedding it raw. Never delete or
paraphrase a value away; render it verbatim inside its span. Where the
template already shows a placeholder inside single backticks (`<path>`, the
Permission Footprint tool names), that is illustrative, not a fence — size the
run per value by the same longest-run-plus-one rule.

**This covers every repo-derived placeholder, not just the tables.** Fencing
only the table cells relocates the payload instead of containing it — the
untrusted values reach the Scripts, Hooks, MCP Servers, Permission Footprint
and broad-access surfaces too. The list below is exhaustive and closed:

- **Summary paragraph** — the README excerpt or plugin description (Step 4f / 4a).
- **Plugin(s) table** — `name`, `version`, `license`, `description`.
- **Skills table** — `name`, `description`, `effort`, `allowed-tools`.
- **Agents table** — `name`, `model`, `description`.
- **Commands table** — `name`, `description`.
- **Scripts list** — BOTH halves of `` - `<path>` — <brief purpose> ``: the
  purpose is the script's first comment line, lifted verbatim out of an
  unvetted file, and the path comes from the repo's own tree listing (Step 2).
  Step 4's `^[A-Za-z0-9._/-]+$` path allowlist does not cover this: it gates
  *fetching*, and scripts are fetched last, so a path dropped by the 30-fetch
  cap still renders here (with its purpose derived from the filename) having
  never been validated.
- **Hooks list** — both halves of every `event → command` mapping. The
  commands are arbitrary strings the repo chose in its `hooks.json` (Step 4e),
  and so are the event keys they are listed under.
- **MCP Servers list** — every server name and transport type, arbitrary
  strings from the repo's `.mcp.json` (detected in Step 3g).
- **Permission Footprint** — every aggregated tool string (`Read`,
  `Bash(gh *)`, …). These are `allowed-tools` frontmatter values authored by
  the repo, i.e. free text, not a fixed vocabulary this skill controls.
- **Broad-access note** — the `<skill-name>` in `> **Note:** <skill-name>
  requests broad access`. A blockquote is not a fence: a crafted name renders
  live inside one exactly as it would anywhere else.
- **Skipped-item footer notes (Step 4)** — both the null/failed-fetch note
  and the failed-path-validation note (`` `<path>` skipped: invalid
  characters ``) render a repo-derived `<path>` in the output footer. The
  validation-skip note in particular quotes a path that JUST failed the
  `^[A-Za-z0-9._/-]+$` allowlist — the single placeholder in this file most
  likely to carry live Markdown metacharacters, since that's exactly what
  the allowlist rejects.
- **Step 1's ref-validation-failure message and its any-other-`gh api`-error
  message.** The ref one quotes `<ref>` at exactly the moment it failed the
  allowlist — the one site in this file where the "already passed Step 1's
  allowlist" exemption for `<ref>` does not hold, since it fires ONLY when
  that check just failed, and `<ref>` can be the target repo's own
  `default_branch`, not the user's typed argument. The error-message one
  quotes GitHub's raw API response body for an unclassified error, which is
  not an allowlist-validated field at all.

The remaining placeholders need no fencing, and this is the complete list of
exemptions: every `<N>`, `<total file count>` and `<items fetched>` is a tally
this skill computes itself; `<commit SHA if available>` is API-shaped hex;
`<ref>` has already passed Step 1's `^[A-Za-z0-9._/-]+$` allowlist by the
time it reaches Step 5 or any surface below, which admits no Markdown
metacharacter — the one exception is Step 1's OWN failure message, covered
above, which by definition renders `<ref>` before or instead of that pass;
`<owner>/<repo>` is the user's own
argument, resolved against a real repository in Step 1 — GitHub's own naming
rules admit no Markdown metacharacter either; and the `<skill-name>` in the
**Next steps** section's `/ievo:security-check <owner>/<repo>@<skill-name>`
line is fixed command-syntax guidance, never substituted with a
repo-discovered skill name — the parenthetical "(e.g. `.../skills@evo` —
here `evo` is the skill name, not a git branch)" clarifies syntax for the
user, who fills in a real name themselves when they run it, exactly like the
`<owner>/<repo>` earlier in the same line.

Wrapping alone is not enough on this template's surfaces: three Markdown
mechanics — two GFM, one CommonMark — cut a code span open from the outside,
so normalize every value BEFORE measuring its fence and wrapping it.

- **Collapse line breaks to spaces (every value, every surface).** A table row
  must occupy exactly one line, a list item's or blockquote's content ends at a
  blank line, and a code span cannot contain a blank line — so a value carrying
  a line break (a multi-line `description:`, a README paragraph break, a
  multi-line `hooks.json` command) breaks its own row, bullet or quote, or
  terminates its own span, and everything after the break renders as live
  Markdown. Replace every CR/LF run inside the value with a single space.
- **Escape `|` as `\|`, doubling any backslash run in front of it (table
  cells only).** GFM splits a row into cells on unescaped pipes *before*
  inline parsing, so a pipe inside backticks still ends the cell — the rule
  in the spec is "include a pipe in a cell's content by escaping it,
  **including inside other inline spans**" (GFM § Tables (extension),
  example 200). A `description:` of `x | ![a](u)` wrapped in backticks
  therefore renders as two cells, the second one a live image — the exact
  injection this rule exists to stop. Escaping the pipe alone is not enough
  when the value ALREADY carries a backslash immediately in front of that
  pipe: a value of `` a\|b `` becomes `a\\|b`, and CommonMark's own
  backslash-escape parity rule (the same one that makes `\\` render as one
  literal backslash) resolves that as *unescaped*: a run of backslashes
  immediately before a special character escapes it only when the run's
  length is odd — an even-length run (here, 2) means the last backslash was
  itself escaped by the one before it, leaving the pipe an ordinary,
  unescaped delimiter. This parity rule is spec-level, not a
  renderer-specific divergence, so both cmark-gfm and micromark split the
  cell there — reopening the injection on exactly the chat-UI renderer class
  this template targets. So escape the escape first: **double every
  backslash in the run immediately preceding each `|`, then prefix the pipe
  with one more backslash** (`\|` → `\\\|`) — this keeps the run's parity
  odd (escaping) regardless of how many backslashes the value's own content
  already carries there. Backslashes anywhere else are left alone, so an
  ordinary `C:\Users\x` still displays verbatim. The one
  residual cost is cosmetic and unavoidable — a backslash that immediately
  precedes a pipe displays doubled, because every renderer consumes one
  backslash off that run, and no encoding yields a single literal backslash
  in front of a literal pipe in all of them. Containment wins over a
  byte-exact display of that one character. Apply this bullet ONLY inside
  the four tables above — on the summary paragraph, the Scripts/Hooks/MCP
  Servers/Permission Footprint lists and the broad-access note there is no
  row to split, and a `\|` inside a code span would render its backslash
  literally.
- **Pad with one space on each side when the value begins or ends with a
  backtick.** A code span's opening and closing fence is a backtick run
  "neither preceded nor followed by a backtick character" (CommonMark §
  Code spans) — so a value like `` ` ![x](evil) `` sitting flush against the
  wrapping fence merges with it (the run reads as one longer opening fence,
  or a shorter closing one) and no span forms at all: the value renders as
  live, unfenced Markdown, the exact injection this rule exists to stop.
  Add a single literal space between the fence and the value on BOTH sides,
  not just the side that touches — CommonMark strips the pad only when BOTH
  ends have one ("a single space character is removed from the front and
  back"), so padding one side alone would leave a stray space on display.
  Padding both keeps the displayed value unpadded while the fence stays
  structurally separate from it.

Apply in this order: truncate (where the 120-char description cap applies) →
collapse line breaks → escape pipes, doubling the backslash run in front of
each one (table cells only) → measure the longest backtick run in the
resulting text → wrap in a backtick run one longer, padding with a space on
each side when the value begins or ends with a backtick.

## Rules

- **Read-only.** This skill NEVER writes, edits, installs, or modifies any files — locally or remotely. No `.ievo/` writes, no vendoring, no git clone.
- **No security scan.** Do not assess security posture. That's `/ievo:security-check`. If the user asks for a security opinion, direct them there.
- **No LLM analysis of file bodies.** This is a structural summary, not a behavioural review. Parse frontmatter, extract metadata, report structure. Don't analyse whether code is "good" or "suspicious".
- **Works on any repo.** Not limited to ievo-ai repos or repos registered on skills.sh. Any public (or accessible-to-gh) GitHub repo is valid input.
- **Respect rate limits.** Cap file content fetches at 30. If more items exist, note the cap in the output footer.
- **Truncate descriptions.** Cap at 120 characters with `...` to keep tables readable.
- **Neutralize excerpts before they render.** Every repo-derived field interpolated into the Step 5 template is untrusted content from the target repo — on every surface, not just the tables (Scripts, Hooks, MCP Servers, Permission Footprint and the broad-access note included) — see § Step 5's "Excerpt containment" note for the exhaustive placeholder list, the fencing rule, the both-sided padding a value starting or ending with a backtick needs, and the line-break/pipe normalization a code span alone does not cover.
- **gh CLI only.** All remote data comes from `gh api` calls. No `git clone`, no `curl`, no external tools.
- **Never interpolate an unvalidated `<ref>` or `<path>` into a Bash command.** Both are attacker-controlled (a branch/tag name, or a path from the target repo's own tree listing) and can legally contain shell metacharacters. Validate against the allowlist in Step 1 / Step 4 first — exit cleanly (ref) or skip the item (path) on failure.

## See also

- `init/SKILL.md` — the full 6-stage pipeline that inspect precedes (discover, index, rank, interview, security scan, install)
- `security-check/SKILL.md` — deep security verdict for a specific skill/agent/plugin (the natural follow-up after inspect)
- `index-repos/SKILL.md` — detailed structural index via `scan_repo.mjs` (heavier than inspect, writes output files)
