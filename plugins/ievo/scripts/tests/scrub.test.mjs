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
  redactProviderSecrets,
  redactNamedSecrets,
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

  it("leaves ordinary prose untouched", () => {
    const text = "the request took 5 seconds and returned ok";
    assert.equal(redactNamedSecrets(text), text);
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
