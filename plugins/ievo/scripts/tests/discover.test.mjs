// Tests for discover.mjs — multi-source candidate discovery.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/discover.test.mjs

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";

import {
  SCRIPT_VERSION,
  SKILLS_SH_API,
  DEFAULT_PER_QUERY_LIMIT,
  DEFAULT_TOTAL_LIMIT,
  DEFAULT_CONCURRENCY,
  REPUTATION_BOOST_OWNERS,
  REPUTATION_BOOST_FACTOR,
  CODEX_VISIBILITY_FLOOR,
  CATEGORY_QUERIES,
  qualityTier,
  buildQueries,
  searchSkillsSh,
  mapWithConcurrency,
  rankCandidates,
  parseArgs,
  readStdin,
  runDiscover,
  CODEX_SOURCE,
  CODEX_QUALITY_TIER,
  defaultCodexExec,
  fetchCodexMarketplace,
  main,
  mainSafe,
  isCliEntry,
} from "../discover.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SCRIPT_VERSION matches plugin.json — real coupling, not hardcoded", () => {
    // Read the canonical package version from plugin.json at test time. If anyone
    // bumps plugin.json without bumping SCRIPT_VERSION (or vice versa), this test
    // fails — closing the drift gap we hit between v0.6.0 and v0.6.1.
    const pluginJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.claude-plugin/plugin.json");
    const { version } = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
    assert.equal(SCRIPT_VERSION, version, `discover.mjs SCRIPT_VERSION ('${SCRIPT_VERSION}') and plugin.json version ('${version}') must agree — bump both in the same PR`);
  });

  it("SKILLS_SH_API points to skills.sh search endpoint", () => {
    assert.equal(SKILLS_SH_API, "https://skills.sh/api/search");
  });

  it("DEFAULT limits are sensible", () => {
    assert.equal(DEFAULT_PER_QUERY_LIMIT, 10);
    assert.equal(DEFAULT_TOTAL_LIMIT, 50);
    assert.equal(DEFAULT_CONCURRENCY, 8);
  });

  it("REPUTATION_BOOST_OWNERS contains expected names from find-skills SKILL.md (lowercase)", () => {
    // Stored lowercase to enable case-insensitive matching at lookup site.
    assert.ok(REPUTATION_BOOST_OWNERS.has("vercel-labs"));
    assert.ok(REPUTATION_BOOST_OWNERS.has("anthropics"));
    assert.ok(REPUTATION_BOOST_OWNERS.has("microsoft"));
    assert.ok(REPUTATION_BOOST_OWNERS.has("composiohq"));
    assert.ok(REPUTATION_BOOST_OWNERS.has("wshobson"));
    assert.ok(REPUTATION_BOOST_OWNERS.has("github"));
  });

  it("REPUTATION_BOOST_FACTOR is 1.5×", () => {
    assert.equal(REPUTATION_BOOST_FACTOR, 1.5);
  });

  it("CATEGORY_QUERIES covers core categories", () => {
    for (const cat of ["testing", "linting", "security", "devops", "documentation"]) {
      assert.ok(CATEGORY_QUERIES[cat], `CATEGORY_QUERIES missing ${cat}`);
      assert.ok(Array.isArray(CATEGORY_QUERIES[cat]));
    }
  });

});

// ---------------------------------------------------------------------------
// qualityTier
// ---------------------------------------------------------------------------

describe("qualityTier", () => {
  it("1K+ installs → trusted", () => {
    assert.equal(qualityTier(1000), "trusted");
    assert.equal(qualityTier(50000), "trusted");
    assert.equal(qualityTier(Number.MAX_SAFE_INTEGER), "trusted");
  });

  it("100-999 installs → neutral", () => {
    assert.equal(qualityTier(100), "neutral");
    assert.equal(qualityTier(500), "neutral");
    assert.equal(qualityTier(999), "neutral");
  });

  it("<100 installs → low-confidence", () => {
    assert.equal(qualityTier(0), "low-confidence");
    assert.equal(qualityTier(50), "low-confidence");
    assert.equal(qualityTier(99), "low-confidence");
  });
});

// ---------------------------------------------------------------------------
// buildQueries
// ---------------------------------------------------------------------------

describe("buildQueries", () => {
  it("returns empty array for empty stack", () => {
    assert.deepEqual(buildQueries({}), []);
  });

  it("includes language fundamentals", () => {
    const q = buildQueries({ languages: ["python", "typescript"] });
    assert.ok(q.includes("python"));
    assert.ok(q.includes("typescript"));
  });

  it("includes direct dependencies", () => {
    const q = buildQueries({ deps: ["pytest", "fastapi"] });
    assert.ok(q.includes("pytest"));
    assert.ok(q.includes("fastapi"));
  });

  it("includes categories AND their seed queries", () => {
    const q = buildQueries({ categories: ["testing"] });
    assert.ok(q.includes("testing"));
    // From CATEGORY_QUERIES.testing
    assert.ok(q.includes("jest"));
    assert.ok(q.includes("pytest"));
    assert.ok(q.includes("playwright"));
  });

  it("includes frameworks", () => {
    const q = buildQueries({ frameworks: ["react", "nextjs"] });
    assert.ok(q.includes("react"));
    assert.ok(q.includes("nextjs"));
  });

  it("generates python + testing compound query", () => {
    const q = buildQueries({ languages: ["python"], categories: ["testing"] });
    assert.ok(q.includes("python testing"));
  });

  it("generates python + fastapi compound query", () => {
    const q = buildQueries({ languages: ["python"], frameworks: ["fastapi"] });
    assert.ok(q.includes("fastapi python"));
  });

  it("generates python + django compound query", () => {
    const q = buildQueries({ languages: ["python"], frameworks: ["django"] });
    assert.ok(q.includes("django python"));
  });

  it("generates react compound queries", () => {
    const q = buildQueries({ frameworks: ["react"] });
    assert.ok(q.includes("react performance"));
    assert.ok(q.includes("react accessibility"));
  });

  it("generates nextjs compound query", () => {
    const q = buildQueries({ frameworks: ["nextjs"] });
    assert.ok(q.includes("nextjs performance"));
  });

  it("generates stripe compound query when stripe in deps", () => {
    const q = buildQueries({ deps: ["stripe"] });
    assert.ok(q.includes("payments integration"));
  });

  it("generates opentelemetry compound query", () => {
    const q = buildQueries({ deps: ["opentelemetry"] });
    assert.ok(q.includes("observability tracing"));
  });

  it("dedupes queries even when categories overlap with deps", () => {
    const q = buildQueries({ deps: ["pytest"], categories: ["testing"] });
    const pytestCount = q.filter((x) => x === "pytest").length;
    assert.equal(pytestCount, 1, "pytest should appear exactly once");
  });

  it("handles unknown category (no seed queries) gracefully", () => {
    const q = buildQueries({ categories: ["unknown-cat"] });
    assert.ok(q.includes("unknown-cat"));
  });

  it("is case-insensitive for compound query triggers", () => {
    const q = buildQueries({ languages: ["Python"], frameworks: ["FastAPI"] });
    assert.ok(q.includes("fastapi python"));
  });

  it("filters out falsy values", () => {
    const q = buildQueries({ languages: ["python", ""], deps: [null, "fastapi"] });
    assert.ok(!q.includes(""));
    assert.ok(!q.includes(null));
  });
});

// ---------------------------------------------------------------------------
// searchSkillsSh (with mock fetch)
// ---------------------------------------------------------------------------

describe("searchSkillsSh", () => {
  function makeMockFetch(responseBody, status = 200, ok = true) {
    return async (url) => ({
      ok,
      status,
      json: async () => responseBody,
    });
  }

  it("returns results for successful response", async () => {
    const mockFetch = makeMockFetch({
      skills: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }],
      searchType: "fuzzy",
    });
    const r = await searchSkillsSh("test", 10, mockFetch);
    assert.equal(r.query, "test");
    assert.equal(r.results.length, 1);
    assert.equal(r.searchType, "fuzzy");
  });

  it("tags each result with source_origin: 'skills.sh'", async () => {
    const mockFetch = makeMockFetch({
      skills: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }],
    });
    const r = await searchSkillsSh("test", 10, mockFetch);
    assert.equal(r.results[0].source_origin, "skills.sh");
    // Original fields preserved alongside the tag.
    assert.equal(r.results[0].id, "a/b/c");
  });

  it("returns empty results on non-ok response", async () => {
    const mockFetch = makeMockFetch(null, 500, false);
    const r = await searchSkillsSh("test", 10, mockFetch);
    assert.equal(r.results.length, 0);
    assert.match(r.error, /HTTP 500/);
  });

  it("returns empty results on fetch error", async () => {
    const mockFetch = async () => {
      throw new Error("network failure");
    };
    const r = await searchSkillsSh("test", 10, mockFetch);
    assert.equal(r.results.length, 0);
    assert.match(r.error, /network failure/);
  });

  it("handles response with missing skills field", async () => {
    const mockFetch = makeMockFetch({});
    const r = await searchSkillsSh("test", 10, mockFetch);
    assert.deepEqual(r.results, []);
  });

  it("URL-encodes query string", async () => {
    let capturedUrl = null;
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ skills: [] }) };
    };
    await searchSkillsSh("react performance", 5, mockFetch);
    assert.match(capturedUrl, /q=react%20performance/);
    assert.match(capturedUrl, /limit=5/);
  });
});

// ---------------------------------------------------------------------------
// mapWithConcurrency
// ---------------------------------------------------------------------------

describe("mapWithConcurrency", () => {
  it("maps over items with results in same order", async () => {
    const r = await mapWithConcurrency([1, 2, 3], async (x) => x * 2, 2);
    assert.deepEqual(r, [2, 4, 6]);
  });

  it("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const fn = async (x) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((res) => setTimeout(res, 5));
      active--;
      return x;
    };
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], fn, 3);
    assert.ok(maxActive <= 3, `maxActive was ${maxActive}, expected ≤ 3`);
  });

  it("handles empty input", async () => {
    const r = await mapWithConcurrency([], async (x) => x, 5);
    assert.deepEqual(r, []);
  });

  it("does not spawn more workers than items", async () => {
    const r = await mapWithConcurrency([1], async (x) => x, 100);
    assert.deepEqual(r, [1]);
  });
});

// ---------------------------------------------------------------------------
// rankCandidates
// ---------------------------------------------------------------------------

describe("rankCandidates", () => {
  it("dedupes by skill.id across queries", () => {
    const results = [
      { query: "q1", results: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }] },
      { query: "q2", results: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].matched_queries.length, 2);
  });

  it("sorts by rank_score descending", () => {
    const results = [
      { query: "q1", results: [
        { id: "x/y/low", name: "low", source: "x/y", installs: 10 },
        { id: "x/y/high", name: "high", source: "x/y", installs: 100000 },
      ] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked[0].name, "high");
    assert.equal(ranked[1].name, "low");
  });

  it("applies the codex visibility floor so install-less codex plugins still surface", () => {
    // A codex plugin (installs 0) would score 0 and sort dead-last without the
    // floor. With it, it outranks a <10-install skills.sh skill but stays below
    // popular ones.
    const results = [
      { query: "__codex-marketplace__", results: [
        { id: "cx/plugin", name: "codexPlugin", source: "codex/official", source_origin: "codex-marketplace", installs: 0 },
      ] },
      { query: "q1", results: [
        { id: "x/y/tiny", name: "tiny", source: "x/y", installs: 3 },     // log10(3)≈0.48 < floor
        { id: "x/y/big", name: "big", source: "x/y", installs: 100000 },  // log10(1e5)=5 > floor
      ] },
    ];
    const ranked = rankCandidates(results);
    const codex = ranked.find((c) => c.name === "codexPlugin");
    const tiny = ranked.find((c) => c.name === "tiny");
    const big = ranked.find((c) => c.name === "big");
    assert.equal(codex.rank_score, CODEX_VISIBILITY_FLOOR);
    assert.ok(codex.rank_score > tiny.rank_score, "codex plugin outranks a sub-floor skill");
    assert.ok(big.rank_score > codex.rank_score, "a popular skill still outranks the codex floor");
  });

  it("does not grant a breadth bonus when a codex sentinel collides with a skills.sh winner", () => {
    // skills.sh entry matched by one real query, then the codex group hits the
    // same id. The sentinel must NOT inflate the winner's breadth bonus.
    const results = [
      { query: "testing", results: [{ id: "a/b/dup", name: "dup", source: "a/b", installs: 100 }] },
      { query: "__codex-marketplace__", results: [
        { id: "a/b/dup", name: "dup", source: "codex/x", source_origin: "codex-marketplace", installs: 0 },
      ] },
    ];
    const ranked = rankCandidates(results);
    const dup = ranked.find((c) => c.id === "a/b/dup");
    // First-seen (skills.sh) wins; sentinel skipped → single real matched query, breadth bonus 1.
    assert.equal(dup.source_origin, "skills.sh");
    assert.deepEqual(dup.matched_queries, ["testing"]);
    assert.equal(dup.rank_score, Math.log10(100)); // installScore × 1 (no breadth inflation)
  });

  it("applies REPUTATION_BOOST_FACTOR for trusted owners", () => {
    const results = [
      { query: "q1", results: [
        { id: "vercel-labs/x/skill", name: "boosted", source: "vercel-labs/x", installs: 1000 },
        { id: "unknown/y/skill", name: "normal", source: "unknown/y", installs: 1000 },
      ] },
    ];
    const ranked = rankCandidates(results);
    const boosted = ranked.find((c) => c.name === "boosted");
    const normal = ranked.find((c) => c.name === "normal");
    assert.equal(boosted.rank_score, normal.rank_score * REPUTATION_BOOST_FACTOR);
  });

  it("applies reputation boost case-insensitively (GitHub owner slugs aren't case-sensitive)", () => {
    // Skills.sh API may emit either case; we shouldn't silently de-rank.
    const results = [
      { query: "q1", results: [
        { id: "Anthropics/x/skill", name: "uppercase", source: "Anthropics/x", installs: 1000 },
        { id: "ANTHROPICS/y/skill", name: "shouty", source: "ANTHROPICS/y", installs: 1000 },
        { id: "anthropics/z/skill", name: "lowercase", source: "anthropics/z", installs: 1000 },
      ] },
    ];
    const ranked = rankCandidates(results);
    for (const entry of ranked) {
      // All three should have the boost (1.5× factor over base log10(1000)=3 = 4.5)
      assert.equal(entry.rank_score, 3 * REPUTATION_BOOST_FACTOR);
    }
  });

  it("skips candidates without `id` field (avoids Map collapse under undefined key)", () => {
    const results = [
      { query: "q1", results: [
        { id: "x/y/has-id", name: "kept", source: "x/y", installs: 100 },
        { name: "missing-id-1", source: "x/y", installs: 100 },  // no id
        { name: "missing-id-2", source: "x/y", installs: 200 },  // no id
      ] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].name, "kept");
    assert.equal(ranked.skippedNoId, 2, "should count skipped no-id entries");
  });

  it("normalizes missing/non-number installs to 0 (avoids NaN rank_score)", () => {
    const results = [
      { query: "q1", results: [
        { id: "x/y/a", name: "missing", source: "x/y" },  // no installs field
        { id: "x/y/b", name: "string", source: "x/y", installs: "abc" },  // non-number
        { id: "x/y/c", name: "null", source: "x/y", installs: null },
        { id: "x/y/d", name: "valid", source: "x/y", installs: 1000 },
      ] },
    ];
    const ranked = rankCandidates(results);
    for (const entry of ranked) {
      assert.ok(Number.isFinite(entry.rank_score), `${entry.name} rank_score should be finite, got ${entry.rank_score}`);
      assert.ok(!Number.isNaN(entry.rank_score), `${entry.name} rank_score should not be NaN`);
    }
    // Sort order is deterministic: valid (1000) > others (0)
    assert.equal(ranked[0].name, "valid");
  });

  it("applies match-breadth bonus", () => {
    const results = [
      { query: "q1", results: [{ id: "x/y/single", name: "single", source: "x/y", installs: 1000 }] },
      { query: "q2", results: [{ id: "x/y/double", name: "double", source: "x/y", installs: 1000 }] },
      { query: "q3", results: [{ id: "x/y/double", name: "double", source: "x/y", installs: 1000 }] },
    ];
    const ranked = rankCandidates(results);
    const single = ranked.find((c) => c.name === "single");
    const double = ranked.find((c) => c.name === "double");
    // double has 2 matched queries → +0.2 multiplier
    assert.ok(double.rank_score > single.rank_score);
    assert.equal(double.matched_queries.length, 2);
  });

  it("assigns quality_tier per qualityTier function", () => {
    const results = [
      { query: "q1", results: [
        { id: "a/b/trust", name: "trust", source: "a/b", installs: 50000 },
        { id: "a/b/neut", name: "neut", source: "a/b", installs: 300 },
        { id: "a/b/low", name: "low", source: "a/b", installs: 5 },
      ] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked.find((c) => c.name === "trust").quality_tier, "trusted");
    assert.equal(ranked.find((c) => c.name === "neut").quality_tier, "neutral");
    assert.equal(ranked.find((c) => c.name === "low").quality_tier, "low-confidence");
  });

  it("handles installs=0 with Math.max guard (no log(0))", () => {
    const results = [
      { query: "q1", results: [{ id: "x/y/z", name: "z", source: "x/y", installs: 0 }] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked[0].rank_score, 0); // log10(1) × 1.0 × 1.0
    assert.notStrictEqual(ranked[0].rank_score, -Infinity);
  });

  it("handles missing source field", () => {
    const results = [
      { query: "q1", results: [{ id: "x/y/z", name: "z", installs: 100 }] },
    ];
    const ranked = rankCandidates(results);
    assert.equal(ranked[0].source_repo, undefined);
    // No trusted-owner boost when source is missing
    assert.ok(ranked[0].rank_score > 0);
  });

  it("returns empty array for no results", () => {
    assert.deepEqual(rankCandidates([]), []);
    assert.deepEqual(rankCandidates([{ query: "q1", results: [] }]), []);
  });

  it("converts matched_queries Set to Array in output (JSON serializable)", () => {
    const results = [
      { query: "q1", results: [{ id: "x/y/z", name: "z", source: "x/y", installs: 100 }] },
    ];
    const ranked = rankCandidates(results);
    assert.ok(Array.isArray(ranked[0].matched_queries));
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns default values for empty argv", () => {
    const a = parseArgs(["node", "discover.mjs"]);
    assert.equal(a.stackFile, null);
    assert.equal(a.limit, DEFAULT_TOTAL_LIMIT);
    assert.equal(a.concurrency, DEFAULT_CONCURRENCY);
    assert.equal(a.perQuery, DEFAULT_PER_QUERY_LIMIT);
  });

  it("--stack-file sets path", () => {
    const a = parseArgs(["node", "discover.mjs", "--stack-file", "/path/to/stack.json"]);
    assert.equal(a.stackFile, "/path/to/stack.json");
  });

  it("--limit parses integer", () => {
    const a = parseArgs(["node", "discover.mjs", "--limit", "20"]);
    assert.equal(a.limit, 20);
  });

  it("--concurrency parses integer", () => {
    const a = parseArgs(["node", "discover.mjs", "--concurrency", "16"]);
    assert.equal(a.concurrency, 16);
  });

  it("--per-query parses integer", () => {
    const a = parseArgs(["node", "discover.mjs", "--per-query", "5"]);
    assert.equal(a.perQuery, 5);
  });

  it("combines multiple flags", () => {
    const a = parseArgs(["node", "discover.mjs", "--limit", "30", "--concurrency", "4"]);
    assert.equal(a.limit, 30);
    assert.equal(a.concurrency, 4);
  });

  it("throws on invalid --limit (NaN-like input)", () => {
    assert.throws(() => parseArgs(["node", "discover.mjs", "--limit", "abc"]), /--limit requires/);
  });

  it("throws on zero --limit (would silently slice to 0)", () => {
    assert.throws(() => parseArgs(["node", "discover.mjs", "--limit", "0"]), /--limit requires/);
  });

  it("throws on negative --concurrency", () => {
    assert.throws(() => parseArgs(["node", "discover.mjs", "--concurrency", "-1"]), /--concurrency requires/);
  });

  it("throws on missing value after --per-query", () => {
    assert.throws(() => parseArgs(["node", "discover.mjs", "--per-query"]), /--per-query requires/);
  });

  it("throws when --stack-file is last arg (no value provided)", () => {
    assert.throws(
      () => parseArgs(["node", "discover.mjs", "--stack-file"]),
      /--stack-file requires a value, got end of arguments/,
    );
  });

  it("throws when --stack-file is followed by another flag instead of a path", () => {
    assert.throws(
      () => parseArgs(["node", "discover.mjs", "--stack-file", "--limit", "20"]),
      /--stack-file requires a value, got flag '--limit'/,
    );
  });

  it("throws when --limit is followed by another flag instead of a number", () => {
    assert.throws(
      () => parseArgs(["node", "discover.mjs", "--limit", "--concurrency"]),
      /--limit requires a value, got flag '--concurrency'/,
    );
  });
});

// ---------------------------------------------------------------------------
// readStdin
// ---------------------------------------------------------------------------

describe("readStdin", () => {
  it("reads chunks from stream and concatenates", async () => {
    const stream = Readable.from(["abc", "def"]);
    const result = await readStdin(stream);
    assert.equal(result, "abcdef");
  });

  it("returns empty string for empty stream", async () => {
    const stream = Readable.from([]);
    const result = await readStdin(stream);
    assert.equal(result, "");
  });
});

// ---------------------------------------------------------------------------
// runDiscover
// ---------------------------------------------------------------------------

describe("runDiscover", () => {
  function makeFakeFetch(skillsByQuery) {
    return async (url) => {
      const u = new URL(url);
      const q = u.searchParams.get("q");
      const skills = skillsByQuery[q] ?? skillsByQuery._default ?? [];
      return { ok: true, json: async () => ({ skills, searchType: "fuzzy" }) };
    };
  }

  // codexExec stub that yields no codex catalog — keeps runDiscover tests
  // deterministic regardless of whether a `codex` binary exists on the host.
  const noCodex = async () => null;

  it("returns error when no queries derived from empty stack", async () => {
    const out = await runDiscover({}, { fetchImpl: makeFakeFetch({}), codexExec: noCodex });
    assert.match(out.error, /no queries derived/);
    assert.deepEqual(out.candidates, []);
  });

  it("produces structured output with sources + queries + candidates", async () => {
    const out = await runDiscover(
      { languages: ["python"] },
      { fetchImpl: makeFakeFetch({ python: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }] }), codexExec: noCodex },
    );
    // out.script_version is emitted from the same SCRIPT_VERSION constant covered
    // by the constants test above — re-checking against the same constant here
    // (not a hardcoded string) keeps runDiscover's wiring honest without
    // re-asserting the package-version coupling.
    assert.equal(out.script_version, SCRIPT_VERSION);
    assert.ok(out.sources[0].name === "skills.sh");
    assert.ok(out.sources[0].queries_executed >= 1);
    assert.ok(out.candidates.length >= 1);
    assert.ok(typeof out.elapsed_ms === "number");
  });

  it("respects limit option", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `a/b/skill-${i}`, name: `skill-${i}`, source: "a/b", installs: i * 100,
    }));
    const out = await runDiscover(
      { languages: ["python"] },
      { limit: 5, fetchImpl: makeFakeFetch({ _default: many }), codexExec: noCodex },
    );
    assert.equal(out.candidates.length, 5);
  });

  it("aggregates errors into source report", async () => {
    const failingFetch = async () => {
      throw new Error("network down");
    };
    const out = await runDiscover(
      { languages: ["python"] },
      { fetchImpl: failingFetch, codexExec: noCodex },
    );
    // Name-based lookup — robust to future reordering of sources[].
    const skillsSh = out.sources.find((s) => s.name === "skills.sh");
    assert.ok(skillsSh.errors > 0);
    assert.ok(skillsSh.error_details.length > 0);
  });

  it("reports an absent codex source as available:false with zero raw_results", async () => {
    const out = await runDiscover(
      { languages: ["python"] },
      { fetchImpl: makeFakeFetch({ python: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }] }), codexExec: noCodex },
    );
    const codexSource = out.sources.find((s) => s.name === CODEX_SOURCE);
    assert.ok(codexSource);
    assert.equal(codexSource.available, false);
    assert.equal(codexSource.raw_results, 0);
    assert.equal(codexSource.error, null);
  });

  it("merges codex candidates into the ranked output with source_origin label", async () => {
    const codexExec = async () =>
      JSON.stringify({
        available: [{ pluginId: "cx/sec-audit", name: "sec-audit", marketplaceSource: { source: "codex/official" } }],
      });
    const out = await runDiscover(
      { languages: ["python"] },
      { fetchImpl: makeFakeFetch({ python: [{ id: "a/b/c", name: "c", source: "a/b", installs: 500 }] }), codexExec },
    );
    const codexSource = out.sources.find((s) => s.name === CODEX_SOURCE);
    assert.equal(codexSource.available, true);
    assert.equal(codexSource.raw_results, 1);
    assert.equal(codexSource.error, null); // no stale .error on the happy path
    const codexCand = out.candidates.find((c) => c.id === "cx/sec-audit");
    assert.ok(codexCand, "codex candidate should appear in ranked output");
    assert.equal(codexCand.source_origin, CODEX_SOURCE);
    assert.equal(codexCand.source_repo, "codex/official");
    // No install count → tagged unranked, not a misleading install-based tier.
    assert.equal(codexCand.quality_tier, CODEX_QUALITY_TIER);
    // The synthetic `__codex-marketplace__` grouping key must NOT leak into the
    // public matched_queries schema — source provenance is in source_origin.
    assert.deepEqual(codexCand.matched_queries, []);
    assert.ok(!codexCand.matched_queries.some((q) => q.startsWith("__")));
  });
});

// ---------------------------------------------------------------------------
// Codex marketplace source
// ---------------------------------------------------------------------------

describe("fetchCodexMarketplace", () => {
  it("maps available[] plugins to ranked-candidate shape", async () => {
    const exec = async () =>
      JSON.stringify({
        installed: [{ pluginId: "x/installed", name: "installed" }],
        available: [
          { pluginId: "x/alpha", name: "alpha", marketplaceSource: { source: "owner/repo" } },
          { name: "beta", marketplaceName: "mkt" },
        ],
      });
    const out = await fetchCodexMarketplace(exec);
    assert.equal(out.source, CODEX_SOURCE);
    assert.equal(out.available, true);
    assert.equal(out.results.length, 2);
    const [alpha, beta] = out.results;
    assert.equal(alpha.id, "x/alpha");
    assert.equal(alpha.source, "owner/repo");
    assert.equal(alpha.source_origin, CODEX_SOURCE);
    assert.equal(alpha.installs, 0);
    // No pluginId → id derived from marketplaceName/name; source falls back to marketplaceName.
    assert.equal(beta.id, "mkt/beta");
    assert.equal(beta.source, "mkt");
  });

  it("derives id/source from CODEX_SOURCE when both pluginId and marketplaceName are absent", async () => {
    const exec = async () => JSON.stringify({ available: [{ name: "gamma" }] });
    const out = await fetchCodexMarketplace(exec);
    assert.equal(out.results[0].id, `${CODEX_SOURCE}/gamma`);
    assert.equal(out.results[0].source, CODEX_SOURCE);
  });

  it("filters out entries with a missing or non-string id/name", async () => {
    const exec = async () =>
      JSON.stringify({ available: [
        { pluginId: "x/noname" },              // no name → dropped
        { name: null },                        // null name → dropped
        { pluginId: "x/num", name: 42 },       // numeric name → dropped (typeof guard)
        { pluginId: "", name: "empty" },       // empty pluginId → derived id "codex-marketplace/empty"
        { pluginId: "x/ok", name: "ok" },      // kept
      ] });
    const out = await fetchCodexMarketplace(exec);
    // Empty pluginId falls through to the name-derived id (not "").
    assert.deepEqual(out.results.map((r) => r.id), ["codex-marketplace/empty", "x/ok"]);
  });

  it("treats a missing available[] array as an empty catalog", async () => {
    const exec = async () => JSON.stringify({ installed: [] });
    const out = await fetchCodexMarketplace(exec);
    assert.equal(out.available, true);
    assert.deepEqual(out.results, []);
  });

  it("returns available:false when exec yields null (codex absent)", async () => {
    const out = await fetchCodexMarketplace(async () => null);
    assert.equal(out.available, false);
    assert.deepEqual(out.results, []);
  });

  it("returns available:false when exec throws", async () => {
    const out = await fetchCodexMarketplace(async () => {
      throw new Error("spawn failed");
    });
    assert.equal(out.available, false);
    assert.deepEqual(out.results, []);
  });

  it("reports an error (but stays available) on unparseable output", async () => {
    const out = await fetchCodexMarketplace(async () => "not json{");
    assert.equal(out.available, true);
    assert.deepEqual(out.results, []);
    assert.match(out.error, /unparseable/);
  });

  it("treats whitespace-only stdout as unparseable (truthy but not JSON)", async () => {
    // `stdout || null` keeps "   \n" (whitespace is truthy); JSON.parse then throws.
    const out = await fetchCodexMarketplace(async () => "   \n");
    assert.equal(out.available, true);
    assert.deepEqual(out.results, []);
    assert.match(out.error, /unparseable/);
  });

  it("invokes the codex binary via injectable async execFile", async () => {
    // success → stdout
    assert.equal(
      await defaultCodexExec(async () => ({ stdout: '{"available":[]}' })),
      '{"available":[]}',
    );
    // rejection (ENOENT / non-zero exit — execFile throws both) → null
    assert.equal(await defaultCodexExec(async () => { throw new Error("ENOENT"); }), null);
    // empty stdout → null
    assert.equal(await defaultCodexExec(async () => ({ stdout: "" })), null);
  });
});

// ---------------------------------------------------------------------------
// main (CLI entry)
// ---------------------------------------------------------------------------

describe("main", () => {
  const tmpDir = join(tmpdir(), `discover-cli-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  // Inject into discovery-path tests so they never spawn the real `codex` binary
  // (deterministic regardless of the host). Early-exit tests omit the 6th arg,
  // which covers main()'s `codexExec = defaultCodexExec` default without ever
  // reaching the codex call.
  const codexNo = async () => null;

  function makeRun() {
    const logs = [];
    const errs = [];
    let exitCode = null;
    return {
      log: (...args) => logs.push(args.join(" ")),
      errLog: (...args) => errs.push(args.join(" ")),
      exit: (code) => { exitCode = code; },
      logs,
      errs,
      get exitCode() { return exitCode; },
    };
  }

  it("--version prints SCRIPT_VERSION and exits 0 (short-circuits before stdin/parseArgs)", async () => {
    const run = makeRun();
    const neverReadStream = Readable.from([]);
    await main(["node", "discover.mjs", "--version"], neverReadStream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs.length, 1);
    assert.equal(run.logs[0], SCRIPT_VERSION);
    assert.equal(run.errs.length, 0);
  });

  it("--version works even with other flags present", async () => {
    const run = makeRun();
    await main(["node", "discover.mjs", "--stack-file", "noexist.json", "--version"], Readable.from([]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs[0], SCRIPT_VERSION);
  });

  it("--help prints usage and exits 0 (short-circuits before stdin/parseArgs)", async () => {
    const run = makeRun();
    const neverReadStream = Readable.from([]);
    await main(["node", "discover.mjs", "--help"], neverReadStream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs.length, 1);
    assert.match(run.logs[0], /discover\.mjs/);
    assert.match(run.logs[0], /--stack-file/);
    assert.match(run.logs[0], /--version/);
    assert.match(run.logs[0], /--help/);
    assert.equal(run.errs.length, 0);
  });

  it("--help works even with other flags present", async () => {
    const run = makeRun();
    await main(["node", "discover.mjs", "--stack-file", "noexist.json", "--help"], Readable.from([]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 0);
    assert.match(run.logs[0], /discover\.mjs/);
  });

  it("--version takes precedence over --help when both present", async () => {
    const run = makeRun();
    await main(["node", "discover.mjs", "--version", "--help"], Readable.from([]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs[0], SCRIPT_VERSION);
  });

  it("exits 1 when no stdin and no --stack-file", async () => {
    const run = makeRun();
    const emptyStream = Readable.from([""]);
    await main(["node", "discover.mjs"], emptyStream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 1);
    assert.match(run.errs.join("\n"), /provide stack/);
  });

  it("reads --stack-file when provided", async () => {
    const stackPath = join(tmpDir, "stack.json");
    writeFileSync(stackPath, JSON.stringify({ languages: ["go"] }), "utf-8");
    const run = makeRun();
    // Set globalThis.fetch to a stub so we don't hit real API
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ skills: [] }) });
    try {
      await main(["node", "discover.mjs", "--stack-file", stackPath], Readable.from([""]), run.log, run.errLog, run.exit, codexNo);
      assert.equal(run.exitCode, 0);
      const output = JSON.parse(run.logs.join("\n"));
      assert.equal(output.stack_input.languages[0], "go");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("reads stdin JSON when --stack-file is absent", async () => {
    const run = makeRun();
    const stream = Readable.from(['{"languages":["rust"]}']);
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ skills: [] }) });
    try {
      await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit, codexNo);
      assert.equal(run.exitCode, 0);
      const output = JSON.parse(run.logs.join("\n"));
      assert.equal(output.stack_input.languages[0], "rust");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("threads codexExec through to the CLI output (codex candidate end-to-end)", async () => {
    const run = makeRun();
    const stream = Readable.from(['{"languages":["python"]}']);
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ skills: [] }) });
    const codexExec = async () =>
      JSON.stringify({ available: [{ pluginId: "cx/p", name: "p", marketplaceSource: { source: "codex/x" } }] });
    try {
      await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit, codexExec);
      assert.equal(run.exitCode, 0);
      const output = JSON.parse(run.logs.join("\n"));
      const codexSource = output.sources.find((s) => s.name === "codex-marketplace");
      assert.equal(codexSource.available, true);
      assert.equal(codexSource.raw_results, 1);
      const cand = output.candidates.find((c) => c.id === "cx/p");
      assert.ok(cand, "codex candidate should appear in CLI output");
      assert.equal(cand.source_origin, "codex-marketplace");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("exits 4 + FATAL stderr when ALL skills.sh queries fail (silent-failure fix)", async () => {
    const run = makeRun();
    const stream = Readable.from(['{"languages":["python"]}']);
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    try {
      await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit, codexNo);
      assert.equal(run.exitCode, 4);
      assert.match(run.errs.join("\n"), /FATAL.*skills\.sh queries failed/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("exits 0 + WARN stderr on partial query failures (rest can still be useful)", async () => {
    const run = makeRun();
    // Multi-dim stack → many queries — fail one to test partial-failure path
    const stream = Readable.from(['{"languages":["python","typescript"],"deps":["pytest","react"]}']);
    const origFetch = globalThis.fetch;
    // Fail only the literal "python" query (deterministic — not call-counter race)
    globalThis.fetch = async (url) => {
      const q = new URL(url).searchParams.get("q");
      if (q === "python") throw new Error("transient");
      return { ok: true, json: async () => ({ skills: [{ id: "a/b/c", name: "c", source: "a/b", installs: 100 }] }) };
    };
    try {
      await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit, codexNo);
      assert.equal(run.exitCode, 0);
      assert.match(run.errs.join("\n"), /WARN.*1\/\d+.*skills\.sh queries failed/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("exits 5 when stack has no derivable queries", async () => {
    const run = makeRun();
    const stream = Readable.from(['{}']);
    await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 5);
    assert.match(run.errs.join("\n"), /no queries derived/);
  });

  it("exits 3 on invalid stdin JSON with source-aware error message", async () => {
    const run = makeRun();
    const stream = Readable.from(["{this is not json"]);
    await main(["node", "discover.mjs"], stream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 3);
    assert.match(run.errs.join("\n"), /invalid JSON in stdin/);
    assert.match(run.errs.join("\n"), /First 200 chars/);
  });

  it("exits 3 on invalid --stack-file JSON with source-aware error", async () => {
    const stackPath = join(tmpDir, "invalid.json");
    writeFileSync(stackPath, "not json at all", "utf-8");
    const run = makeRun();
    await main(["node", "discover.mjs", "--stack-file", stackPath], Readable.from([""]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 3);
    assert.match(run.errs.join("\n"), /invalid JSON in --stack-file/);
  });

  it("exits 3 on missing --stack-file", async () => {
    const run = makeRun();
    await main(["node", "discover.mjs", "--stack-file", "/nope/missing.json"], Readable.from([""]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 3);
    assert.match(run.errs.join("\n"), /cannot read stack file/);
  });

  it("exits 3 on invalid CLI args (NaN limit)", async () => {
    const run = makeRun();
    await main(["node", "discover.mjs", "--limit", "abc"], Readable.from([""]), run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 3);
    assert.match(run.errs.join("\n"), /--limit requires/);
  });

  it("mainSafe catches unexpected throw and exits 2 with fatal", async () => {
    const run = makeRun();
    // Create a stdin stream that throws when iterated — simulates unhandled error path
    const throwingStream = {
      async *[Symbol.asyncIterator]() {
        throw new Error("simulated unhandled error");
      },
    };
    await mainSafe(["node", "discover.mjs"], throwingStream, run.log, run.errLog, run.exit);
    assert.equal(run.exitCode, 2);
    assert.match(run.errs.join("\n"), /fatal:/);
  });

  it("mainSafe forwards successful runs unchanged", async () => {
    const run = makeRun();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ skills: [] }) });
    try {
      await mainSafe(["node", "discover.mjs"], Readable.from(['{"languages":["go"]}']), run.log, run.errLog, run.exit, codexNo);
      assert.equal(run.exitCode, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// isCliEntry — pure predicate extracted from the module-scope CLI entry guard
// ---------------------------------------------------------------------------

describe("isCliEntry", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "discover.mjs");
  // pathToFileURL produces a platform-correct file URL — on Windows `file://C:\…`
  // (raw concatenation) is invalid, `file:///C:/…` (pathToFileURL output) is correct.
  const scriptUrl = pathToFileURL(scriptPath).href;

  it("returns true when argv[1] is the absolute script path", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", scriptPath]), true);
  });

  it("returns true when argv[1] is a relative path that resolves to the script", () => {
    // Simulate `node ./relative/path/to/discover.mjs` — argv[1] is relative.
    // resolve() normalises against process.cwd(); test by chdir'ing to script's dir.
    const cwdBefore = process.cwd();
    process.chdir(dirname(scriptPath));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./discover.mjs"]), true);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("returns false when argv[1] points to a different file", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other/file.mjs"]), false);
  });

  it("returns false when argv[1] is undefined (covers `?? \"\"` fallback)", () => {
    // Node populates argv[1] = undefined when launched via `node -e '...'` or REPL.
    // The `?? ""` fallback resolves to cwd, which won't equal the script's absolute path.
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess (covers CLI entry guard)
// ---------------------------------------------------------------------------

describe("CLI invocation (subprocess — covers entry guard)", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "discover.mjs");
  const tmpDir = join(tmpdir(), `discover-spawn-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  it("--version prints bare version and exits 0", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--version"], {
      encoding: "utf-8",
      timeout: 30000,
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), SCRIPT_VERSION);
    assert.equal(r.stderr, "");
  });

  it("--help prints usage and exits 0", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--help"], {
      encoding: "utf-8",
      timeout: 30000,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /discover\.mjs/);
    assert.match(r.stdout, /--stack-file/);
    assert.match(r.stdout, /--version/);
    assert.match(r.stdout, /--help/);
    assert.equal(r.stderr, "");
  });

  it("runs as CLI with --stack-file containing empty stack, exits 5 (no queries derived)", () => {
    const stackPath = join(tmpDir, "stack.json");
    writeFileSync(stackPath, JSON.stringify({}), "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, "--stack-file", stackPath], {
      encoding: "utf-8",
      timeout: 30000,
    });
    // Empty stack → exit 5 (per new contract — let init branch on this)
    assert.equal(r.status, 5);
    const output = JSON.parse(r.stdout);
    assert.match(output.error, /no queries derived/);
  });

  it("runs as CLI with stdin, exits 1 on empty input", () => {
    const r = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf-8",
      input: "",
      timeout: 30000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /provide stack/);
  });

  it("runs as CLI, exits 3 with source-aware error on malformed JSON stdin", () => {
    const r = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf-8",
      input: "{not valid json",
      timeout: 30000,
    });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /invalid JSON in stdin/);
    assert.match(r.stderr, /First 200 chars/);
  });

  it("runs as CLI, exits 3 with source-aware error on malformed --stack-file", () => {
    const stackPath = join(tmpDir, "bad.json");
    writeFileSync(stackPath, "{not valid", "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, "--stack-file", stackPath], {
      encoding: "utf-8",
      timeout: 30000,
    });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /invalid JSON in --stack-file/);
  });

  it("runs as CLI, exits 3 on missing --stack-file", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--stack-file", "/nonexistent/path.json"], {
      encoding: "utf-8",
      timeout: 30000,
    });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /cannot read stack file/);
  });

  it("runs as CLI, exits 3 on invalid --limit", () => {
    const r = spawnSync(process.execPath, [scriptPath, "--limit", "abc"], {
      encoding: "utf-8",
      input: '{"languages":["python"]}',
      timeout: 30000,
    });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /--limit requires a positive integer/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
