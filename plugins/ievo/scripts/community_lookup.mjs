#!/usr/bin/env node
// community_lookup.mjs — Pre-built community index lookup for ievo init.
//
// Resolves per-repo decision based on SHA-match against ievo-ai/community-index:
//   community_match:       SHA equals manifest's scanner_sha → use cached index
//   community_stale:       SHA differs (upstream advanced)   → local fallback
//   community_unknown:     not in manifest                    → local fallback
//   community_unreachable: ls-remote failed                   → local fallback
//
// Cache:
//   ~/.ievo/community-cache/community-index/   (user-level, shared across projects)
//
// Output:
//   JSON to stdout — per-repo records plus summary
//
// Usage:
//   node community_lookup.mjs <owner>/<repo> [<owner>/<repo> ...]
//   echo "wshobson/agents" | node community_lookup.mjs -
//
// CLI:
//   --cache-dir DIR     override default ~/.ievo/community-cache/community-index
//   --no-refresh        don't git fetch — use stale cache
//   --no-remote         skip ls-remote (debug only)
//   --jobs N            parallel ls-remote workers (default 10)

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const COMMUNITY_REPO = "https://github.com/ievo-ai/community-index.git";
const DEFAULT_CACHE = join(homedir(), ".ievo", "community-cache", "community-index");
const SCRIPT_VERSION = "0.4.0";

async function run(cmd, args, { timeout = 60000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout });
    return { code: 0, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    return {
      code: err.code ?? 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? err.message ?? "",
    };
  }
}

async function ensureCache(cacheDir, refresh) {
  if (!existsSync(cacheDir)) {
    mkdirSync(dirname(cacheDir), { recursive: true });
    const { code, stderr } = await run("git", ["clone", "--depth=1", COMMUNITY_REPO, cacheDir], { timeout: 120000 });
    if (code !== 0) return { status: "missing", error: stderr.trim() };
    return { status: "fresh", error: null };
  }

  if (!refresh) return { status: "stale", error: null };

  const fetch = await run("git", ["-C", cacheDir, "fetch", "--depth=1", "origin", "main"]);
  if (fetch.code !== 0) return { status: "stale", error: fetch.stderr.trim() };
  const reset = await run("git", ["-C", cacheDir, "reset", "--hard", "origin/main"]);
  if (reset.code !== 0) return { status: "stale", error: reset.stderr.trim() };
  return { status: "fresh", error: null };
}

async function cacheHeadSha(cacheDir) {
  const { code, stdout } = await run("git", ["-C", cacheDir, "rev-parse", "--short", "HEAD"]);
  return code === 0 ? stdout.trim() : "unknown";
}

async function upstreamSha(ownerRepo) {
  const url = `https://github.com/${ownerRepo}.git`;
  const { code, stdout } = await run("git", ["ls-remote", url, "HEAD"], { timeout: 30000 });
  if (code !== 0 || !stdout.trim()) return null;
  const firstLine = stdout.trim().split("\n")[0];
  const sha = firstLine.split(/\s+/)[0];
  return sha.slice(0, 7);
}

async function lookupRepo(ownerRepo, manifest, cacheDir, noRemote) {
  const entry = manifest.repos?.[ownerRepo];
  if (!entry) {
    return { repo: ownerRepo, verdict: "community_unknown", reason: "not present in manifest" };
  }
  if (entry.last_scan == null) {
    return { repo: ownerRepo, verdict: "community_unknown", reason: "entry present but never scanned" };
  }

  const manifestSha = entry.scanner_sha;
  const indexPath = resolve(cacheDir, entry.index_file);
  const base = {
    repo: ownerRepo,
    manifest_sha: manifestSha,
    index_path: indexPath,
    stats: entry.stats,
    risk_tier: entry.risk_tier,
    has_hooks: entry.has_hooks,
    has_mcp: entry.has_mcp,
  };

  if (noRemote) {
    return { ...base, verdict: "community_match", warning: "no-remote mode — sha not verified" };
  }

  const upstream = await upstreamSha(ownerRepo);
  if (upstream === null) {
    return { ...base, verdict: "community_unreachable", reason: "ls-remote failed (network or unauthorized)" };
  }

  if (upstream === manifestSha) {
    return { ...base, verdict: "community_match", upstream_sha: upstream };
  }

  return {
    repo: ownerRepo,
    verdict: "community_stale",
    manifest_sha: manifestSha,
    upstream_sha: upstream,
    reason: `upstream advanced from ${manifestSha} to ${upstream}`,
  };
}

function parseArgs(argv) {
  const args = { repos: [], cacheDir: DEFAULT_CACHE, refresh: true, noRemote: false, jobs: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cache-dir") args.cacheDir = argv[++i];
    else if (a === "--no-refresh") args.refresh = false;
    else if (a === "--no-remote") args.noRemote = true;
    else if (a === "--jobs") args.jobs = parseInt(argv[++i], 10);
    else args.repos.push(a);
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function mapWithConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  let repos = args.repos;
  if (repos.includes("-")) {
    const stdinText = await readStdin();
    repos = stdinText.split("\n").map((l) => l.trim()).filter(Boolean);
  } else {
    repos = repos.filter(Boolean);
  }

  if (repos.length === 0) {
    console.error(JSON.stringify({ error: "no repos given" }));
    process.exit(1);
  }

  const { status: cacheStatus, error: cacheError } = await ensureCache(args.cacheDir, args.refresh);

  if (cacheStatus === "missing") {
    const output = {
      script_version: SCRIPT_VERSION,
      cache_status: "missing",
      cache_error: cacheError,
      summary: { community_match: 0, community_stale: 0, community_unknown: 0, community_unreachable: repos.length },
      results: repos.map((r) => ({ repo: r, verdict: "community_unreachable", reason: "cache could not be obtained" })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const manifestPath = join(args.cacheDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(JSON.stringify({ error: `manifest.json missing in cache: ${manifestPath}` }));
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const cacheSha = await cacheHeadSha(args.cacheDir);

  const results = await mapWithConcurrency(
    repos,
    (r) => lookupRepo(r, manifest, args.cacheDir, args.noRemote),
    args.jobs,
  );

  const summary = { community_match: 0, community_stale: 0, community_unknown: 0, community_unreachable: 0 };
  for (const r of results) summary[r.verdict]++;

  const output = {
    script_version: SCRIPT_VERSION,
    cache_status: cacheStatus,
    cache_error: cacheError,
    cache_dir: args.cacheDir,
    cache_commit_sha: cacheSha,
    manifest_version: manifest.version,
    scanner: manifest.scanner,
    lookup_timestamp: new Date().toISOString(),
    summary,
    results,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(3);
});
