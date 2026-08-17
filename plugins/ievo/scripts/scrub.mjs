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
// Order matters (the LAST step is why): redact PEM private-key blocks, then
// provider-shaped secrets, then named assignment values, then HTTP
// credential-header values, then URL-embedded credentials, then rewrite
// $HOME paths, then truncate LAST — so a secret sitting inside an oversized
// blob is redacted before truncation could slice through its signature and
// leave an unredacted fragment. The PEM pass runs FIRST because
// redactNamedSecrets is line-scoped: on a `TLS_KEY: -----BEGIN ...` line it
// would take just the marker line as the assignment's value, decapitating
// the armor so a later PEM pass could no longer recognise the block while
// every body line below it still leaked.
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
export const SCRIPT_VERSION = "0.80.17";

export const REDACTED = "[REDACTED]";
export const MAX_CODEPOINTS = 500;
export const TRUNCATION_MARKER = "…[truncated]";

const HELP_TEXT = `scrub.mjs — privacy scrub for evo-auto failure capture
Usage:
  <input> | node scrub.mjs      scrub stdin, write scrubbed text to stdout
  node scrub.mjs --version
  node scrub.mjs --help

Redacts PEM-armored private-key blocks, provider-shaped secret values
(GitHub/OpenAI/Slack/AWS/Stripe tokens, JWTs), secret-shaped NAME=value / NAME: value
assignments (*_TOKEN/*_KEY/*_SECRET/*_PASSWORD/*_ID, camelCase equivalents
like authToken/clientSecret/accessKeyId, kebab-case equivalents like
api-key/client-secret, bare PASSWORD/SECRET/TOKEN/APIKEY/API_KEY), HTTP
credential-header values (Authorization/Cookie/Set-Cookie/api-key),
URL-embedded credentials (scheme://user:pass@host), rewrites $HOME-absolute
paths to ~-relative, and caps output at ${MAX_CODEPOINTS}
Unicode code points. Never writes a file; on any internal error emits nothing
and exits 0 (fail-closed for content).`;

// ---------------------------------------------------------------------------
// 1. PEM-armored private-key blocks (redacted wholesale, markers included)
// ---------------------------------------------------------------------------

// RFC 7468-style armor whose label names a private key: bare `PRIVATE KEY`
// (PKCS#8), prefixed variants (`RSA`/`EC`/`DSA`/`ENCRYPTED`/`OPENSSH` — any
// bounded uppercase prefix is accepted, so a novel future label ending in
// "PRIVATE KEY" redacts rather than leaks), and PGP's suffixed
// `PGP PRIVATE KEY BLOCK`. Markers and labels are uppercase by spec and real
// generators emit them case-exact — the same case-exact discipline as
// PROVIDER_SECRET_RE below. Public-material armor (`CERTIFICATE`,
// `PUBLIC KEY`) is deliberately NOT matched: it carries no secret, and
// redacting it would only destroy diagnostic signal. The prefix run is
// length-bounded so a stray `-----BEGIN ` followed by a long uppercase run
// costs constant work per scan position, not O(run).
const PEM_LABEL = String.raw`(?:[A-Z0-9][A-Z0-9 ]{0,64} )?PRIVATE KEY(?: BLOCK)?`;

// A complete block — `-----BEGIN <label>-----` body `-----END <label>-----`,
// the END label backreference-matched to BEGIN's — is redacted exactly,
// markers included. The body is `[\s\S]` (any character), not a base64
// class: real bodies also carry PKCS#1 encryption headers
// (`Proc-Type:`/`DEK-Info:` with `,`/`-`), PGP armor headers
// (`Version:`/`Comment:`), blank lines, and — in the JSON-encoded tool
// output this script scrubs — literal backslash-n escape pairs instead of
// newlines; a narrower class would fail on those shapes and leak the whole
// block.
//
// The fallback alternative redacts from an orphan `-----BEGIN ...-----`
// marker to END OF INPUT when no matching END follows: a truncated capture
// that cut the key off mid-body (the same truncated-capture class
// MALFORMED_QUOTED_VALUE below handles for quoted values), or a
// corrupted/mismatched END label. Everything after the marker is presumed
// key material — over-redaction is the fail-closed direction, the same
// trade the redact-to-end-of-line fallback below makes, widened to end of
// input because a PEM body is inherently multi-line, so no line-scoped stop
// condition can bound it.
//
// The strict alternative's lazy body is deliberately UNBOUNDED, unlike
// QUOTED_VALUE_INNER below (bounded at 255) — the fallback is what makes
// that safe. QUOTED_VALUE_INNER's quadratic came from n restarts of an
// O(n) futile end-of-line scan, because its fallback advanced the scan
// position only a few characters past each failure. Here a strict failure
// drops into `[\s\S]*`, which consumes THE REST OF THE INPUT — so a whole
// input pays at most one futile scan plus one linear consume, O(input)
// unconditionally, with no bound needed. A bound would buy no linearity
// and would cost redaction tightness: a complete block whose body exceeded
// the bound would route to the redact-to-end-of-input fallback instead of
// closing at its real END marker. Pinned by a linearity test alongside the
// two existing redactNamedSecrets ones.
const PEM_BLOCK_RE = new RegExp(
  String.raw`-----BEGIN (${PEM_LABEL})-----(?:[\s\S]*?-----END \1-----|[\s\S]*)`,
  "g",
);

// The SSH.com/Tectia dialect of the same armor — FOUR dashes with a space on
// each side of the marker words (`---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----`,
// RFC 4716's framing applied to private keys; what PuTTYgen's
// "Export ssh.com key" emits). Not reachable by PEM_BLOCK_RE's five-dash
// no-space literal, so it gets a sibling regex with the identical
// strict-then-consume-to-end structure — same label set, same backreference,
// same fallback rationale, same linearity argument. Found by the vuln-scan
// pass on this diff, not by the original #530 report.
const SSH2_BLOCK_RE = new RegExp(
  String.raw`---- BEGIN (${PEM_LABEL}) ----(?:[\s\S]*?---- END \1 ----|[\s\S]*)`,
  "g",
);

export function redactPemBlocks(text) {
  return text.replace(PEM_BLOCK_RE, REDACTED).replace(SSH2_BLOCK_RE, REDACTED);
}

// ---------------------------------------------------------------------------
// 2. Provider-shaped secret VALUES (redacted regardless of surrounding name)
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
    String.raw`\b[sp]k_(?:live|test)_[A-Za-z0-9]{16,255}\b`, // Stripe secret/publishable key
    String.raw`\brk_(?:live|test)_[A-Za-z0-9]{16,255}\b`, // Stripe restricted key (both live and test mode, docs.stripe.com/keys)
  ].join("|"),
  "g",
);

export function redactProviderSecrets(text) {
  return text.replace(PROVIDER_SECRET_RE, REDACTED);
}

// ---------------------------------------------------------------------------
// 3. Assignment VALUES for secret-shaped NAMES (name kept, value redacted)
// ---------------------------------------------------------------------------

// Snake form: any identifier ending in _TOKEN / _KEY / _SECRET / _PASSWORD /
// _ID, any casing (e.g. AWS_SECRET_ACCESS_KEY, db_password). camelCase form:
// the same suffix words as a capitalized word at a lower→upper case
// transition instead of an underscore (authToken, clientSecret, accessKeyId,
// secretAccessKey — the JS/Node SDK spelling of the same secret-shaped
// names; skills#557). Bare form: the handful of unsuffixed names that are
// secret-shaped on their own, any casing (APIKEY has no underscore before
// KEY, so it isn't covered by the snake form; API_KEY is covered by both but
// listed for clarity) — this is also what covers plain camelCase `apiKey`:
// the whole identifier case-folds to APIKEY, no case transition needed.
//
// One suffix list drives both the snake and camelCase spellings so the two
// alternatives cannot drift apart.
const SECRET_SUFFIXES = ["TOKEN", "KEY", "SECRET", "PASSWORD", "ID"];
const BARE_SECRET_NAMES = ["PASSWORD", "SECRET", "TOKEN", "APIKEY", "API_KEY"];

// Case-insensitive spelling of a literal ("KEY" -> "[Kk][Ee][Yy]").
// ASSIGNMENT_RE cannot carry the "i" flag: the camelCase alternative below is
// meaningful only case-EXACTLY — under "i", its lower→upper boundary check
// degenerates and any word whose lowercased tail spells a suffix matches
// (monkey/turkey via KEY, avoid/grid via ID), redacting ordinary prose and
// identifiers wholesale. Node 18's regexes have no scoped case-sensitivity
// toggle (the `(?i:...)`/`(?-i:...)` modifier groups need V8 12.4+ / Node
// 22), so the alternatives that WERE case-insensitive via the flag keep that
// exact behavior through per-character classes instead.
function anyCase(literal) {
  return literal.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
}

// "TOKEN" -> "Token", "ID" -> "Id" — the capitalized-word spelling the
// camelCase alternative matches case-exactly.
function titleCase(literal) {
  return literal[0] + literal.slice(1).toLowerCase();
}

// The snake and camelCase alternatives' leading character class is
// [A-Za-z0-9], not just [A-Za-z] — a digit-leading name (2FA_TOKEN,
// 1PASSWORD_SERVICE_ACCOUNT_TOKEN) is a realistic secret-shaped identifier,
// and ASSIGNMENT_RE's \b can't recover a match starting mid-identifier:
// every digit→letter/letter→letter transition inside a name like 2FA_TOKEN
// is word→word, so \b never fires there (skills#507).
//
// The camelCase alternative requires the character before the capitalized
// suffix to be a lowercase letter or digit (`(?<=[a-z0-9])` — a real
// lower→upper camel boundary: authToken's h→T, accessKeyId's y→I,
// oauth2Token's 2→T). An UPPERCASE-preceded suffix (APIToken, SSHKey — an
// acronym run before the suffix word) is deliberately not matched: that is a
// different identifier grammar with its own false-positive surface, and
// skills#557 scopes this fix to the lower→upper transition all its exploit
// examples share. The trailing \b that ASSIGNMENT_RE wraps around NAME_ALT
// keeps the suffix terminal in every alternative (authTokenValue is no more
// a match than AUTH_TOKEN_VALUE is).
//
// The ID suffix additionally matches fully capitalized (SessionID,
// AccessKeyID — the AWS Go SDK's own field spelling): Go's initialisms
// convention capitalizes the whole abbreviation where camelCase would
// title-case a word, and Go-binary error dumps (kubectl, terraform, aws)
// are a common shape in captured tool output. The lower→upper lookbehind
// still applies, so an acronym run before it (UUID) stays out. The other
// four suffixes are ordinary words with no initialism spelling. Found by
// /ievo:vuln-scan on this diff, not by the original skills#557 report.
const CAMEL_SUFFIXES = [...SECRET_SUFFIXES.map(titleCase), "ID"];
//
// Kebab form: the same suffix words as the snake form, hyphen-delimited
// instead of underscore-delimited (api-key, client-secret, access-token,
// db-password, session-id). Neither the snake alternative (hyphen isn't in
// its `[A-Za-z0-9_]` character class) nor the camelCase one (an
// all-lowercase hyphenated name has no lower→upper case transition) can
// match a kebab-case name, so a real-world hyphenated credential name rode
// through unmatched. Azure OpenAI/Cognitive Services' documented `api-key`
// HTTP header (handled separately below, in HTTP_CRED_HEADER_NAME) is a
// concrete instance of this same shape appearing as an assignment name too
// (`{"api-key": "<value>"}`, `api-key=<value>`) (skills#620).
//
// UNLIKE the snake alternative above, the leading run here is bounded
// (`{0,254}`, not `*`) — a run of hyphen-joined identifier characters with
// no terminal suffix (`a-a-a-a-…-a`) is a realistic captured-output shape
// (a long flag list, a slug, a compound path segment), and the boundary fix
// (skills#612) that lets a match attempt START right after ANY non-alnum
// character — including a hyphen, same as it does for `_` — means every
// such hyphen is a fresh attempt position. An unbounded greedy
// `[A-Za-z0-9-]*` backtracking from each of those O(n) positions makes the
// whole match O(n²) on adversarial input the text hasn't been truncated
// out of yet (scrub() caps length LAST — see file header); measured on the
// unbounded form: 989ms at 40 KB, 3.9s at 80 KB (quadrupling per doubling).
// Bounding the run the same way PROVIDER_SECRET_RE and QUOTED_VALUE_INNER
// already are elsewhere in this file caps the backtrack cost per attempt
// position at O(255), restoring linear total cost (108ms at 160 KB,
// bounded) — real kebab-case identifiers are nowhere near 255 characters,
// so this costs no legitimate match. The pre-existing snake alternative
// shares this same unbounded shape and is not touched here — out of scope
// for skills#620, which only adds this new kebab alternative.
const NAME_ALT = [
  String.raw`[A-Za-z0-9][A-Za-z0-9_]*_(?:${SECRET_SUFFIXES.map(anyCase).join("|")})`,
  String.raw`[A-Za-z0-9][A-Za-z0-9-]{0,254}-(?:${SECRET_SUFFIXES.map(anyCase).join("|")})`,
  String.raw`[A-Za-z0-9][A-Za-z0-9_]*(?<=[a-z0-9])(?:${CAMEL_SUFFIXES.join("|")})`,
  ...BARE_SECRET_NAMES.map(anyCase),
].join("|");

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
// quoted value (7=see MALFORMED_QUOTED_VALUE above). Compiled WITHOUT the
// "i" flag (it used to carry one): NAME_ALT now manages casing per
// alternative — snake/bare names stay case-insensitive via anyCase()'s
// per-character classes, while the camelCase alternative's lower→upper
// boundary stays case-exact, which an "i" flag would destroy (see above).
// Every other atom in the pattern is a case-agnostic character class, so
// the flag change affects nothing else.
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
//
// The LEADING boundary is `(?<![A-Za-z0-9])`, not `\b`: `\b` treats `_` as
// the same word class as a letter/digit, so it never fires between a
// preceding `_` and the secret-shaped name that follows — an underscore-
// prefixed identifier (`_authToken=`, `_password=`, `__SECRET_KEY=`, the real
// `.npmrc` shape `//registry.npmjs.org/:_authToken=npm_xxxx`) skipped
// ASSIGNMENT_RE entirely, even though NAME_ALT's own leading character class
// already excludes `_` from the matched name itself (skills#612). This only
// changes behaviour when the identifier-shaped run NAME_ALT is scanning
// STARTS with one or more underscores: every such run's first character is
// otherwise either a letter/digit (where `\b` already fired trivially, same
// as the lookbehind does, so ordinary prose and every other existing case
// are unaffected) or the very start of the input. The trailing `\b` and
// every suffix-grammar rule above (case-exactness, the lower→upper camel
// transition, the acronym-run exclusion) are untouched — this widens only
// which character may precede the match, never what the match itself may
// contain.
const ASSIGNMENT_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(${NAME_ALT})\b(["']?)(\s*[:=]\s*)(?:(["'])(${QUOTED_VALUE_INNER})\4${QUOTED_VALUE_CLOSE}|(${UNQUOTED_VALUE})|(${MALFORMED_QUOTED_VALUE}))`,
  "g",
);

export function redactNamedSecrets(text) {
  return text.replace(ASSIGNMENT_RE, (_match, name, closeQuote, sep, quote) =>
    quote
      ? `${name}${closeQuote}${sep}${quote}${REDACTED}${quote}`
      : `${name}${closeQuote}${sep}${REDACTED}`,
  );
}

// ---------------------------------------------------------------------------
// 4. HTTP credential-header VALUES — Authorization / Cookie / Set-Cookie
// ---------------------------------------------------------------------------

// NAME_ALT above never fires on `Authorization`/`Cookie`/`Set-Cookie`: those
// literal identifiers don't end in `_TOKEN`/`_KEY`/`_SECRET`/`_PASSWORD`/
// `_ID` (or the kebab equivalent) and aren't among the bare keywords, so a
// `curl -H "Authorization: Bearer <token>"` or a fetch/HTTP tool call's
// `Cookie:`/`Set-Cookie:` header rides through redactNamedSecrets untouched.
//
// `api-key` is listed here too even though NAME_ALT's kebab alternative
// (added above) now also matches a plain `api-key: value` / `api-key=value`
// assignment on its own: this pass' unquoted branch runs to end of line
// instead of stopping at a comma/semicolon the way ASSIGNMENT_RE's
// UNQUOTED_VALUE does, which is the correct behavior for a real HTTP header
// value (same reasoning as the Digest-Authorization case below) rather than
// an ordinary assignment. Azure OpenAI/Cognitive Services' documented
// authentication header is literally `api-key` (lowercase, hyphenated,
// unprefixed hex-string value — no provider-signature prefix for
// PROVIDER_SECRET_RE to catch), so it rode through all five redaction passes
// unmatched (skills#620). Matched case-insensitively via the "gi" flag below
// (no camelCase-alternative ambiguity here, unlike ASSIGNMENT_RE, so the
// flag is safe to use directly rather than needing anyCase()) — this also
// means the common real-world `X-Api-Key` header variant matches too, the
// same way `Proxy-Authorization` already does via the leading boundary
// check below (skills#612), which excludes only a preceding letter/digit.
const HTTP_CRED_HEADER_NAME = String.raw`Authorization|Set-Cookie|Cookie|api-key`;

// Deliberately NOT reusing ASSIGNMENT_RE's UNQUOTED_VALUE (comma/semicolon
// terminated) for the unquoted branch here — that shape is wrong for a
// header value. A `Cookie` header packs multiple `name=value` pairs
// separated by `;` (`session=abc123; csrftoken=xyz789`), and a `Digest`
// `Authorization` value packs multiple `key="value"` params separated by
// `,` (`Digest username="foo", realm="bar", response="<hash>"`) — in both
// shapes every segment is part of the SAME credential, not a delimiter
// between it and unrelated trailing content the way a comma is for a
// `PASSWORD=x, unrelated text` line. Stopping at the first `,`/`;` (as
// UNQUOTED_VALUE does) would redact only the first segment and leak every
// later one — the Digest response hash in particular, which is exactly the
// credential this pass exists to catch. So the unquoted branch here is a
// flat, unbounded `[^\r\n]+`: it runs to the next real CRLF or end of input,
// consuming commas/semicolons/quotes alike as ordinary content. This is the
// same "swallow the undelimited tail" trade-off `scrub.test.mjs` already
// pins for redactNamedSecrets (an unquoted value with no delimiter runs to
// end of line) — deliberately over-redacting whatever a captured record's
// JSON-compact single line puts after the header, rather than risk under-
// redacting a multi-segment credential by guessing where it "should" stop.
// Fail-closed is the only property this file trades against diagnostic
// completeness.
//
// This also means no third "malformed quoted value" branch is needed
// (unlike ASSIGNMENT_RE's MALFORMED_QUOTED_VALUE): if the strict quoted
// alternative below fails to find a valid closing quote (a truncated
// capture, `Authorization: "Bearer trunc` with no closer), the regex engine
// backtracks to the SAME start position and retries the unquoted
// alternative — `[^\r\n]+` doesn't exclude quote characters, so it happily
// re-consumes from that same opening quote through to end of line. The
// value is still fully redacted; nothing extra to write.
//
// Linearity: the strict quoted alternative reuses QUOTED_VALUE_INNER, whose
// own 255-unit bound (see above) already caps a failed attempt at O(255)
// before falling through — so the unquoted `[^\r\n]+` fallback runs at most
// once per header occurrence, for O(line length) each, with no per-position
// re-scan the way the pre-fix MALFORMED_QUOTED_VALUE had. Pinned by its own
// linearity test alongside the existing ones.
//
// Same underscore-boundary fix as ASSIGNMENT_RE's leading edge above
// (skills#612), applied here for consistency even though none of the three
// header names has a common underscore-prefixed spelling in the wild: the
// leading `(?<![A-Za-z0-9])` still blocks an immediately-preceding
// letter/digit (MyAuthorization stays a non-match, same as `\b` gave), but no
// longer misses a name reachable only past a preceding `_`.
const HTTP_CRED_HEADER_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(${HTTP_CRED_HEADER_NAME})\b(["']?)(\s*:\s*)(?:(["'])(${QUOTED_VALUE_INNER})\4${QUOTED_VALUE_CLOSE}|([^\r\n]+))`,
  "gi",
);

export function redactHttpCredentialHeaders(text) {
  return text.replace(HTTP_CRED_HEADER_RE, (_match, name, closeQuote, sep, quote) =>
    quote
      ? `${name}${closeQuote}${sep}${quote}${REDACTED}${quote}`
      : `${name}${closeQuote}${sep}${REDACTED}`,
  );
}

// ---------------------------------------------------------------------------
// 5. URL-embedded credentials — the userinfo of scheme://user:pass@host
// ---------------------------------------------------------------------------

// Fires only when the userinfo carries a `:` — i.e. a password component
// exists (`postgres://user:pass@host/db`, `redis://:pass@host`). A
// colon-less `scheme://name@host` (`ssh://git@github.com/...`) is
// overwhelmingly a plain, non-secret username in real tool output, and
// redacting it would destroy routing diagnostics for no secrecy gain; a
// provider-shaped token riding there alone is already PROVIDER_SECRET_RE's
// job, which ran just above.
//
// The username run is `*`, not `+` — `redis://:pass@host` has an EMPTY
// username, and requiring one leaks that whole shape (the issue's own
// recommended regex required a non-empty username and so missed its own
// `redis://:pass@host` example; re-derived from RFC 3986 rather than
// copied).
//
// The WHOLE userinfo is redacted, not just the password: real credentials
// ride in the username slot too (`https://<token>:x-oauth-basic@github.com`,
// GitLab's `oauth2:<token>@`), so preserving the username can preserve the
// secret. The host and everything after it survive — that is the diagnostic
// half of the URL, and never the credential. (When THIS pass is what fires:
// redactNamedSecrets runs first, so a username that is literally a bare
// NAME_ALT keyword — `https://TOKEN:x@host/path` — is consumed there as a
// `TOKEN:`-assignment whose unbounded value swallows host and path too.
// Over-redaction, still fail-closed; noted so this comment doesn't overclaim.)
//
// Character classes follow RFC 3986: `/`, `?`, `#` hard-terminate the
// authority, so none can appear raw inside userinfo — excluding them stops
// false positives on credential-free URLs whose later parts contain `@`
// (`https://host:8080?e=a@b.c`, `https://host:443/@user`); whitespace ends
// a URL embedded in prose. The username run also excludes `:`, making the
// FIRST colon the user/password split — deterministic, no ambiguity to
// backtrack over, so matching stays linear. The password run ALLOWS raw `:`
// and `@` (sloppy-but-real connection strings embed them unencoded): the
// greedy run plus the final literal `@` backtracks to the LAST `@` in the
// span, so `u:p@ss@host` redacts the full `u:p@ss`, never a prefix of it.
// The scheme is RFC 3986's `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`,
// length-bounded like every other open-ended run in this file so a long
// letter run costs constant work per scan position.
const URL_CREDENTIAL_RE = new RegExp(
  String.raw`([A-Za-z][A-Za-z0-9+.-]{0,31}://)[^\s/?#:@]*:[^\s/?#]*@`,
  "g",
);

export function redactUrlCredentials(text) {
  return text.replace(URL_CREDENTIAL_RE, `$1${REDACTED}@`);
}

// ---------------------------------------------------------------------------
// 6. $HOME-absolute paths → ~-relative (never leak the username)
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
// 7. Cap at MAX_CODEPOINTS Unicode code points — LAST (see header comment)
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
  out = redactPemBlocks(out);
  out = redactProviderSecrets(out);
  out = redactNamedSecrets(out);
  out = redactHttpCredentialHeaders(out);
  out = redactUrlCredentials(out);
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
