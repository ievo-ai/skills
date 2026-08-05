#!/usr/bin/env node
// check-version-bump.mjs — fail a PR that touches plugin files without
// bumping the plugin version (AGENTS.md "Version bumping — in every PR").
//
// The existing per-script coupling tests (discover.test.mjs,
// evolution_candidates.test.mjs, scrub.test.mjs) assert SCRIPT_VERSION ==
// plugin.json's version — they catch DRIFT between version-carrying files,
// not an ABSENT bump. A PR that touches plugins/ievo/** or .claude-plugin/**
// and bumps nothing keeps every file mutually consistent at the OLD value,
// so those tests (and the coverage/pre-commit gates) stay green even though
// the bump was skipped. See AGENTS.md § "Version bumping" and eva
// evolution-store L-2026-07-23-02 / L-2026-07-23-03 (skills#414, skills#378).
//
// When any changed path (merge-base..head) is under plugins/ievo/** or
// .claude-plugin/**, asserts:
//   1. plugin.json's `version` at head is strictly GREATER than its value at
//      the merge-base (i.e. this PR actually bumped it, forwards — an equal
//      version means no bump, a lower one means a downgrade). Versions that
//      aren't plain dotted-numeric can't be ordered, so those fall back to
//      "must at least differ" — see compareVersions.
//   2. Every `export const SCRIPT_VERSION` literal under
//      plugins/ievo/scripts/*.mjs — globbed at runtime, never hardcoded (a
//      hardcoded file list is exactly how AGENTS.md's own bump checklist
//      went stale 3 times independently: L-2026-07-06-01, L-2026-07-23-03,
//      L-2026-07-24-01) — equals the head plugin.json version, except
//      scripts listed in DECOUPLED_SCRIPTS.
//   3. marketplace.json's `metadata.version` and `plugins[0].version` both
//      equal the head plugin.json version.
//
// Infra/docs-only PRs (no plugins/ievo/** or .claude-plugin/** change) are
// exempt — AGENTS.md "Infra-only PRs do NOT bump the version" — detected by
// simply finding no changed path under either prefix.
//
// On a non-pull_request event (e.g. push to main, post-merge) there is no PR
// diff to evaluate — the pull_request gate already covered this change
// before merge — so this is a no-op.
//
// Usage:
//   node check-version-bump.mjs [--base <ref>] [--head <ref>]
// Env (fallback when the matching flag is absent):
//   GITHUB_EVENT_NAME — skip entirely when set and not "pull_request".
//   BASE_SHA / HEAD_SHA — merge-base input / current ref.
//
// Lives outside plugins/ievo/scripts/, so the 100% coverage GATE does not
// apply to itself (same carve-out as check-coverage.mjs) — it is still
// tested to 100% by hand in tests/check-version-bump.test.mjs.
//
// Every plugins/ievo/scripts/*.mjs file this reads is fully PR-controlled: an
// attacker's PR could commit a symlinked ".mjs" entry pointing at a FIFO/
// special file, and a plain readFileSync would follow it and hang the CI job
// until the workflow timeout. Reads go through the validators' shared
// safeReadFileSync (lstat-rejects anything that isn't a regular file first)
// for the same reason validate_agents.mjs/validate_skills.mjs guard their
// own PR-controlled reads — see _safe-read.mjs's header (closes #364-class
// CWE-59/61 for this script too, found by /ievo:vuln-scan on this diff).

import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeReadFileSync, sanitizeForLog } from "./validators/_safe-read.mjs";

export const PLUGIN_JSON_PATH = "plugins/ievo/.claude-plugin/plugin.json";
export const MARKETPLACE_JSON_PATH = ".claude-plugin/marketplace.json";
export const SCRIPTS_DIR = "plugins/ievo/scripts";
const PLUGIN_PATH_PREFIXES = ["plugins/ievo/", ".claude-plugin/"];

// Scripts whose SCRIPT_VERSION is intentionally NOT coupled to plugin.json.
// scan_repo.mjs's SCRIPT_VERSION is the scanner OUTPUT-FORMAT version
// (community-index-bot lineage), decoupled since v0.6.6 (#47) — its own test
// asserts semver *shape* only ("not coupled to plugin.json"). Kept as an
// explicit, visible allow-list (mirroring check-coverage.mjs's CARVE_OUTS)
// rather than inferred, so a silently-added new decoupled script can't slip
// past this gate unnoticed.
export const DECOUPLED_SCRIPTS = new Set(["scan_repo.mjs"]);

export function isPluginPath(path) {
  return PLUGIN_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--base") out.base = argv[++i];
    else if (argv[i] === "--head") out.head = argv[++i];
  }
  return out;
}

export function getMergeBase(base, head, execImpl = execFileSync) {
  return execImpl("git", ["merge-base", base, head], { encoding: "utf-8" }).trim();
}

export function getChangedPaths(mergeBase, head, execImpl = execFileSync) {
  const out = execImpl("git", ["diff", "--name-only", mergeBase, head], { encoding: "utf-8" });
  return out.split("\n").filter(Boolean);
}

// Reads a path's content AT a given ref via `git show`. Returns null when the
// path did not exist at that ref (new file) — the caller decides what that
// means, this just reports "absent", it never throws.
export function readFileAtRef(ref, path, execImpl = execFileSync) {
  try {
    return execImpl("git", ["show", `${ref}:${path}`], { encoding: "utf-8" });
  } catch {
    return null;
  }
}

export function findScriptFiles(dir = SCRIPTS_DIR, readdirImpl = readdirSync) {
  return readdirImpl(dir)
    .filter((f) => f.endsWith(".mjs"))
    .sort();
}

export function extractScriptVersion(source) {
  const m = source.match(/export const SCRIPT_VERSION\s*=\s*"([^"]+)"/);
  return m ? m[1] : null;
}

// Plain dotted-numeric version (the only shape this repo ships — "0.62.4").
// Anything else (a pre-release/build tag like "1.0.0-rc.1") is deliberately
// NOT ordered here; see compareVersions.
const NUMERIC_VERSION_RE = /^\d+(?:\.\d+)*$/;

// Numeric-segment comparison of two dotted versions. Returns 1 / 0 / -1 for
// a > b / a == b / a < b, and null when either side is not plain dotted-numeric
// — an unorderable tag is reported as "cannot compare" rather than guessed at,
// and the caller then falls back to the weaker "must at least differ" check.
// Missing trailing segments count as 0, so "1.1" == "1.1.0" and "1.1.1" > "1.1".
export function compareVersions(a, b) {
  if (!NUMERIC_VERSION_RE.test(a ?? "") || !NUMERIC_VERSION_RE.test(b ?? "")) return null;
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function parseJsonOrError(text, label) {
  if (text === null) return { error: `${label}: missing at merge-base` };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `${label}: invalid JSON at merge-base (${e.message})` };
  }
}

// Pure(ish) core check — all I/O is dependency-injected so tests never touch
// the real filesystem or spawn real git. Returns { skipped, reason, errors }.
export function checkVersionBump({
  mergeBase,
  head,
  execImpl = execFileSync,
  readFileImpl = safeReadFileSync,
  readdirImpl = readdirSync,
}) {
  const changed = getChangedPaths(mergeBase, head, execImpl);
  if (!changed.some(isPluginPath)) {
    return { skipped: true, reason: "no plugins/ievo/** or .claude-plugin/** changes — infra/docs-only PR, no bump required", errors: [] };
  }

  const errors = [];

  const headPluginJson = JSON.parse(readFileImpl(PLUGIN_JSON_PATH, "utf-8"));
  const headVersion = headPluginJson.version;

  const baseParsed = parseJsonOrError(readFileAtRef(mergeBase, PLUGIN_JSON_PATH, execImpl), "plugin.json");
  if (baseParsed.error) {
    errors.push(baseParsed.error);
  } else {
    const baseVersion = baseParsed.value.version;
    const unchanged = `plugin.json: version unchanged ('${headVersion}') — plugins/ievo/**/.claude-plugin/** changed but the version was not bumped`;
    // A bump must go FORWARD: "differs from the merge-base" alone would let a
    // downgrade (0.62.4 -> 0.62.3, whether a bad merge or a deliberate
    // republish of an already-released version) satisfy the gate.
    const cmp = compareVersions(headVersion, baseVersion);
    if (cmp === null) {
      // Unorderable on at least one side — fall back to "must at least differ".
      if (headVersion === baseVersion) errors.push(unchanged);
    } else if (cmp === 0) {
      errors.push(unchanged);
    } else if (cmp < 0) {
      errors.push(
        `plugin.json: version went BACKWARDS ('${baseVersion}' at the merge-base -> '${headVersion}' at head) — a bump must increase the version`,
      );
    }
  }

  for (const file of findScriptFiles(SCRIPTS_DIR, readdirImpl)) {
    if (DECOUPLED_SCRIPTS.has(file)) continue;
    const source = readFileImpl(join(SCRIPTS_DIR, file), "utf-8");
    const scriptVersion = extractScriptVersion(source);
    if (scriptVersion === null) continue; // no SCRIPT_VERSION constant — nothing to couple
    if (scriptVersion !== headVersion) {
      errors.push(`${file}: SCRIPT_VERSION ('${scriptVersion}') does not match plugin.json version ('${headVersion}')`);
    }
  }

  const marketplace = JSON.parse(readFileImpl(MARKETPLACE_JSON_PATH, "utf-8"));
  if (marketplace.metadata?.version !== headVersion) {
    errors.push(
      `marketplace.json: metadata.version ('${marketplace.metadata?.version}') does not match plugin.json version ('${headVersion}')`,
    );
  }
  if (marketplace.plugins?.[0]?.version !== headVersion) {
    errors.push(
      `marketplace.json: plugins[0].version ('${marketplace.plugins?.[0]?.version}') does not match plugin.json version ('${headVersion}')`,
    );
  }

  return { skipped: false, reason: null, errors };
}

export function main(
  argv = process.argv,
  env = process.env,
  execImpl = execFileSync,
  readFileImpl = safeReadFileSync,
  readdirImpl = readdirSync,
  log = console.log,
  errLog = console.error,
  exit = process.exit,
) {
  if (env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== "pull_request") {
    log(`check-version-bump: skip — GITHUB_EVENT_NAME='${env.GITHUB_EVENT_NAME}' (not a pull_request; already gated pre-merge)`);
    return exit(0);
  }

  const args = parseArgs(argv);
  const base = args.base || env.BASE_SHA;
  const head = args.head || env.HEAD_SHA || "HEAD";

  if (!base) {
    errLog("check-version-bump: no base ref given (--base <ref> or $BASE_SHA) — cannot compute a merge-base to diff against");
    return exit(2);
  }

  let mergeBase;
  try {
    mergeBase = getMergeBase(base, head, execImpl);
  } catch (e) {
    errLog(`check-version-bump: failed to compute merge-base('${base}', '${head}'): ${e.message}`);
    return exit(2);
  }

  let result;
  try {
    result = checkVersionBump({ mergeBase, head, execImpl, readFileImpl, readdirImpl });
  } catch (e) {
    errLog(`check-version-bump: unexpected failure while checking the bump (a git diff error, or malformed plugin.json/marketplace.json JSON): ${e.message}`);
    return exit(2);
  }

  if (result.skipped) {
    log(`check-version-bump: skip — ${result.reason}`);
    return exit(0);
  }

  if (result.errors.length) {
    errLog("Version-bump gate FAILED:");
    for (const e of result.errors) errLog(sanitizeForLog(`  ✗ ${e}`));
    return exit(1);
  }

  log("Version-bump gate OK — plugin version bumped and all coupled files agree.");
  return exit(0);
}

// Exported (rather than inlined into the guard below) so it is testable with
// argv shapes Node would never produce — same contract as every
// plugins/ievo/scripts/*.mjs entry guard.
//
// Normalises both sides: process.argv[1] is often a relative path
// (`node .github/scripts/check-version-bump.mjs`) while import.meta.url is
// always an absolute, percent-ENCODED file: URL. A naive
// `metaUrl === \`file://${argv[1]}\`` therefore mismatches whenever the
// checkout path contains a space or any non-ASCII character (encoded as %20 /
// %XX in import.meta.url, literal in argv[1]) — and a mismatch here means
// main() never runs, so the gate exits 0 and passes silently. fileURLToPath()
// decodes, resolve() absolutises; both sides then compare like-for-like.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

if (isCliEntry(import.meta.url, process.argv)) {
  main();
}
