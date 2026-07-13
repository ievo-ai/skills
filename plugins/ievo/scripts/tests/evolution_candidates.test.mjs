// Tests for evolution_candidates.mjs — iEvo auto-evolution candidate accumulator.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/evolution_candidates.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  IEVO_DIR,
  CANDIDATES_DIR,
  SESSION_EXT,
  DEFAULT_RETENTION,
  DEFAULT_SCOPE,
  candidatesDir,
  sanitizeSessionId,
  sessionFilePath,
  parseCandidates,
  latestTimestamp,
  readSessionCandidates,
  appendCandidate,
  listSessions,
  countPending,
  pruneSessions,
  parseArgs,
  main,
  mainSafe,
  isCliEntry,
} from "../evolution_candidates.mjs";

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "evolution_candidates.mjs");

// Write a session .jsonl file directly (bypassing appendCandidate) so tests can
// craft exact on-disk state, including malformed lines and custom timestamps.
function writeSession(root, sessionId, records) {
  const dir = candidatesDir(root);
  mkdirSync(dir, { recursive: true });
  const body = records
    .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
    .join("\n");
  writeFileSync(join(dir, `${sessionId}${SESSION_EXT}`), body + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("SCRIPT_VERSION matches plugin.json — real coupling, not hardcoded", () => {
    const pluginJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.claude-plugin/plugin.json");
    const { version } = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
    assert.equal(SCRIPT_VERSION, version, `evolution_candidates.mjs SCRIPT_VERSION ('${SCRIPT_VERSION}') and plugin.json version ('${version}') must agree — bump both in the same PR`);
  });

  it("path + retention constants are sensible", () => {
    assert.equal(IEVO_DIR, ".ievo");
    assert.equal(CANDIDATES_DIR, "evolution-candidates");
    assert.equal(SESSION_EXT, ".jsonl");
    assert.equal(DEFAULT_RETENTION, 10);
    assert.equal(DEFAULT_SCOPE, "unclassified");
  });
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

describe("candidatesDir", () => {
  it("joins project root with .ievo/evolution-candidates", () => {
    assert.equal(candidatesDir("/tmp/proj"), join("/tmp/proj", ".ievo", "evolution-candidates"));
  });

  it("defaults project root to cwd-relative '.'", () => {
    assert.equal(candidatesDir(), join(".", ".ievo", "evolution-candidates"));
  });
});

describe("sanitizeSessionId", () => {
  it("passes a UUID-shaped id through unchanged", () => {
    assert.equal(sanitizeSessionId("abc-123_DEF.9"), "abc-123_DEF.9");
  });

  it("replaces unsafe characters (path separators, spaces, traversal) with underscores", () => {
    assert.equal(sanitizeSessionId("a/b c:d"), "a_b_c_d");
    assert.equal(sanitizeSessionId("../evil"), ".._evil");
  });

  it("coerces non-string ids before sanitizing", () => {
    assert.equal(sanitizeSessionId(12345), "12345");
  });

  it("throws when the id has no alphanumeric character (empty)", () => {
    assert.throws(() => sanitizeSessionId(""), /invalid session id/);
  });

  it("throws when the id is only separators", () => {
    assert.throws(() => sanitizeSessionId("///"), /invalid session id/);
  });
});

describe("sessionFilePath", () => {
  it("builds <root>/.ievo/evolution-candidates/<id>.jsonl", () => {
    assert.equal(
      sessionFilePath("/p", "sess1"),
      join("/p", ".ievo", "evolution-candidates", "sess1.jsonl"),
    );
  });

  it("propagates the sanitize error for an unusable id", () => {
    assert.throws(() => sessionFilePath("/p", ""), /invalid session id/);
  });
});

// ---------------------------------------------------------------------------
// parseCandidates
// ---------------------------------------------------------------------------

describe("parseCandidates", () => {
  it("returns [] for empty / whitespace-only input", () => {
    assert.deepEqual(parseCandidates(""), []);
    assert.deepEqual(parseCandidates("\n  \n\t\n"), []);
  });

  it("skips blank, unparseable, and malformed lines but keeps valid candidates", () => {
    const input = [
      "",                                  // blank → skip
      "not json{",                         // unparseable → skip
      "null",                              // parses to null → skip (not an object)
      "123",                               // parses to number → skip
      JSON.stringify({ no: "text" }),      // object without text → skip
      JSON.stringify({ text: 42 }),        // non-string text → skip
      JSON.stringify({ text: "" }),        // empty text → skip
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", scope: "unclassified", text: "real one" }),
    ].join("\n");
    const out = parseCandidates(input);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "real one");
  });
});

describe("latestTimestamp", () => {
  it("returns '' when there are no timestamped candidates", () => {
    assert.equal(latestTimestamp([]), "");
    assert.equal(latestTimestamp([{ text: "x" }]), ""); // no ts field
  });

  it("returns the lexicographically-greatest ts, ignoring non-string ts", () => {
    const out = latestTimestamp([
      { ts: "2026-01-03T00:00:00Z", text: "a" }, // set latest first...
      { ts: "2026-01-01T00:00:00Z", text: "b" }, // ...so this one does NOT update
      { ts: 99, text: "c" },                     // non-string ts → skipped
      { ts: "2026-01-05T00:00:00Z", text: "d" }, // new max
    ]);
    assert.equal(out, "2026-01-05T00:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// readSessionCandidates
// ---------------------------------------------------------------------------

describe("readSessionCandidates", () => {
  const root = join(tmpdir(), `evc-read-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when the session file is absent (ENOENT)", () => {
    assert.deepEqual(readSessionCandidates(join(root, "nope.jsonl")), []);
  });

  it("parses candidates from an existing file", () => {
    writeSession(root, "s1", [{ ts: "2026-01-01T00:00:00Z", scope: "unclassified", text: "hi" }]);
    const out = readSessionCandidates(sessionFilePath(root, "s1"));
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "hi");
  });

  it("rethrows a non-ENOENT read error (e.g. EACCES)", () => {
    const boom = () => { const e = new Error("denied"); e.code = "EACCES"; throw e; };
    assert.throws(() => readSessionCandidates("/whatever", boom), /denied/);
  });
});

// ---------------------------------------------------------------------------
// appendCandidate
// ---------------------------------------------------------------------------

describe("appendCandidate", () => {
  const root = join(tmpdir(), `evc-append-${process.pid}`);
  before(() => mkdirSync(root, { recursive: true }));
  after(() => rmSync(root, { recursive: true, force: true }));

  it("throws when text is missing (no args at all)", () => {
    assert.throws(() => appendCandidate(), /non-empty --text/);
  });

  it("throws when text is not a string", () => {
    assert.throws(() => appendCandidate({ sessionId: "s", text: 5 }), /non-empty --text/);
  });

  it("throws when text is whitespace-only", () => {
    assert.throws(() => appendCandidate({ sessionId: "s", text: "   " }), /non-empty --text/);
  });

  it("writes a trimmed candidate to the session file (real fs, default now())", () => {
    const projectRoot = join(root, "p1");
    const res = appendCandidate({ projectRoot, sessionId: "sess-A", text: "  we always pin deps  " });
    assert.equal(res.written, true);
    assert.equal(res.record.text, "we always pin deps");
    assert.equal(res.record.scope, DEFAULT_SCOPE);
    assert.match(res.record.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO-8601 from real Date
    const onDisk = readSessionCandidates(sessionFilePath(projectRoot, "sess-A"));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].text, "we always pin deps");
  });

  it("stamps an injected ts and scope", () => {
    const projectRoot = join(root, "p2");
    const res = appendCandidate({
      projectRoot, sessionId: "sess-B", text: "prefer X", scope: "project-wide", ts: "2026-07-04T00:00:00Z",
    });
    assert.equal(res.record.ts, "2026-07-04T00:00:00Z");
    assert.equal(res.record.scope, "project-wide");
  });

  it("dedups an identical (scope, text) candidate within the same session", () => {
    const projectRoot = join(root, "p3");
    const first = appendCandidate({ projectRoot, sessionId: "s", text: "same", ts: "2026-07-04T00:00:00Z" });
    assert.equal(first.written, true);
    const second = appendCandidate({ projectRoot, sessionId: "s", text: "same", ts: "2026-07-04T01:00:00Z" });
    assert.equal(second.written, false);
    assert.equal(second.reason, "duplicate");
    assert.equal(readSessionCandidates(sessionFilePath(projectRoot, "s")).length, 1);
  });

  it("treats an existing record with no scope field as DEFAULT_SCOPE for dedup (nullish coalescing)", () => {
    const projectRoot = join(root, "p4");
    // Pre-seed a raw line WITHOUT a scope field.
    writeSession(projectRoot, "s", [{ ts: "2026-07-04T00:00:00Z", text: "legacy" }]);
    const res = appendCandidate({ projectRoot, sessionId: "s", text: "legacy", scope: DEFAULT_SCOPE });
    assert.equal(res.written, false);
    assert.equal(res.reason, "duplicate");
  });

  it("honors the default projectRoot '.' via injected fs deps (no disk writes)", () => {
    const writes = [];
    const res = appendCandidate(
      { sessionId: "s", text: "t", ts: "2026-07-04T00:00:00Z" },
      {
        readImpl: () => { const e = new Error("nf"); e.code = "ENOENT"; throw e; },
        mkdir: () => {},
        appendFile: (p, body) => writes.push([p, body]),
      },
    );
    assert.equal(res.written, true);
    assert.equal(writes.length, 1);
    // Path is rooted at the default "." → contains .ievo/evolution-candidates.
    assert.ok(res.filePath.includes(join(".ievo", "evolution-candidates")));
  });

  // --- --text-file (#373: never interpolate free-form correction text into a
  // Bash argument — read it from a file the caller already wrote instead) ---

  it("reads the correction from --text-file instead of --text (real fs)", () => {
    const projectRoot = join(root, "tf1");
    const textFilePath = join(root, "tf1-correction.txt");
    writeFileSync(textFilePath, "  we always pin deps via --text-file  \n", "utf-8");
    const res = appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath });
    assert.equal(res.written, true);
    assert.equal(res.record.text, "we always pin deps via --text-file");
  });

  it("--text-file takes precedence when both --text and --text-file are given", () => {
    const projectRoot = join(root, "tf2");
    const textFilePath = join(root, "tf2-correction.txt");
    writeFileSync(textFilePath, "from the file", "utf-8");
    const res = appendCandidate({ projectRoot, sessionId: "s", text: "from --text", textFile: textFilePath });
    assert.equal(res.record.text, "from the file");
  });

  it("throws a descriptive error when --text-file cannot be read (ENOENT)", () => {
    const projectRoot = join(root, "tf3");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: join(root, "does-not-exist.txt") }),
      /could not read --text-file '.*does-not-exist\.txt': /,
    );
  });

  it("treats whitespace-only --text-file content as empty (throws)", () => {
    const projectRoot = join(root, "tf4");
    const textFilePath = join(root, "tf4-correction.txt");
    writeFileSync(textFilePath, "   \n\t\n", "utf-8");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }),
      /non-empty --text or --text-file/,
    );
  });

  it("propagates a non-ENOENT --text-file read error (e.g. EACCES)", () => {
    const boom = () => { const e = new Error("denied"); e.code = "EACCES"; throw e; };
    assert.throws(
      () => appendCandidate({ sessionId: "s", textFile: "/whatever" }, { readImpl: boom }),
      /could not read --text-file '\/whatever': denied/,
    );
  });
});

// ---------------------------------------------------------------------------
// listSessions / countPending
// ---------------------------------------------------------------------------

describe("listSessions", () => {
  const root = join(tmpdir(), `evc-list-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when the candidates dir does not exist (ENOENT)", () => {
    assert.deepEqual(listSessions(join(root, "empty-proj")), []);
  });

  it("rethrows a non-ENOENT readdir error", () => {
    const boom = () => { const e = new Error("perm"); e.code = "EACCES"; throw e; };
    assert.throws(() => listSessions(root, { readdir: boom }), /perm/);
  });

  it("lists only .jsonl session files, ignoring pending.md and other artefacts", () => {
    const projectRoot = join(root, "proj");
    writeSession(projectRoot, "sA", [{ ts: "2026-01-02T00:00:00Z", text: "one" }]);
    writeSession(projectRoot, "sB", [
      { ts: "2026-01-03T00:00:00Z", text: "two" },
      { ts: "2026-01-04T00:00:00Z", text: "three" },
    ]);
    // Non-session artefacts that must be ignored.
    writeFileSync(join(candidatesDir(projectRoot), "pending.md"), "# parked\n", "utf-8");
    writeFileSync(join(candidatesDir(projectRoot), "README.txt"), "notes\n", "utf-8");

    const sessions = listSessions(projectRoot).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((s) => s.sessionId), ["sA", "sB"]);
    assert.equal(sessions[0].candidates.length, 1);
    assert.equal(sessions[1].candidates.length, 2);
    assert.equal(sessions[1].latestTs, "2026-01-04T00:00:00Z");
  });
});

describe("countPending", () => {
  const root = join(tmpdir(), `evc-count-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns 0 when there are no sessions", () => {
    assert.equal(countPending(join(root, "none")), 0);
  });

  it("sums candidates across all sessions", () => {
    const projectRoot = join(root, "proj");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "s2", [
      { ts: "2026-01-02T00:00:00Z", text: "b" },
      { ts: "2026-01-03T00:00:00Z", text: "c" },
    ]);
    assert.equal(countPending(projectRoot), 3);
  });
});

// ---------------------------------------------------------------------------
// pruneSessions
// ---------------------------------------------------------------------------

describe("pruneSessions", () => {
  const root = join(tmpdir(), `evc-prune-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("removes nothing when session count is within the retention cap (default keep)", () => {
    const projectRoot = join(root, "under");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "s2", [{ ts: "2026-01-02T00:00:00Z", text: "b" }]);
    const res = pruneSessions(projectRoot); // default keep = 10
    assert.deepEqual(res.removed, []);
    assert.equal(res.kept, 2);
  });

  it("keeps the most-recent `keep` sessions and removes older ones (ts desc, sessionId tiebreak)", () => {
    const projectRoot = join(root, "over");
    // Distinct ts to exercise both directions of the ts compare; C and D share a
    // ts to exercise the sessionId tiebreak (both directions).
    writeSession(projectRoot, "A", [{ ts: "2026-01-03T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "B", [{ ts: "2026-01-01T00:00:00Z", text: "b" }]);
    writeSession(projectRoot, "C", [{ ts: "2026-01-02T00:00:00Z", text: "c" }]);
    writeSession(projectRoot, "D", [{ ts: "2026-01-02T00:00:00Z", text: "d" }]);

    const res = pruneSessions(projectRoot, 2);
    // Ordered most-recent-first: A(03), then D/C(02, id desc → D before C), then B(01).
    // Keep A + D; remove C and B.
    assert.equal(res.kept, 2);
    assert.equal(res.removed.length, 2);
    assert.ok(existsSync(sessionFilePath(projectRoot, "A")));
    assert.ok(existsSync(sessionFilePath(projectRoot, "D")));
    assert.ok(!existsSync(sessionFilePath(projectRoot, "C")));
    assert.ok(!existsSync(sessionFilePath(projectRoot, "B")));
  });

  it("orders equal-timestamp sessions by id (tiebreak exercised both directions)", () => {
    // Fully injected so the readdir order (b, a, c) is deterministic — the sort
    // then compares equal-ts sessions in both id orders, covering both sides of
    // the tiebreak ternary. Desc-by-id keeps 'c'; 'b' and 'a' are removed.
    const files = {
      "b.jsonl": [{ ts: "2026-01-02T00:00:00Z", text: "b" }],
      "a.jsonl": [{ ts: "2026-01-02T00:00:00Z", text: "a" }],
      "c.jsonl": [{ ts: "2026-01-02T00:00:00Z", text: "c" }],
    };
    const removed = [];
    const res = pruneSessions("/proj", 1, {
      readdir: () => Object.keys(files),
      readImpl: (p) => {
        const base = p.split(/[\\/]/).pop();
        return files[base].map((r) => JSON.stringify(r)).join("\n") + "\n";
      },
      unlink: (p) => removed.push(p.split(/[\\/]/).pop()),
    });
    assert.equal(res.kept, 1);
    assert.deepEqual(removed.sort(), ["a.jsonl", "b.jsonl"]);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns defaults with a null command for a bare invocation", () => {
    const a = parseArgs(["node", "evolution_candidates.mjs"]);
    assert.equal(a.command, null);
    assert.equal(a.scope, DEFAULT_SCOPE);
    assert.equal(a.project, ".");
    assert.equal(a.keep, DEFAULT_RETENTION);
    assert.equal(a.ts, null);
    assert.equal(a.textFile, null);
  });

  it("parses the append command with all flags", () => {
    const a = parseArgs([
      "node", "x", "append",
      "--session", "sid", "--text", "a correction",
      "--scope", "project-wide", "--project", "/p", "--ts", "2026-07-04T00:00:00Z",
    ]);
    assert.equal(a.command, "append");
    assert.equal(a.session, "sid");
    assert.equal(a.text, "a correction");
    assert.equal(a.scope, "project-wide");
    assert.equal(a.project, "/p");
    assert.equal(a.ts, "2026-07-04T00:00:00Z");
  });

  it("parses --text-file", () => {
    const a = parseArgs(["node", "x", "append", "--session", "sid", "--text-file", "/tmp/correction.txt"]);
    assert.equal(a.textFile, "/tmp/correction.txt");
    assert.equal(a.text, null);
  });

  it("parses count / list / prune commands", () => {
    assert.equal(parseArgs(["node", "x", "count"]).command, "count");
    assert.equal(parseArgs(["node", "x", "list"]).command, "list");
    assert.equal(parseArgs(["node", "x", "prune", "--keep", "5"]).keep, 5);
  });

  it("throws on a non-numeric --keep", () => {
    assert.throws(() => parseArgs(["node", "x", "prune", "--keep", "abc"]), /--keep requires a non-negative integer/);
  });

  it("throws on a negative --keep", () => {
    assert.throws(() => parseArgs(["node", "x", "prune", "--keep", "-1"]), /--keep requires a non-negative integer/);
  });

  it("throws on an unknown flag", () => {
    assert.throws(() => parseArgs(["node", "x", "--bogus"]), /unknown flag '--bogus'/);
  });

  it("throws when a flag value is missing (end of arguments)", () => {
    assert.throws(() => parseArgs(["node", "x", "append", "--session"]), /--session requires a value, got end of arguments/);
  });

  it("throws when a flag value is another flag", () => {
    assert.throws(() => parseArgs(["node", "x", "append", "--text", "--scope"]), /--text requires a value, got flag '--scope'/);
  });
});

// ---------------------------------------------------------------------------
// main (in-process, injected io)
// ---------------------------------------------------------------------------

describe("main", () => {
  const root = join(tmpdir(), `evc-main-${process.pid}`);
  before(() => mkdirSync(root, { recursive: true }));
  after(() => rmSync(root, { recursive: true, force: true }));

  function makeRun() {
    const logs = [];
    const errs = [];
    let exitCode = null;
    return {
      io: {
        log: (...a) => logs.push(a.join(" ")),
        errLog: (...a) => errs.push(a.join(" ")),
        exit: (c) => { exitCode = c; },
      },
      logs,
      errs,
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
    assert.match(run.logs[0], /append --session/);
    assert.match(run.logs[0], /prune/);
    assert.match(run.logs[0], /--version/);
  });

  it("exits 2 with an error on unparseable args", () => {
    const run = makeRun();
    main(["node", "x", "--bogus"], run.io);
    assert.equal(run.exitCode, 2);
    assert.match(run.errs.join("\n"), /unknown flag/);
  });

  it("append writes a candidate and prints the JSON result (ts from default now())", () => {
    const run = makeRun();
    const projectRoot = join(root, "m-append");
    main(["node", "x", "append", "--project", projectRoot, "--session", "s", "--text", "cap this"], run.io);
    assert.equal(run.exitCode, 0);
    const result = JSON.parse(run.logs[0]);
    assert.equal(result.written, true);
    assert.equal(result.record.text, "cap this");
  });

  it("append passes an explicit --ts through", () => {
    const run = makeRun();
    const projectRoot = join(root, "m-append-ts");
    main(["node", "x", "append", "--project", projectRoot, "--session", "s", "--text", "t", "--ts", "2026-07-04T09:00:00Z"], run.io);
    const result = JSON.parse(run.logs[0]);
    assert.equal(result.record.ts, "2026-07-04T09:00:00Z");
  });

  it("append surfaces a validation error as exit 3", () => {
    const run = makeRun();
    // No --text → appendCandidate throws → caught → exit 3.
    main(["node", "x", "append", "--session", "s"], run.io);
    assert.equal(run.exitCode, 3);
    assert.match(run.errs.join("\n"), /non-empty --text/);
  });

  it("append reads the correction from --text-file", () => {
    const run = makeRun();
    const projectRoot = join(root, "m-append-textfile");
    const textFilePath = join(root, "m-append-textfile-correction.txt");
    writeFileSync(textFilePath, "captured via --text-file", "utf-8");
    main(["node", "x", "append", "--project", projectRoot, "--session", "s", "--text-file", textFilePath], run.io);
    assert.equal(run.exitCode, 0);
    const result = JSON.parse(run.logs[0]);
    assert.equal(result.written, true);
    assert.equal(result.record.text, "captured via --text-file");
  });

  it("count prints the total pending across sessions", () => {
    const projectRoot = join(root, "m-count");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "s2", [{ ts: "2026-01-02T00:00:00Z", text: "b" }]);
    const run = makeRun();
    main(["node", "x", "count", "--project", projectRoot], run.io);
    assert.equal(run.exitCode, 0);
    assert.equal(run.logs[0], "2");
  });

  it("list prints the sessions as JSON", () => {
    const projectRoot = join(root, "m-list");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    const run = makeRun();
    main(["node", "x", "list", "--project", projectRoot], run.io);
    assert.equal(run.exitCode, 0);
    const parsed = JSON.parse(run.logs[0]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].sessionId, "s1");
  });

  it("prune prints the removed list as JSON", () => {
    const projectRoot = join(root, "m-prune");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "s2", [{ ts: "2026-01-02T00:00:00Z", text: "b" }]);
    const run = makeRun();
    main(["node", "x", "prune", "--keep", "1", "--project", projectRoot], run.io);
    assert.equal(run.exitCode, 0);
    const result = JSON.parse(run.logs[0]);
    assert.equal(result.kept, 1);
    assert.equal(result.removed.length, 1);
  });

  it("exits 2 on a missing/unknown command", () => {
    const run = makeRun();
    main(["node", "x"], run.io); // no command
    assert.equal(run.exitCode, 2);
    assert.match(run.errs.join("\n"), /unknown or missing command/);
  });
});

// ---------------------------------------------------------------------------
// mainSafe
// ---------------------------------------------------------------------------

describe("mainSafe", () => {
  it("forwards a successful run unchanged", () => {
    let code = null;
    mainSafe(["node", "x", "--version"], { log: () => {}, errLog: () => {}, exit: (c) => { code = c; } });
    assert.equal(code, 0);
  });

  it("catches an unexpected throw and exits 2 (with injected errLog/exit)", () => {
    let code = null;
    const errs = [];
    mainSafe(["node", "x", "--version"], {
      log: () => { throw new Error("boom"); }, // throws OUTSIDE main's try blocks
      errLog: (...a) => errs.push(a.join(" ")),
      exit: (c) => { code = c; },
    });
    assert.equal(code, 2);
    assert.match(errs.join("\n"), /fatal: boom/);
  });

  it("falls back to console.error when io.errLog is absent on the failure path", () => {
    let code = null;
    const origErr = console.error;
    const captured = [];
    console.error = (...a) => captured.push(a.join(" "));
    try {
      // No errLog in io → the catch uses `io.errLog ?? console.error`.
      mainSafe(["node", "x", "--version"], { log: () => { throw new Error("kaboom"); }, exit: (c) => { code = c; } });
    } finally {
      console.error = origErr;
    }
    assert.equal(code, 2);
    assert.match(captured.join("\n"), /fatal: kaboom/);
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
      assert.equal(isCliEntry(scriptUrl, ["node", "./evolution_candidates.mjs"]), true);
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
  const root = join(tmpdir(), `evc-spawn-${process.pid}`);
  before(() => mkdirSync(root, { recursive: true }));
  after(() => rmSync(root, { recursive: true, force: true }));

  function run(args, opts = {}) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf-8", timeout: 30000, ...opts });
  }

  it("--version prints the bare version and exits 0", () => {
    const r = run(["--version"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), SCRIPT_VERSION);
  });

  it("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /append --session/);
    assert.match(r.stdout, /prune/);
  });

  it("append → count round-trips through the real CLI", () => {
    const projectRoot = join(root, "cli-proj");
    const appended = run(["append", "--project", projectRoot, "--session", "cli-s", "--text", "cli correction"]);
    assert.equal(appended.status, 0);
    assert.equal(JSON.parse(appended.stdout).written, true);

    const counted = run(["count", "--project", projectRoot]);
    assert.equal(counted.status, 0);
    assert.equal(counted.stdout.trim(), "1");
  });

  it("exits 3 with an error on invalid append input", () => {
    const r = run(["append", "--session", "s"]); // no --text
    assert.equal(r.status, 3);
    assert.match(r.stderr, /non-empty --text/);
  });

  it("append --text-file round-trips through the real CLI (#373)", () => {
    const projectRoot = join(root, "cli-proj-textfile");
    const textFilePath = join(root, "cli-proj-textfile-correction.txt");
    writeFileSync(textFilePath, "cli correction from file", "utf-8");
    const appended = run(["append", "--project", projectRoot, "--session", "cli-s", "--text-file", textFilePath]);
    assert.equal(appended.status, 0);
    const result = JSON.parse(appended.stdout);
    assert.equal(result.written, true);
    assert.equal(result.record.text, "cli correction from file");
  });

  it("exits 2 on an unknown command", () => {
    const r = run(["frobnicate"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown or missing command/);
  });
});
