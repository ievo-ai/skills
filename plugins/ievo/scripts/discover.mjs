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
//   node discover.mjs --stack-file ./stack.json [--project <root>]
//   node discover.mjs --limit 30 --concurrency 8
//
// --stack-file <path> is untrusted input (skills#543, mirrors
// evolution_candidates.mjs's --text-file fix in #523): the path can be
// influenced by a compromised or prompt-injected agent turn issuing a
// different --stack-file value directly via Bash, so it is contained to the
// project's own .ievo/ directory (--project, default "."), both lexically up
// front and again by realpath, and required to be a regular file under a
// size cap.

import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SCRIPT_VERSION = "0.80.9";
export const SKILLS_SH_API = "https://skills.sh/api/search";
export const DEFAULT_PER_QUERY_LIMIT = 10;
export const DEFAULT_TOTAL_LIMIT = 50;
export const DEFAULT_CONCURRENCY = 8;

// Strips C0 control characters (and DEL) from attacker-influenceable input
// before it reaches an errLog()/console.error message (CWE-117): the
// --stack-file read/parse-failure messages below echo the raw args.stackFile
// value, and the stdin parse-failure branch echoes a raw stdinText slice — a
// crafted ESC byte (0x1B) or other control byte in either would otherwise
// survive untouched and inject ANSI/control sequences into a terminal or CI
// log viewer. Every echoed `err.message` is stripped too, not just the value
// we interpolate ourselves: an Error raised BY the runtime re-embeds the raw
// bytes we just sanitized — fs errors quote the offending path verbatim
// (`ENOENT: ... lstat '<raw path>'`) and V8's JSON.parse message quotes a
// ~12-char snippet of the raw input (`Unexpected token 'x', "<raw>"... is not
// valid JSON`).
// Also strips every code point with the Unicode Bidi_Control property —
// U+061C (ALM), U+200E-U+200F (LRM/RLM), U+202A-U+202E, U+2066-U+2069 — plus
// zero-width characters (U+200B-U+200F, U+FEFF); the U+2066-U+2069 isolates
// are widened to the full U+2060-U+2069 invisible-operator block (CWE-116
// follow-up, skills#600). The ASCII-only range above didn't touch any of
// these, and this sink is a raw terminal/CI log stream — exactly where U+202E
// (RLO) actually re-orders the rest of the line — so a crafted --stack-file
// path or stdin snippet carrying one could reverse the error message a
// reviewer reads. The Bidi_Control set is closed at those six ranges — adding
// a code point outside them means the enumeration above is no longer
// exhaustive and the comment must say so.
// Per-file copy (not a shared import) mirrors
// validate_skills.mjs/validate_agents.mjs's own CONTROL_CHAR_RE — each
// sink's exact character class is tuned to its own risk model (see
// .github/scripts/validators/_safe-read.mjs).
export const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

// Reserved prefix for synthetic source-grouping sentinels (e.g.
// `__codex-marketplace__`). buildQueries rejects any real query starting with
// it; rankCandidates uses it to keep sentinels out of the breadth bonus and
// strip them from the serialized matched_queries. Single source of truth so a
// future source's sentinel stays consistent.
export const SENTINEL_PREFIX = "__";

// Owner reputation boost for ranking (NOT a security signal).
// Sourced from find-skills SKILL.md "trusted sources" guidance.
// Stored lowercase — GitHub owner slugs are case-insensitive, and skills.sh
// API may emit either case. Compare via .toLowerCase() at lookup site.
export const REPUTATION_BOOST_OWNERS = new Set([
  "vercel-labs", "anthropics", "microsoft", "composiohq",
  "wshobson", "github",
]);
export const REPUTATION_BOOST_FACTOR = 1.5;

// Visibility floor for Codex marketplace candidates (which carry no install
// count). log10(10) = 1.0 — equivalent to a ~10-install skill: enough to surface
// mid-pack rather than be sliced off by --limit, low enough that any 100+ install
// skills.sh skill still outranks. See rankCandidates for the rationale.
export const CODEX_VISIBILITY_FLOOR = 1.0;

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

// Stack-independent meta-tooling queries (skills#315). General-purpose
// codebase-audit / planning-advisor tools — read-only auditors that survey a
// codebase and produce prioritized findings/plans, not implementers (e.g.
// shadcn/improve, ~17.6K skills.sh installs) — exist independent of any
// project's language, dependency, or framework mix. Unlike every entry in
// CATEGORY_QUERIES above (each only fires if that category was resolved for
// the project in Step 4.5), this group is not gated behind a detected
// category — see the buildQueries layer below.
export const STACK_INDEPENDENT_QUERIES = [
  "codebase audit", "improve codebase", "implementation plan", "tech debt audit", "senior advisor",
];

// ---------------------------------------------------------------------------
// --stack-file containment + size cap (skills#543)
//
// --stack-file is untrusted input — the same class of gap already closed for
// evolution_candidates.mjs's --text-file in #523. init/SKILL.md Step 5b's
// documented invocation now passes a fixed .ievo/log/ path via --stack-file
// (skills#567 replaced the prior stdin pipe, which embedded manifest-derived
// JSON text inside a single-quoted shell argument — itself the injection
// vector). The path value is still untrusted, since an altered Bash command
// line could still substitute a different one. Contain it to the project's
// own .ievo/ directory regardless of how it arrived here — both
// lexically up front (assertStackFileAllowed, mirrors scan_repo.mjs's
// assertContained()) and again by realpath once the target is known to exist
// (assertStackFileReadable, mirrors scan_repo.mjs's assertCheckoutContained()
// — closes the gap a lexical-only check leaves open when an ancestor
// directory under .ievo/ is itself a symlink) — and require a regular file
// under a size cap (mirrors evolution_candidates.mjs's MAX_TEXT_FILE_BYTES /
// scan_repo.mjs's MAX_SCAN_FILE_BYTES).
// ---------------------------------------------------------------------------

export const IEVO_DIR = ".ievo";
export const MAX_STACK_FILE_BYTES = 256 * 1024;

function ievoRoot(projectRoot) {
  return resolve(projectRoot, IEVO_DIR);
}

// Throws if `target` would resolve outside `allowedDir` — shared by the
// lexical pre-check (assertStackFileAllowed, below) and the realpath
// re-check (assertStackFileReadable, below). Mirrors scan_repo.mjs's
// assertContained() / evolution_candidates.mjs's assertContainedIn().
function assertContainedIn(target, allowedDir) {
  if (target !== allowedDir && !target.startsWith(allowedDir + sep)) {
    throw new Error(`must be inside ${allowedDir}`);
  }
}

// Lexical pre-check restricting --stack-file to <projectRoot>/.ievo/ — the
// first line of defense against a compromised/prompt-injected agent turn
// passing an arbitrary path (e.g. ~/.aws/credentials, a project .env)
// directly via Bash. Purely lexical (no filesystem access), so it rejects an
// out-of-bounds path before anything on disk is touched. Returns the
// resolved absolute path so the caller reads the exact path just validated.
// NOT sufficient on its own against a symlinked ancestor directory — see
// assertStackFileReadable's realpath re-check below.
export function assertStackFileAllowed(stackFile, projectRoot) {
  const resolvedTarget = resolve(stackFile);
  assertContainedIn(resolvedTarget, ievoRoot(projectRoot));
  return resolvedTarget;
}

// lstat (not readFileSync) so a symlink AT THE LEAF is judged on its own type
// without following it — a symlink planted directly at the --stack-file path
// would otherwise be followed straight through to its real target by a plain
// readFileSync (CWE-59). Throws (rather than returning a boolean) since an
// unreadable/oversized/non-regular --stack-file must abort the run, not
// silently degrade.
//
// lstat's non-follow behavior applies only to the path's FINAL component —
// every ANCESTOR directory component is still resolved normally, so a
// symlinked ancestor (e.g. `.ievo/link -> ~/.aws`, then --stack-file
// `.ievo/link/credentials`) passes assertStackFileAllowed's lexical check
// (the string is inside .ievo/) and then lstats/reads straight through to the
// real target anyway. Re-verify containment against the REALPATH of both
// sides after the type/size checks succeed (only then do we know the path —
// and therefore every ancestor in it — actually exists to realpath).
export function assertStackFileReadable(
  resolvedPath,
  projectRoot,
  capBytes = MAX_STACK_FILE_BYTES,
  statImpl = lstatSync,
  realpathImpl = realpathSync,
) {
  const st = statImpl(resolvedPath);
  if (!st.isFile()) {
    throw new Error("not a regular file");
  }
  if (st.size > capBytes) {
    throw new Error(`exceeds ${capBytes} bytes`);
  }
  assertContainedIn(realpathImpl(resolvedPath), realpathImpl(ievoRoot(projectRoot)));
}

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

// NOTE: generated query strings must NOT start with `__`. That prefix is
// reserved for synthetic source sentinels (e.g. `__codex-marketplace__`) which
// rankCandidates treats specially and strips from matched_queries. Natural
// search terms never start with `__`; the fail-fast guard at the end of this
// function enforces the invariant rather than trusting it.
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

  // Layer 6 — stack-independent meta-tooling queries (skills#315). Fires
  // whenever the stack produced ANY real signal, regardless of WHICH
  // language/dep/category/framework was detected — that's the gap this
  // closes (CATEGORY_QUERIES entries are each conditional on one specific
  // category; this layer has no such condition). Guarded on "any signal
  // present" rather than truly unconditional so a totally empty `{}` stack
  // (Step 4 manifest detection finding nothing at all) still yields zero
  // queries — preserving runDiscover's "no queries derived, abort init"
  // contract for that distinct failure mode.
  if (languages.length || deps.length || categories.length || frameworks.length) {
    for (const q of STACK_INDEPENDENT_QUERIES) queries.add(q);
  }

  const out = [...queries].filter(Boolean);
  // Fail-fast guard for the `__` sentinel invariant (see the note above): a real
  // query must never start with `__`, or it would be mistaken for a synthetic
  // source key in rankCandidates and silently corrupt breadth-bonus filtering.
  for (const q of out) {
    if (q.startsWith(SENTINEL_PREFIX)) throw new Error(`query sentinel collision: '${q}' — queries must not start with '${SENTINEL_PREFIX}'`);
  }
  return out;
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
    // Tag every result with its origin explicitly so the field is set at the
    // source, not inferred via fallback downstream. (rankCandidates keeps a
    // defensive `?? "skills.sh"` for callers that pass raw, untagged objects.)
    const results = (data.skills ?? []).map((s) => ({ ...s, source_origin: "skills.sh" }));
    return { query, results, searchType: data.searchType };
  } catch (err) {
    return { query, results: [], error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Codex marketplace source (optional — only when the `codex` CLI is present)
//
// Codex `plugin list --json` (rust-v0.138.0+) returns { installed[], available[] }.
// `available[]` is the discoverable catalog — uninstalled plugins from the user's
// configured Codex marketplaces, the candidates iEvo can run through its
// security-auditor before install. NOTE: the discovery command is `codex plugin
// list`, NOT `codex plugin marketplace` (which manages marketplace *configs*, not
// plugins). Absent codex / non-zero exit / unparseable output → silently skip
// (no error, no behaviour change for Claude Code-only users — universal
// positioning preserved).
// ---------------------------------------------------------------------------

export const CODEX_SOURCE = "codex-marketplace";

// quality_tier for codex candidates — they have no install count, so the
// install-based tiers (qualityTier) don't apply. Exported so downstream
// consumers match on the constant rather than a hard-coded string.
export const CODEX_QUALITY_TIER = "unranked";

export async function defaultCodexExec(execImpl = execFileAsync) {
  // Returns `codex plugin list --json` stdout, or null if codex is unavailable /
  // failed. Async (execFile, not spawnSync) so a slow/hung codex never blocks the
  // event loop. execFile rejects on a missing binary (ENOENT), non-zero exit, or
  // the timeout — all land in the graceful-skip catch. 5s timeout: this is a
  // best-effort source running concurrently with skills.sh, so its ceiling caps
  // the worst-case discovery stall — keep it well under the typical skills.sh
  // wall-clock. execImpl is injectable for tests.
  try {
    // Only stdout is consumed — any codex stderr (deprecation/diagnostic
    // warnings) is intentionally discarded; this source is best-effort and must
    // never surface noise on the main discovery path.
    // maxBuffer 10 MB (vs Node's 1 MB default): a large marketplace catalog would
    // otherwise throw ERR_CHILD_PROCESS_STDIO_MAXBUFFER → caught below → indistinguishable
    // from "codex absent". 10 MB is far above any realistic plugin-list JSON.
    const { stdout } = await execImpl("codex", ["plugin", "list", "--json"], { encoding: "utf-8", timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
    // Truthy stdout = "codex ran and emitted output" (→ available: true). Whether
    // that output is parseable is fetchCodexMarketplace's call: it reports a parse
    // failure as available: true + error, not as absent (available: false).
    return stdout || null;
  } catch {
    // Deliberate uniform skip: ENOENT (codex absent), non-zero exit (codex
    // present but `plugin list` failed / unsupported subcommand), and timeout all
    // collapse to null → available: false, no error. This is a best-effort source
    // whose contract is "zero noise for non-Codex users"; we trade per-cause
    // diagnostics for that silence. If debuggability ever outweighs it, branch on
    // err.code === "ENOENT" here and surface the others as available: false + error.
    return null;
  }
}

// codexRunner is the `(execImpl?) => Promise<string|null>` codex runner
// (defaultCodexExec) — called here with no args. Distinct from the
// `(cmd, args, opts)` execFile-style fn that defaultCodexExec itself takes:
// different signatures, different layers.
export async function fetchCodexMarketplace(codexRunner = defaultCodexExec) {
  let stdout;
  try {
    stdout = await codexRunner();
  } catch {
    // The default codexRunner (defaultCodexExec) never throws — it catches
    // internally and returns null. This guard is for a custom/injected runner
    // that may reject; covered by the "returns available:false when exec throws"
    // test which passes a directly-throwing runner.
    return { source: CODEX_SOURCE, available: false, results: [] };
  }
  if (!stdout) return { source: CODEX_SOURCE, available: false, results: [] };

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { source: CODEX_SOURCE, available: true, results: [], error: "unparseable codex output" };
  }

  // filter(Boolean) drops null/undefined array elements before the map — a null
  // entry would throw on `.pluginId` and crash the whole run (mainSafe → exit 2),
  // breaking the graceful-degradation guarantee for a malformed codex payload.
  const avail = Array.isArray(data?.available) ? data.available.filter(Boolean) : [];
  const results = avail
    .map((p) => ({
      // `||` (not `??`) so an empty-string pluginId is treated as absent and
      // falls through to the marketplaceName/name-derived id — an empty id would
      // collide with every other empty-id entry under dedup.
      id: p.pluginId || (p.name ? `${p.marketplaceName || CODEX_SOURCE}/${p.name}` : null),
      name: p.name,
      // discover's ranker reads `source` as the source repo/origin.
      // `||` (not `??`) so an empty-string marketplaceName/source falls through
      // rather than producing `""` / `"/name"`.
      source: p.marketplaceSource?.source || p.marketplaceName || CODEX_SOURCE,
      source_origin: CODEX_SOURCE,
      // Codex plugins carry no install count (the codex-cli 0.142.3 schema has
      // no install field), so installs is always 0; the ranker lifts their
      // rank_score to CODEX_VISIBILITY_FLOOR (see rankCandidates) so they surface
      // mid-pack rather than sort dead-last, and they're tagged via source_origin
      // downstream.
      installs: 0,
    }))
    // Require string id+name. typeof guards against a future codex output shape
    // emitting a non-string name (e.g. a number) slipping through a truthy check.
    .filter((c) => typeof c.id === "string" && typeof c.name === "string");

  return { source: CODEX_SOURCE, available: true, results };
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

      // First-seen wins on id collision. runDiscover feeds skills.sh groups
      // before the codex group, so a codex plugin sharing an id with a skills.sh
      // skill is absorbed into the skills.sh entry (its source_origin dropped) —
      // skills.sh is the more authoritative, install-ranked source, so this is
      // the intended tie-break.
      const isNew = !byId.has(skill.id);
      if (isNew) {
        byId.set(skill.id, {
          id: skill.id,
          name: skill.name,
          source_repo: skill.source,
          // searchSkillsSh and fetchCodexMarketplace both tag results at the
          // source, so this fallback only fires for a raw/legacy caller that
          // passed untagged objects — it defaults them to "skills.sh".
          source_origin: skill.source_origin ?? "skills.sh",
          installs,
          // Codex plugins expose no install count, so the install-based tiers
          // ("low-confidence" etc.) are meaningless and would contradict their
          // visibility-floor ranking. Tag them "unranked" instead.
          quality_tier: skill.source_origin === CODEX_SOURCE ? CODEX_QUALITY_TIER : qualityTier(installs),
          matched_queries: new Set(),
          rank_score: 0,
        });
      }
      const entry = byId.get(skill.id);
      // Synthetic source sentinels (e.g. `__codex-marketplace__`) count only as
      // the lone query for a codex-only candidate (the entry they created). Never
      // add one to a pre-existing skills.sh winner — that would hand it an
      // unearned breadth bonus just for also appearing in the codex catalog.
      if (isNew || !query.startsWith(SENTINEL_PREFIX)) {
        entry.matched_queries.add(query);
      }
    }
  }

  // Compute rank_score for each candidate. NOTE: source sentinels are still
  // present in matched_queries at this point (they're stripped only after this
  // loop) — so a codex-only candidate's breadth bonus is computed from size 1
  // (the lone sentinel = neutral bonus), not size 0.
  for (const entry of byId.values()) {
    // Base score = installs (log-scaled to avoid dominance by mega-popular skills)
    // Math.max with 1 guards against log10(0) = -Infinity.
    // Codex marketplace plugins expose no install metric (installs=0 → score 0),
    // which would sort them dead-last and slice them off under --limit in any rich
    // stack — making the codex source a silent no-op for the users it targets. Give
    // them a visibility floor (≈ a 10-install skill: log10(10)=1) so a handful
    // surface mid-pack: visible, never dominant (100+ install skills still outrank).
    // The inner log10(max(installs,1)) is 0 today (codex installs is always 0) and
    // the floor wins — but it's kept forward-safe: if codex ever exposes install
    // counts, a popular plugin would score above the floor on its own merit.
    const installScore = entry.source_origin === CODEX_SOURCE
      ? Math.max(Math.log10(Math.max(entry.installs, 1)), CODEX_VISIBILITY_FLOOR)
      : Math.log10(Math.max(entry.installs, 1));

    // Reputation boost (NOT a security shortcut — just visibility aid)
    // Case-insensitive: GitHub owner slugs aren't case-sensitive.
    // For codex candidates source_repo is the marketplace source (a path or URL),
    // so the first segment is rarely a trusted owner — a URL like
    // `https://…` yields `https:` (no false boost). If a codex marketplace ever
    // emits an `owner/repo`-shaped source under a trusted owner, the boost stacks
    // on top of the visibility floor (e.g. anthropics → 1.0 × 1.5 = 1.5); that's
    // an intended "trusted host" signal, consistent with the skills.sh treatment.
    const owner = (entry.source_repo ?? "").split("/")[0].toLowerCase();
    const repBoost = REPUTATION_BOOST_OWNERS.has(owner) ? REPUTATION_BOOST_FACTOR : 1.0;

    // Query-match breadth bonus — matched by multiple queries = more relevant
    const breadthBonus = 1 + 0.2 * (entry.matched_queries.size - 1);

    entry.rank_score = installScore * repBoost * breadthBonus;
  }

  // Convert matched_queries Set to Array for JSON serialization. Drop synthetic
  // source sentinels (e.g. `__codex-marketplace__`) — they're internal grouping
  // keys, not real query terms, and would mislead downstream readers of the
  // public schema. Source provenance is carried by `source_origin`. Filtered
  // only here (after scoring) so the breadth bonus still treats the sentinel as
  // the one query that matched a codex-only candidate.
  for (const entry of byId.values()) {
    entry.matched_queries = [...entry.matched_queries].filter((q) => !q.startsWith(SENTINEL_PREFIX));
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
    // CWE-117: value is an attacker-influenceable CLI arg (same threat model
    // as --stack-file above), and main()'s catch echoes err.message verbatim.
    throw new Error(`${flagName} requires a positive integer, got '${value.replace(CONTROL_CHAR_RE, "")}' — falling back to ${fallback} would mask the input error`);
  }
  return n;
}

function requireValue(argv, i, flagName) {
  const v = argv[i];
  if (v === undefined) {
    throw new Error(`${flagName} requires a value, got end of arguments`);
  }
  if (v.startsWith("--")) {
    // CWE-117: v is an attacker-influenceable CLI arg echoed via main()'s
    // parseArgs catch — strip before it reaches that errLog() message.
    throw new Error(`${flagName} requires a value, got flag '${v.replace(CONTROL_CHAR_RE, "")}' — looks like the value was forgotten`);
  }
  return v;
}

export function parseArgs(argv) {
  const args = { stackFile: null, limit: DEFAULT_TOTAL_LIMIT, concurrency: DEFAULT_CONCURRENCY, perQuery: DEFAULT_PER_QUERY_LIMIT, project: "." };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stack-file") args.stackFile = requireValue(argv, ++i, "--stack-file");
    else if (a === "--limit") args.limit = parsePositiveInt(requireValue(argv, ++i, "--limit"), "--limit", DEFAULT_TOTAL_LIMIT);
    else if (a === "--concurrency") args.concurrency = parsePositiveInt(requireValue(argv, ++i, "--concurrency"), "--concurrency", DEFAULT_CONCURRENCY);
    else if (a === "--per-query") args.perQuery = parsePositiveInt(requireValue(argv, ++i, "--per-query"), "--per-query", DEFAULT_PER_QUERY_LIMIT);
    else if (a === "--project") args.project = requireValue(argv, ++i, "--project");
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
    // codexExec: () => Promise<string|null> — a codex *runner* (defaultCodexExec's
    // signature), NOT the inner (cmd, args, opts) execFile-style fn. Tests return
    // the raw JSON string or null; returning a {stdout} object would silently fail.
    codexExec = defaultCodexExec,
  } = options;

  const startTime = Date.now();
  const queries = buildQueries(stack);

  if (queries.length === 0) {
    // sources: [] is intentional for this early-return — no source is queried.
    // Callers get exit 5 (error set) and abort before reading sources, so the
    // "codex-marketplace entry always emitted" guarantee applies only to runs
    // that actually reach the fetch stage below.
    return {
      script_version: SCRIPT_VERSION,
      sources: [],
      candidates: [],
      error: "no queries derived from stack — provide languages/deps/categories/frameworks",
    };
  }

  // skills.sh and codex are independent sources — fetch them concurrently so a
  // slow codex (up to its 5s timeout) overlaps with the skills.sh queries
  // instead of being added to wall-clock time after they finish.
  const [allResults, codex] = await Promise.all([
    mapWithConcurrency(queries, (q) => searchSkillsSh(q, perQuery, fetchImpl), concurrency),
    fetchCodexMarketplace(codexExec),
  ]);

  const totalResults = allResults.reduce((s, r) => s + r.results.length, 0);
  const errors = allResults.filter((r) => r.error).map((r) => ({ query: r.query, error: r.error }));
  const groups = codex.results.length
    ? [...allResults, { query: `${SENTINEL_PREFIX}${CODEX_SOURCE}${SENTINEL_PREFIX}`, results: codex.results }]
    : allResults;

  const ranked = rankCandidates(groups).slice(0, limit);

  return {
    script_version: SCRIPT_VERSION,
    elapsed_ms: Date.now() - startTime,
    stack_input: stack,
    sources: [
      {
        name: "skills.sh",
        queries_executed: queries.length,
        raw_results: totalResults,
        errors: errors.length,
        error_details: errors,
      },
      {
        name: CODEX_SOURCE,
        available: codex.available,
        raw_results: codex.results.length,
        error: codex.error ?? null,
      },
    ],
    queries,
    candidates: ranked,
  };
}

export async function main(argv = process.argv, stdinStream = process.stdin, log = console.log, errLog = console.error, exit = process.exit, codexExec = defaultCodexExec) {
  if (argv.includes("--version")) {
    log(SCRIPT_VERSION);
    return exit(0);
  }

  if (argv.includes("--help")) {
    log(`discover.mjs — multi-source candidate discovery for ievo init
Usage:
  echo '{"languages":["python"],"deps":["pytest"]}' | discover.mjs
  discover.mjs --stack-file <path> [--project <root>] [--limit N] [--concurrency N]
  discover.mjs --version
  discover.mjs --help

Notes:
  --stack-file <path> is untrusted input: it must be an existing regular file
  inside <project root>/.ievo/ (--project, default ".") and under a fixed
  size cap — any other path is rejected rather than read.`);
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
    // Strip control characters before this value can ever reach an errLog()
    // message (CWE-117) — the raw args.stackFile is still used below for the
    // actual containment/read checks, only the echoed copy is sanitized.
    const safeStackFile = args.stackFile.replace(CONTROL_CHAR_RE, "");
    inputSource = `--stack-file ${safeStackFile}`;
    let raw;
    try {
      const allowedPath = assertStackFileAllowed(args.stackFile, args.project);
      assertStackFileReadable(allowedPath, args.project);
      raw = readFileSync(allowedPath, "utf-8");
    } catch (err) {
      // err.message is stripped as well as safeStackFile: a path that clears
      // the lexical containment check but does not exist reaches lstat, whose
      // ENOENT message quotes the raw path — re-injecting the exact bytes
      // safeStackFile just removed.
      errLog(`Error: cannot read stack file '${safeStackFile}': ${err.message.replace(CONTROL_CHAR_RE, "")}`);
      return exit(3);
    }
    try {
      stack = JSON.parse(raw);
    } catch (err) {
      // Unlike the stdin path below, no `First 200 chars:` echo here: an
      // attacker-influenced --stack-file could point at any regular file
      // inside .ievo/, including a credential accidentally dropped there
      // (skills#543) — the parse-failure message alone is enough to debug a
      // malformed stack file without also disclosing its content. That
      // message is not content-free, though: V8 quotes a ~12-char snippet of
      // the file, so strip control characters out of it (too short to leak a
      // credential, long enough to carry an ANSI escape).
      errLog(`Error: invalid JSON in ${inputSource}: ${err.message.replace(CONTROL_CHAR_RE, "")}`);
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
      // Both lines carry raw stdin: V8's message quotes a ~12-char snippet of
      // it, so sanitizing only the `First 200 chars:` line below would leave
      // the injection window open one line above it.
      errLog(`Error: invalid JSON in stdin: ${err.message.replace(CONTROL_CHAR_RE, "")}`);
      errLog(`First 200 chars: ${stdinText.slice(0, 200).replace(CONTROL_CHAR_RE, "")}`);
      return exit(3);
    }
  }

  const output = await runDiscover(stack, {
    limit: args.limit,
    concurrency: args.concurrency,
    perQuery: args.perQuery,
    codexExec,
  });

  // Always print the JSON to stdout (callers parse it).
  log(JSON.stringify(output, null, 2));

  // Surface discovery problems to stderr — init's Bash invocation captures
  // stderr separately from stdout. Don't bury failures in JSON only.
  // Look the skills.sh source up by name, not index — robust if sources[] order
  // ever changes (codex is always a second entry now).
  const skillsSh = output.sources?.find((s) => s.name === "skills.sh");
  const errorCount = skillsSh?.errors ?? 0;
  const queryCount = skillsSh?.queries_executed ?? 0;
  if (queryCount > 0 && errorCount === queryCount) {
    // Total failure — all queries errored. Exit non-zero so init can branch.
    errLog(`[discover.mjs] FATAL: all ${queryCount} skills.sh queries failed. Network down / API outage / DNS / TLS issue. Candidates list will be empty.`);
    return exit(4);
  }
  if (errorCount > 0) {
    // Partial failure — warn but continue. Candidates may still be useful.
    // The queries are built by buildQueries() straight from the stack's
    // languages/deps/categories/frameworks strings — i.e. from the same
    // stdin/--stack-file input sanitized at the parse-failure echoes above —
    // so this echo is the same CWE-117 sink and needs the same strip. Only
    // `.query` is echoed (the joining `, ` and the two counts are ours), so
    // stripping the joined string covers every attacker-supplied byte in it.
    const failedQueries = (skillsSh?.error_details ?? []).map((e) => e.query).join(", ").replace(CONTROL_CHAR_RE, "");
    errLog(`[discover.mjs] WARN: ${errorCount}/${queryCount} skills.sh queries failed: ${failedQueries}`);
  }
  // Surface a codex error (e.g. unparseable output) on stderr too — symmetric
  // with the skills.sh WARN above, so a Codex user debugging "why no marketplace
  // plugins?" sees a hint instead of having to read the raw JSON. Absent codex
  // (error: null) stays silent — the zero-noise contract for non-Codex users.
  const codexSource = output.sources?.find((s) => s.name === CODEX_SOURCE);
  if (codexSource?.error) {
    errLog(`[discover.mjs] WARN: codex: ${codexSource.error}`);
  }
  if (output.error) {
    // Stack input issue (no queries derived) — communicate via exit code too
    errLog(`[discover.mjs] WARN: ${output.error}`);
    return exit(5);
  }

  return exit(0);
}

export async function mainSafe(argv = process.argv, stdinStream = process.stdin, log = console.log, errLog = console.error, exit = process.exit, codexExec = defaultCodexExec) {
  // Defensive wrapper — main() has internal try/catch around every known
  // throwing path, but this catches anything future code might add without
  // wrapping. Testable via mock exit/errLog. Forwards codexExec so tests can
  // inject a stub and stay independent of a host codex binary.
  try {
    return await main(argv, stdinStream, log, errLog, exit, codexExec);
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
