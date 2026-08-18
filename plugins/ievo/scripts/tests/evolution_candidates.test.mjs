// Tests for evolution_candidates.mjs — iEvo auto-evolution candidate accumulator.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/evolution_candidates.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  CONTROL_CHAR_RE,
  IEVO_DIR,
  CANDIDATES_DIR,
  SESSION_EXT,
  GIT_COMMON_SUBDIR,
  DEFAULT_RETENTION,
  DEFAULT_SCOPE,
  MAX_TEXT_FILE_BYTES,
  defaultGetGitCommonDir,
  legacyCandidatesDir,
  candidatesDir,
  sanitizeSessionId,
  sessionFilePath,
  parseCandidates,
  latestTimestamp,
  readSessionCandidates,
  assertTextFileAllowed,
  assertTextFileReadable,
  appendCandidate,
  listSessions,
  countPending,
  pruneSessions,
  parseArgs,
  main,
  mainSafe,
  isCliEntry,
} from "../evolution_candidates.mjs";

// Forces legacy (pre-#564) path resolution — injected throughout tests that
// don't care about the git-common-dir relocation, so their assertions stay
// deterministic regardless of whether the OS tmpdir happens to sit inside a
// git working tree on a given machine. Dedicated describe blocks below test
// the relocation itself (fake AND real git-common-dir resolution).
const NO_GIT = { getGitCommonDir: () => null };

// appendCandidate routes --text-file content through scrub.mjs's scrub(), which
// is not redaction-only: these two pin the OTHER stages of that transform (see
// the "capture-behaviour change" tests below), keyed off scrub.mjs's own
// constants so the pins move with it instead of hardcoding 500 / the marker.
import { MAX_CODEPOINTS, TRUNCATION_MARKER } from "../scrub.mjs";

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "evolution_candidates.mjs");

// Write a session .jsonl file directly (bypassing appendCandidate) so tests can
// craft exact on-disk state, including malformed lines and custom timestamps.
// Always targets the legacy location (NO_GIT) — callers that want to seed the
// git-common-dir location instead pass an explicit dir to writeSessionAt.
function writeSession(root, sessionId, records) {
  writeSessionAt(candidatesDir(root, NO_GIT), sessionId, records);
}

function writeSessionAt(dir, sessionId, records) {
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
    assert.equal(MAX_TEXT_FILE_BYTES, 256 * 1024);
  });

  it("CONTROL_CHAR_RE matches C0 controls and DEL, excludes tab/LF/CR (CWE-150, skills#632)", () => {
    // CONTROL_CHAR_RE carries the `g` flag (needed for its .replace() call
    // sites below) — reset lastIndex before each .test() call so this loop
    // isn't tripped up by the stateful global-regex gotcha.
    for (const ch of ["\x00", "\x1b", "\x07", "\x7f"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} to match`);
    }
    for (const ch of ["\t", "\n", "\r", "a"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(!CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} not to match`);
    }
  });

  it("CONTROL_CHAR_RE matches every Bidi_Control code point and the zero-width characters incl. BOM (Trojan-Source spoof guard, skills#632)", () => {
    // Mirrors discover.mjs/scan_repo.mjs/validate_agents.mjs/validate_skills.mjs's
    // own pin of their (per-file) CONTROL_CHAR_RE copy — see this constant's
    // header comment for why it's not a shared import. Bidi_Control is a
    // closed set: U+061C, U+200E-U+200F, U+202A-U+202E, U+2066-U+2069. Every
    // one is asserted so a future narrowing of the class cannot silently drop
    // one. The zero-width characters (U+200B-U+200F, U+FEFF) and the rest of
    // the U+2060-U+2069 invisible-operator block are asserted alongside.
    const stripped = [
      0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
      0x2066, 0x2067, 0x2068, 0x2069,
      0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
    ];
    for (const cp of stripped) {
      CONTROL_CHAR_RE.lastIndex = 0;
      const label = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.ok(CONTROL_CHAR_RE.test(String.fromCodePoint(cp)), `expected ${label} to match`);
    }
    // The code point immediately below and above each added range stays
    // untouched — a widening that overshoots is as much a defect as one that
    // falls short.
    for (const cp of [0x061b, 0x061d, 0x200a, 0x2010, 0x2029, 0x202f, 0x205f, 0x206a, 0xfefe, 0xff00, 0x0061]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      const label = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.ok(!CONTROL_CHAR_RE.test(String.fromCodePoint(cp)), `expected ${label} not to match`);
    }
  });
});

// ---------------------------------------------------------------------------
// assertTextFileAllowed / assertTextFileReadable (#523)
// ---------------------------------------------------------------------------

describe("assertTextFileAllowed", () => {
  it("returns the resolved path when it is inside <projectRoot>/.ievo/", () => {
    const result = assertTextFileAllowed("/proj/.ievo/hooks/tmp/x.txt", "/proj");
    assert.equal(result, resolve("/proj/.ievo/hooks/tmp/x.txt"));
  });

  it("allows the .ievo/ directory itself (no trailing path)", () => {
    assert.equal(assertTextFileAllowed("/proj/.ievo", "/proj"), resolve("/proj/.ievo"));
  });

  it("throws for a sibling directory that merely shares the '.ievo' prefix", () => {
    assert.throws(() => assertTextFileAllowed("/proj/.ievo-evil/x.txt", "/proj"), /must be inside/);
  });

  it("throws for a path escaping via traversal", () => {
    assert.throws(() => assertTextFileAllowed("/proj/.ievo/../../etc/passwd", "/proj"), /must be inside/);
  });

  it("throws for an absolute path entirely outside the project (e.g. ~/.aws/credentials)", () => {
    assert.throws(() => assertTextFileAllowed("/home/<name>/.aws/credentials", "/proj"), /must be inside/);
  });
});

describe("assertTextFileReadable", () => {
  const fakeStat = (isFile, size) => () => ({ isFile: () => isFile, size });
  const fakeRealpath = (p) => p; // identity: realpath equals the lexical path (no symlink involved)

  it("passes for a regular file under the size cap whose realpath stays inside .ievo/", () => {
    assert.doesNotThrow(() =>
      assertTextFileReadable("/proj/.ievo/whatever", "/proj", 100, fakeStat(true, 10), fakeRealpath));
  });

  it("throws for a non-regular file (e.g. a symlink or directory, per lstat)", () => {
    assert.throws(
      () => assertTextFileReadable("/proj/.ievo/whatever", "/proj", 100, fakeStat(false, 10), fakeRealpath),
      /not a regular file/,
    );
  });

  it("throws when the file exceeds the size cap", () => {
    assert.throws(
      () => assertTextFileReadable("/proj/.ievo/whatever", "/proj", 100, fakeStat(true, 101), fakeRealpath),
      /exceeds 100 bytes/,
    );
  });

  it("throws when the realpath resolves outside .ievo/ (symlinked ancestor directory, #523 review finding)", () => {
    // Simulates .ievo/link -> /outside, --text-file .ievo/link/secret: the
    // lexical path is inside .ievo/, but lstat resolves the intermediate
    // "link" component (POSIX semantics) and reports on the REAL target, so
    // isFile()/size alone would pass. The realpath re-check must still catch it.
    const realpathImpl = (p) => (p === "/proj/.ievo" ? "/proj/.ievo" : "/outside/secret");
    assert.throws(
      () => assertTextFileReadable("/proj/.ievo/link/secret", "/proj", 100, fakeStat(true, 10), realpathImpl),
      /must be inside/,
    );
  });

  it("defaults capBytes to MAX_TEXT_FILE_BYTES and statImpl/realpathImpl to the real fs", () => {
    // Real fs, real lstatSync/realpathSync defaults: a genuine regular file
    // under a genuine <projectRoot>/.ievo/, well under the cap, no symlink.
    const projectRoot = join(tmpdir(), `evc-readable-defaults-${process.pid}`);
    const filePath = join(projectRoot, IEVO_DIR, "whatever.txt");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "hello", "utf-8");
    try {
      assert.doesNotThrow(() => assertTextFileReadable(filePath, projectRoot));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects a REAL symlinked ancestor directory under .ievo/ pointing outside the project (end-to-end)", () => {
    const root = join(tmpdir(), `evc-symlink-${process.pid}`);
    const projectRoot = join(root, "proj");
    const outsideDir = join(root, "outside");
    const ievoDir = join(projectRoot, IEVO_DIR);
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(ievoDir, { recursive: true });
    writeFileSync(join(outsideDir, "secret.txt"), "AKIAABCDEFGHIJKLMNOP", "utf-8");
    symlinkSync(outsideDir, join(ievoDir, "link"), "dir");
    try {
      const textFile = join(ievoDir, "link", "secret.txt");
      const allowedPath = assertTextFileAllowed(textFile, projectRoot);
      assert.throws(() => assertTextFileReadable(allowedPath, projectRoot), /must be inside/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

describe("legacyCandidatesDir", () => {
  it("joins project root with .ievo/evolution-candidates, ignoring git entirely", () => {
    assert.equal(legacyCandidatesDir("/tmp/proj"), join("/tmp/proj", ".ievo", "evolution-candidates"));
  });

  it("defaults project root to cwd-relative '.'", () => {
    assert.equal(legacyCandidatesDir(), join(".", ".ievo", "evolution-candidates"));
  });
});

describe("candidatesDir (#564 — git-common-dir relocation)", () => {
  it("falls back to the legacy .ievo/evolution-candidates path when not a git working tree", () => {
    assert.equal(candidatesDir("/tmp/proj", NO_GIT), join("/tmp/proj", ".ievo", "evolution-candidates"));
  });

  it("defaults project root to cwd-relative '.' on the legacy fallback", () => {
    assert.equal(candidatesDir(undefined, NO_GIT), join(".", ".ievo", "evolution-candidates"));
  });

  it("defaults deps to {} (real getGitCommonDir) when no deps are given", () => {
    // No injection at all — exercises the `deps = {}` default parameter itself.
    // "/definitely/does/not/exist" is neither a repo nor an existing directory,
    // so the real defaultGetGitCommonDir resolves to null regardless of host.
    assert.equal(
      candidatesDir("/definitely/does/not/exist/evc-default-deps"),
      join("/definitely/does/not/exist/evc-default-deps", ".ievo", "evolution-candidates"),
    );
  });

  it("joins <git-common-dir>/ievo/evolution-candidates when inside a git working tree", () => {
    const deps = { getGitCommonDir: () => "/repo/.git" };
    assert.equal(candidatesDir("/repo", deps), join("/repo/.git", GIT_COMMON_SUBDIR, "evolution-candidates"));
  });

  it("uses the git-common-dir location even when projectRoot is a linked worktree elsewhere", () => {
    // The whole point of the relocation: a worktree's own path never appears
    // in the resolved candidates dir once getGitCommonDir resolves it to the
    // shared main-checkout .git.
    const deps = { getGitCommonDir: () => "/main-checkout/.git" };
    const dir = candidatesDir("/some/other/worktree/path", deps);
    assert.equal(dir, join("/main-checkout/.git", GIT_COMMON_SUBDIR, "evolution-candidates"));
    assert.ok(!dir.includes("worktree"));
  });
});

describe("defaultGetGitCommonDir (#564)", () => {
  it("returns null when the spawn itself throws", () => {
    assert.equal(defaultGetGitCommonDir("/proj", () => { throw new Error("boom"); }), null);
  });

  it("returns null when spawnImpl returns a falsy result", () => {
    assert.equal(defaultGetGitCommonDir("/proj", () => null), null);
  });

  it("returns null when spawnImpl reports a spawn error (e.g. git binary missing)", () => {
    const spawnImpl = () => ({ error: Object.assign(new Error("not found"), { code: "ENOENT" }), status: null, stdout: "" });
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl), null);
  });

  it("returns null on a non-zero exit status (not a git repo)", () => {
    const spawnImpl = () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository\n" });
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl), null);
  });

  it("returns null when stdout is empty or whitespace-only despite a zero exit", () => {
    const spawnImpl = () => ({ status: 0, stdout: "   \n" });
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl), null);
  });

  it("returns null when stdout is missing entirely (nullish-coalescing fallback)", () => {
    const spawnImpl = () => ({ status: 0 }); // no stdout field at all
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl), null);
  });

  it("resolves a relative git-common-dir (main checkout: '.git') against projectRoot", () => {
    const spawnImpl = () => ({ status: 0, stdout: ".git\n" });
    assert.equal(defaultGetGitCommonDir("/repo", spawnImpl, () => true), resolve("/repo", ".git"));
  });

  it("passes an already-absolute git-common-dir (linked worktree) through resolve() unchanged", () => {
    const spawnImpl = () => ({ status: 0, stdout: "/main-checkout/.git\n" });
    assert.equal(defaultGetGitCommonDir("/some/worktree", spawnImpl, () => true), "/main-checkout/.git");
  });

  // --- #564 vuln-scan follow-up: plausibility check on the resolved dir (CWE-73) ---

  it("returns null when the resolved directory does not look like a git dir (existsImpl all false)", () => {
    const spawnImpl = () => ({ status: 0, stdout: "/not-really-a-git-dir\n" });
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl, () => false), null);
  });

  it("returns the resolved directory when it looks like a git dir (HEAD + objects + refs all present)", () => {
    const spawnImpl = () => ({ status: 0, stdout: "/real/.git\n" });
    const seen = [];
    const existsImpl = (p) => { seen.push(p); return true; };
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl, existsImpl), "/real/.git");
    assert.deepEqual(seen.sort(), [join("/real/.git", "HEAD"), join("/real/.git", "objects"), join("/real/.git", "refs")].sort());
  });

  it("short-circuits on the first missing entry (existsImpl not called for the rest)", () => {
    const spawnImpl = () => ({ status: 0, stdout: "/partial/.git\n" });
    const calls = [];
    const existsImpl = (p) => { calls.push(p); return false; };
    assert.equal(defaultGetGitCommonDir("/proj", spawnImpl, existsImpl), null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], join("/partial/.git", "HEAD"));
  });

  it("invokes the real git binary with --git-common-dir and a bounded timeout by default", () => {
    let capturedArgs, capturedOpts;
    const spawnImpl = (cmd, args, opts) => {
      capturedArgs = args;
      capturedOpts = opts;
      return { status: 0, stdout: "/x/.git\n" };
    };
    defaultGetGitCommonDir("/proj", spawnImpl);
    assert.deepEqual(capturedArgs, ["rev-parse", "--git-common-dir"]);
    assert.equal(capturedOpts.cwd, "/proj");
    assert.equal(typeof capturedOpts.timeout, "number");
    assert.ok(capturedOpts.timeout > 0);
  });

  // --- real git, real filesystem: end-to-end sanity beyond the injected-spawn unit tests above ---

  it("resolves the real .git dir for a real git repository (default spawnSync)", () => {
    const root = join(tmpdir(), `evc-gitdir-real-${process.pid}`);
    mkdirSync(root, { recursive: true });
    try {
      const init = spawnSync("git", ["init", "-q"], { cwd: root });
      assert.equal(init.status, 0);
      const dir = defaultGetGitCommonDir(root);
      assert.equal(dir, resolve(root, ".git"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for a real, non-git directory (default spawnSync)", () => {
    const root = join(tmpdir(), `evc-gitdir-none-${process.pid}`);
    mkdirSync(root, { recursive: true });
    try {
      assert.equal(defaultGetGitCommonDir(root), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for a nonexistent directory (default spawnSync)", () => {
    assert.equal(defaultGetGitCommonDir(join(tmpdir(), `evc-gitdir-missing-${process.pid}`)), null);
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

  it("strips control characters from the invalid-id message (CWE-150, skills#632)", () => {
    // No alphanumeric survivor (an ANSI SGR sequence like \x1b[31m carries
    // digits/letters that would sanitize to a non-empty `s` and never reach
    // the throw) — pure separators/ESC so the throw branch is hit, then the
    // RAW `id` embedded in the message must come back with the ESC byte gone.
    assert.throws(
      () => sanitizeSessionId("//\x1b//"),
      (err) => {
        assert.match(err.message, /invalid session id/);
        assert.doesNotMatch(err.message, /\x1b/);
        return true;
      },
    );
  });
});

describe("sessionFilePath", () => {
  it("builds <root>/.ievo/evolution-candidates/<id>.jsonl on the legacy fallback", () => {
    assert.equal(
      sessionFilePath("/p", "sess1", NO_GIT),
      join("/p", ".ievo", "evolution-candidates", "sess1.jsonl"),
    );
  });

  it("defaults deps to {} when omitted (real getGitCommonDir, nonexistent root falls back)", () => {
    assert.equal(
      sessionFilePath("/definitely/does/not/exist/evc-sfp-default-deps", "sess1"),
      join("/definitely/does/not/exist/evc-sfp-default-deps", ".ievo", "evolution-candidates", "sess1.jsonl"),
    );
  });

  it("propagates the sanitize error for an unusable id", () => {
    assert.throws(() => sessionFilePath("/p", "", NO_GIT), /invalid session id/);
  });

  it("builds <git-common-dir>/ievo/evolution-candidates/<id>.jsonl when getGitCommonDir resolves", () => {
    const deps = { getGitCommonDir: () => "/repo/.git" };
    assert.equal(
      sessionFilePath("/repo", "sess1", deps),
      join("/repo/.git", GIT_COMMON_SUBDIR, "evolution-candidates", "sess1.jsonl"),
    );
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
  const fakeStat = (isFile, size) => () => ({ isFile: () => isFile, size });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when the session file is absent (ENOENT at the stat step)", () => {
    assert.deepEqual(readSessionCandidates(join(root, "nope.jsonl")), []);
  });

  it("parses candidates from an existing file (real fs, default statImpl)", () => {
    writeSession(root, "s1", [{ ts: "2026-01-01T00:00:00Z", scope: "unclassified", text: "hi" }]);
    const out = readSessionCandidates(sessionFilePath(root, "s1", NO_GIT));
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "hi");
  });

  it("rethrows a non-ENOENT read error (e.g. EACCES)", () => {
    const boom = () => { const e = new Error("denied"); e.code = "EACCES"; throw e; };
    assert.throws(() => readSessionCandidates("/whatever", boom, fakeStat(true, 10)), /denied/);
  });

  it("rethrows a non-ENOENT stat error", () => {
    const boom = () => { const e = new Error("perm"); e.code = "EACCES"; throw e; };
    assert.throws(() => readSessionCandidates("/whatever", readFileSync, boom), /perm/);
  });

  it("skips (returns []) a non-regular file per lstat, e.g. a symlink — not followed, not thrown (CWE-59, #643)", () => {
    assert.deepEqual(readSessionCandidates("/whatever", readFileSync, fakeStat(false, 10)), []);
  });

  it("skips (returns []) a regular file exceeding MAX_TEXT_FILE_BYTES", () => {
    assert.deepEqual(
      readSessionCandidates("/whatever", readFileSync, fakeStat(true, MAX_TEXT_FILE_BYTES + 1)),
      [],
    );
  });

  it("reads a regular file exactly at the MAX_TEXT_FILE_BYTES cap", () => {
    const readImpl = () => '{"ts":"2026-01-01T00:00:00Z","text":"at cap"}\n';
    const out = readSessionCandidates("/whatever", readImpl, fakeStat(true, MAX_TEXT_FILE_BYTES));
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "at cap");
  });

  it("skips a REAL symlink at the leaf, end-to-end (default statImpl, no readImpl call)", () => {
    const symlinkRoot = join(tmpdir(), `evc-read-symlink-${process.pid}`);
    const targetPath = join(symlinkRoot, "target.jsonl");
    const linkPath = join(symlinkRoot, "link.jsonl");
    mkdirSync(symlinkRoot, { recursive: true });
    writeFileSync(targetPath, '{"ts":"2026-01-01T00:00:00Z","text":"should never surface"}\n', "utf-8");
    symlinkSync(targetPath, linkPath, "file");
    try {
      let readCalled = false;
      const out = readSessionCandidates(linkPath, () => { readCalled = true; throw new Error("must not read through a symlink"); });
      assert.deepEqual(out, []);
      assert.equal(readCalled, false);
    } finally {
      rmSync(symlinkRoot, { recursive: true, force: true });
    }
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
    const res = appendCandidate({ projectRoot, sessionId: "sess-A", text: "  we always pin deps  " }, NO_GIT);
    assert.equal(res.written, true);
    assert.equal(res.record.text, "we always pin deps");
    assert.equal(res.record.scope, DEFAULT_SCOPE);
    assert.match(res.record.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO-8601 from real Date
    const onDisk = readSessionCandidates(sessionFilePath(projectRoot, "sess-A", NO_GIT));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].text, "we always pin deps");
  });

  it("stamps an injected ts and scope", () => {
    const projectRoot = join(root, "p2");
    const res = appendCandidate({
      projectRoot, sessionId: "sess-B", text: "prefer X", scope: "project-wide", ts: "2026-07-04T00:00:00Z",
    }, NO_GIT);
    assert.equal(res.record.ts, "2026-07-04T00:00:00Z");
    assert.equal(res.record.scope, "project-wide");
  });

  it("dedups an identical (scope, text) candidate within the same session", () => {
    const projectRoot = join(root, "p3");
    const first = appendCandidate({ projectRoot, sessionId: "s", text: "same", ts: "2026-07-04T00:00:00Z" }, NO_GIT);
    assert.equal(first.written, true);
    const second = appendCandidate({ projectRoot, sessionId: "s", text: "same", ts: "2026-07-04T01:00:00Z" }, NO_GIT);
    assert.equal(second.written, false);
    assert.equal(second.reason, "duplicate");
    assert.equal(readSessionCandidates(sessionFilePath(projectRoot, "s", NO_GIT)).length, 1);
  });

  it("treats an existing record with no scope field as DEFAULT_SCOPE for dedup (nullish coalescing)", () => {
    const projectRoot = join(root, "p4");
    // Pre-seed a raw line WITHOUT a scope field.
    writeSession(projectRoot, "s", [{ ts: "2026-07-04T00:00:00Z", text: "legacy" }]);
    const res = appendCandidate({ projectRoot, sessionId: "s", text: "legacy", scope: DEFAULT_SCOPE }, NO_GIT);
    assert.equal(res.written, false);
    assert.equal(res.reason, "duplicate");
  });

  it("degrades dedup to 'no existing candidates' (does not throw) when the session file itself is non-regular per lstat (#643)", () => {
    // The session file this call dedups against is server-controlled, not
    // attacker-controlled — but readSessionCandidates' new lstat guard now
    // sits in this call path too, so confirm it degrades the same way an
    // absent file always has (empty existing list, write proceeds) instead of
    // throwing, mirroring the ENOENT case.
    const projectRoot = join(root, "p-nonregular-session-file");
    const writes = [];
    const res = appendCandidate(
      { projectRoot, sessionId: "s", text: "t", ts: "2026-07-04T00:00:00Z" },
      {
        readImpl: () => { throw new Error("must not be called — stat already skipped this entry"); },
        statImpl: () => ({ isFile: () => false, size: 0 }),
        mkdir: () => {},
        appendFile: (p, body) => writes.push([p, body]),
        getGitCommonDir: () => null,
      },
    );
    assert.equal(res.written, true);
    assert.equal(writes.length, 1);
  });

  it("honors the default projectRoot '.' via injected fs deps (no disk writes)", () => {
    const writes = [];
    const res = appendCandidate(
      { sessionId: "s", text: "t", ts: "2026-07-04T00:00:00Z" },
      {
        // statImpl reports a regular file so readSessionCandidates' new lstat
        // guard reaches this readImpl mock instead of short-circuiting on a
        // (real, default-statImpl) ENOENT for a path that was never written.
        statImpl: () => ({ isFile: () => true, size: 1 }),
        readImpl: () => { const e = new Error("nf"); e.code = "ENOENT"; throw e; },
        mkdir: () => {},
        appendFile: (p, body) => writes.push([p, body]),
        getGitCommonDir: () => null,
      },
    );
    assert.equal(res.written, true);
    assert.equal(writes.length, 1);
    // Path is rooted at the default "." → contains .ievo/evolution-candidates.
    assert.ok(res.filePath.includes(join(".ievo", "evolution-candidates")));
  });

  it("writes under <git-common-dir>/ievo/evolution-candidates when getGitCommonDir resolves (no disk writes)", () => {
    const writes = [];
    const projectRoot = join(root, "p-git");
    const res = appendCandidate(
      { projectRoot, sessionId: "s", text: "t", ts: "2026-07-04T00:00:00Z" },
      {
        statImpl: () => ({ isFile: () => true, size: 1 }),
        readImpl: () => { const e = new Error("nf"); e.code = "ENOENT"; throw e; },
        mkdir: () => {},
        appendFile: (p, body) => writes.push([p, body]),
        getGitCommonDir: () => join(projectRoot, ".git"),
      },
    );
    assert.equal(res.written, true);
    assert.equal(
      res.filePath,
      join(projectRoot, ".git", GIT_COMMON_SUBDIR, "evolution-candidates", "s.jsonl"),
    );
    assert.ok(!res.filePath.includes(join(".ievo", "evolution-candidates")));
  });

  // --- --text-file (#373: never interpolate free-form correction text into a
  // Bash argument — read it from a file the caller already wrote instead;
  // #523: the path itself is untrusted — contained to the project's own
  // .ievo/, must be a regular file under the size cap, and is scrubbed
  // before being trimmed/persisted) ---

  // Builds a --text-file path INSIDE <projectRoot>/.ievo/ — the only
  // directory assertTextFileAllowed permits — so a test not exercising
  // containment itself doesn't trip it.
  function allowedTextFile(projectRoot, name, content) {
    const dir = join(projectRoot, IEVO_DIR);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, name);
    writeFileSync(p, content, "utf-8");
    return p;
  }

  it("reads the correction from --text-file instead of --text (real fs)", () => {
    const projectRoot = join(root, "tf1");
    const textFilePath = allowedTextFile(projectRoot, "correction.txt", "  we always pin deps via --text-file  \n");
    const res = appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT);
    assert.equal(res.written, true);
    assert.equal(res.record.text, "we always pin deps via --text-file");
  });

  it("--text-file takes precedence when both --text and --text-file are given", () => {
    const projectRoot = join(root, "tf2");
    const textFilePath = allowedTextFile(projectRoot, "correction.txt", "from the file");
    const res = appendCandidate({ projectRoot, sessionId: "s", text: "from --text", textFile: textFilePath }, NO_GIT);
    assert.equal(res.record.text, "from the file");
  });

  it("throws a descriptive error when --text-file cannot be read (ENOENT)", () => {
    const projectRoot = join(root, "tf3");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: join(projectRoot, IEVO_DIR, "does-not-exist.txt") }, NO_GIT),
      /could not read --text-file '.*does-not-exist\.txt': /,
    );
  });

  it("strips control characters from the --text-file path AND the wrapped ENOENT message (CWE-150, skills#632)", () => {
    // --text-file is documented (header comment, #523) as attacker-
    // influenceable: a compromised/prompt-injected agent turn could pass a
    // crafted path directly via Bash. lstat's ENOENT message quotes the raw
    // path back verbatim, so both the outer template's own `textFile`
    // interpolation and the wrapped `err.message` need stripping.
    const projectRoot = join(root, "tf-ctl");
    mkdirSync(join(projectRoot, IEVO_DIR), { recursive: true });
    const ghost = join(projectRoot, IEVO_DIR, "ghost-\x1b[31mFAKE\x1b[0m.txt");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: ghost }, NO_GIT),
      (err) => {
        assert.match(err.message, /could not read --text-file/);
        assert.match(err.message, /ENOENT/);
        assert.doesNotMatch(err.message, /\x1b/);
        assert.match(err.message, /FAKE/);
        return true;
      },
    );
  });

  it("treats whitespace-only --text-file content as empty (throws)", () => {
    const projectRoot = join(root, "tf4");
    const textFilePath = allowedTextFile(projectRoot, "correction.txt", "   \n\t\n");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT),
      /non-empty --text or --text-file/,
    );
  });

  it("propagates a non-ENOENT --text-file read error (e.g. EACCES)", () => {
    const boom = () => { const e = new Error("denied"); e.code = "EACCES"; throw e; };
    const projectRoot = join(root, "tf5");
    const textFile = join(projectRoot, IEVO_DIR, "whatever");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile }, {
        statImpl: () => ({ isFile: () => true, size: 10 }),
        realpathImpl: (p) => p, // identity: no symlink involved in this fixture
        readImpl: boom,
        getGitCommonDir: () => null,
      }),
      /could not read --text-file '.*whatever': denied/,
    );
  });

  // --- #523: containment, size cap, non-regular-file rejection, scrub ---

  it("rejects a --text-file path outside the project's .ievo/ directory (containment)", () => {
    const projectRoot = join(root, "tf-contain");
    const outside = join(root, "outside-secret.txt");
    writeFileSync(outside, "not inside .ievo", "utf-8");
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: outside }, NO_GIT),
      /could not read --text-file '.*outside-secret\.txt': must be inside .*\.ievo/,
    );
    assert.equal(existsSync(sessionFilePath(projectRoot, "s", NO_GIT)), false);
  });

  it("rejects a --text-file that is a directory, not a regular file", () => {
    const projectRoot = join(root, "tf-dir");
    const dirAsTextFile = join(projectRoot, IEVO_DIR, "not-a-file");
    mkdirSync(dirAsTextFile, { recursive: true });
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: dirAsTextFile }, NO_GIT),
      /could not read --text-file '.*not-a-file': not a regular file/,
    );
  });

  it("rejects a --text-file exceeding MAX_TEXT_FILE_BYTES", () => {
    const projectRoot = join(root, "tf-big");
    const textFilePath = allowedTextFile(projectRoot, "big.txt", "x".repeat(MAX_TEXT_FILE_BYTES + 1));
    assert.throws(
      () => appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT),
      new RegExp(`could not read --text-file '.*big\\.txt': exceeds ${MAX_TEXT_FILE_BYTES} bytes`),
    );
  });

  it("scrubs a live-looking secret out of --text-file content before persisting", () => {
    const projectRoot = join(root, "tf-scrub");
    const textFilePath = allowedTextFile(
      projectRoot,
      "correction.txt",
      "the fix used ghp_abcdefghijklmnopqrstuvwxyz0123456789AB by mistake",
    );
    const res = appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT);
    assert.equal(res.written, true);
    assert.doesNotMatch(res.record.text, /ghp_[A-Za-z0-9]{30,}/);
    assert.match(res.record.text, /\[REDACTED\]/);
  });

  // scrub() is not redaction-only — it also rewrites $HOME paths and truncates.
  // Routing --text-file through it therefore changed what a captured correction
  // looks like on disk (they were persisted verbatim before v0.75.11). Both
  // stages are pinned here so a later scrub.mjs change can't move --text-file's
  // persisted shape silently (#523 review finding).

  it("truncates --text-file content past scrub()'s MAX_CODEPOINTS cap (capture-behaviour change)", () => {
    const projectRoot = join(root, "tf-truncate");
    // Plain filler: no secret shape and no $HOME shape, so of scrub()'s four
    // stages only the truncation one can change this input.
    const body = "a".repeat(MAX_CODEPOINTS + 25);
    const textFilePath = allowedTextFile(projectRoot, "correction.txt", body);
    const res = appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT);
    assert.equal(res.written, true);
    assert.equal(res.record.text, "a".repeat(MAX_CODEPOINTS) + TRUNCATION_MARKER);
    assert.ok(res.record.text.endsWith(TRUNCATION_MARKER));
  });

  it("rewrites a $HOME-absolute path in --text-file content to ~ (capture-behaviour change)", () => {
    const projectRoot = join(root, "tf-home");
    const home = homedir();
    const textFilePath = allowedTextFile(projectRoot, "correction.txt", `see ${home}/notes/pinning.md for the rule`);
    const res = appendCandidate({ projectRoot, sessionId: "s", textFile: textFilePath }, NO_GIT);
    assert.equal(res.written, true);
    assert.equal(res.record.text, "see ~/notes/pinning.md for the rule");
    assert.ok(!res.record.text.includes(home));
  });
});

// ---------------------------------------------------------------------------
// listSessions / countPending
// ---------------------------------------------------------------------------

describe("listSessions", () => {
  const root = join(tmpdir(), `evc-list-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns [] when the candidates dir does not exist (ENOENT)", () => {
    assert.deepEqual(listSessions(join(root, "empty-proj"), NO_GIT), []);
  });

  it("rethrows a non-ENOENT readdir error", () => {
    const boom = () => { const e = new Error("perm"); e.code = "EACCES"; throw e; };
    assert.throws(() => listSessions(root, { ...NO_GIT, readdir: boom }), /perm/);
  });

  it("rethrows a non-ENOENT readdir error from the legacy dir when the git-common-dir scan already succeeded", () => {
    // currentDir !== legacyDir (git project) exercises the SECOND loop
    // iteration's error path — the first test above only covers the
    // single-dir (non-git) case, where the two directories collapse to one.
    const projectRoot = join(root, "git-proj-legacy-error");
    const boom = () => { const e = new Error("perm"); e.code = "EACCES"; throw e; };
    const gitDir = join(projectRoot, ".git");
    const currentDir = join(gitDir, GIT_COMMON_SUBDIR, "evolution-candidates");
    assert.throws(
      () => listSessions(projectRoot, {
        getGitCommonDir: () => gitDir,
        readdir: (dir) => (dir === currentDir ? [] : boom()),
      }),
      /perm/,
    );
  });

  it("lists only .jsonl session files, ignoring pending.md and other artefacts", () => {
    const projectRoot = join(root, "proj");
    writeSession(projectRoot, "sA", [{ ts: "2026-01-02T00:00:00Z", text: "one" }]);
    writeSession(projectRoot, "sB", [
      { ts: "2026-01-03T00:00:00Z", text: "two" },
      { ts: "2026-01-04T00:00:00Z", text: "three" },
    ]);
    // Non-session artefacts that must be ignored.
    writeFileSync(join(candidatesDir(projectRoot, NO_GIT), "pending.md"), "# parked\n", "utf-8");
    writeFileSync(join(candidatesDir(projectRoot, NO_GIT), "README.txt"), "notes\n", "utf-8");

    const sessions = listSessions(projectRoot, NO_GIT).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((s) => s.sessionId), ["sA", "sB"]);
    assert.equal(sessions[0].candidates.length, 1);
    assert.equal(sessions[1].candidates.length, 2);
    assert.equal(sessions[1].latestTs, "2026-01-04T00:00:00Z");
  });

  // --- #564: merge across the git-common-dir (current) and legacy locations ---

  it("merges sessions from both the current and legacy locations for a git project", () => {
    const projectRoot = join(root, "git-proj-merge");
    const gitDir = join(projectRoot, ".git");
    const currentDir = join(gitDir, GIT_COMMON_SUBDIR, "evolution-candidates");
    const legacyDir = legacyCandidatesDir(projectRoot);
    writeSessionAt(currentDir, "new-sess", [{ ts: "2026-02-01T00:00:00Z", text: "captured post-relocation" }]);
    writeSessionAt(legacyDir, "old-sess", [{ ts: "2026-01-01T00:00:00Z", text: "captured pre-relocation" }]);

    const sessions = listSessions(projectRoot, { getGitCommonDir: () => gitDir })
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    assert.deepEqual(sessions.map((s) => s.sessionId), ["new-sess", "old-sess"]);
    assert.equal(sessions[0].filePath, join(currentDir, "new-sess.jsonl"));
    assert.equal(sessions[1].filePath, join(legacyDir, "old-sess.jsonl"));
  });

  it("prefers the current-location copy when the same session id exists in both locations", () => {
    const projectRoot = join(root, "git-proj-collision");
    const gitDir = join(projectRoot, ".git");
    const currentDir = join(gitDir, GIT_COMMON_SUBDIR, "evolution-candidates");
    const legacyDir = legacyCandidatesDir(projectRoot);
    writeSessionAt(currentDir, "dup", [{ ts: "2026-02-01T00:00:00Z", text: "current copy" }]);
    writeSessionAt(legacyDir, "dup", [{ ts: "2026-01-01T00:00:00Z", text: "legacy copy" }]);

    const sessions = listSessions(projectRoot, { getGitCommonDir: () => gitDir });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].filePath, join(currentDir, "dup.jsonl"));
    assert.equal(sessions[0].candidates[0].text, "current copy");
  });

  it("returns [] for a git project with neither location populated", () => {
    const projectRoot = join(root, "git-proj-empty");
    const gitDir = join(projectRoot, ".git");
    assert.deepEqual(listSessions(projectRoot, { getGitCommonDir: () => gitDir }), []);
  });

  it("skips a symlinked *.jsonl entry in the legacy dir instead of following it (CWE-59, #643)", () => {
    // Simulates a malicious/compromised repo committing a symlink at
    // <projectRoot>/.ievo/evolution-candidates/evil.jsonl (git tracks symlinks
    // as blob mode 120000 — no git-internals bypass needed). A real readFileSync
    // would follow it straight through to whatever it points at; the session
    // must instead surface with zero candidates, and the outside target's
    // content must never be read/parsed.
    const projectRoot = join(root, "proj-symlink");
    const legacyDir = legacyCandidatesDir(projectRoot);
    const outsideTarget = join(root, "outside-target.jsonl");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(outsideTarget, '{"ts":"2026-01-01T00:00:00Z","text":"exfiltrated secret"}\n', "utf-8");
    symlinkSync(outsideTarget, join(legacyDir, "evil.jsonl"), "file");
    writeSessionAt(legacyDir, "legit", [{ ts: "2026-01-02T00:00:00Z", text: "real candidate" }]);

    const sessions = listSessions(projectRoot, NO_GIT).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    assert.deepEqual(sessions.map((s) => s.sessionId), ["evil", "legit"]);
    assert.deepEqual(sessions[0].candidates, []);
    assert.equal(sessions[1].candidates[0].text, "real candidate");
  });

  it("skips an oversized *.jsonl entry in the legacy dir (CWE-400)", () => {
    const projectRoot = join(root, "proj-oversized");
    const legacyDir = legacyCandidatesDir(projectRoot);
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "huge.jsonl"), "x".repeat(MAX_TEXT_FILE_BYTES + 1), "utf-8");

    const sessions = listSessions(projectRoot, NO_GIT);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].candidates, []);
  });
});

describe("countPending", () => {
  const root = join(tmpdir(), `evc-count-${process.pid}`);
  after(() => rmSync(root, { recursive: true, force: true }));

  it("returns 0 when there are no sessions", () => {
    assert.equal(countPending(join(root, "none"), NO_GIT), 0);
  });

  it("sums candidates across all sessions", () => {
    const projectRoot = join(root, "proj");
    writeSession(projectRoot, "s1", [{ ts: "2026-01-01T00:00:00Z", text: "a" }]);
    writeSession(projectRoot, "s2", [
      { ts: "2026-01-02T00:00:00Z", text: "b" },
      { ts: "2026-01-03T00:00:00Z", text: "c" },
    ]);
    assert.equal(countPending(projectRoot, NO_GIT), 3);
  });

  it("sums candidates across both the current and legacy locations for a git project", () => {
    const projectRoot = join(root, "git-proj-sum");
    const gitDir = join(projectRoot, ".git");
    const currentDir = join(gitDir, GIT_COMMON_SUBDIR, "evolution-candidates");
    const legacyDir = legacyCandidatesDir(projectRoot);
    writeSessionAt(currentDir, "s1", [{ ts: "2026-02-01T00:00:00Z", text: "a" }]);
    writeSessionAt(legacyDir, "s2", [
      { ts: "2026-01-01T00:00:00Z", text: "b" },
      { ts: "2026-01-02T00:00:00Z", text: "c" },
    ]);
    assert.equal(countPending(projectRoot, { getGitCommonDir: () => gitDir }), 3);
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
    const res = pruneSessions(projectRoot, undefined, NO_GIT); // default keep = 10
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

    const res = pruneSessions(projectRoot, 2, NO_GIT);
    // Ordered most-recent-first: A(03), then D/C(02, id desc → D before C), then B(01).
    // Keep A + D; remove C and B.
    assert.equal(res.kept, 2);
    assert.equal(res.removed.length, 2);
    assert.ok(existsSync(sessionFilePath(projectRoot, "A", NO_GIT)));
    assert.ok(existsSync(sessionFilePath(projectRoot, "D", NO_GIT)));
    assert.ok(!existsSync(sessionFilePath(projectRoot, "C", NO_GIT)));
    assert.ok(!existsSync(sessionFilePath(projectRoot, "B", NO_GIT)));
  });

  it("prunes across both the current and legacy locations for a git project (unlinks from whichever dir a session actually lives in)", () => {
    const projectRoot = join(root, "git-proj-prune");
    const gitDir = join(projectRoot, ".git");
    const currentDir = join(gitDir, GIT_COMMON_SUBDIR, "evolution-candidates");
    const legacyDir = legacyCandidatesDir(projectRoot);
    writeSessionAt(currentDir, "new-sess", [{ ts: "2026-02-01T00:00:00Z", text: "a" }]);
    writeSessionAt(legacyDir, "old-sess", [{ ts: "2026-01-01T00:00:00Z", text: "b" }]);

    const res = pruneSessions(projectRoot, 1, { getGitCommonDir: () => gitDir });
    assert.equal(res.kept, 1);
    assert.deepEqual(res.removed, [join(legacyDir, "old-sess.jsonl")]);
    assert.ok(existsSync(join(currentDir, "new-sess.jsonl")));
    assert.ok(!existsSync(join(legacyDir, "old-sess.jsonl")));
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
      ...NO_GIT,
      readdir: () => Object.keys(files),
      statImpl: () => ({ isFile: () => true, size: 1 }),
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

  // --- CWE-150 (skills#632): every CLI-arg echo below is attacker-
  // influenceable the same way --text-file's own header comment documents —
  // a compromised/prompt-injected agent turn issuing crafted argv directly
  // via Bash. main()'s catch (both the parseArgs one and the outer one)
  // echoes these thrown messages verbatim to stderr, a raw terminal/CI log
  // stream. ---

  it("strips control characters from an unknown flag echoed in the thrown message (skills#632)", () => {
    assert.throws(
      () => parseArgs(["node", "x", "--\x1b[31mFAKE\x1b[0m"]),
      (err) => {
        assert.match(err.message, /unknown flag/);
        assert.doesNotMatch(err.message, /\x1b/);
        assert.match(err.message, /FAKE/);
        return true;
      },
    );
  });

  it("strips control characters from a forgotten-value flag echoed in the thrown message (skills#632)", () => {
    assert.throws(
      () => parseArgs(["node", "x", "append", "--text", "--\x1b[31mFAKE\x1b[0m"]),
      (err) => {
        assert.match(err.message, /--text requires a value, got flag/);
        assert.doesNotMatch(err.message, /\x1b/);
        assert.match(err.message, /FAKE/);
        return true;
      },
    );
  });

  it("strips control characters from an invalid --keep value in the thrown message (skills#632)", () => {
    assert.throws(
      () => parseArgs(["node", "x", "prune", "--keep", "abc\x1b[31mFAKE\x1b[0m"]),
      (err) => {
        assert.match(err.message, /--keep requires a non-negative integer/);
        assert.doesNotMatch(err.message, /\x1b/);
        assert.match(err.message, /FAKE/);
        return true;
      },
    );
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
        // Forces legacy path resolution for every main()-level test below —
        // deterministic regardless of whether the OS tmpdir sits inside a git
        // working tree (see NO_GIT). The relocation itself is exercised via
        // the lower-level candidatesDir/appendCandidate/listSessions tests
        // above and the real-git CLI subprocess suite below.
        deps: NO_GIT,
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
    // #523: --help must state the --text-file restriction, not just its shape.
    assert.match(run.logs[0], /--text-file <path> is untrusted input/);
    assert.match(run.logs[0], /inside <project root>\/\.ievo\//);
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
    const textFilePath = join(projectRoot, IEVO_DIR, "m-append-textfile-correction.txt");
    mkdirSync(dirname(textFilePath), { recursive: true });
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

  it("strips control characters from an unknown command echoed in the error (CWE-150, skills#632)", () => {
    // The unrecognized positional command (args.command) comes straight from
    // argv, the same attacker-influenceable-CLI-arg threat model as the
    // enumerated flag-value sites — found while auditing this file for every
    // echo path, not one of the issue's originally cited five.
    const run = makeRun();
    main(["node", "x", "bogus-\x1b[31mFAKE\x1b[0m-cmd"], run.io);
    assert.equal(run.exitCode, 2);
    const errText = run.errs.join("\n");
    assert.match(errText, /unknown or missing command/);
    assert.doesNotMatch(errText, /\x1b/);
    assert.match(errText, /FAKE/);
  });

  it("strips control characters from a raw fs error in main's outer catch (CWE-150, skills#632)", () => {
    // Unlike appendCandidate's re-thrown --text-file message (already
    // sanitized at its own throw site), listSessions's non-ENOENT readdir
    // errors propagate a native fs error message straight through to main's
    // outer catch, unsanitized by anything else in this file — the case the
    // issue's cited main()-outer-catch site (formerly lines 581-583) exists
    // for. Put a FILE where evolution-candidates/ (a directory) is expected:
    // readdirSync then throws ENOTDIR, quoting the path (which carries the
    // control character) verbatim.
    if (process.platform === "win32") return;
    const projectRoot = join(root, "m-list-ctl-\x1b[31mFAKE\x1b[0m");
    mkdirSync(join(projectRoot, IEVO_DIR), { recursive: true });
    writeFileSync(join(projectRoot, IEVO_DIR, CANDIDATES_DIR), "not a directory", "utf-8");
    const run = makeRun();
    main(["node", "x", "list", "--project", projectRoot], run.io);
    assert.equal(run.exitCode, 3);
    const errText = run.errs.join("\n");
    assert.match(errText, /ENOTDIR/);
    assert.doesNotMatch(errText, /\x1b/);
    assert.match(errText, /FAKE/);
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
    const textFilePath = join(projectRoot, IEVO_DIR, "cli-proj-textfile-correction.txt");
    mkdirSync(dirname(textFilePath), { recursive: true });
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

// ---------------------------------------------------------------------------
// Real git worktree removal (#564 — end-to-end proof of the actual fix)
// ---------------------------------------------------------------------------

describe("git worktree relocation, real git (#564)", () => {
  const scratch = join(tmpdir(), `evc-worktree-${process.pid}`);
  const mainRepo = join(scratch, "main-repo");
  const worktree = join(scratch, "wt-feature");

  function git(args, opts = {}) {
    const r = spawnSync("git", args, { cwd: mainRepo, encoding: "utf-8", ...opts });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r;
  }

  function run(args, opts = {}) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: "utf-8", timeout: 30000, ...opts });
  }

  before(() => {
    mkdirSync(mainRepo, { recursive: true });
    git(["init", "-q"]);
    git(["config", "user.email", "evc-test@example.com"]);
    git(["config", "user.name", "evc-test"]);
    writeFileSync(join(mainRepo, "file.txt"), "hi\n", "utf-8");
    git(["add", "file.txt"]);
    git(["commit", "-q", "-m", "init"]);
    git(["worktree", "add", "-q", "-b", "feature", worktree]);
  });
  after(() => rmSync(scratch, { recursive: true, force: true }));

  it("writes a candidate captured inside the worktree to the MAIN checkout's shared .git, not the worktree", () => {
    const appended = run(["append", "--project", worktree, "--session", "wt-sess", "--text", "captured in worktree"]);
    assert.equal(appended.status, 0, appended.stderr);
    const result = JSON.parse(appended.stdout);
    assert.equal(result.written, true);

    const expectedPath = join(mainRepo, ".git", GIT_COMMON_SUBDIR, "evolution-candidates", "wt-sess.jsonl");
    assert.equal(result.filePath, expectedPath);
    assert.ok(existsSync(expectedPath), "candidate file must exist under the main checkout's .git");
    assert.ok(
      !existsSync(join(worktree, IEVO_DIR, CANDIDATES_DIR, "wt-sess.jsonl")),
      "candidate file must NOT exist under the worktree's own .ievo/",
    );
  });

  it("SURVIVES the worktree's removal — the exact failure mode reported in #564", () => {
    // Precondition from the previous test: a candidate was captured while
    // working inside `worktree`. Now simulate exactly what the issue
    // describes — the worktree is deleted (branch merged / task done) before
    // anyone reviewed the pending candidate.
    rmSync(worktree, { recursive: true, force: true });
    assert.ok(!existsSync(worktree));

    // Querying from the (still-present) main checkout must still find it —
    // pre-#564 this candidate would have been deleted along with the
    // worktree and permanently lost.
    const counted = run(["count", "--project", mainRepo]);
    assert.equal(counted.status, 0, counted.stderr);
    assert.equal(counted.stdout.trim(), "1");

    const listed = run(["list", "--project", mainRepo]);
    assert.equal(listed.status, 0, listed.stderr);
    const sessions = JSON.parse(listed.stdout);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, "wt-sess");
    assert.equal(sessions[0].candidates[0].text, "captured in worktree");
  });

  it("resolves the main checkout's OWN git-common-dir to the same shared location (relative '.git' case)", () => {
    // Run from the main checkout itself (not a linked worktree) — the
    // '.git' git rev-parse prints here is relative, exercising the other
    // half of defaultGetGitCommonDir's resolve() normalization (the
    // worktree case above already exercised the absolute-path half).
    const appended = run(["append", "--project", mainRepo, "--session", "main-sess", "--text", "captured in main checkout"]);
    assert.equal(appended.status, 0, appended.stderr);
    const result = JSON.parse(appended.stdout);
    assert.equal(result.filePath, join(mainRepo, ".git", GIT_COMMON_SUBDIR, "evolution-candidates", "main-sess.jsonl"));
  });
});
