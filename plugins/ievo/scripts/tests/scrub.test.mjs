// Tests for scrub.mjs — iEvo auto-evolution privacy scrub (stdin -> stdout).
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/scrub.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  MAX_CODE_POINTS,
  TRUNCATION_MARKER,
  REDACTED,
  redactProviderSecrets,
  redactAssignments,
  redactHomePaths,
  capLength,
  scrub,
  main,
  mainSafe,
  isCliEntry,
} from "../scrub.mjs";

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scrub.mjs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SCRIPT_VERSION matches plugin.json — real coupling, not hardcoded", () => {
    const pluginJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.claude-plugin/plugin.json");
    const { version } = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
    assert.equal(SCRIPT_VERSION, version, `scrub.mjs SCRIPT_VERSION ('${SCRIPT_VERSION}') and plugin.json version ('${version}') must agree — bump both in the same PR`);
  });

  it("cap + marker + redaction constants are sensible", () => {
    assert.equal(MAX_CODE_POINTS, 500);
    assert.equal(typeof TRUNCATION_MARKER, "string");
    assert.ok(TRUNCATION_MARKER.length > 0);
    assert.equal(typeof REDACTED, "string");
    assert.ok(REDACTED.length > 0);
  });
});

// ---------------------------------------------------------------------------
// redactProviderSecrets
// ---------------------------------------------------------------------------

describe("redactProviderSecrets", () => {
  it("redacts each GitHub App/OAuth/PAT token prefix", () => {
    const prefixes = ["ghp", "gho", "ghu", "ghs", "ghr"];
    for (const p of prefixes) {
      const token = `${p}_abcdefghijklmnopqrstuvwxyz0123456789AB`;
      const out = redactProviderSecrets(`token=${token} end`);
      assert.ok(!out.includes(token), `${p}_ token leaked: ${out}`);
      assert.match(out, new RegExp(REDACTED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("redacts fine-grained github_pat_ tokens", () => {
    const token = "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const out = redactProviderSecrets(`pat is ${token} yes`);
    assert.ok(!out.includes(token));
    assert.equal(out, `pat is ${REDACTED} yes`);
  });

  it("redacts sk- style keys (OpenAI legacy, OpenAI project, Anthropic)", () => {
    for (const token of [
      "sk-abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz01234567",
    ]) {
      const out = redactProviderSecrets(`key ${token} done`);
      assert.ok(!out.includes(token), `leaked: ${out}`);
    }
  });

  it("does not redact a short sk- prefixed word (below the opaque-tail floor)", () => {
    const out = redactProviderSecrets("sk-short is fine");
    assert.equal(out, "sk-short is fine");
  });

  it("redacts Slack tokens across the xox[abprs]- family", () => {
    for (const letter of ["a", "b", "p", "r", "s"]) {
      const token = `xox${letter}-1234567890-abcdefghij`;
      const out = redactProviderSecrets(`slack ${token} ok`);
      assert.ok(!out.includes(token), `leaked: ${out}`);
    }
  });

  it("does not redact an xox-prefixed word with an unknown letter", () => {
    const out = redactProviderSecrets("xoxq-1234567890-abcdefghij is not slack-shaped");
    assert.match(out, /xoxq-1234567890-abcdefghij/);
  });

  it("redacts an AWS access key ID", () => {
    const out = redactProviderSecrets("aws AKIAABCDEFGHIJKLMNOP done");
    assert.equal(out, `aws ${REDACTED} done`);
  });

  it("does not redact AKIA followed by too few characters", () => {
    const out = redactProviderSecrets("aws AKIASHORT done");
    assert.match(out, /AKIASHORT/);
  });

  it("redacts a JWT (three base64url segments)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactProviderSecrets(`jwt ${jwt} end`);
    assert.equal(out, `jwt ${REDACTED} end`);
  });

  it("does not touch text with no provider-shaped secret", () => {
    const text = "just an ordinary sentence about tokens and keys, no literal values here";
    assert.equal(redactProviderSecrets(text), text);
  });

  it("redacts multiple distinct secrets in one string", () => {
    const out = redactProviderSecrets(
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB and AKIAABCDEFGHIJKLMNOP together",
    );
    assert.equal(out, `${REDACTED} and ${REDACTED} together`);
  });
});

// ---------------------------------------------------------------------------
// redactAssignments
// ---------------------------------------------------------------------------

describe("redactAssignments", () => {
  it("redacts a shell-style assignment, keeping the name", () => {
    const out = redactAssignments("export GH_TOKEN=abc123XYZ && run");
    assert.equal(out, `export GH_TOKEN=${REDACTED} && run`);
  });

  it("redacts a JSON-style quoted key/value pair", () => {
    const out = redactAssignments('{"APP_ID": "12345"}');
    assert.equal(out, `{"APP_ID": "${REDACTED}"}`);
  });

  it("redacts a single-quoted shell value", () => {
    const out = redactAssignments("FOO_SECRET='abc123' end");
    assert.equal(out, `FOO_SECRET='${REDACTED}' end`);
  });

  it("redacts a YAML-style unquoted value", () => {
    const out = redactAssignments("DB_PASSWORD: hunter2");
    assert.equal(out, `DB_PASSWORD: ${REDACTED}`);
  });

  it("covers every recognised name suffix", () => {
    const cases = [
      ["GH_TOKEN=x", "GH_TOKEN"],
      ["ANTHROPIC_API_KEY=x", "ANTHROPIC_API_KEY"],
      ["APP_SECRET=x", "APP_SECRET"],
      ["DB_PASSWORD=x", "DB_PASSWORD"],
      ["APP_ID=x", "APP_ID"],
    ];
    for (const [input, name] of cases) {
      const out = redactAssignments(input);
      assert.equal(out, `${name}=${REDACTED}`);
    }
  });

  it("leaves a bare name mention with no assignment untouched", () => {
    const text = "the GH_TOKEN env var controls this";
    assert.equal(redactAssignments(text), text);
  });

  it("does not treat a lowercase name as secret-shaped (scope: uppercase only)", () => {
    const text = "gh_token=abc123";
    assert.equal(redactAssignments(text), text);
  });

  it("redacts multiple assignments in one string, independently", () => {
    const out = redactAssignments("GH_TOKEN=abc APP_ID=123");
    assert.equal(out, `GH_TOKEN=${REDACTED} APP_ID=${REDACTED}`);
  });
});

// ---------------------------------------------------------------------------
// redactHomePaths
// ---------------------------------------------------------------------------

describe("redactHomePaths", () => {
  it("rewrites an absolute $HOME-prefixed path to ~", () => {
    assert.equal(redactHomePaths("/home/runner/work/eva/eva/foo.txt", "/home/runner"), "~/work/eva/eva/foo.txt");
  });

  it("rewrites every occurrence, not just the first", () => {
    const text = "/home/runner/a.txt and /home/runner/b.txt";
    assert.equal(redactHomePaths(text, "/home/runner"), "~/a.txt and ~/b.txt");
  });

  it("leaves text with no home-path occurrence unchanged", () => {
    const text = "no machine-local path here";
    assert.equal(redactHomePaths(text, "/home/runner"), text);
  });

  it("guards against an empty home value", () => {
    const text = "/anything/here";
    assert.equal(redactHomePaths(text, ""), text);
  });

  it("guards against a root '/' home value (would over-match every separator)", () => {
    const text = "/anything/here";
    assert.equal(redactHomePaths(text, "/"), text);
  });

  it("uses the real os.homedir() by default and does not throw", () => {
    assert.doesNotThrow(() => redactHomePaths("some text with no real home dir substring"));
  });
});

// ---------------------------------------------------------------------------
// capLength
// ---------------------------------------------------------------------------

describe("capLength", () => {
  it("leaves text at or under the cap unchanged", () => {
    assert.equal(capLength("hello", 5), "hello");
    assert.equal(capLength("hi", 5), "hi");
  });

  it("truncates text over the cap and appends the marker", () => {
    assert.equal(capLength("abcdefgh", 5), `abcde${TRUNCATION_MARKER}`);
  });

  it("counts Unicode CODE POINTS, not UTF-16 code units — never splits a surrogate pair", () => {
    const emojiText = "\u{1F600}".repeat(10); // 10 code points, 20 UTF-16 units
    const capped = capLength(emojiText, 3);
    assert.equal(capped, "\u{1F600}\u{1F600}\u{1F600}" + TRUNCATION_MARKER);
    // No lone surrogate: re-decoding the capped text round-trips through
    // Array.from without producing replacement/invalid characters.
    assert.equal(Array.from(capped.replace(TRUNCATION_MARKER, "")).length, 3);
  });

  it("defaults to MAX_CODE_POINTS when no max is given", () => {
    const text = "x".repeat(MAX_CODE_POINTS + 50);
    const capped = capLength(text);
    assert.equal(capped, "x".repeat(MAX_CODE_POINTS) + TRUNCATION_MARKER);
  });
});

// ---------------------------------------------------------------------------
// scrub — full pipeline
// ---------------------------------------------------------------------------

describe("scrub", () => {
  it("applies every pass together: secret + assignment + home path", () => {
    const home = "/home/runner";
    const input = `export GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB; cd ${home}/project`;
    const out = scrub(input);
    assert.ok(!out.includes("ghp_"));
    assert.ok(!out.includes(home));
    assert.match(out, /GH_TOKEN=/);
    assert.match(out, /~\/project/);
  });

  it("caps the FINAL text, after redaction markers are substituted in", () => {
    // A realistic-length token (40 chars, like a real ghp_/gho_/ghs_ PAT)
    // followed by enough filler to push the COMBINED input over the cap —
    // confirms capLength runs last, over the already-redacted text, not the
    // raw pre-redaction text (which would leave a different byte count).
    const secret = "ghp_" + "a".repeat(36);
    const input = `prefix ${secret} ` + "y".repeat(600);
    const out = scrub(input);
    // Overall output never exceeds MAX_CODE_POINTS code points + marker.
    const withoutMarker = out.endsWith(TRUNCATION_MARKER) ? out.slice(0, -TRUNCATION_MARKER.length) : out;
    assert.ok(Array.from(withoutMarker).length <= MAX_CODE_POINTS);
    assert.ok(!out.includes(secret));
  });

  it("returns input unchanged when nothing matches any pass", () => {
    const text = "a perfectly ordinary short line";
    assert.equal(scrub(text), text);
  });
});

// ---------------------------------------------------------------------------
// main (CLI, injected io)
// ---------------------------------------------------------------------------

describe("main", () => {
  function makeRun(stdinText = "") {
    const logs = [];
    const writes = [];
    let exitCode = null;
    return {
      io: {
        log: (...a) => logs.push(a.join(" ")),
        exit: (c) => { exitCode = c; },
        readStdin: () => stdinText,
        write: (s) => writes.push(s),
      },
      logs,
      writes,
      get exitCode() { return exitCode; },
    };
  }

  it("--version prints SCRIPT_VERSION and exits 0", () => {
    const run = makeRun();
    main(["node", "x", "--version"], run.io);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs[0], SCRIPT_VERSION);
  });

  it("--help prints usage and exits 0", () => {
    const run = makeRun();
    main(["node", "x", "--help"], run.io);
    assert.equal(run.exitCode, 0);
    assert.match(run.logs[0], /scrub.mjs/);
  });

  it("reads stdin, scrubs it, and writes the result — no extra newline added", () => {
    const run = makeRun("GH_TOKEN=abc123 secret");
    main(["node", "x"], run.io);
    assert.equal(run.exitCode, 0);
    assert.equal(run.writes.join(""), `GH_TOKEN=${REDACTED} secret`);
  });

  it("exits 0 with no write when stdin can't be read", () => {
    const logs = [];
    const writes = [];
    let exitCode = null;
    main(["node", "x"], {
      log: (...a) => logs.push(a.join(" ")),
      exit: (c) => { exitCode = c; },
      readStdin: () => { throw new Error("EBADF"); },
      write: (s) => writes.push(s),
    });
    assert.equal(exitCode, 0);
    assert.equal(writes.length, 0);
  });

  it("uses real console.log / process.stdout.write / process.exit defaults without throwing when overridden partially", () => {
    // Exercise the default-parameter branches for log/exit/write by only
    // overriding readStdin, then immediately stopping before any real exit
    // via a thin exit override (defaults for log/write are never invoked on
    // the --version path here, this covers readStdin's default-object shape).
    let exitCode = null;
    main(["node", "x", "--version"], { exit: (c) => { exitCode = c; } });
    assert.equal(exitCode, 0);
  });
});

// ---------------------------------------------------------------------------
// mainSafe
// ---------------------------------------------------------------------------

describe("mainSafe", () => {
  it("forwards a successful run unchanged", () => {
    let code = null;
    mainSafe(["node", "x", "--version"], { log: () => {}, exit: (c) => { code = c; } });
    assert.equal(code, 0);
  });

  it("catches a thrown error, logs fatal, and exits 2", () => {
    let code = null;
    const errs = [];
    mainSafe(["node", "x"], {
      readStdin: () => "text",
      write: () => { throw new Error("kaboom"); },
      errLog: (...a) => errs.push(a.join(" ")),
      exit: (c) => { code = c; },
    });
    assert.equal(code, 2);
    assert.match(errs.join("\n"), /fatal: kaboom/);
  });

  it("falls back to console.error when errLog is not supplied", () => {
    let code = null;
    mainSafe(["node", "x"], {
      readStdin: () => "text",
      write: () => { throw new Error("boom"); },
      exit: (c) => { code = c; },
    });
    assert.equal(code, 2);
  });
});

// ---------------------------------------------------------------------------
// isCliEntry
// ---------------------------------------------------------------------------

describe("isCliEntry", () => {
  it("matches when argv[1] resolves to the same file as import.meta.url", () => {
    const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(scriptUrl, ["node", SCRIPT_PATH]), true);
  });

  it("matches a relative argv[1] against an absolute import.meta.url", () => {
    const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
    const cwd = process.cwd();
    process.chdir(dirname(SCRIPT_PATH));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./scrub.mjs"]), true);
    } finally {
      process.chdir(cwd);
    }
  });

  it("does not match a different file", () => {
    const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other.mjs"]), false);
  });

  it("does not match when argv[1] is absent", () => {
    const scriptUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
  });
});

// ---------------------------------------------------------------------------
// CLI invocation (subprocess — covers entry guard)
// ---------------------------------------------------------------------------

describe("CLI invocation (subprocess — covers entry guard)", () => {
  function run(args, input) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
      encoding: "utf-8",
      timeout: 30000,
      input: input ?? "",
    });
  }

  it("--version prints the bare version and exits 0", () => {
    const r = run(["--version"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), SCRIPT_VERSION);
  });

  it("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /scrub.mjs/);
  });

  it("scrubs real piped stdin end to end", () => {
    const r = run([], "export GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB done");
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes("ghp_"));
    assert.match(r.stdout, /GH_TOKEN=/);
  });

  it("ignores unrecognised flags and still scrubs stdin", () => {
    const r = run(["--bogus"], "plain text");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "plain text");
  });

  it("produces empty output for empty stdin", () => {
    const r = run([], "");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
