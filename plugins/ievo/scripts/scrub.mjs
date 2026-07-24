#!/usr/bin/env node
// scrub.mjs — privacy scrub for evo-auto failure capture (part 1/2 of #422,
// closes #423).
//
// A pure stdin→stdout text transform. The evo-auto failure-capture hook
// (part 2 of #422) pipes every captured `PostToolUseFailure`/`PermissionDenied`
// record through this script BEFORE it is written to
// `.ievo/evolution-candidates/<session-id>.jsonl` — so a captured record can
// never carry a live secret or a leaked local username, even though the tool
// output it's built from is untrusted (it may embed anything the failing
// command printed).
//
// Order matters (LAST bullet is why): redact secrets, then redact named
// assignment values, then rewrite $HOME paths, then truncate LAST — so a
// secret sitting inside an oversized blob is redacted before truncation could
// slice through its signature and leave an unredacted fragment.
//
// Stdlib only (Node 18+, bundled with Claude Code / Codex) — no dependencies.
//
// Usage:
//   <input> | node scrub.mjs      # scrub stdin, write scrubbed text to stdout
//   node scrub.mjs --version
//   node scrub.mjs --help
//
// Contract: never writes a file. On any internal error while running as a
// CLI (unreadable stdin, an unexpected throw from scrub()), emit NOTHING to
// stdout and exit 0 — fail-CLOSED for content (never leak a partially
// scrubbed or raw blob), fail-OPEN for the pipeline (the observer hook piping
// through this script must never abort because scrub failed).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// SCRIPT_VERSION is coupled to plugin.json (asserted in the test) — the same
// drift guard discover.mjs / evolution_candidates.mjs use. Bump both in the
// same PR.
export const SCRIPT_VERSION = "0.55.0";

export const REDACTED = "[REDACTED]";
export const MAX_CODEPOINTS = 500;
export const TRUNCATION_MARKER = "…[truncated]";

const HELP_TEXT = `scrub.mjs — privacy scrub for evo-auto failure capture
Usage:
  <input> | node scrub.mjs      scrub stdin, write scrubbed text to stdout
  node scrub.mjs --version
  node scrub.mjs --help

Redacts provider-shaped secret values (GitHub/OpenAI/Slack/AWS tokens, JWTs),
secret-shaped NAME=value / NAME: value assignments (*_TOKEN/*_KEY/*_SECRET/
*_PASSWORD/*_ID, bare PASSWORD/SECRET/TOKEN/APIKEY/API_KEY), rewrites
$HOME-absolute paths to ~-relative, and caps output at ${MAX_CODEPOINTS} Unicode
code points. Never writes a file; on any internal error emits nothing and
exits 0 (fail-closed for content).`;

// ---------------------------------------------------------------------------
// 1. Provider-shaped secret VALUES (redacted regardless of surrounding name)
// ---------------------------------------------------------------------------

// Each alternative is anchored with a fixed, case-exact provider prefix (real
// tokens are case-exact by their own spec) and bounded at 255 chars to keep
// matching linear on pathological input. Order is irrelevant — the prefixes
// are mutually exclusive.
const PROVIDER_SECRET_RE = new RegExp(
  [
    String.raw`\bgh[pousr]_[A-Za-z0-9]{36,255}\b`, // GitHub classic/app-style tokens (ghp_/gho_/ghu_/ghs_/ghr_)
    String.raw`\bgithub_pat_[A-Za-z0-9_]{20,255}\b`, // GitHub fine-grained PAT
    String.raw`\bsk-[A-Za-z0-9_-]{16,255}\b`, // OpenAI-style secret key
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,255}\b`, // Slack token
    String.raw`\bAKIA[0-9A-Z]{16}\b`, // AWS access key id
    String.raw`\beyJ[A-Za-z0-9_-]{5,255}\.[A-Za-z0-9_-]{5,255}\.[A-Za-z0-9_-]{5,255}\b`, // JWT (header.payload.signature)
  ].join("|"),
  "g",
);

export function redactProviderSecrets(text) {
  return text.replace(PROVIDER_SECRET_RE, REDACTED);
}

// ---------------------------------------------------------------------------
// 2. Assignment VALUES for secret-shaped NAMES (name kept, value redacted)
// ---------------------------------------------------------------------------

// Suffix form: any identifier ending in _TOKEN / _KEY / _SECRET / _PASSWORD /
// _ID (e.g. AWS_SECRET_ACCESS_KEY, DB_PASSWORD). Bare form: the handful of
// unsuffixed names that are secret-shaped on their own (APIKEY has no
// underscore before KEY, so it isn't covered by the suffix form; API_KEY is
// covered by both but listed for clarity).
const NAME_ALT = String.raw`[A-Za-z][A-Za-z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|ID)|PASSWORD|SECRET|TOKEN|APIKEY|API_KEY`;

// Captures: (1) name, (2) an optional closing quote right after the name
// (covers a quoted key like `"api_key": …`), (3) separator (`=`/`:` with
// surrounding whitespace), then either a quoted value (4=quote char,
// 5=inner text) or an unquoted value (6=run of non-whitespace/comma/
// semicolon/quote chars). Case-insensitive — assignment names appear in
// every casing convention (env files are uppercase, JS object literals are
// often camelCase).
const ASSIGNMENT_RE = new RegExp(
  String.raw`\b(${NAME_ALT})\b(["']?)(\s*[:=]\s*)(?:(["'])([^"'\r\n]*)\4|([^\s,;"'\r\n]+))`,
  "gi",
);

export function redactNamedSecrets(text) {
  return text.replace(ASSIGNMENT_RE, (_match, name, closeQuote, sep, quote) =>
    quote
      ? `${name}${closeQuote}${sep}${quote}${REDACTED}${quote}`
      : `${name}${closeQuote}${sep}${REDACTED}`,
  );
}

// ---------------------------------------------------------------------------
// 3. $HOME-absolute paths → ~-relative (never leak the username)
// ---------------------------------------------------------------------------

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rewriteHomePaths(text, home) {
  if (!home) return text;
  const re = new RegExp(
    String.raw`(?<![A-Za-z0-9_])` + escapeRegExp(home) + String.raw`(?=$|[^A-Za-z0-9_.-])`,
    "g",
  );
  return text.replace(re, "~");
}

// ---------------------------------------------------------------------------
// 4. Cap at MAX_CODEPOINTS Unicode code points — LAST (see header comment)
// ---------------------------------------------------------------------------

export function truncateScrubbed(text, limit = MAX_CODEPOINTS) {
  // Unicode-aware like the sibling truncate() in scan_repo.mjs — spreading
  // into an array counts by code point, not UTF-16 code unit, so a surrogate
  // pair (e.g. an emoji) isn't split mid-character.
  const chars = [...text];
  if (chars.length <= limit) return text;
  return chars.slice(0, limit).join("") + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Composite transform
// ---------------------------------------------------------------------------

export function scrub(text, opts = {}) {
  if (typeof text !== "string") {
    throw new TypeError(`scrub() requires a string, got ${typeof text}`);
  }
  const home = opts.home ?? homedir();
  let out = text;
  out = redactProviderSecrets(out);
  out = redactNamedSecrets(out);
  out = rewriteHomePaths(out, home);
  out = truncateScrubbed(out);
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function defaultReadStdin() {
  return readFileSync(0, "utf-8");
}

export function main(argv = process.argv, io = {}) {
  const {
    write = (s) => process.stdout.write(s),
    log = console.log,
    exit = process.exit,
    readStdin = defaultReadStdin,
    home,
  } = io;

  if (argv.includes("--version")) {
    log(SCRIPT_VERSION);
    return exit(0);
  }
  if (argv.includes("--help")) {
    log(HELP_TEXT);
    return exit(0);
  }

  try {
    const input = readStdin();
    write(scrub(input, { home }));
    return exit(0);
  } catch {
    // Fail-closed for content, fail-open for the pipeline — see header comment.
    return exit(0);
  }
}

// Pure entry-guard predicate — extracted so the `argv[1] ?? ""` fallback
// branch is reachable from tests (mirrors discover.mjs / evolution_candidates.mjs).
// Normalises both sides: process.argv[1] may be relative while import.meta.url
// is always absolute.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

if (isCliEntry(import.meta.url, process.argv)) {
  main();
}
