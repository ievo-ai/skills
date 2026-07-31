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
export const SCRIPT_VERSION = "0.75.7";

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
//
// The suffix alternative's leading character class is [A-Za-z0-9], not just
// [A-Za-z] — a digit-leading name (2FA_TOKEN, 1PASSWORD_SERVICE_ACCOUNT_TOKEN)
// is a realistic secret-shaped identifier, and ASSIGNMENT_RE's \b can't
// recover a match starting mid-identifier: every digit→letter/letter→letter
// transition inside a name like 2FA_TOKEN is word→word, so \b never fires
// there (skills#507).
const NAME_ALT = String.raw`[A-Za-z0-9][A-Za-z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|ID)|PASSWORD|SECRET|TOKEN|APIKEY|API_KEY`;

// An unquoted value stops at a comma/semicolon/CRLF (unchanged), OR right
// before the next secret-shaped `NAME<sep>` further along the same line —
// so back-to-back assignments on one line ("A_TOKEN=one B_SECRET=two")
// still redact independently — OR the end of input. Internal whitespace no
// longer stops the match: the value alternative used to be
// `[^\s,;"'\r\n]+`, which matched only the FIRST token of a multi-word
// unquoted value, so `.replace()` only redacted that token and copied every
// subsequent word through untouched (`PASSWORD=my secret pass` ->
// `PASSWORD=[REDACTED] secret pass`, skills#493).
//
// The repeated group consumes a whole run of non-whitespace OR a whole run
// of whitespace per iteration — not one character at a time — so
// NEXT_ASSIGNMENT_LOOKAHEAD's NAME_ALT probe (only ever reachable once
// `\s+` has matched, i.e. once per whitespace run) is attempted once per
// word, not once per character of run length. Matching char-by-char here
// was tried first and rejected: bounding a per-character NAME_ALT probe at
// a fixed length to keep it linear also caps the value length itself,
// silently truncating a redaction past that bound — a regression against
// the pre-fix code, which had no length limit on a whitespace-free value.
// Consuming whole runs keeps the total cost of every NAME_ALT probe across
// a value O(value length) with no length cap at all. The whitespace
// alternative is `[^\S\r\n]+` (horizontal whitespace only), not `\s+` —
// `\s` also matches \r\n, and a bare `\s+` here would swallow a trailing
// newline the value must stop before, same as every other stop condition.
//
// Quote characters are NOT excluded from the continuation runs (only from
// the mandatory first char, so a value that actually starts with a
// delimiter quote still routes to the quoted alternatives below). An
// apostrophe/quote appearing INSIDE an otherwise-unquoted value (e.g. a
// contraction: "don't") is ordinary content — excluding it reproduced the
// exact same partial-redaction bug as the whitespace case above, just
// triggered by a different character (`PASSWORD=don't share this` ->
// `PASSWORD=[REDACTED]'t share this`; found by /ievo:vuln-scan on this
// diff, not by the original skills#493 report).
const NEXT_ASSIGNMENT_LOOKAHEAD = String.raw`\s+\b(?:${NAME_ALT})\b["']?\s*[:=]`;
const UNQUOTED_VALUE = String.raw`[^\s,;"'\r\n](?:(?!${NEXT_ASSIGNMENT_LOOKAHEAD})(?:[^\s,;\r\n]+|[^\S\r\n]+))*`;

// Fallback for a value that visibly STARTS with a quote character but the
// strict quoted alternative below can't fully close: consumes from the
// opening quote through the next stop condition anyway, so the whole thing
// still gets redacted instead of the ENTIRE `NAME=value` segment falling
// through completely unmatched — silently worse than a partial redaction,
// since no `[REDACTED]` marker appears anywhere to hint the value was
// missed (also found by /ievo:vuln-scan on this diff). Reachable whenever
// the strict alternative below fails to close: a genuinely missing or
// truncated closing quote (tool-failure output cut off mid-line), or — once
// the closing-quote boundary check below rejects interior quotes — a value
// whose only same-type quotes are interior ones.
//
// The continuation covers every non-CRLF character, NOT `[^,;\r\n]`: this
// alternative only fires once an opening quote has been consumed, and
// INSIDE a quoted value a comma/semicolon is ordinary content, not a
// delimiter. Stopping at one reproduced the very partial-leak class this
// fix closes — `PASSWORD="my secret, more secret` (truncated capture)
// redacted only up to the comma and copied `, more secret` through in
// cleartext. The separator stops that still apply are the ones that are
// real separators here: CRLF, the NEXT_ASSIGNMENT_LOOKAHEAD probe (so a
// real assignment later on the same line still redacts independently),
// and end of input.
//
// That continuation is spelled as whole runs — a run of non-whitespace OR
// a run of horizontal whitespace per iteration — for exactly the reason
// UNQUOTED_VALUE is (see above), not merely for symmetry. Written
// per-character as `[^\r\n]`, the lookahead is re-attempted at every
// position inside a whitespace run, and its leading `\s+` backtracks across
// the whole remaining run on each attempt, so `PASSWORD="` followed by a
// long space run costs O(run²) — on untrusted input that has NOT been
// truncated yet, since scrub() caps length LAST by design. Consuming whole
// runs attempts the probe once per run instead of once per character,
// restoring linear cost (found in review). The redacted span is unchanged:
// the two classes are disjoint and their union is exactly `[^\r\n]`, and
// the lookahead can only succeed at a position where whitespace begins —
// which, because `\s+` backtracks, is true at a whitespace run's first
// character whenever it is true anywhere inside that run.
const MALFORMED_QUOTED_VALUE = String.raw`["'](?:(?!${NEXT_ASSIGNMENT_LOOKAHEAD})(?:[^\s\r\n]+|[^\S\r\n]+))*`;

// A same-type quote only TERMINATES a quoted value when a real delimiter
// follows it: whitespace/CRLF, `,`/`;`, a closing bracket/brace/paren, or
// end of input. Without this check the lazy inner match closes on the first
// same-type quote it reaches even when that quote sits INSIDE the value —
// an apostrophe in `PASSWORD='don't share this xyz`, a JSON-escaped `\"` in
// `{"db_password":"p@ss\"real"}` — redacting only as far as it and copying
// the rest of the live secret through in cleartext. That is the same
// partial-leak class skills#493 closes, surviving in the quoted branch
// (found in review). With the check an interior quote no longer terminates:
// the match either finds the value's real closing quote further along
// (`PASSWORD='don't share this'` -> `PASSWORD='[REDACTED]'`) or fails over
// to MALFORMED_QUOTED_VALUE above and redacts to end of line. Both are
// fail-closed; the cost is over-redaction when a value genuinely closes on
// a quote followed by something else (`TOKEN="abc"def`).
const QUOTED_VALUE_CLOSE = String.raw`(?=[\s,;}\])]|$)`;

// Inner text of a strictly-quoted value: non-CRLF characters, except that a
// backslash always takes the next character with it — so a backslash-escaped
// quote (`"p@ss\" real"`, ubiquitous in the JSON-encoded tool output this
// script scrubs) is content, not a candidate terminator. The boundary check
// above alone does not cover it: an escaped quote followed by a space
// satisfies the boundary and closed the value early, leaking the tail.
// Escape awareness can only push the accepted closing quote LATER than the
// plain `[^\r\n]*?` form would, never earlier, so it can only ever widen the
// redacted span (worst case: no closer is accepted and the MALFORMED
// fallback redacts to end of line) — it cannot introduce a new under-match.
// Spelled `\\[^\r\n]` rather than `\\.` to keep the excluded set exactly
// CRLF: `.` additionally excludes U+2028/U+2029, which are ordinary content
// here.
//
// The repetition is BOUNDED rather than an unbounded `*?`, for the same
// linear-time reason PROVIDER_SECRET_RE above is bounded at 255. When no
// closer this alternative accepts exists ahead on the line, the lazy inner
// scans all the way to end of line before failing — and the MALFORMED
// fallback below then advances the scan position by only a few characters,
// so that futile end-of-line scan restarts at EVERY assignment on the line:
// `'PASSWORD="a '.repeat(n)` is a single line with n restarts of an O(n)
// scan, i.e. O(n²), on input that has NOT been truncated yet because scrub()
// caps length LAST by design (measured on the unbounded form: 0.6s at 48 KB,
// 2.5s at 96 KB — found in review). This is the same attacker-influenced
// cost the unquoted and malformed alternatives were already restructured to
// avoid, left unfixed in the strict-quoted one; whole-run consumption cannot
// fix it here, because the cost is one full scan per restart rather than
// re-probing inside a run.
//
// A length bound is the right instrument HERE even though one was tried and
// rejected for UNQUOTED_VALUE earlier in this PR, and the difference is the
// direction of the failure. Overflowing this bound makes the strict
// alternative FAIL, which drops the value into MALFORMED_QUOTED_VALUE below
// and redacts from the opening quote to end of line — so the bound can only
// ever WIDEN a redaction, never truncate one. The UNQUOTED_VALUE cap
// truncated the redacted span itself and copied the tail through in
// cleartext, which is a leak; this one's only cost is over-redaction of
// whatever follows a quoted value longer than the bound on the same line
// (`TOKEN="<256+ chars>" tail` -> `TOKEN=[REDACTED]` instead of
// `TOKEN="[REDACTED]" tail`). Fail-closed either way, pinned by its own test.
//
// A "unit" is one character or one backslash-escape pair, so the bound is on
// iterations, not on the byte length of the value.
const QUOTED_VALUE_MAX_UNITS = 255;
const QUOTED_VALUE_INNER = String.raw`(?:[^\r\n\\]|\\[^\r\n]){0,${QUOTED_VALUE_MAX_UNITS}}?`;

// Captures: (1) name, (2) an optional closing quote right after the name
// (covers a quoted key like `"api_key": …`), (3) separator (`=`/`:` with
// surrounding whitespace), then a quoted value (4=quote char, 5=inner
// text), an unquoted value (6=see UNQUOTED_VALUE above), or a malformed
// quoted value (7=see MALFORMED_QUOTED_VALUE above). Case-insensitive —
// assignment names appear in every casing convention (env files are
// uppercase, JS object literals are often camelCase).
//
// The quoted alternative's inner text is QUOTED_VALUE_INNER (lazy, only CRLF
// excluded, backslash-escape aware, length-bounded) and closes on a
// backreference to whichever quote character opened it (\4) — NOT
// `[^"'\r\n]*` (greedy, excluding BOTH quote characters), which stopped at
// the first occurrence of EITHER quote type and so failed to find a
// same-type closer sitting past an embedded opposite-type quote (`"user's
// api key"` has no `"` immediately after "user", so the old pattern never
// found the real closing `"` at all — the MALFORMED_QUOTED_VALUE case above,
// also found by /ievo:vuln-scan).
// Lazy (not greedy) matching stops at the FIRST subsequent same-type quote
// that QUOTED_VALUE_CLOSE accepts as a real terminator, so two quoted
// assignments on one line ("A_TOKEN=\"one\" B_SECRET=\"two\"") still redact
// independently instead of the first value's match spanning into the second,
// while a quote interior to the value no longer ends it early.
const ASSIGNMENT_RE = new RegExp(
  String.raw`\b(${NAME_ALT})\b(["']?)(\s*[:=]\s*)(?:(["'])(${QUOTED_VALUE_INNER})\4${QUOTED_VALUE_CLOSE}|(${UNQUOTED_VALUE})|(${MALFORMED_QUOTED_VALUE}))`,
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
