---
name: index-repos
description: Enumerate the full content of one or more GitHub repos that host Claude Code skills, agents, and plugins. Thin wrapper around `scripts/scan_repo.mjs` (deterministic Node scanner — no LLM required). Returns structured markdown indices per repo. Use when expanding a small set of candidate skills into the full breadth of what their host repos offer.
license: MIT
compatibility: Requires `git` CLI + Node.js 18+ (ships with Claude Code — guaranteed available). Same script is used by ievo-ai/community-index GHA — single source of truth.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Index Repos

Enumerate GitHub repo content. **v0.4.0 architectural change:** delegates all heavy lifting to `scripts/scan_repo.mjs` — a pure-Node deterministic scanner that the `ievo-ai/community-index` GitHub Action ALSO uses. Single source of truth for the indexing algorithm. (v0.3.x used Python; migrated to Node so no extra runtime install needed — Node ships with Claude Code.)

## Input

Either:
- A list of `<owner>/<repo>` strings
- A single repo identifier

Caller provides via prompt. No interactive input.

## What scan_repo.mjs does (executed via Bash)

For each repo:
1. Shallow clone into `~/.ievo/checkouts/<owner>-<repo>/` (or refresh if cached + TTL expired)
2. Detect layout (marketplace / flat-skills / flat-agents / single-plugin / other)
3. Enumerate plugins / agents / skills / commands / hooks / MCP
4. Parse YAML frontmatter for each item
5. Compute risk signals (hooks events, allowed-tools, license, etc.)
6. Emit structural facts only — NO risk_tier (removed in v0.5.2). Risk verdicts come from `security-auditor` antivirus deep scan per selected item before install.
7. Write `<owner>-<repo>.md` matching `ievo-ai/community-index/indices/_TEMPLATE.md` format
8. Write `<owner>-<repo>.json` (manifest entry update for community-index)

No LLM. No API tokens. Just `git`, `node`, filesystem ops, native JSON parsing in stdlib.

## Step-by-step (what Claude does when this skill activates)

### 1. Resolve output dir

`<project>/.ievo/cache/index/`

### 2. Per-repo invocation

For each repo in the input list, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scan_repo.mjs" \
  <owner>/<repo> \
  --output-dir <project>/.ievo/cache/index \
  --checkout-dir ~/.ievo/checkouts
```

The script writes `<owner>-<repo>.md` (full structured index) and `<owner>-<repo>.json` (manifest entry).

It prints one-line summary to stdout:
```
<owner>/<repo>: indexed (commit=<sha>) — N plugins, M agents, K skills, hooks: yes/no, risk: <tier>
```

Collect these summary lines for the caller.

### 3. Force-refresh flag

If caller specifies `force_refresh=true`, append `--force-refresh` to the Node command. Otherwise the script honors TTL cache (7 days).

### 4. Network failure handling

`scan_repo.mjs` handles its own network errors:
- If `git clone`/`fetch` fails and a stale checkout exists, use it
- If fully unable, the script exits with code 2 and a message to stderr

Catch the exit code:
- 0 → success, index files written
- 2 → network failure with no fallback. Skip this repo, report to caller as "FAILED: network unreachable"

## Step-by-step parallel dispatch (when caller is init)

When invoked from `/ievo:init`, the caller dispatches `repo-indexer` sub-agents in parallel — one per repo. Each `repo-indexer` agent calls this script via Bash. The script is fast enough (~30 sec per cold repo, sub-second per cached repo) that the parallel approach gives wall-clock = slowest repo, not sum.

## Rules

- **Use the script, never re-implement.** The Node scanner is the single source of truth. If you find yourself thinking "I'll just grep with awk here for speed" — STOP. Use the script. Drift between script-output and Claude-shell-output breaks the community-index trust model.
- **No LLM in indexing.** The whole point of this rewrite is removing rate-limit risk and ensuring deterministic output. Don't override the script's output with model-generated content.
- **One repo per invocation.** Loop over multiple repos by repeating the Bash call. Each `scan_repo.mjs` invocation handles one repo.
- **Output dir defaults to project's `.ievo/cache/index/`.** Pass explicit `--output-dir` if caller wants elsewhere (community-index GHA uses its own location).
- **Checkout dir is user-level.** Default `~/.ievo/checkouts/` shared across projects.
- **Script version is `SCRIPT_VERSION` constant.** Bumped when the scanner output format changes. Stays in sync with plugin.json version (0.3.4+).

## Why this architecture

Three callers, one algorithm:

```
1. /ievo:init's repo-indexer sub-agents (parallel)
2. /ievo:index-repos standalone slash command
3. ievo-ai/community-index GitHub Action (daily refresh)
```

All three invoke `scripts/scan_repo.mjs` with identical CLI args. Output is byte-identical regardless of which path triggered it.

This is **critical for the community-index trust model**: when iEvo init compares its local scan against community-index's recorded `scanner_sha`, the content must match because both sides ran the same algorithm.

## See also

- `${CLAUDE_PLUGIN_ROOT}/scripts/scan_repo.mjs` — the scanner source
- [`ievo-ai/community-index/indices/_TEMPLATE.md`](https://github.com/ievo-ai/community-index/blob/main/indices/_TEMPLATE.md) — canonical output format
- `security-check` skill — per-item audit, reads scanner-cached signals + adds deeper review
