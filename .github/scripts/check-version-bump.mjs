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
//   1. plugin.json's `version` at head differs from its value at the
//      merge-base (i.e. this PR actually bumped it).
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

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

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
  readFileImpl = readFileSync,
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
  } else if (baseParsed.value.version === headVersion) {
    errors.push(
      `plugin.json: version unchanged ('${headVersion}') — plugins/ievo/**/.claude-plugin/** changed but the version was not bumped`,
    );
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
  readFileImpl = readFileSync,
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
    for (const e of result.errors) errLog(`  ✗ ${e}`);
    return exit(1);
  }

  log("Version-bump gate OK — plugin version bumped and all coupled files agree.");
  return exit(0);
}

export function isCliEntry(metaUrl, argv) {
  return metaUrl === `file://${argv[1]}`;
}

if (isCliEntry(import.meta.url, process.argv)) {
  main();
}
