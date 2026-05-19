---
name: community-index
description: Look up the pre-built community index at ievo-ai/community-index to decide per repo whether to use a cached index or do a fresh local scan. Returns SHA-gated verdict for each repo — community_match (use cache), community_stale, community_unknown, community_unreachable (all three require local fallback). Thin wrapper around `scripts/community_lookup.mjs` (Node, parallel ls-remote, stdlib-only). Used by `/ievo:init` Step 5.5 between find-skills and index-repos to avoid redundant cold-cache scans for repos the community already indexed at the same commit.
license: MIT
compatibility: Requires `git` CLI + Node.js 18+ (ships with Claude Code — guaranteed available). Fetches https://github.com/ievo-ai/community-index (public, no auth).
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/community-index
---

# Community Index

Trust-gated lookup of pre-built repo indices from `ievo-ai/community-index`. Returns
per-repo decisions so the caller can skip local scans for repos already covered by the
community index — but ONLY when SHA matches upstream HEAD byte-for-byte.

## Trust model

The community index is trusted **only when byte-accurate**:

- `scanner_sha` in the manifest == current `git ls-remote HEAD` of the upstream repo

Any drift = upstream may have new content the index does not reflect (including
potentially malicious changes). In that case the verdict is `community_stale` and the
caller MUST do a local scan. **Never** trust a community index based on `last_scan`
timestamp or `ttl_hours` — those are informational, not security signals.

## Input

A list of `<owner>/<repo>` strings — typically the unique-repos extracted from
find-skills' output during `/ievo:init` Step 5.5.

## Output verdicts

| Verdict | Meaning | Caller action |
|---------|---------|---------------|
| `community_match` | Repo in manifest AND ls-remote SHA == manifest.scanner_sha | Read cached `index_path` MD — skip local scan |
| `community_stale` | Repo in manifest BUT SHA differs (upstream advanced) | Local scan REQUIRED — trust invalidated |
| `community_unknown` | Repo not in manifest (or never scanned) | Local scan required — no community data |
| `community_unreachable` | ls-remote failed (network, rate-limit, etc.) | Local scan required — no verification possible |

## Step-by-step

### 1. Invoke `scripts/community_lookup.mjs` via Bash

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/community_lookup.mjs" \
  <owner1>/<repo1> <owner2>/<repo2> ... <ownerN>/<repoN> \
  --jobs 10
```

Node is the guaranteed runtime — Claude Code and Codex CLI both ship with Node 18+.
No extra install needed.

The script:
1. Clones `ievo-ai/community-index` into `~/.ievo/community-cache/community-index/`
   (first call) OR runs `git fetch + reset --hard origin/main` (subsequent calls)
2. Reads `manifest.json`
3. Runs `git ls-remote HEAD` in parallel for each input repo (default 10 workers)
4. Compares each upstream SHA against `manifest.repos[X].scanner_sha`
5. Returns JSON with per-repo verdict + summary

Output goes to stdout as a single JSON object — the LLM caller parses it directly.

### 2. CLI flags

| Flag | When to use |
|------|-------------|
| `--no-refresh` | Repeated calls within same session — cache already fresh, skip `git fetch` (~500ms saved) |
| `--no-remote` | Debug only — treat all known repos as match without ls-remote verification. NEVER use in real `/ievo:init` |
| `--jobs N` | Tune parallel ls-remote workers (default 10 is fine for ≤20 repos) |
| `--cache-dir DIR` | Override default `~/.ievo/community-cache/community-index/` |

### 3. Per-repo decision dispatch

After reading the JSON output, the caller groups repos by verdict:

```
match    → list of (repo, index_path) — caller reads each MD directly
stale    → list of repos for local fallback (with reason logged)
unknown  → list of repos for local fallback
unreach  → list of repos for local fallback (with warning logged)
```

The init pipeline (Step 6) dispatches `repo-indexer` sub-agents ONLY for stale +
unknown + unreachable. Match repos skip Step 6 entirely.

## Performance

- 10 repos, all known, cache fresh: ~800ms (10 parallel ls-remote)
- 10 repos, cache missing (first call): ~2s (shallow clone + 10 ls-remote)
- 10 repos with `--no-refresh`: ~500ms (no git fetch)

Compare to local scan cost without this skill:
- 10 repos cold-cache via `repo-indexer`: ~30-60s (parallel shallow clones)

**Best case** (all match): ~98% wall-clock reduction.
**Worst case** (all stale/unknown): adds ~1s overhead to current init time, no savings —
but security trust gate is still enforced.

## Rules

- **SHA-match is the only trust signal.** Do not infer freshness from `last_scan`,
  `ttl_hours`, or any clock-based metric. Only byte-accurate SHA match = trust.
- **ls-remote per repo is mandatory.** Never skip on the assumption that the cache is
  recent. Between scanner run and now, upstream may have shifted.
- **Stale = same risk as unknown.** Caller MUST do local fallback. Do not partially use
  cached data with a "warning" — that defeats the trust gate.
- **Cache is user-level.** Shared across all projects on the same machine. Each
  invocation refreshes via `git fetch` (cheap).
- **Always refresh by default.** This skill is typically invoked once per `/ievo:init`.
  The ~500ms cost of `git fetch` is negligible vs the multi-minute savings on local
  scans. Pass `--no-refresh` only for repeated calls in same session.
- **JSON output is the contract.** Do not summarize the JSON into prose for the
  caller — they need the structured data to dispatch the right action per repo.

## Why this architecture

Two callers, one algorithm:

```
1. /ievo:init Step 5.5 (this skill, invoked once per init)
2. (future) /ievo:update — when checking installed plugins for new content
```

Both invoke `scripts/community_lookup.py` with the same CLI args. The script handles
cache management, manifest reading, parallel ls-remote, and decision logic.

This mirrors the `index-repos` ↔ `scan_repo.mjs` separation: the SKILL.md is the LLM
contract (input/output, when to invoke), the Python script is the deterministic
algorithm. Drift between them is impossible because the script is the single source of
truth.

## See also

- `${CLAUDE_PLUGIN_ROOT}/scripts/community_lookup.mjs` — the algorithm
- `index-repos` skill — fallback path for verdicts that need local scan
- [`ievo-ai/community-index`](https://github.com/ievo-ai/community-index) — the data source
- [`ievo-ai/community-index/manifest.json`](https://github.com/ievo-ai/community-index/blob/main/manifest.json) — the source of truth for known repos
