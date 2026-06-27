#!/usr/bin/env node
// discover.mjs — multi-source candidate discovery for ievo init.
//
// Replaces the manual `npx skills add vercel-labs/skills --skill find-skills`
// prereq + `find-skills` SKILL.md invocation. We hit skills.sh API directly
// (it's just a REST endpoint — find-skills was a thin wrapper). Future: also
// query GitHub for agents/plugins not surfaced by skills.sh.
//
// Heuristics inherited from vercel-labs/skills find-skills SKILL.md:
// - Trusted owners (vercel-labs, anthropics, microsoft, ComposioHQ) get an
//   install-count BOOST in ranking. NOT a trust shortcut — security verdict
//   still comes from security-auditor LLM scan per item. Reputation aids
//   visibility, not safety.
// - Install thresholds: 1K+ preferred, <100 caution flag. NOT auto-rejection.
// - Category query mapping: testing → [testing, jest, playwright, pytest, ...]
//
// Input: stack context as JSON on stdin OR via --stack-file <path>
// Output: JSON to stdout — deduplicated ranked candidates
//
// Usage:
//   echo '{"languages":["python"],"deps":["pytest","fastapi"]}' | node discover.mjs
//   node discover.mjs --stack-file ./stack.json
//   node discover.mjs --limit 30 --concurrency 8

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_VERSION = "0.29.0";
export const SKILLS_SH_API = "https://skills.sh/api/search";
export const DEFAULT_PER_QUERY_LIMIT = 10;
export const DEFAULT_TOTAL_LIMIT = 50;
export const DEFAULT_CONCURRENCY = 8;

// Owner reputation boost for ranking (NOT a security signal).
// Sourced from find-skills SKILL.md "trusted sources" guidance.
// Stored lowercase — GitHub owner slugs are case-insensitive, and skills.sh
// API may emit either case. Compare via .toLowerCase() at lookup site.
export const REPUTATION_BOOST_OWNERS = new Set([
  "vercel-labs", "anthropics", "microsoft", "composiohq",
  "wshobson", "github",
]);
export const REPUTATION_BOOST_FACTOR = 1.5;

// Install-count quality tiers (from find-skills SKILL.md).
export function qualityTier(installs) {
  if (installs >= 1000) return "trusted";    // 1K+ preferred
  if (installs >= 100) return "neutral";     // 100-1K is fine
  return "low-confidence";                    // <100 caution
}

// Category → seed queries (from find-skills SKILL.md "Common Categories" table).
export const CATEGORY_QUERIES = {
  "web-development": ["react", "nextjs", "typescript", "tailwind"],
  "testing": ["testing", "jest", "playwright", "pytest", "vitest"],
  "devops": ["docker", "kubernetes", "ci-cd", "deployment"],
  "documentation": ["docs", "changelog", "api-docs"],
  "linting": ["lint", "eslint", "ruff", "prettier", "format"],
  "code-quality": ["review", "refactor", "best-practices"],
  "design": ["design-system", "accessibility"],
  "productivity": ["workflow", "automation", "git"],
  "frameworks": [],     // resolved from `frameworks` input
  "databases": ["database", "orm", "migration", "sql"],
  "security": ["security", "audit", "vulnerability"],
  "observability": ["logging", "tracing", "metrics", "opentelemetry"],
};

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

export function buildQueries(stack) {
  const queries = new Set();

  // Pre-filter all input arrays to non-empty strings (drop null/undefined/empty).
  const languages = (stack.languages ?? []).filter((s) => typeof s === "string" && s.length > 0);
  const deps = (stack.deps ?? []).filter((s) => typeof s === "string" && s.length > 0);
  const categories = (stack.categories ?? []).filter((s) => typeof s === "string" && s.length > 0);
  const frameworks = (stack.frameworks ?? []).filter((s) => typeof s === "string" && s.length > 0);

  // Layer 1 — language fundamentals (single-word, fuzzy mode in API)
  for (const lang of languages) {
    queries.add(lang);
  }

  // Layer 2 — per-dependency (single-word, fuzzy)
  for (const dep of deps) {
    queries.add(dep);
  }

  // Layer 3 — categories (single-word for breadth) + their seed queries
  for (const cat of categories) {
    queries.add(cat);
    for (const seed of CATEGORY_QUERIES[cat] ?? []) {
      queries.add(seed);
    }
  }

  // Layer 4 — frameworks (treat as deps if listed separately)
  for (const fw of frameworks) {
    queries.add(fw);
  }

  // Layer 5 — stack-specific compound queries (multi-word, semantic mode)
  const langSet = new Set(languages.map((s) => s.toLowerCase()));
  const depSet = new Set(deps.map((s) => s.toLowerCase()));
  const catSet = new Set(categories.map((s) => s.toLowerCase()));
  const fwSet = new Set(frameworks.map((s) => s.toLowerCase()));

  if (langSet.has("python") && catSet.has("testing")) queries.add("python testing");
  if (langSet.has("python") && fwSet.has("fastapi")) queries.add("fastapi python");
  if (langSet.has("python") && fwSet.has("django")) queries.add("django python");
  if (fwSet.has("react")) queries.add("react performance");
  if (fwSet.has("react")) queries.add("react accessibility");
  if (fwSet.has("nextjs")) queries.add("nextjs performance");
  if (depSet.has("stripe")) queries.add("payments integration");
  if (depSet.has("opentelemetry")) queries.add("observability tracing");

  return [...queries].filter(Boolean);
}

// ---------------------------------------------------------------------------
// skills.sh API
// ---------------------------------------------------------------------------

export async function searchSkillsSh(query, perQueryLimit = DEFAULT_PER_QUERY_LIMIT, fetchImpl = fetch) {
  const url = `${SKILLS_SH_API}?q=${encodeURIComponent(query)}&limit=${perQueryLimit}`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { query, results: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return { query, results: data.skills ?? [], searchType: data.searchType };
  } catch (err) {
    return { query, results: [], error: err.message };
  }
}

export async function mapWithConcurrency(items, fn, concurrency) {
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

// ---------------------------------------------------------------------------
// Dedup + rank
// ---------------------------------------------------------------------------

export function rankCandidates(allResults) {
  // Map by id (skill.id format: "owner/repo/skill-id")
  const byId = new Map();
  let skippedNoId = 0;

  for (const { query, results } of allResults) {
    for (const skill of results) {
      // Skip entries without an id — they'd collide under `undefined` key
      // and silently dedupe-collapse N candidates into one. Count for diagnostics.
      if (!skill.id) {
        skippedNoId++;
        continue;
      }

      // Normalize installs to a finite number (API may omit or send non-number)
      const installs = typeof skill.installs === "number" && Number.isFinite(skill.installs)
        ? skill.installs
        : 0;

      if (!byId.has(skill.id)) {
        byId.set(skill.id, {
          id: skill.id,
          name: skill.name,
          source_repo: skill.source,
          installs,
          quality_tier: qualityTier(installs),
          matched_queries: new Set(),
          rank_score: 0,
        });
      }
      const entry = byId.get(skill.id);
      entry.matched_queries.add(query);
    }
  }

  // Compute rank_score for each candidate
  for (const entry of byId.values()) {
    // Base score = installs (log-scaled to avoid dominance by mega-popular skills)
    // Math.max with 1 guards against log10(0) = -Infinity.
    const installScore = Math.log10(Math.max(entry.installs, 1));

    // Reputation boost (NOT a security shortcut — just visibility aid)
    // Case-insensitive: GitHub owner slugs aren't case-sensitive.
    const owner = (entry.source_repo ?? "").split("/")[0].toLowerCase();
    const repBoost = REPUTATION_BOOST_OWNERS.has(owner) ? REPUTATION_BOOST_FACTOR : 1.0;

    // Query-match breadth bonus — matched by multiple queries = more relevant
    const breadthBonus = 1 + 0.2 * (entry.matched_queries.size - 1);

    entry.rank_score = installScore * repBoost * breadthBonus;
  }

  // Convert matched_queries Set to Array for JSON serialization
  for (const entry of byId.values()) {
    entry.matched_queries = [...entry.matched_queries];
  }

  const sorted = [...byId.values()].sort((a, b) => b.rank_score - a.rank_score);
  // Attach diagnostic — non-enumerable so it doesn't appear in JSON unless explicit
  Object.defineProperty(sorted, "skippedNoId", { value: skippedNoId, enumerable: false });
  return sorted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parsePositiveInt(value, flagName, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} requires a positive integer, got '${value}' — falling back to ${fallback} would mask the input error`);
  }
  return n;
}

function requireValue(argv, i, flagName) {
  const v = argv[i];
  if (v === undefined) {
    throw new Error(`${flagName} requires a value, got end of arguments`);
  }
  if (v.startsWith("--")) {
    throw new Error(`${flagName} requires a value, got flag '${v}' — looks like the value was forgotten`);
  }
  return v;
}

export function parseArgs(argv) {
  const args = { stackFile: null, limit: DEFAULT_TOTAL_LIMIT, concurrency: DEFAULT_CONCURRENCY, perQuery: DEFAULT_PER_QUERY_LIMIT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stack-file") args.stackFile = requireValue(argv, ++i, "--stack-file");
    else if (a === "--limit") args.limit = parsePositiveInt(requireValue(argv, ++i, "--limit"), "--limit", DEFAULT_TOTAL_LIMIT);
    else if (a === "--concurrency") args.concurrency = parsePositiveInt(requireValue(argv, ++i, "--concurrency"), "--concurrency", DEFAULT_CONCURRENCY);
    else if (a === "--per-query") args.perQuery = parsePositiveInt(requireValue(argv, ++i, "--per-query"), "--per-query", DEFAULT_PER_QUERY_LIMIT);
  }
  return args;
}

export async function readStdin(stdinStream = process.stdin) {
  const chunks = [];
  for await (const chunk of stdinStream) {
    // process.stdin yields Buffer; Readable.from(["str"]) yields strings.
    // Normalize both to Buffer so Buffer.concat works.
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function runDiscover(stack, options = {}) {
  const {
    limit = DEFAULT_TOTAL_LIMIT,
    concurrency = DEFAULT_CONCURRENCY,
    perQuery = DEFAULT_PER_QUERY_LIMIT,
    fetchImpl = fetch,
  } = options;

  const startTime = Date.now();
  const queries = buildQueries(stack);

  if (queries.length === 0) {
    return {
      script_version: SCRIPT_VERSION,
      sources: [],
      candidates: [],
      error: "no queries derived from stack — provide languages/deps/categories/frameworks",
    };
  }

  const allResults = await mapWithConcurrency(
    queries,
    (q) => searchSkillsSh(q, perQuery, fetchImpl),
    concurrency,
  );

  const totalResults = allResults.reduce((s, r) => s + r.results.length, 0);
  const errors = allResults.filter((r) => r.error).map((r) => ({ query: r.query, error: r.error }));

  const ranked = rankCandidates(allResults).slice(0, limit);

  return {
    script_version: SCRIPT_VERSION,
    elapsed_ms: Date.now() - startTime,
    stack_input: stack,
    sources: [{
      name: "skills.sh",
      queries_executed: queries.length,
      raw_results: totalResults,
      errors: errors.length,
      error_details: errors,
    }],
    queries,
    candidates: ranked,
  };
}

export async function main(argv = process.argv, stdinStream = process.stdin, log = console.log, errLog = console.error, exit = process.exit) {
  if (argv.includes("--version")) {
    log(SCRIPT_VERSION);
    return exit(0);
  }

  if (argv.includes("--help")) {
    log(`discover.mjs — multi-source candidate discovery for ievo init
Usage:
  echo '{"languages":["python"],"deps":["pytest"]}' | discover.mjs
  discover.mjs --stack-file <path> [--limit N] [--concurrency N]
  discover.mjs --version
  discover.mjs --help`);
    return exit(0);
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    errLog(`Error: ${err.message}`);
    return exit(3);
  }

  let stack;
  let inputSource;
  if (args.stackFile) {
    inputSource = `--stack-file ${args.stackFile}`;
    let raw;
    try {
      raw = readFileSync(args.stackFile, "utf-8");
    } catch (err) {
      errLog(`Error: cannot read stack file '${args.stackFile}': ${err.message}`);
      return exit(3);
    }
    try {
      stack = JSON.parse(raw);
    } catch (err) {
      errLog(`Error: invalid JSON in ${inputSource}: ${err.message}`);
      errLog(`First 200 chars: ${raw.slice(0, 200)}`);
      return exit(3);
    }
  } else {
    inputSource = "stdin";
    const stdinText = (await readStdin(stdinStream)).trim();
    if (!stdinText) {
      errLog("Error: provide stack via stdin JSON or --stack-file <path>");
      return exit(1);
    }
    try {
      stack = JSON.parse(stdinText);
    } catch (err) {
      errLog(`Error: invalid JSON in stdin: ${err.message}`);
      errLog(`First 200 chars: ${stdinText.slice(0, 200)}`);
      return exit(3);
    }
  }

  const output = await runDiscover(stack, {
    limit: args.limit,
    concurrency: args.concurrency,
    perQuery: args.perQuery,
  });

  // Always print the JSON to stdout (callers parse it).
  log(JSON.stringify(output, null, 2));

  // Surface discovery problems to stderr — init's Bash invocation captures
  // stderr separately from stdout. Don't bury failures in JSON only.
  const errorCount = output.sources?.[0]?.errors ?? 0;
  const queryCount = output.sources?.[0]?.queries_executed ?? 0;
  if (queryCount > 0 && errorCount === queryCount) {
    // Total failure — all queries errored. Exit non-zero so init can branch.
    errLog(`[discover.mjs] FATAL: all ${queryCount} skills.sh queries failed. Network down / API outage / DNS / TLS issue. Candidates list will be empty.`);
    return exit(4);
  }
  if (errorCount > 0) {
    // Partial failure — warn but continue. Candidates may still be useful.
    const failedQueries = output.sources[0].error_details.map((e) => e.query).join(", ");
    errLog(`[discover.mjs] WARN: ${errorCount}/${queryCount} skills.sh queries failed: ${failedQueries}`);
  }
  if (output.error) {
    // Stack input issue (no queries derived) — communicate via exit code too
    errLog(`[discover.mjs] WARN: ${output.error}`);
    return exit(5);
  }

  return exit(0);
}

export async function mainSafe(argv = process.argv, stdinStream = process.stdin, log = console.log, errLog = console.error, exit = process.exit) {
  // Defensive wrapper — main() has internal try/catch around every known
  // throwing path, but this catches anything future code might add without
  // wrapping. Testable via mock exit/errLog.
  try {
    return await main(argv, stdinStream, log, errLog, exit);
  } catch (err) {
    errLog(`fatal: ${err.message}`);
    return exit(2);
  }
}

// Pure entry-guard predicate — extracted so the `argv[1] ?? ""` fallback
// branch is reachable from tests. Module-scope `if` runs at import time
// with whatever argv Node populated; tests can call this directly with
// argv shapes Node would never produce (e.g. `["node"]` from `node -e`).
//
// Normalises both sides: process.argv[1] is often a relative path
// (`node plugins/ievo/scripts/discover.mjs`) while import.meta.url is
// always absolute. Without resolve() the equality check silently fails
// and main() never runs.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

// CLI entry — only run when invoked directly.
if (isCliEntry(import.meta.url, process.argv)) {
  mainSafe();
}
