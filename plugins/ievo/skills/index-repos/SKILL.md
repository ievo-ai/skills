---
name: index-repos
description: Enumerate the full content of one or more GitHub repos that host Claude Code skills, agents, and plugins. Returns a structured markdown index per repo (plugins, agents, skills, hooks, commands). Caches results locally for re-use across multiple init runs. Use when expanding a small set of candidate skills into the full breadth of what their host repos offer, or when checking what a repo contains before deciding to install from it.
license: MIT
compatibility: Requires `gh` CLI installed and authenticated.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Index Repos

Enumerate a GitHub repo's full Claude-Code-relevant content. Skills.sh and find-skills only surface specific skills — but the same repo often hosts many more agents, plugins, hooks, and commands that don't appear in the skill catalog. This skill scans the full repo so consumers (like `/ievo:init`) can see everything available, not just what skills.sh indexed.

## Input

Either:
- A list of `<owner>/<repo>` strings (e.g. `["wshobson/agents", "anthropics/claude-plugins-official"]`)
- A single repo identifier

The caller provides this in the prompt. No interactive input.

## Step 1: Check cache

For each repo, look for a cached index at:
```
<project>/.ievo/cache/index/<owner>-<repo>.md
```

Cache is **project-scope** (lives inside the project), so teams can commit indices for shared visibility. TTL is 7 days — check the `Cached:` timestamp in the file frontmatter.

If cache exists and is younger than TTL → use it, skip the scan.
If stale or missing → re-scan (Step 2-4).

## Step 2: Probe top-level layout

Use `gh api` to list the repo's root contents:

```bash
gh api repos/<owner>/<repo>/contents --jq '.[] | {name, type}'
```

Identify present directories. Common Claude-Code-relevant ones:
- `plugins/` — multi-plugin marketplace (e.g. wshobson/agents)
- `agents/` — flat agent files
- `skills/` — flat skill directories
- `commands/` — flat slash command files
- `hooks/` — hook configurations
- `.claude-plugin/` — single-plugin manifest

## Step 3: Enumerate per layout

### If `plugins/` exists (marketplace layout)

```bash
gh api repos/<owner>/<repo>/contents/plugins --jq '.[] | select(.type=="dir") | .name'
```

For each plugin directory, list its sub-contents:
```bash
gh api repos/<owner>/<repo>/contents/plugins/<plugin>/agents --jq '.[] | .name' 2>/dev/null
gh api repos/<owner>/<repo>/contents/plugins/<plugin>/skills --jq '.[] | select(.type=="dir") | .name' 2>/dev/null
gh api repos/<owner>/<repo>/contents/plugins/<plugin>/commands --jq '.[] | .name' 2>/dev/null
gh api repos/<owner>/<repo>/contents/plugins/<plugin>/hooks/hooks.json --silent 2>/dev/null   # presence check
```

Read the plugin manifest if present:
```bash
gh api repos/<owner>/<repo>/contents/plugins/<plugin>/.claude-plugin/plugin.json --jq '.content' | base64 -d
```

Extract `description`, `version` from each manifest.

### If `agents/` exists (flat layout)

```bash
gh api repos/<owner>/<repo>/contents/agents --jq '.[] | select(.name | endswith(".md")) | .name'
```

For each agent file, read its YAML frontmatter via:
```bash
gh api repos/<owner>/<repo>/contents/agents/<agent>.md --jq '.content' | base64 -d | sed -n '/^---$/,/^---$/p'
```

Extract `name`, `description`, `model`, `tools`.

### If `skills/` exists (flat layout)

```bash
gh api repos/<owner>/<repo>/contents/skills --jq '.[] | select(.type=="dir") | .name'
```

For each skill dir, read SKILL.md frontmatter (same approach as agents).

### Other layouts (mattpocock/skills uses `skills/<category>/<name>/`)

If the standard probes return empty or sparse results, do one level of nested probing:
```bash
gh api repos/<owner>/<repo>/contents/skills --jq '.[] | select(.type=="dir") | .name' | \
  xargs -I{} gh api repos/<owner>/<repo>/contents/skills/{} --jq '.[] | select(.type=="dir") | .name'
```

## Step 4: Build markdown index

Write structured markdown to `<project>/.ievo/cache/index/<owner>-<repo>.md`:

```markdown
# <owner>/<repo> — repo index
> Cached: <ISO timestamp>
> TTL: 7 days
> Commit SHA: <gh api repos/<owner>/<repo>/commits/HEAD --jq '.sha[0:8]'>
> Layout: marketplace | flat-agents | flat-skills | mixed

## Repo metadata
- **Stars:** <count>
- **Description:** <repo description>
- **License:** <SPDX from LICENSE file or repo.license.spdx_id>
- **Last commit:** <relative time>

## Plugins (<N>)

### <plugin-name>
- **Description:** <from plugin.json>
- **Version:** <from plugin.json>
- **Path:** `plugins/<plugin-name>/`
- **Agents (<n>):** <comma-separated names>
- **Skills (<n>):** <comma-separated names>
- **Commands (<n>):** <comma-separated names>
- **Hooks:** present | none (with event list if present)
- **MCP:** present | none

[...repeat per plugin...]

## Standalone agents (<N>)

### <agent-name>
- **Description:** <from frontmatter>
- **Model:** <from frontmatter>
- **Path:** `agents/<agent-name>.md`

## Standalone skills (<N>)

### <skill-name>
- **Description:** <from frontmatter>
- **Path:** `skills/<skill-name>/SKILL.md`

## Standalone commands (<N>)

### <command-name>
- **Description:** <from frontmatter>
- **Path:** `commands/<command-name>.md`
```

Sections empty if no content of that type — but always include header so the absence is explicit.

## Step 5: Return the index path(s)

Output to caller:
- File path(s) of indexed repo(s)
- Brief summary (e.g. "indexed wshobson/agents: 72 plugins, 0 standalone agents")

Caller (typically `init`) reads the markdown file to extract candidate names + metadata.

## Rules

- **gh CLI is hard prereq.** Without it, fail with clear instruction. Don't fallback to webfetch (less reliable, no auth for private repos).
- **Always probe before assuming layout.** Don't hardcode "this repo uses `plugins/`" — list root contents and infer.
- **Sparse output is fine.** A repo with only `agents/` (no plugins, no skills) gets a tiny index with empty sections. That's still useful.
- **Cache invalidation by TTL.** Don't trust cache older than 7 days. Re-scan replaces the cached file entirely.
- **Markdown over JSON.** LLM consumers parse markdown more naturally; humans read it too. JSON would force every consumer to deserialize.
- **No security audit here.** That's `security-check`'s job. Index only describes what's present.
- **Idempotent.** Re-indexing a fresh repo produces a stable output. Cache-hit returns the same file every time.
