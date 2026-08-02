// Tests for scrub.mjs — privacy scrub for evo-auto failure capture.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/scrub.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  SCRIPT_VERSION,
  REDACTED,
  MAX_CODEPOINTS,
  TRUNCATION_MARKER,
  redactPemBlocks,
  redactProviderSecrets,
  redactNamedSecrets,
  redactHttpCredentialHeaders,
  redactUrlCredentials,
  rewriteHomePaths,
  truncateScrubbed,
  scrub,
  main,
  isCliEntry,
} from "../scrub.mjs";

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scrub.mjs");

// A synthetic home directory that does NOT look like a real machine-local
// path (avoids the repo's machine-local-paths pre-commit validator, which
// flags literal /Users/<name>/ and /home/<name>/ strings) — under the OS
// tmpdir instead, which is never a real user home.
const FAKE_HOME = join("/tmp", "scrub-fixture-home");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SCRIPT_VERSION matches plugin.json — real coupling, not hardcoded", () => {
    const pluginJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.claude-plugin/plugin.json");
    const { version } = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
    assert.equal(SCRIPT_VERSION, version, `scrub.mjs SCRIPT_VERSION ('${SCRIPT_VERSION}') and plugin.json version ('${version}') must agree — bump both in the same PR`);
  });

  it("REDACTED / MAX_CODEPOINTS / TRUNCATION_MARKER are the documented values", () => {
    assert.equal(REDACTED, "[REDACTED]");
    assert.equal(MAX_CODEPOINTS, 500);
    assert.equal(TRUNCATION_MARKER, "…[truncated]");
  });
});

// ---------------------------------------------------------------------------
// redactPemBlocks — PEM-armored private-key blocks
// ---------------------------------------------------------------------------

// A structurally realistic armor block with a synthetic (non-key) body.
function pemBlock(label, body = "MIIEfake+base64/line0\nMIIEfake+base64/line1==") {
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

describe("redactPemBlocks", () => {
  it("redacts a complete PKCS#1 RSA block wholesale, markers included", () => {
    const out = redactPemBlocks(`before\n${pemBlock("RSA PRIVATE KEY")}\nafter`);
    assert.equal(out, `before\n${REDACTED}\nafter`);
  });

  it("redacts every private-key label variant, including PGP's BLOCK suffix", () => {
    for (const label of [
      "PRIVATE KEY",
      "RSA PRIVATE KEY",
      "EC PRIVATE KEY",
      "DSA PRIVATE KEY",
      "ENCRYPTED PRIVATE KEY",
      "OPENSSH PRIVATE KEY",
      "PGP PRIVATE KEY BLOCK",
    ]) {
      assert.equal(redactPemBlocks(pemBlock(label)), REDACTED, label);
    }
  });

  it("redacts a body carrying PKCS#1 encryption headers and blank lines", () => {
    const body =
      "Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,ABCDEF0123456789\n\nMIIEfake+base64==";
    assert.equal(redactPemBlocks(pemBlock("RSA PRIVATE KEY", body)), REDACTED);
  });

  it("redacts a JSON-encoded block whose newlines are literal backslash-n escapes", () => {
    const oneLine =
      "-----BEGIN PRIVATE KEY-----\\nMIIEfake==\\n-----END PRIVATE KEY-----";
    assert.equal(redactPemBlocks(`{"key":"${oneLine}"}`), `{"key":"${REDACTED}"}`);
  });

  it("redacts multiple blocks independently, preserving text between", () => {
    assert.equal(
      redactPemBlocks(`${pemBlock("EC PRIVATE KEY")} and ${pemBlock("PRIVATE KEY")}`),
      `${REDACTED} and ${REDACTED}`,
    );
  });

  it("closes at the block's real END marker, keeping trailing text", () => {
    assert.equal(
      redactPemBlocks(`${pemBlock("OPENSSH PRIVATE KEY")} tail stays`),
      `${REDACTED} tail stays`,
    );
  });

  it("redacts an unterminated (truncated-capture) block to end of input — fail-closed", () => {
    const out = redactPemBlocks(`log line\n-----BEGIN RSA PRIVATE KEY-----\nMIIEfakeTruncated`);
    assert.equal(out, `log line\n${REDACTED}`);
    assert.doesNotMatch(out, /MIIEfake/);
  });

  it("redacts to end of input when the END label does not match the BEGIN label", () => {
    const out = redactPemBlocks(
      `-----BEGIN RSA PRIVATE KEY-----\nMIIEfake==\n-----END PRIVATE KEY-----\ntail material`,
    );
    assert.equal(out, REDACTED);
    assert.doesNotMatch(out, /MIIEfake|tail material/);
  });

  it("an orphan BEGIN closes at the next matching END, swallowing what sits between", () => {
    assert.equal(
      redactPemBlocks(`-----BEGIN PRIVATE KEY-----\nMIIEfake\n${pemBlock("PRIVATE KEY")} tail`),
      `${REDACTED} tail`,
    );
  });

  it("swallows a later differently-labelled block into an earlier orphan BEGIN's fallback", () => {
    const orphan = "-----BEGIN EC PRIVATE KEY-----\nMIIEfake";
    assert.equal(
      redactPemBlocks(`${orphan}\nbetween\n${pemBlock("PGP PRIVATE KEY BLOCK")}\nend`),
      REDACTED,
    );
  });

  it("redacts the four-dash SSH.com/Tectia armor dialect (PuTTYgen export shape)", () => {
    // RFC 4716-style framing: FOUR dashes, spaces around the marker words —
    // unreachable by the five-dash no-space literal, covered by its own
    // sibling regex. Found by the vuln-scan pass on this diff.
    const block =
      "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nComment: exported by puttygen\nMIIEfake+base64==\n---- END SSH2 ENCRYPTED PRIVATE KEY ----";
    assert.equal(redactPemBlocks(`before\n${block}\nafter`), `before\n${REDACTED}\nafter`);
  });

  it("redacts a truncated four-dash SSH2 block to end of input — fail-closed", () => {
    const out = redactPemBlocks(
      "log line\n---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nMIIEfakeTruncated",
    );
    assert.equal(out, `log line\n${REDACTED}`);
    assert.doesNotMatch(out, /MIIEfake/);
  });

  it("leaves four-dash SSH2 PUBLIC key armor untouched", () => {
    const block =
      "---- BEGIN SSH2 PUBLIC KEY ----\nComment: not a secret\nAAAAB3fake==\n---- END SSH2 PUBLIC KEY ----";
    assert.equal(redactPemBlocks(block), block);
  });

  it("leaves certificate and public-key armor untouched (no secret, keep the signal)", () => {
    for (const label of ["CERTIFICATE", "PUBLIC KEY", "RSA PUBLIC KEY", "CERTIFICATE REQUEST"]) {
      const block = pemBlock(label);
      assert.equal(redactPemBlocks(block), block, label);
    }
  });

  it("leaves an END marker with no BEGIN, and prose about private keys, untouched", () => {
    const text =
      "error: expected -----END PRIVATE KEY----- terminator; check your private key file";
    assert.equal(redactPemBlocks(text), text);
  });

  it("stays linear on adversarial marker-dense input (no quadratic blowup)", () => {
    // The strict alternative's lazy body is unbounded — safe, unlike the
    // pre-bound QUOTED_VALUE_INNER, because a strict failure drops into a
    // fallback that consumes to END OF INPUT: the whole input pays at most
    // one futile scan, so there is no restart-per-position quadratic to
    // guard against. Pinned here the same way the two redactNamedSecrets
    // linearity tests pin theirs, with the same deliberately loose budget.
    const orphanDense = "-----BEGIN PRIVATE KEY----- x ".repeat(3000);
    const blockDense = `${pemBlock("PRIVATE KEY")}\n`.repeat(1400);
    const endDense = `-----BEGIN PRIVATE KEY-----${"-----END PRIVATE KEX-----".repeat(3000)}`;
    const started = process.hrtime.bigint();
    const orphanOut = redactPemBlocks(orphanDense);
    const blockOut = redactPemBlocks(blockDense);
    const endOut = redactPemBlocks(endDense);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(orphanOut, REDACTED);
    assert.equal(blockOut, `${REDACTED}\n`.repeat(1400));
    assert.equal(endOut, REDACTED);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });
});

// ---------------------------------------------------------------------------
// redactProviderSecrets — provider-shaped secret VALUES
// ---------------------------------------------------------------------------

describe("redactProviderSecrets", () => {
  it("redacts a GitHub classic/app-style token (ghp_/gho_/ghu_/ghs_/ghr_)", () => {
    for (const prefix of ["ghp", "gho", "ghu", "ghs", "ghr"]) {
      const token = `${prefix}_${"a".repeat(36)}`;
      assert.equal(redactProviderSecrets(`token: ${token}`), `token: ${REDACTED}`);
    }
  });

  it("redacts a GitHub fine-grained PAT (github_pat_...)", () => {
    const token = `github_pat_${"c".repeat(22)}_${"d".repeat(59)}`;
    assert.equal(redactProviderSecrets(token), REDACTED);
  });

  it("redacts an OpenAI-style secret key (sk-...)", () => {
    assert.equal(redactProviderSecrets(`key=sk-${"e".repeat(20)}`), `key=${REDACTED}`);
  });

  it("redacts a Slack token (xox[abprs]-...)", () => {
    for (const kind of ["a", "b", "p", "r", "s"]) {
      const token = `xox${kind}-1234567890-abcdefghij`;
      assert.equal(redactProviderSecrets(`slack ${token}`), `slack ${REDACTED}`);
    }
  });

  it("redacts an AWS access key id (AKIA...)", () => {
    assert.equal(redactProviderSecrets("AKIAABCDEFGHIJKLMNOP"), REDACTED);
  });

  it("redacts a JWT (header.payload.signature starting eyJ)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_abc123";
    assert.equal(redactProviderSecrets(`jwt ${jwt}`), `jwt ${REDACTED}`);
  });

  it("redacts multiple occurrences in one blob (global replace)", () => {
    const a = `ghp_${"a".repeat(36)}`;
    const b = `AKIAABCDEFGHIJKLMNOP`;
    assert.equal(redactProviderSecrets(`${a} and ${b}`), `${REDACTED} and ${REDACTED}`);
  });

  it("leaves ordinary text untouched", () => {
    const text = "no secrets here, just prose about tokens and passwords";
    assert.equal(redactProviderSecrets(text), text);
  });

  it("does not redact a short, non-matching prefix run (below the length floor)", () => {
    const text = "ghp_tooshort";
    assert.equal(redactProviderSecrets(text), text);
  });
});

// ---------------------------------------------------------------------------
// redactNamedSecrets — assignment VALUES for secret-shaped NAMES
// ---------------------------------------------------------------------------

describe("redactNamedSecrets", () => {
  it("redacts a suffix-shaped NAME=value (unquoted)", () => {
    assert.equal(redactNamedSecrets("DB_PASSWORD=hunter2"), "DB_PASSWORD=[REDACTED]");
    assert.equal(redactNamedSecrets("AWS_SECRET_ACCESS_KEY=AKIAABCDEFGHIJKLMNOP"), "AWS_SECRET_ACCESS_KEY=[REDACTED]");
    assert.equal(redactNamedSecrets("MY_API_TOKEN=xyz"), "MY_API_TOKEN=[REDACTED]");
    assert.equal(redactNamedSecrets("CLIENT_SECRET=xyz"), "CLIENT_SECRET=[REDACTED]");
    assert.equal(redactNamedSecrets("USER_ID=42"), "USER_ID=[REDACTED]");
  });

  it("redacts a bare secret-shaped NAME (PASSWORD/SECRET/TOKEN/APIKEY/API_KEY)", () => {
    assert.equal(redactNamedSecrets("PASSWORD=hunter2"), "PASSWORD=[REDACTED]");
    assert.equal(redactNamedSecrets("SECRET=hunter2"), "SECRET=[REDACTED]");
    assert.equal(redactNamedSecrets("TOKEN=hunter2"), "TOKEN=[REDACTED]");
    assert.equal(redactNamedSecrets("APIKEY=hunter2"), "APIKEY=[REDACTED]");
    assert.equal(redactNamedSecrets("API_KEY=hunter2"), "API_KEY=[REDACTED]");
  });

  it("redacts NAME: value (colon separator, YAML/JSON-ish)", () => {
    assert.equal(redactNamedSecrets("password: hunter2"), "password: [REDACTED]");
  });

  it("redacts a quoted value, preserving the quote characters", () => {
    assert.equal(redactNamedSecrets('TOKEN="hunter2"'), 'TOKEN="[REDACTED]"');
    assert.equal(redactNamedSecrets("TOKEN='hunter2'"), "TOKEN='[REDACTED]'");
  });

  it("redacts a quoted NAME (JSON key form), preserving name + its quote", () => {
    assert.equal(redactNamedSecrets('{"api_key": "my-secret-value"}'), '{"api_key": "[REDACTED]"}');
    assert.equal(redactNamedSecrets('{"GITHUB_TOKEN":"plainvalue"}'), '{"GITHUB_TOKEN":"[REDACTED]"}');
    assert.equal(redactNamedSecrets("'client_secret': 'abc'"), "'client_secret': '[REDACTED]'");
  });

  it("is case-insensitive on the name", () => {
    assert.equal(redactNamedSecrets("Db_Password=hunter2"), "Db_Password=[REDACTED]");
    assert.equal(redactNamedSecrets("apiKey=hunter2"), "apiKey=[REDACTED]");
  });

  it("keeps the NAME itself, redacting only the value", () => {
    const out = redactNamedSecrets("GITHUB_TOKEN=hunter2");
    assert.match(out, /^GITHUB_TOKEN=/);
    assert.doesNotMatch(out, /hunter2/);
  });

  it("redacts every occurrence in one blob (global replace)", () => {
    assert.equal(
      redactNamedSecrets("A_TOKEN=one B_SECRET=two"),
      "A_TOKEN=[REDACTED] B_SECRET=[REDACTED]",
    );
  });

  it("does not redact a name that isn't secret-shaped", () => {
    const text = "REQUEST_COUNT=5, STATUS: ok";
    assert.equal(redactNamedSecrets(text), text);
  });

  it("redacts a digit-leading suffix-shaped NAME (skills#507)", () => {
    assert.equal(redactNamedSecrets("2FA_TOKEN=abcd1234efgh5678"), "2FA_TOKEN=[REDACTED]");
    assert.equal(
      redactNamedSecrets("1PASSWORD_SERVICE_ACCOUNT_TOKEN=my-real-secret-value"),
      "1PASSWORD_SERVICE_ACCOUNT_TOKEN=[REDACTED]",
    );
    assert.equal(redactNamedSecrets("9CLIENT_SECRET=super-secret-value-here"), "9CLIENT_SECRET=[REDACTED]");
  });

  it("fully redacts a multi-word unquoted value, not just its first token (skills#493)", () => {
    assert.equal(redactNamedSecrets("PASSWORD=my secret pass"), "PASSWORD=[REDACTED]");
    assert.equal(
      redactNamedSecrets("DB_PASSWORD=correct horse battery staple"),
      "DB_PASSWORD=[REDACTED]",
    );
    assert.doesNotMatch(redactNamedSecrets("PASSWORD=my secret pass"), /secret pass/);
  });

  it("fully redacts a long whitespace-free unquoted value with no length cap", () => {
    // The multi-word fix must not introduce a length limit on the
    // previously-unbounded whitespace-free case — a >255-char single-token
    // value (well past any earlier length-based guard considered here)
    // still redacts in full, with no trailing plaintext fragment.
    const longValue = "a".repeat(300);
    const out = redactNamedSecrets(`PASSWORD=${longValue}`);
    assert.equal(out, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(out, /a{10}/);
  });

  it("redacts multi-word unquoted values independently when two assignments share a line", () => {
    assert.equal(
      redactNamedSecrets("A_TOKEN=hello world B_SECRET=another value"),
      "A_TOKEN=[REDACTED] B_SECRET=[REDACTED]",
    );
  });

  it("does not stop early when a non-assignment word inside the value merely looks like a secret name", () => {
    // "token" appears mid-value but isn't followed by a `:`/`=` separator,
    // so it must not be mistaken for the start of a new assignment.
    assert.equal(redactNamedSecrets("PASSWORD=my token is safe"), "PASSWORD=[REDACTED]");
  });

  it("still stops an unquoted multi-word value at a comma", () => {
    assert.equal(
      redactNamedSecrets("PASSWORD=hello, unrelated text"),
      "PASSWORD=[REDACTED], unrelated text",
    );
  });

  it("does not swallow a trailing newline into the redacted value", () => {
    assert.equal(redactNamedSecrets("TOKEN=hunter2\n"), "TOKEN=[REDACTED]\n");
    assert.equal(
      redactNamedSecrets("PASSWORD=my secret pass\nnext line untouched"),
      "PASSWORD=[REDACTED]\nnext line untouched",
    );
  });

  it("fully redacts an unquoted value containing an apostrophe/contraction (skills#493 follow-up)", () => {
    const out = redactNamedSecrets("PASSWORD=don't share this");
    assert.equal(out, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(out, /share this/);
    assert.equal(
      redactNamedSecrets("PASSWORD=it's a secret value here"),
      "PASSWORD=[REDACTED]",
    );
  });

  it("fully redacts a double-quoted value containing an embedded apostrophe", () => {
    const out = redactNamedSecrets(`{"api_key": "user's real api key is abc123xyz"}`);
    assert.equal(out, `{"api_key": "[REDACTED]"}`);
    assert.doesNotMatch(out, /abc123xyz/);
  });

  it("redacts two quoted assignments on one line independently (lazy backreference doesn't overrun)", () => {
    assert.equal(
      redactNamedSecrets(`A_TOKEN="one" B_SECRET="two"`),
      `A_TOKEN="[REDACTED]" B_SECRET="[REDACTED]"`,
    );
  });

  it("does not end a quoted value at a quote interior to it (review follow-up)", () => {
    // The lazy backreference closed on the FIRST subsequent same-type quote,
    // even one sitting inside the value — redacting only up to it and
    // copying the rest of the live secret through. Same partial-leak class
    // as skills#493, surviving in the quoted branch.
    const apostrophe = redactNamedSecrets(`PASSWORD='don't share this xyz`);
    assert.equal(apostrophe, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(apostrophe, /share this xyz/);

    // `'tis the season` (covered below) was one apostrophe from failing.
    const contraction = redactNamedSecrets(`PASSWORD='tis the season's end`);
    assert.equal(contraction, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(contraction, /season|end/);

    // JSON-encoded tool output — the escaped `\"` is content, not a closer.
    const jsonEscaped = redactNamedSecrets(`{"db_password":"p@ss\\"real"}`);
    assert.equal(jsonEscaped, `{"db_password":"[REDACTED]"}`);
    assert.doesNotMatch(jsonEscaped, /real/);

    // ...and when a delimiter follows the escaped quote, so the closing-quote
    // boundary check alone would have accepted it as a terminator.
    const escapedThenSpace = redactNamedSecrets(`{"db_password":"p@ss\\" real"}`);
    assert.equal(escapedThenSpace, `{"db_password":"[REDACTED]"}`);
    assert.doesNotMatch(escapedThenSpace, /real/);
  });

  it("still closes at the value's real terminating quote past an interior one", () => {
    // Not merely a fail-over to the redact-to-end-of-line fallback: when a
    // real closing quote does exist further along, the strict alternative
    // finds it and the text after the value survives.
    assert.equal(redactNamedSecrets(`PASSWORD='don't share this'`), "PASSWORD='[REDACTED]'");
    assert.equal(
      redactNamedSecrets(`{"api_key": "it's a \\"quoted\\" secret", "n": 1}`),
      `{"api_key": "[REDACTED]", "n": 1}`,
    );
  });

  it("accepts a closing quote only before a real delimiter, redacting to end of line otherwise", () => {
    // Every delimiter the boundary check treats as a real terminator...
    assert.equal(redactNamedSecrets(`TOKEN="a" tail`), `TOKEN="[REDACTED]" tail`);
    assert.equal(redactNamedSecrets(`TOKEN="a",tail`), `TOKEN="[REDACTED]",tail`);
    assert.equal(redactNamedSecrets(`TOKEN="a";tail`), `TOKEN="[REDACTED]";tail`);
    assert.equal(redactNamedSecrets(`{"token":"a"}`), `{"token":"[REDACTED]"}`);
    assert.equal(redactNamedSecrets(`[TOKEN="a"]`), `[TOKEN="[REDACTED]"]`);
    assert.equal(redactNamedSecrets(`fn(PASSWORD="a")`), `fn(PASSWORD="[REDACTED]")`);
    assert.equal(redactNamedSecrets(`TOKEN="a"\ntail`), `TOKEN="[REDACTED]"\ntail`);
    assert.equal(redactNamedSecrets(`TOKEN="a"`), `TOKEN="[REDACTED]"`);

    // ...and anything else is treated as interior, so the value falls to the
    // redact-to-end-of-line fallback. Over-redaction is the fail-closed side
    // of that trade: a scrubber must not stop short of a live secret.
    assert.equal(redactNamedSecrets(`TOKEN="abc"def`), "TOKEN=[REDACTED]");
  });

  it("still redacts a value that looks quoted but has no closing quote (truncated capture)", () => {
    assert.equal(redactNamedSecrets(`PASSWORD="truncated mid val`), "PASSWORD=[REDACTED]");
    assert.doesNotMatch(redactNamedSecrets(`PASSWORD="truncated mid val`), /truncated/);
    assert.equal(redactNamedSecrets(`PASSWORD='tis the season`), "PASSWORD=[REDACTED]");
  });

  it("stops a malformed (unclosed) quoted value before a real assignment that follows it on the same line", () => {
    assert.equal(
      redactNamedSecrets(`PASSWORD="unclosed val TOKEN=abc`),
      "PASSWORD=[REDACTED] TOKEN=[REDACTED]",
    );
    // ...even when the unclosed value itself contains a comma, which must
    // NOT end the value (see below) but also must not defeat the lookahead.
    assert.equal(
      redactNamedSecrets(`PASSWORD="unclosed, val TOKEN=abc`),
      "PASSWORD=[REDACTED] TOKEN=[REDACTED]",
    );
  });

  it("does not stop a malformed (unclosed) quoted value at a comma or semicolon", () => {
    // Inside a quoted value a `,`/`;` is content, not a delimiter — so the
    // truncated-capture fallback must consume past it. Stopping there
    // reproduced the exact partial-leak class skills#493 closes.
    const comma = redactNamedSecrets(`PASSWORD="my secret, more secret`);
    assert.equal(comma, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(comma, /more secret/);

    const semi = redactNamedSecrets(`PASSWORD="my secret; more secret`);
    assert.equal(semi, "PASSWORD=[REDACTED]");
    assert.doesNotMatch(semi, /more secret/);

    const single = redactNamedSecrets(`API_KEY='abc, def; ghi`);
    assert.equal(single, "API_KEY=[REDACTED]");
    assert.doesNotMatch(single, /def|ghi/);
  });

  it("keeps a malformed quoted value inside its own line", () => {
    // Widening past `,`/`;` must not widen past CRLF.
    assert.equal(
      redactNamedSecrets(`PASSWORD="unclosed, val\nnext line untouched`),
      "PASSWORD=[REDACTED]\nnext line untouched",
    );
  });

  it("still closes a properly quoted value at its closing quote, commas and all", () => {
    // The strict alternative is tried first, so a value that DOES close
    // keeps its trailing text — the fallback's widening only applies when
    // no closing quote exists.
    assert.equal(
      redactNamedSecrets(`PASSWORD="my secret, more secret" trailing`),
      `PASSWORD="[REDACTED]" trailing`,
    );
  });

  it("stays linear on a long whitespace run after an unclosed quote (no quadratic blowup)", () => {
    // The malformed-quoted fallback used to consume one character at a
    // time, so NEXT_ASSIGNMENT_LOOKAHEAD's leading `\s+` was re-attempted
    // at every position of a whitespace run and backtracked across the
    // whole remaining run each time — O(run²) on untrusted, not-yet-
    // truncated input (scrub() caps length LAST). Consuming whole runs
    // makes it linear.
    //
    // The budget is deliberately loose: the fixed pattern handles this in
    // well under 10ms even on a loaded CI runner, while the quadratic form
    // took multiple seconds at this size, so the margin absorbs any
    // realistic scheduling noise without turning the assertion into a
    // flake.
    const input = `PASSWORD="${" ".repeat(50_000)}`;
    const started = process.hrtime.bigint();
    const out = redactNamedSecrets(input);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(out, "PASSWORD=[REDACTED]");
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });

  it("stays linear on repeated quote-opened values with no acceptable closer (no quadratic blowup)", () => {
    // The sibling test above pins the MALFORMED branch; this pins the STRICT
    // quoted one, which had its own quadratic left open. Its lazy inner was
    // unbounded, so on a line where no same-type quote is followed by a
    // QUOTED_VALUE_CLOSE delimiter it scanned to end of line before failing
    // — and it did that once per assignment on the line, because the
    // malformed fallback that catches the failure advances the scan position
    // by only a couple of characters. n restarts of an O(n) scan is O(n²),
    // again on untrusted, not-yet-truncated input (scrub() caps length LAST).
    // Bounding the inner repetition caps each futile scan instead.
    //
    // Measured on the unbounded form, quadrupling per doubling of input:
    // 159ms at 24 KB, 620ms at 48 KB, 2500ms at 96 KB. Bounded: 5ms / 9ms /
    // 19ms. Same deliberately loose 1000ms budget as the sibling test above.
    const units = 8_000;
    const input = `PASSWORD="a `.repeat(units);
    const started = process.hrtime.bigint();
    const out = redactNamedSecrets(input);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    // Every assignment redacts independently; the final one additionally
    // swallows the trailing space, since no assignment follows it to stop at.
    assert.equal(out, Array(units).fill("PASSWORD=[REDACTED]").join(" "));
    assert.doesNotMatch(out, /"a/);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });

  it("over-redacts, never under-redacts, a quoted value past the inner length bound", () => {
    // The bound that makes the strict alternative linear (above) is safe
    // precisely because overflowing it makes that alternative FAIL rather
    // than match short: the value falls through to the redact-to-end-of-line
    // fallback, so the bound can only widen a redaction. That is the
    // opposite of the length cap tried and rejected on the unquoted-value
    // alternative earlier in this PR, which truncated the redacted span
    // itself and copied the tail through in cleartext.
    const long = "s".repeat(300);
    const over = redactNamedSecrets(`TOKEN="${long}" tail`);
    assert.equal(over, "TOKEN=[REDACTED]"); // ` tail` over-redacted, nothing leaked
    assert.doesNotMatch(over, /s{5}/);

    // At the bound the value still closes normally, keeping its trailing text.
    assert.equal(redactNamedSecrets(`TOKEN="${"s".repeat(255)}" tail`), `TOKEN="[REDACTED]" tail`);

    // The bound counts inner units, not characters — a backslash-escape pair
    // is one unit, so 255 escaped pairs (510 characters) still closes.
    assert.equal(redactNamedSecrets(`TOKEN="${"\\a".repeat(255)}" tail`), `TOKEN="[REDACTED]" tail`);
  });

  it("redacts the same span whether or not the value runs through whitespace", () => {
    // Consuming whole runs instead of single characters must not move the
    // stop position: an unclosed value still swallows its internal spaces
    // and still stops before a real assignment further along the line,
    // including when several spaces separate the two.
    assert.equal(
      redactNamedSecrets(`PASSWORD="my  secret   value`),
      "PASSWORD=[REDACTED]",
    );
    assert.equal(
      redactNamedSecrets(`PASSWORD="unclosed   val    TOKEN=abc`),
      "PASSWORD=[REDACTED]    TOKEN=[REDACTED]",
    );
    assert.doesNotMatch(redactNamedSecrets(`PASSWORD="my  secret   value`), /secret/);
  });

  it("leaves ordinary prose untouched", () => {
    const text = "the request took 5 seconds and returned ok";
    assert.equal(redactNamedSecrets(text), text);
  });
});

// ---------------------------------------------------------------------------
// redactHttpCredentialHeaders — Authorization / Cookie / Set-Cookie VALUES
// ---------------------------------------------------------------------------

describe("redactHttpCredentialHeaders", () => {
  it("redacts an Authorization header, keeping the header name", () => {
    for (const scheme of ["Bearer", "Basic", "Digest", "Token", "Negotiate", "AWS4-HMAC-SHA256"]) {
      assert.equal(
        redactHttpCredentialHeaders(`Authorization: ${scheme} abc123xyz`),
        `Authorization: ${REDACTED}`,
        scheme,
      );
    }
  });

  it("is case-insensitive on the header name", () => {
    assert.equal(
      redactHttpCredentialHeaders("authorization: bearer abc123"),
      "authorization: [REDACTED]",
    );
    assert.equal(
      redactHttpCredentialHeaders("AUTHORIZATION: Bearer abc123"),
      "AUTHORIZATION: [REDACTED]",
    );
    assert.equal(redactHttpCredentialHeaders("cookie: session=abc"), "cookie: [REDACTED]");
    assert.equal(
      redactHttpCredentialHeaders("Set-COOKIE: session=abc"),
      "Set-COOKIE: [REDACTED]",
    );
  });

  it("redacts a Cookie header's ENTIRE value, not just the first name=value pair", () => {
    // A Cookie header packs multiple pairs separated by `;` — every pair is
    // part of the same credential, unlike a comma in redactNamedSecrets'
    // UNQUOTED_VALUE (which legitimately terminates a value there). Stopping
    // at the first `;` would leak every pair after it.
    assert.equal(
      redactHttpCredentialHeaders("Cookie: session=abc123; csrftoken=xyz789"),
      "Cookie: [REDACTED]",
    );
    assert.doesNotMatch(
      redactHttpCredentialHeaders("Cookie: session=abc123; csrftoken=xyz789"),
      /xyz789/,
    );
  });

  it("redacts a Set-Cookie header's full value, attributes included", () => {
    assert.equal(
      redactHttpCredentialHeaders("Set-Cookie: sid=abc123; Path=/; HttpOnly; Secure"),
      "Set-Cookie: [REDACTED]",
    );
  });

  it("redacts a Digest Authorization value's every param, including the trailing response hash", () => {
    // A Digest value packs comma-separated key="value" params — the
    // response hash (the actual credential) sits LAST. Stopping early on
    // any internal comma/quote would leak exactly that.
    const out = redactHttpCredentialHeaders(
      `Authorization: Digest username="foo", realm="bar", nonce="baz", response="secrethash123"`,
    );
    assert.equal(out, "Authorization: [REDACTED]");
    assert.doesNotMatch(out, /secrethash123/);
  });

  it("redacts a JSON-quoted key + JSON-quoted value, preserving quotes and sibling fields", () => {
    assert.equal(
      redactHttpCredentialHeaders('{"Authorization": "Bearer abc123", "other": "value"}'),
      '{"Authorization": "[REDACTED]", "other": "value"}',
    );
    assert.equal(
      redactHttpCredentialHeaders(`{"Cookie":"session=abc123","ok":true}`),
      `{"Cookie":"[REDACTED]","ok":true}`,
    );
  });

  it("redacts a single-quoted value", () => {
    assert.equal(
      redactHttpCredentialHeaders("Cookie: 'session=abc123'"),
      "Cookie: '[REDACTED]'",
    );
  });

  it("still redacts a value that looks quoted but never closes (truncated capture)", () => {
    const out = redactHttpCredentialHeaders('Authorization: "Bearer truncated mid val');
    assert.equal(out, "Authorization: [REDACTED]");
    assert.doesNotMatch(out, /truncated/);
  });

  it("redacts every occurrence independently when real CRLF separates them", () => {
    assert.equal(
      redactHttpCredentialHeaders(
        "Authorization: Bearer abc123\nCookie: session=xyz789\nContent-Type: json",
      ),
      "Authorization: [REDACTED]\nCookie: [REDACTED]\nContent-Type: json",
    );
  });

  it("swallows an undelimited trailing tail into the redacted span (same trade-off as redactNamedSecrets)", () => {
    // No real CRLF between the credential and what follows on the same
    // line — the unquoted branch runs to end of input rather than guess
    // where the credential "should" stop. Fail-closed and deliberate, same
    // as the sibling scrub.test.mjs case for redactNamedSecrets.
    const out = redactHttpCredentialHeaders("Authorization: Bearer abc123 more prose after");
    assert.equal(out, "Authorization: [REDACTED]");
    assert.doesNotMatch(out, /more prose/);
  });

  it("leaves ordinary prose untouched (no colon after the word)", () => {
    const text = "Authorization required before you can proceed";
    assert.equal(redactHttpCredentialHeaders(text), text);
  });

  it("leaves a header with no value untouched (nothing to redact)", () => {
    assert.equal(redactHttpCredentialHeaders("Cookie:"), "Cookie:");
  });

  it("leaves a non-credential header name untouched", () => {
    const text = "Content-Type: application/json";
    assert.equal(redactHttpCredentialHeaders(text), text);
  });

  it("does not match when the name is a substring of a longer identifier (word boundary)", () => {
    assert.equal(
      redactHttpCredentialHeaders("MyAuthorization: Bearer abc123"),
      "MyAuthorization: Bearer abc123",
    );
    // Suffix-shaped names are redactNamedSecrets' job (NAME_ALT's `_TOKEN`
    // suffix), not this pass' — "authorization_token" has no `\b` right
    // after "Authorization" (the underscore is a word character).
    assert.equal(
      redactHttpCredentialHeaders("authorization_token=abc123"),
      "authorization_token=abc123",
    );
  });

  it("redacts hyphen-prefixed variants like Proxy-Authorization (the boundary fires after `-`)", () => {
    // `-` is a non-word character, so `\bAuthorization\b` DOES match inside
    // `Proxy-Authorization` — RFC 7235 §4.4's header shares `Authorization`'s
    // grammar and is already covered by this pass without naming it in
    // HTTP_CRED_HEADER_NAME. The complement of the `MyAuthorization` case
    // above (`y` is a word character, so no boundary, so no match); pinned so
    // a future tightening of the name pattern can't silently drop it.
    assert.equal(
      redactHttpCredentialHeaders("Proxy-Authorization: Basic dXNlcjpwYXNz"),
      "Proxy-Authorization: [REDACTED]",
    );
    assert.equal(
      redactHttpCredentialHeaders("proxy-authorization: Bearer abc123"),
      "proxy-authorization: [REDACTED]",
    );
  });

  it("stays linear on a long whitespace-free unquoted value (no quadratic blowup)", () => {
    const input = `Authorization: ${"a".repeat(50_000)}`;
    const started = process.hrtime.bigint();
    const out = redactHttpCredentialHeaders(input);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(out, "Authorization: [REDACTED]");
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });

  it("stays linear on repeated quote-opened values with no acceptable closer (no quadratic blowup)", () => {
    // Same shape as ASSIGNMENT_RE's sibling linearity test: the strict
    // quoted alternative's 255-unit bound caps each failed attempt, so the
    // unquoted fallback runs once per occurrence rather than re-scanning.
    const units = 3000;
    const input = `Authorization: "a `.repeat(units);
    const started = process.hrtime.bigint();
    const out = redactHttpCredentialHeaders(input);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(out, "Authorization: [REDACTED]");
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });

  it("stays linear on many repeated headers across real newlines (no quadratic blowup)", () => {
    const units = 500;
    const input = `Authorization: ${"x".repeat(2000)}\n`.repeat(units);
    const started = process.hrtime.bigint();
    const out = redactHttpCredentialHeaders(input);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(out, `Authorization: ${REDACTED}\n`.repeat(units));
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });
});

// ---------------------------------------------------------------------------
// redactUrlCredentials — userinfo of scheme://user:pass@host
// ---------------------------------------------------------------------------

describe("redactUrlCredentials", () => {
  it("redacts user:pass in a connection-string URL, keeping scheme and host", () => {
    assert.equal(
      redactUrlCredentials("postgres://user:pass@host/db"),
      `postgres://${REDACTED}@host/db`,
    );
  });

  it("redacts an empty-username credential (redis://:pass@host)", () => {
    // The username run is `*`, not `+` — requiring a non-empty username
    // (as the issue's own recommended regex did) leaks this whole shape.
    assert.equal(
      redactUrlCredentials("redis://:hunter2@host:6379/0"),
      `redis://${REDACTED}@host:6379/0`,
    );
  });

  it("redacts the username too — real credentials ride in the username slot", () => {
    assert.equal(
      redactUrlCredentials("https://sometoken99:x-oauth-basic@github.com/o/r.git"),
      `https://${REDACTED}@github.com/o/r.git`,
    );
    assert.doesNotMatch(
      redactUrlCredentials("https://oauth2:fake-token-value@gitlab.example/x"),
      /oauth2|fake-token/,
    );
  });

  it("redacts a password containing raw : and @ through to the last @", () => {
    assert.equal(
      redactUrlCredentials("mysql://root:p@ss:w@rd@db.internal:3306/app"),
      `mysql://${REDACTED}@db.internal:3306/app`,
    );
  });

  it("redacts an empty password when the colon is present", () => {
    assert.equal(redactUrlCredentials("ftp://user:@host/x"), `ftp://${REDACTED}@host/x`);
  });

  it("redacts schemes containing + . - (svn+ssh, mongodb+srv)", () => {
    assert.equal(
      redactUrlCredentials("mongodb+srv://u:p@cluster0.example.net/db"),
      `mongodb+srv://${REDACTED}@cluster0.example.net/db`,
    );
    assert.equal(
      redactUrlCredentials("svn+ssh://u:p@svn.host/repo"),
      `svn+ssh://${REDACTED}@svn.host/repo`,
    );
  });

  it("redacts credentials in front of an IPv6 host", () => {
    assert.equal(
      redactUrlCredentials("http://u:p@[::1]:8080/x"),
      `http://${REDACTED}@[::1]:8080/x`,
    );
  });

  it("redacts every occurrence in one blob (global replace)", () => {
    assert.equal(
      redactUrlCredentials("postgres://a:b@h1/x and redis://:c@h2"),
      `postgres://${REDACTED}@h1/x and redis://${REDACTED}@h2`,
    );
  });

  it("redacts inside JSON-encoded tool output", () => {
    assert.equal(
      redactUrlCredentials('{"url":"postgres://u:p@h/db"}'),
      `{"url":"postgres://${REDACTED}@h/db"}`,
    );
  });

  it("leaves a colon-less userinfo untouched (plain username, e.g. ssh://git@...)", () => {
    const text = "ssh://git@github.com/o/r.git";
    assert.equal(redactUrlCredentials(text), text);
  });

  it("leaves credential-free URLs untouched, including port, query-@ and path-@ shapes", () => {
    // `/`, `?`, `#` hard-terminate a URL's authority (RFC 3986), so
    // excluding them from the userinfo runs is what keeps a later `@` in a
    // path/query from reading as a credential.
    for (const text of [
      "https://example.com:8080/path",
      "https://host:8080?err=a@b.c",
      "https://medium.example:443/@user/post",
      "http://localhost:3000",
      "file:///C:/temp/x.txt",
      "http://[::1]:8080/health",
      "contact a@b.example by mail",
      "the ratio is 12:30@60Hz",
    ]) {
      assert.equal(redactUrlCredentials(text), text, text);
    }
  });

  it("stays linear on adversarial input (no quadratic blowup)", () => {
    // Structural linearity: the first colon is the deterministic
    // user/password split, and the password run excludes `/` — so any
    // later `scheme://` start necessarily embeds slashes that stop the
    // previous run, bounding total work at O(input). Same loose budget as
    // the sibling linearity tests.
    const noAt = `postgres://user:${"b".repeat(50_000)}`;
    const schemeDense = "a://b:".repeat(8_000);
    const started = process.hrtime.bigint();
    const noAtOut = redactUrlCredentials(noAt);
    const schemeDenseOut = redactUrlCredentials(schemeDense);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(noAtOut, noAt); // no @ terminator anywhere — nothing to redact
    assert.equal(schemeDenseOut, schemeDense);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs.toFixed(1)}ms — expected linear-time matching`);
  });
});

// ---------------------------------------------------------------------------
// rewriteHomePaths — $HOME-absolute paths → ~-relative
// ---------------------------------------------------------------------------

describe("rewriteHomePaths", () => {
  it("rewrites a $HOME-absolute path to ~-relative", () => {
    assert.equal(
      rewriteHomePaths(`path is ${FAKE_HOME}/work/eva/file.txt`, FAKE_HOME),
      "path is ~/work/eva/file.txt",
    );
  });

  it("rewrites the bare home dir with nothing after it", () => {
    assert.equal(rewriteHomePaths(`cwd=${FAKE_HOME}`, FAKE_HOME), "cwd=~");
  });

  it("rewrites every occurrence in one blob (global replace)", () => {
    assert.equal(
      rewriteHomePaths(`${FAKE_HOME}/a and ${FAKE_HOME}/b`, FAKE_HOME),
      "~/a and ~/b",
    );
  });

  it("does not rewrite a longer sibling directory name (right-boundary guard)", () => {
    const text = `${FAKE_HOME}2/other`;
    assert.equal(rewriteHomePaths(text, FAKE_HOME), text);
  });

  it("does not rewrite when the match isn't at a proper left path boundary", () => {
    // "banana" + FAKE_HOME's basename-shaped suffix is a coincidental
    // substring, not an actual occurrence of the home path — the char right
    // before the match must not be alphanumeric.
    const text = `banana${FAKE_HOME}/file`;
    assert.equal(rewriteHomePaths(text, FAKE_HOME), text);
  });

  it("returns text unchanged when home is falsy (empty/undefined)", () => {
    const text = `path ${FAKE_HOME}/file`;
    assert.equal(rewriteHomePaths(text, ""), text);
    assert.equal(rewriteHomePaths(text, undefined), text);
  });

  it("escapes regex-special characters in the home path", () => {
    const home = "/tmp/scrub(fixture)+home";
    assert.equal(rewriteHomePaths(`${home}/file`, home), "~/file");
  });
});

// ---------------------------------------------------------------------------
// truncateScrubbed — cap at MAX_CODEPOINTS with a truncation marker
// ---------------------------------------------------------------------------

describe("truncateScrubbed", () => {
  it("leaves text at or under the limit unchanged", () => {
    const text = "a".repeat(MAX_CODEPOINTS);
    assert.equal(truncateScrubbed(text), text);
    assert.equal(truncateScrubbed("short"), "short");
  });

  it("truncates text over the limit and appends the marker", () => {
    const text = "a".repeat(MAX_CODEPOINTS + 50);
    const out = truncateScrubbed(text);
    assert.equal(out, "a".repeat(MAX_CODEPOINTS) + TRUNCATION_MARKER);
  });

  it("counts Unicode code points, not UTF-16 units (surrogate-pair safe)", () => {
    // 😀 is a surrogate pair (2 UTF-16 units, 1 code point).
    const text = "😀".repeat(MAX_CODEPOINTS + 10);
    const out = truncateScrubbed(text);
    assert.equal([...out.replace(TRUNCATION_MARKER, "")].length, MAX_CODEPOINTS);
    assert.ok(out.endsWith(TRUNCATION_MARKER));
  });

  it("respects a custom limit", () => {
    assert.equal(truncateScrubbed("abcdef", 3), "abc" + TRUNCATION_MARKER);
    assert.equal(truncateScrubbed("abc", 3), "abc");
  });
});

// ---------------------------------------------------------------------------
// scrub — composite transform
// ---------------------------------------------------------------------------

describe("scrub", () => {
  it("throws a TypeError on non-string input", () => {
    assert.throws(() => scrub(123), TypeError);
    assert.throws(() => scrub(null), TypeError);
    assert.throws(() => scrub(undefined), TypeError);
  });

  it("applies redaction, home-path rewrite, and truncation together, in order", () => {
    const token = `ghp_${"a".repeat(36)}`;
    // Comma-delimited from the trailing path (not "at <path>" with no
    // delimiter): now that redactNamedSecrets's unquoted-value match
    // spans internal whitespace (skills#493), "token=" is itself
    // NAME_ALT-shaped (bare "TOKEN"), so undelimited trailing prose after
    // the already-redacted marker would be swallowed into the same match
    // with no boundary to stop at — the comma is a realistic delimiter
    // (log/KV-style output) that keeps this test's actual intent (pipeline
    // ordering) independent of that unrelated redaction-width fix.
    const input = `token=${token}, path ${FAKE_HOME}/work`;
    const out = scrub(input, { home: FAKE_HOME });
    assert.equal(out, `token=${REDACTED}, path ~/work`);
  });

  it("swallows an undelimited trailing tail — including a $HOME path — into the redacted span", () => {
    // The flip side of the skills#493 widening, pinned explicitly rather
    // than left implicit in the reworked fixture above. With NO delimiter
    // between the secret and the prose that follows it, the unquoted-value
    // match runs to end of line, so the tail is REMOVED by redaction
    // rather than surviving to be rewritten by rewriteHomePaths. That is
    // fail-closed and deliberate — redaction must not under-match a secret
    // whose value happens to contain spaces — but it does mean a
    // diagnostic tail on such a line is lost, and it means home-path
    // rewriting IS observably affected in composite use even though
    // rewriteHomePaths itself is untouched. Locked down so a future
    // narrowing of the match has to confront this trade-off explicitly.
    const token = `ghp_${"a".repeat(36)}`;
    const out = scrub(`token=${token} at ${FAKE_HOME}/work`, { home: FAKE_HOME });
    assert.equal(out, `token=${REDACTED}`);
    assert.doesNotMatch(out, /work/);

    // Same shape without a secret-shaped VALUE: the diagnostic tail after
    // a secret-shaped NAME is swallowed too.
    assert.equal(scrub("run_id: 7f3a failed status 500", { home: FAKE_HOME }), `run_id: ${REDACTED}`);
    // A delimiter is what preserves the tail.
    assert.equal(
      scrub("run_id: 7f3a failed, status 500", { home: FAKE_HOME }),
      `run_id: ${REDACTED}, status 500`,
    );
  });

  it("redacts a secret fully even when its span crosses the truncation boundary", () => {
    const secretBody = "a".repeat(36);
    const token = `ghp_${secretBody}`; // 40 chars, straddles MAX_CODEPOINTS if unredacted
    const padding = "x".repeat(MAX_CODEPOINTS - 10);
    const input = `${padding} ${token} more-padding-after`;
    const out = scrub(input, { home: FAKE_HOME });
    // Redaction runs before truncation, so no raw fragment of the secret —
    // not even a partial one sliced by the 500-code-point cutoff — can ever
    // reach the output. (The short "[REDACTED]" marker itself may still get
    // sliced by truncation; that's cosmetic, not a leak, since it carries no
    // secret material.)
    assert.doesNotMatch(out, /ghp_/);
    assert.ok(!out.includes(secretBody));
  });

  it("redacts a PEM block via the composite pipeline, before named-assignment slicing", () => {
    // The PEM pass runs FIRST: on this line-scoped assignment,
    // redactNamedSecrets alone would have taken just the `-----BEGIN
    // ...-----` marker line as TLS_KEY's value and left every body line
    // below it leaking.
    assert.equal(
      scrub(`TLS_KEY: ${pemBlock("RSA PRIVATE KEY")}\ndone`, { home: FAKE_HOME }),
      `TLS_KEY: ${REDACTED}\ndone`,
    );
  });

  it("redacts URL credentials via the composite pipeline (NAME_ALT-less names)", () => {
    // `DATABASE_URL` matches no NAME_ALT suffix, so the named pass skips
    // the line entirely — the URL pass is the only thing standing between
    // this credential and the persisted capture.
    assert.equal(
      scrub("DATABASE_URL=postgres://admin:hunter2@db.prod.internal:5432/app", {
        home: FAKE_HOME,
      }),
      `DATABASE_URL=postgres://${REDACTED}@db.prod.internal:5432/app`,
    );
  });

  it("redacts an Authorization/Cookie header via the composite pipeline (NAME_ALT-less names)", () => {
    // Neither `Authorization` nor `Cookie` is NAME_ALT-shaped, so
    // redactNamedSecrets alone skips them — the new HTTP-credential-header
    // pass is what closes this gap (CWE-200, skills#544).
    assert.equal(
      scrub("Authorization: Bearer ghp_abc123\ndone", { home: FAKE_HOME }),
      `Authorization: ${REDACTED}\ndone`,
    );
    assert.equal(
      scrub("Cookie: session=abc123; csrftoken=xyz789\ndone", { home: FAKE_HOME }),
      `Cookie: ${REDACTED}\ndone`,
    );
  });

  it("redacts a PEM block fully even when it straddles the truncation boundary", () => {
    // Redaction runs before truncation (see the pipeline-order test above),
    // so no armor fragment — marker or body — can survive the cutoff.
    const padding = "x".repeat(MAX_CODEPOINTS - 10);
    const out = scrub(`${padding}\n${pemBlock("PRIVATE KEY")}`, { home: FAKE_HOME });
    assert.doesNotMatch(out, /MIIEfake|PRIVATE KEY/);
  });

  it("defaults opts to {} and home to the real OS homedir when not given", () => {
    // No opts at all — exercises the `opts = {}` default and the `opts.home
    // ?? homedir()` branch that falls through to the real homedir().
    const out = scrub("plain text, no secrets, no home paths");
    assert.equal(out, "plain text, no secrets, no home paths");
  });

  it("uses an explicit opts.home over the real OS homedir", () => {
    const out = scrub(`at ${FAKE_HOME}/x`, { home: FAKE_HOME });
    assert.equal(out, "at ~/x");
  });
});

// ---------------------------------------------------------------------------
// main — CLI entry point (injected io)
// ---------------------------------------------------------------------------

describe("main (injected io)", () => {
  it("--version logs the bare version and exits 0", () => {
    let logged = null;
    let code = null;
    main(["node", "x", "--version"], { log: (s) => { logged = s; }, exit: (c) => { code = c; } });
    assert.equal(logged, SCRIPT_VERSION);
    assert.equal(code, 0);
  });

  it("--help logs usage and exits 0", () => {
    let logged = null;
    let code = null;
    main(["node", "x", "--help"], { log: (s) => { logged = s; }, exit: (c) => { code = c; } });
    assert.match(logged, /scrub\.mjs — privacy scrub/);
    assert.equal(code, 0);
  });

  it("reads stdin, scrubs it, writes the result, exits 0", () => {
    let written = null;
    let code = null;
    // Comma-delimited — see the "applies redaction, home-path rewrite, and
    // truncation together" test above for why an undelimited "NAME=value
    // at <path>" fixture is no longer safe to use here (skills#493).
    main(["node", "x"], {
      readStdin: () => `TOKEN=hunter2, path ${FAKE_HOME}/file`,
      write: (s) => { written = s; },
      exit: (c) => { code = c; },
      home: FAKE_HOME,
    });
    assert.equal(written, "TOKEN=[REDACTED], path ~/file");
    assert.equal(code, 0);
  });

  it("fails closed: readStdin throwing emits nothing and exits 0", () => {
    let written = null;
    let writeCalled = false;
    let code = null;
    main(["node", "x"], {
      readStdin: () => { throw new Error("EAGAIN"); },
      write: (s) => { writeCalled = true; written = s; },
      exit: (c) => { code = c; },
    });
    assert.equal(writeCalled, false);
    assert.equal(written, null);
    assert.equal(code, 0);
  });

  it("fails closed: scrub() throwing (non-string from readStdin) emits nothing and exits 0", () => {
    let writeCalled = false;
    let code = null;
    main(["node", "x"], {
      readStdin: () => null,
      write: () => { writeCalled = true; },
      exit: (c) => { code = c; },
    });
    assert.equal(writeCalled, false);
    assert.equal(code, 0);
  });
});

// ---------------------------------------------------------------------------
// isCliEntry
// ---------------------------------------------------------------------------

describe("isCliEntry", () => {
  const scriptUrl = pathToFileURL(SCRIPT_PATH).href;

  it("returns true when argv[1] is the absolute script path", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", SCRIPT_PATH]), true);
  });

  it("returns true when argv[1] is a relative path resolving to the script", () => {
    const cwdBefore = process.cwd();
    process.chdir(dirname(SCRIPT_PATH));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./scrub.mjs"]), true);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("returns false for a different file", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other.mjs"]), false);
  });

  it("returns false when argv[1] is undefined (covers `?? ''` fallback)", () => {
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess (covers the module-scope entry guard + real-io defaults)
// ---------------------------------------------------------------------------

describe("CLI invocation (subprocess — covers entry guard)", () => {
  function run(args, input) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf-8", timeout: 30000, input: input ?? "" });
  }

  it("--version prints the bare version and exits 0", () => {
    const r = run(["--version"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), SCRIPT_VERSION);
  });

  it("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });

  it("scrubs real stdin through the real CLI and writes to stdout", () => {
    const r = run([], "TOKEN=hunter2\n");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "TOKEN=[REDACTED]\n");
  });

  it("never writes a file — only reads stdin and writes stdout", () => {
    const r = run([], "plain text");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "plain text");
    assert.equal(r.stderr, "");
  });
});
