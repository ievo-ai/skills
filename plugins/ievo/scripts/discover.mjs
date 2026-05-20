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
// - Synonym fallback: if "deploy" yields low results, retry with "deployment"
//
// Input: stack context as JSON on stdin OR via --stack-file <path>
// Output: JSON to stdout — deduplicated ranked candidates
//
// Usage:
//   echo '{"languages":["python"],"deps":["pytest","fastapi"]}' | node discover.mjs
//   node discover.mjs --stack-file ./stack.json
//   node discover.mjs --limit 30 --concurrency 8

import { readFileSync } from "node:fs";

const SCRIPT_VERSION = "0.6.0";
const SKILLS_SH_API = "https://skills.sh/api/search";
const DEFAULT_PER_QUERY_LIMIT = 10;
const DEFAULT_TOTAL_LIMIT = 50;
const DEFAULT_CONCURRENCY = 8;

// Owner reputation boost for ranking (NOT a security signal).
// Sourced from find-skills SKILL.md "trusted sources" guidance.
const REPUTATION_BOOST_OWNERS = new Set([
  "vercel-labs", "anthropics", "microsoft", "ComposioHQ",
  "wshobson", "github",
]);
const REPUTATION_BOOST_FACTOR = 1.5;

// Install-count quality tiers (from find-skills SKILL.md).
function qualityTier(installs) {
  if (installs >= 1000) return "trusted";    // 1K+ preferred
  if (installs >= 100) return "neutral";     // 100-1K is fine
  return "low-confidence";                    // <100 caution
}

// Category → seed queries (from find-skills SKILL.md "Common Categories" table).
const CATEGORY_QUERIES = {
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

// Synonym fallback (from find-skills "Try alternative terms" tip).
const SYNONYMS = {
  "deploy": ["deployment", "ci-cd"],
  "format": ["formatting", "formatter"],
  "lint": ["linting", "linter"],
  "test": ["testing", "tests"],
  "auth": ["authentication", "authorization"],
  "perf": ["performance", "optimization"],
};

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

function buildQueries(stack) {
  const queries = new Set();

  // Layer 1 — language fundamentals (single-word, fuzzy mode in API)
  for (const lang of stack.languages ?? []) {
    queries.add(lang);
  }

  // Layer 2 — per-dependency (single-word, fuzzy)
  for (const dep of stack.deps ?? []) {
    queries.add(dep);
  }

  // Layer 3 — categories (single-word for breadth) + their seed queries
  for (const cat of stack.categories ?? []) {
    queries.add(cat);
    for (const seed of CATEGORY_QUERIES[cat] ?? []) {
      queries.add(seed);
    }
  }

  // Layer 4 — frameworks (treat as deps if listed separately)
  for (const fw of stack.frameworks ?? []) {
    queries.add(fw);
  }

  // Layer 5 — stack-specific compound queries (multi-word, semantic mode)
  const langSet = new Set((stack.languages ?? []).map((s) => s.toLowerCase()));
  const depSet = new Set((stack.deps ?? []).map((s) => s.toLowerCase()));
  const catSet = new Set((stack.categories ?? []).map((s) => s.toLowerCase()));
  const fwSet = new Set((stack.frameworks ?? []).map((s) => s.toLowerCase()));

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

async function searchSkillsSh(query, perQueryLimit = DEFAULT_PER_QUERY_LIMIT) {
  const url = `${SKILLS_SH_API}?q=${encodeURIComponent(query)}&limit=${perQueryLimit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { query, results: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return { query, results: data.skills ?? [], searchType: data.searchType };
  } catch (err) {
    return { query, results: [], error: err.message };
  }
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

// ---------------------------------------------------------------------------
// Dedup + rank
// ---------------------------------------------------------------------------

function rankCandidates(allResults, stack) {
  // Map by id (skill.id format: "owner/repo/skill-id")
  const byId = new Map();
  for (const { query, results } of allResults) {
    for (const skill of results) {
      const id = skill.id;
      if (!byId.has(id)) {
        byId.set(id, {
          id: skill.id,
          name: skill.name,
          source_repo: skill.source,
          installs: skill.installs,
          quality_tier: qualityTier(skill.installs),
          matched_queries: new Set(),
          rank_score: 0,
        });
      }
      const entry = byId.get(id);
      entry.matched_queries.add(query);
    }
  }

  // Compute rank_score for each candidate
  for (const entry of byId.values()) {
    // Base score = installs (log-scaled to avoid dominance by mega-popular skills)
    const installScore = Math.log10(Math.max(entry.installs, 1));

    // Reputation boost (NOT a security shortcut — just visibility aid)
    const owner = (entry.source_repo ?? "").split("/")[0];
    const repBoost = REPUTATION_BOOST_OWNERS.has(owner) ? REPUTATION_BOOST_FACTOR : 1.0;

    // Query-match breadth bonus — matched by multiple queries = more relevant
    const breadthBonus = 1 + 0.2 * (entry.matched_queries.size - 1);

    entry.rank_score = installScore * repBoost * breadthBonus;
  }

  // Convert matched_queries Set to Array for JSON serialization
  for (const entry of byId.values()) {
    entry.matched_queries = [...entry.matched_queries];
  }

  return [...byId.values()].sort((a, b) => b.rank_score - a.rank_score);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { stackFile: null, limit: DEFAULT_TOTAL_LIMIT, concurrency: DEFAULT_CONCURRENCY, perQuery: DEFAULT_PER_QUERY_LIMIT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stack-file") args.stackFile = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
    else if (a === "--per-query") args.perQuery = parseInt(argv[++i], 10);
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const args = parseArgs(process.argv);

  let stack;
  if (args.stackFile) {
    stack = JSON.parse(readFileSync(args.stackFile, "utf-8"));
  } else {
    const stdinText = (await readStdin()).trim();
    if (!stdinText) {
      console.error("Error: provide stack via stdin JSON or --stack-file <path>");
      process.exit(1);
    }
    stack = JSON.parse(stdinText);
  }

  const startTime = Date.now();
  const queries = buildQueries(stack);

  if (queries.length === 0) {
    console.log(JSON.stringify({
      script_version: SCRIPT_VERSION,
      sources: [],
      candidates: [],
      error: "no queries derived from stack — provide languages/deps/categories/frameworks",
    }, null, 2));
    return;
  }

  const allResults = await mapWithConcurrency(
    queries,
    (q) => searchSkillsSh(q, args.perQuery),
    args.concurrency,
  );

  const totalResults = allResults.reduce((s, r) => s + r.results.length, 0);
  const errors = allResults.filter((r) => r.error).map((r) => ({ query: r.query, error: r.error }));

  const ranked = rankCandidates(allResults, stack).slice(0, args.limit);

  const output = {
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

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(2);
});
