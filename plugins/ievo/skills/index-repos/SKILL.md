---
name: index-repos
description: Enumerate the full content of one or more GitHub repos that host Claude Code skills, agents, and plugins. Uses shallow `git clone` into a user-level checkout cache (one git operation per repo instead of dozens of gh API calls — eliminates rate-limiting issues). Returns a structured markdown index per repo. Use when expanding a small set of candidate skills into the full breadth of what their host repos offer.
license: MIT
compatibility: Requires `git` CLI installed and available on PATH. `gh` CLI no longer required for indexing — only used for security audit by sibling skills.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Index Repos

Enumerate a GitHub repo's full Claude-Code-relevant content. **v0.3.0 architectural change:** uses shallow `git clone` into a user-level cache, then scans filesystem locally. Replaces the gh-api-per-file approach (v0.2.x) which triggered Anthropic-side rate limits and GitHub API throttling on big repos like wshobson/agents.

## Input

Either:
- A list of `<owner>/<repo>` strings (e.g. `["wshobson/agents", "anthropics/claude-plugins-official"]`)
- A single repo identifier

Caller provides via prompt. No interactive input.

## Step 1: Resolve cache paths

Two cache locations, different scopes:

**Checkout cache (user-level, shared across projects):**
```
~/.ievo/checkouts/<owner>-<repo>/
```

**Index cache (project-level, derived from checkout):**
```
<project>/.ievo/cache/index/<owner>-<repo>.md
```

User-level for checkouts saves disk (~300MB cumulative typical) by sharing across projects. Project-level for the structured indices keeps them with the project's iEvo state.

## Step 2: Update or create checkout

For each repo:

### If `~/.ievo/checkouts/<owner>-<repo>/` does NOT exist

Shallow clone:
```bash
git clone --depth=1 \
  https://github.com/<owner>/<repo>.git \
  ~/.ievo/checkouts/<owner>-<repo>
```

`--depth=1` clones only the latest commit. Full tree at HEAD is checked out — file content immediately available for filesystem reads.

### If checkout exists

Check TTL:
```bash
CHECKOUT_AGE=$(($(date +%s) - $(stat -c %Y ~/.ievo/checkouts/<owner>-<repo>/.git/HEAD 2>/dev/null || stat -f %m ~/.ievo/checkouts/<owner>-<repo>/.git/HEAD)))
```

- If age < 7 days → use as-is, skip to Step 3
- If age ≥ 7 days → refresh:
  ```bash
  git -C ~/.ievo/checkouts/<owner>-<repo> fetch --depth=1
  git -C ~/.ievo/checkouts/<owner>-<repo> reset --hard origin/HEAD
  ```

### Handle network failures gracefully

If `git clone` or `git fetch` fails (network, repo not found, auth issue):
- Print clear error: `Cannot clone <repo>: <error>`
- If a stale checkout exists, USE IT (with a "stale" tag in the index)
- If no checkout at all, skip this repo (record failure for caller)

## Step 3: Probe layout from local filesystem

`ls` and `find` on the local checkout — these are filesystem ops, no API limits.

```bash
ls ~/.ievo/checkouts/<owner>-<repo>/
```

Identify present directories of interest:
- `plugins/` — multi-plugin marketplace layout
- `agents/` — flat agent files
- `skills/` — flat skill directories
- `commands/` — flat slash command files
- `hooks/` — hook configurations
- `.claude-plugin/` — single-plugin manifest

## Step 4: Enumerate per layout (filesystem reads)

All operations now local — no network beyond Step 2's clone.

### If `plugins/` exists (marketplace layout)

```bash
ls -1 ~/.ievo/checkouts/<owner>-<repo>/plugins/
```

For each plugin directory:
```bash
PLUGIN_DIR=~/.ievo/checkouts/<owner>-<repo>/plugins/<plugin>
ls -1 "$PLUGIN_DIR/agents/" 2>/dev/null              # list agent files
ls -1d "$PLUGIN_DIR/skills/"*/ 2>/dev/null           # list skill dirs
ls -1 "$PLUGIN_DIR/commands/" 2>/dev/null            # list command files
test -f "$PLUGIN_DIR/hooks/hooks.json" && echo "hooks: present" || echo "hooks: none"
test -f "$PLUGIN_DIR/.mcp.json" && echo "mcp: present" || echo "mcp: none"
```

Read plugin manifest if present:
```bash
cat "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null
```

Extract `description`, `version`.

### If `agents/` exists (flat layout)

```bash
ls ~/.ievo/checkouts/<owner>-<repo>/agents/*.md 2>/dev/null
```

For each agent file, read YAML frontmatter (first `---` block):
```bash
awk '/^---$/{c++} c==1{print} c==2{exit}' ~/.ievo/checkouts/<owner>-<repo>/agents/<agent>.md
```

Extract `name`, `description`, `model`, `tools`.

### If `skills/` exists (flat or nested layout)

Try flat first:
```bash
ls -1d ~/.ievo/checkouts/<owner>-<repo>/skills/*/SKILL.md 2>/dev/null
```

If sparse results, try one level of category nesting (e.g. `skills/<category>/<name>/`):
```bash
find ~/.ievo/checkouts/<owner>-<repo>/skills -mindepth 2 -maxdepth 3 -name 'SKILL.md' 2>/dev/null
```

For each found SKILL.md, read frontmatter same as agents.

### Other layouts

If standard probes return nothing, do broader recursive search:
```bash
find ~/.ievo/checkouts/<owner>-<repo> -maxdepth 5 -name 'SKILL.md' 2>/dev/null | head -50
find ~/.ievo/checkouts/<owner>-<repo> -maxdepth 5 -name '.claude-plugin' -type d 2>/dev/null | head -50
```

Limit depth to avoid scanning vendored deps (`node_modules`, etc.).

## Step 5: Build markdown index

Write structured markdown to `<project>/.ievo/cache/index/<owner>-<repo>.md`:

```markdown
# <owner>/<repo> — repo index
> Indexed: <ISO timestamp>
> TTL: 7 days
> Checkout commit: <git -C ~/.ievo/checkouts/<owner>-<repo> rev-parse --short HEAD>
> Checkout path: ~/.ievo/checkouts/<owner>-<repo>
> Layout: marketplace | flat-agents | flat-skills | mixed | other

## Repo metadata
- **Description:** <from README.md or repo description if available>
- **License:** <from LICENSE / package.json / .claude-plugin/plugin.json>
- **Last commit:** <git log -1 --format='%cr'>

## Plugins (<N>)

### <plugin-name>
- **Description:** <from plugin.json>
- **Version:** <from plugin.json>
- **Path:** `plugins/<plugin-name>/`
- **Agents (<n>):** <comma-separated names>
- **Skills (<n>):** <comma-separated names>
- **Commands (<n>):** <comma-separated names>
- **Hooks:** present (events: <list>) | none
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

Empty sections still get headers — explicit absence is informative.

## Step 6: Return summary to caller

Output one-liner per repo:
```
- <owner>/<repo>: indexed (clone: hit|miss|stale-network) — N plugins, M agents, K skills, hooks: yes/no
```

Caller (typically `init`) reads the markdown files to extract candidate names and metadata.

## Rules

- **git CLI is required.** Without it, fail with clear instruction (`brew install git` etc.). Don't fallback to gh api — that's what caused the rate limit problems in v0.2.x.
- **Checkouts are user-level, indices are project-level.** Different scopes by design.
- **`--depth=1` is mandatory.** Full clones are expensive (some repos have huge history). Shallow is enough — we only need HEAD content.
- **TTL is 7 days.** Hard-coded. If a repo updates more often than the user re-indexes, that's acceptable — registries don't churn fast.
- **Filesystem reads have no rate limit.** Take advantage: do thorough enumeration without API budget anxiety.
- **Stale checkout > no checkout.** If network fails on refresh, use existing checkout with a "stale" annotation in the index. Don't break the flow.
- **No security audit here.** That's `security-check`'s job. Index describes what's present only.
- **Disk budget.** Cumulative checkouts can hit ~500MB for users who init many projects. Acceptable for v0.3.0. A `/ievo:cleanup-cache` command could add later.
- **Markdown over JSON.** LLM consumers parse markdown more naturally; humans read it too.

## Why this architecture (vs gh api per file)

v0.2.x used `gh api repos/<r>/contents/...` per directory and per file. For `wshobson/agents` (72 plugins, ~500 files):
- ~150-200 `gh api` calls per repo
- ~1-2 seconds per call with cold cache
- 5+ minutes per repo
- N tool calls in tight sequence → Anthropic's inference rate limit kicks in
- Init runs hang or rate-limit

v0.3.0 with shallow clone:
- 1 `git clone --depth=1` per repo (~5-30 sec depending on size)
- Filesystem reads after (instant, no API)
- Total: ~30 sec per cold-cache repo
- ~5x faster, zero API rate limit risk
- Re-indexing (cache hit, age check via stat) is sub-second
