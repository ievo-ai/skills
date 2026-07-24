#!/usr/bin/env node
// scrub.mjs — pure stdin->stdout privacy scrub for iEvo auto-evolution's
// opt-in tool-failure capture (see /ievo:evo-auto-enable, #422). Failure
// telemetry (a PostToolUseFailure `error` string + `tool_input`, or a
// PermissionDenied `tool_input`) can carry secrets or machine-local paths
// verbatim — this script strips that BEFORE the caller ever persists the
// record via evolution_candidates.mjs. Fail-CLOSED by design: a caller must
// treat a non-zero exit / thrown error as "drop the record" and never fall
// back to writing the raw, unscrubbed text.
//
// Never writes a file — reads all of stdin, writes the scrubbed text to
// stdout, nothing else touches the filesystem.
//
// Stdlib only (Node 18+, bundled with Claude Code / Codex) — no dependencies.
//
// Usage:
//   <producer> | node scrub.mjs
//   node scrub.mjs --version | --help
//
// Redaction passes, applied in this order (see each function for why):
//   1. Provider-shaped secret tokens (GitHub / OpenAI+Anthropic / Slack / AWS / JWT)
//   2. NAME_TOKEN / NAME_KEY / NAME_SECRET / NAME_PASSWORD / NAME_ID
//      assignment values (name kept, value redacted) — the same
//      *_TOKEN/*_KEY/*_SECRET/*_PASSWORD/*_ID convention AGENTS.md's
//      "Public-repo content safety" section already establishes.
//   3. $HOME-absolute paths -> ~-relative
//   4. Hard cap at 500 Unicode CODE POINTS (never UTF-16 code units, so a
//      truncation can't split a surrogate pair), with a trailing marker.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// SCRIPT_VERSION is coupled to plugin.json (asserted in the test) — the same
// drift guard discover.mjs / evolution_candidates.mjs use.
export const SCRIPT_VERSION = "0.55.0";
export const MAX_CODE_POINTS = 500;
export const TRUNCATION_MARKER = "...[truncated]";
export const REDACTED = "<redacted>";

const HELP_TEXT = `scrub.mjs — iEvo privacy scrub (stdin -> stdout)
Usage:
  <producer> | node scrub.mjs
  node scrub.mjs --version
  node scrub.mjs --help`;

// ---------------------------------------------------------------------------
// Pass 1 — provider-shaped secret tokens
// ---------------------------------------------------------------------------

// GitHub's first-party token family shares one shape (a fixed literal prefix
// + an opaque body): ghp_ (classic PAT), gho_ (OAuth), ghu_ (App
// user-to-server), ghs_ (App installation/server), ghr_ (App refresh), and
// github_pat_ (fine-grained PAT) — see
// https://docs.github.com/en/authentication. The issue's port-scope names
// only ghp_/github_pat_ as examples of "provider-shaped"; scrubbing just
// those two and leaving the sibling prefixes verbatim would be an arbitrary,
// easily-closed gap in a script whose whole job is "no GitHub token
// survives" — App installation tokens (`ghs_...`) are exactly the shape iEvo's
// own CI automation mints, so they are exactly the kind of value this hook's
// captured telemetry could plausibly contain.
const GITHUB_TOKEN_RE = /\bgh[oprsu]_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g;

// OpenAI-style (`sk-...`) and Anthropic-style (`sk-ant-...`) API keys share
// the `sk-` prefix; OpenAI project keys add a `proj-` infix — all covered by
// requiring only the shared prefix plus a long-enough opaque tail (short
// tails are rejected to avoid flagging incidental "sk-"-prefixed words).
const SK_KEY_RE = /\bsk-[A-Za-z0-9_-]{20,}\b/g;

// Slack tokens: xoxb- (bot), xoxp- (user), xoxa- (app-level), xoxr-
// (refresh), xoxs- (workspace-config) — the issue's "xox?-" shorthand for
// this family.
const SLACK_TOKEN_RE = /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g;

// AWS access key ID: fixed 4-char AKIA prefix + 16 uppercase-alnum (20 chars
// total) — a stable, fully-documented format.
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;

// JWT: three base64url segments; the first always starts "eyJ" (base64 of
// the literal `{"`), which is what makes JWTs greppable in the wild.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const PROVIDER_SECRET_PATTERNS = [GITHUB_TOKEN_RE, SK_KEY_RE, SLACK_TOKEN_RE, AWS_KEY_RE, JWT_RE];

export function redactProviderSecrets(text) {
  let out = text;
  for (const re of PROVIDER_SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pass 2 — NAME_TOKEN / NAME_KEY / NAME_SECRET / NAME_PASSWORD / NAME_ID
// assignment values (name kept, value redacted)
// ---------------------------------------------------------------------------

// Matches shell (`NAME=value`), YAML (`NAME: value`), and JSON
// (`"NAME": "value"`) assignment shapes.
//   group 1 = the name (kept verbatim, including the suffix that makes it
//             secret-shaped)
//   group 2 = an optional closing quote directly after the name (JSON key)
//   group 3 = the separator (":" or "=", optional surrounding whitespace)
//   group 4 = an optional opening quote before the value
//   group 5 = the value (redacted)
// \4 back-references group 4 so a matched opening quote also consumes its
// matching closing quote — an unmatched optional group back-references as
// the empty string per the JS regex spec, so this is safe when the value
// was unquoted too. Without this, a closing quote would survive right after
// the substituted marker (e.g. `NAME="<redacted>"` -> `NAME="<redacted>"` is
// correct; omitting the back-reference would instead leave a stray `"`).
const ASSIGNMENT_RE =
  /\b([A-Z][A-Z0-9_]*(?:_TOKEN|_KEY|_SECRET|_PASSWORD|_ID))\b("?)(\s*[:=]\s*)(["'])?([^\s"',}\]]+)\4?/g;

export function redactAssignments(text) {
  return text.replace(ASSIGNMENT_RE, (_match, name, nameQuote, sep, valueQuote) => {
    const q = valueQuote ?? "";
    return `${name}${nameQuote}${sep}${q}${REDACTED}${q}`;
  });
}

// ---------------------------------------------------------------------------
// Pass 3 — $HOME-absolute paths -> ~-relative
// ---------------------------------------------------------------------------

export function redactHomePaths(text, home = homedir()) {
  // A home dir of "" or "/" would turn every path separator into "~" — guard
  // against both a missing/unresolvable homedir() and the degenerate root case.
  if (!home || home.length <= 1) return text;
  return text.replaceAll(home, "~");
}

// ---------------------------------------------------------------------------
// Pass 4 — hard cap at MAX_CODE_POINTS Unicode code points
// ---------------------------------------------------------------------------

// Slices by CODE POINT (via the string iterator, which yields whole code
// points) rather than by UTF-16 code unit (`.length`/`.slice`), so a cap can
// never split an astral character's surrogate pair into two lone —
// individually invalid — surrogates.
export function capLength(text, max = MAX_CODE_POINTS) {
  const codePoints = Array.from(text);
  if (codePoints.length <= max) return text;
  return codePoints.slice(0, max).join("") + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function scrub(text) {
  let out = text;
  out = redactProviderSecrets(out);
  out = redactAssignments(out);
  out = redactHomePaths(out);
  out = capLength(out);
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(argv = process.argv, io = {}) {
  const {
    log = console.log,
    exit = process.exit,
    readStdin = () => readFileSync(0, "utf-8"),
    write = (s) => process.stdout.write(s),
  } = io;

  if (argv.includes("--version")) {
    log(SCRIPT_VERSION);
    return exit(0);
  }
  if (argv.includes("--help")) {
    log(HELP_TEXT);
    return exit(0);
  }

  let input;
  try {
    input = readStdin();
  } catch {
    // No readable stdin (e.g. a closed/invalid fd 0 in some host
    // environment) — nothing to scrub. Exit clean rather than crash the
    // caller's pipeline; the caller's own fail-closed contract (drop the
    // record on any non-zero exit / empty output) already covers this.
    return exit(0);
  }

  write(scrub(input));
  return exit(0);
}

export function mainSafe(argv = process.argv, io = {}) {
  try {
    return main(argv, io);
  } catch (err) {
    const errLog = io.errLog ?? console.error;
    const exit = io.exit ?? process.exit;
    errLog(`fatal: ${err.message}`);
    return exit(2);
  }
}

// Pure entry-guard predicate — mirrors discover.mjs / evolution_candidates.mjs.
// Normalises both sides: process.argv[1] may be relative while
// import.meta.url is always absolute.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

if (isCliEntry(import.meta.url, process.argv)) {
  mainSafe();
}
