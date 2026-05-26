---
name: inspect
description: "Pre-install structured summary of a remote skill/plugin repo. Fetches the repo tree and key files via gh API, then renders a human-readable capability overview — skills, agents, commands, scripts, permission footprint — without triggering discovery, security scan, or install. Use when the user asks \"what does owner/repo contain\", \"inspect this skill before install\", \"show me what's in owner/repo\", \"summarise owner/repo without installing\", \"what skills does this repo have\", or invokes /ievo:inspect <owner>/<repo>."
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

Produce a structured capability summary of a remote GitHub repo that hosts skills, agents, or plugins — before committing to the full `/ievo:init` pipeline. Answers "what does this repo contain?" in under 30 seconds with zero side effects.

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
- **Any other error** — report the raw error message from `gh api`.

Exit cleanly on any failure. Do NOT retry or guess alternative names.

Store the resolved ref (default branch name, or user-provided ref) for all subsequent API calls.

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
- **Exclude** paths under `tests/`, `test/`, `fixtures/`, and `__tests__/` directories — these are likely test fixture copies, not real skills. Including them would inflate the skill count and pollute the Permission Footprint with synthetic `allowed-tools`.

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

### 4a. Plugin manifests

For each detected `plugin.json`:

```bash
gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" --jq '.content' | base64 -d
```

Extract: `name`, `version`, `description`, `author`, `license`, `keywords`.

### 4b. Skill frontmatter

For each detected `SKILL.md`, fetch and parse the YAML frontmatter (the `---`-delimited block at the top):

```bash
gh api "repos/<owner>/<repo>/contents/<path>?ref=<ref>" --jq '.content' | base64 -d
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

If `README.md` exists at the repo root, fetch the first 40 lines for a project-level summary.

**Rate limit awareness:** GitHub API has a 5,000 requests/hour limit for authenticated users. For repos with many items, batch fetches and stop at 30 file fetches total. Note in the output if some items were not fetched due to rate-limit caution.

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

<If any skill has broad permissions like `Bash(*)`, flag it:>
> **Note:** <skill-name> requests broad Bash access (`Bash(*)`). Review its SKILL.md body before installing.

---

**Ref inspected:** `<ref>` (`<commit SHA if available>`)
**Files in repo:** <total file count from tree>
**Items fetched:** <number of files whose content was read> / <total items detected>
<If tree was truncated: "**Note:** Repository tree was truncated by the API — some files may not appear above.">

**Next steps:**
- To install: run `/ievo:init` and select this repo when it appears, or add it manually
- For a security verdict first: run `/ievo:security-check <owner>/<repo>@<skill-name>` (where `<skill-name>` is the name of a specific skill to audit, e.g. `@init` — not a git ref)
- To index the full repo structure: run `/ievo:index-repos <owner>/<repo>`
```

## Rules

- **Read-only.** This skill NEVER writes, edits, installs, or modifies any files — locally or remotely. No `.ievo/` writes, no vendoring, no git clone.
- **No security scan.** Do not assess security posture. That's `/ievo:security-check`. If the user asks for a security opinion, direct them there.
- **No LLM analysis of file bodies.** This is a structural summary, not a behavioural review. Parse frontmatter, extract metadata, report structure. Don't analyse whether code is "good" or "suspicious".
- **Works on any repo.** Not limited to ievo-ai repos or repos registered on skills.sh. Any public (or accessible-to-gh) GitHub repo is valid input.
- **Respect rate limits.** Cap file content fetches at 30. If more items exist, note the cap in the output footer.
- **Truncate descriptions.** Cap at 120 characters with `...` to keep tables readable.
- **gh CLI only.** All remote data comes from `gh api` calls. No `git clone`, no `curl`, no external tools.

## See also

- `init/SKILL.md` — the full 6-stage pipeline that inspect precedes (discover, index, rank, interview, security scan, install)
- `security-check/SKILL.md` — deep security verdict for a specific skill/agent/plugin (the natural follow-up after inspect)
- `index-repos/SKILL.md` — detailed structural index via `scan_repo.mjs` (heavier than inspect, writes output files)
