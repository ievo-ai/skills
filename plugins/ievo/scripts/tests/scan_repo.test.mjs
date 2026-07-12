// Tests for scan_repo.mjs — deterministic repo scanner.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/scan_repo.test.mjs
//
// Phase plan (matches the v0.6.7 export refactor):
//   B — pure-function tests (top sections): truncate, isoNow, isoDate,
//       parseArgs, parseFrontmatter, isDir/fileExists, detectLayout,
//       list*Sorted, enumerateHooks, enumerateMcp, isCliEntry, constants.
//   C — execImpl-injected tests for shell-calling functions:
//       run, checkoutOrRefresh, getCommitSha, getLastCommitDate,
//       getDefaultBranch, countRecentCommits.
//   D — integration: enumeratePlugins / enumerateOnePlugin /
//       enumerateStandalone* + renderIndexMd + main() end-to-end,
//       using real fs fixtures via mkdirSync/writeFileSync in tmp
//       dirs and execImpl-mocked main.
//   E — CLI subprocess (spawnSync) covering the module-load entry
//       guard, plus gap-fill for nullish-coalescing and ternary
//       false-paths to reach literal 100/100/100.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, utimesSync, chmodSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  TTL_SECONDS,
  FRONTMATTER_RE,
  OWNER_REPO_RE,
  isValidOwnerRepo,
  assertContained,
  truncate,
  escapeMdCell,
  isoNow,
  isoDate,
  parseArgs,
  parseFrontmatter,
  renderIndexMd,
  isCliEntry,
  isDir,
  fileExists,
  detectLayout,
  listDirSorted,
  listFilesSorted,
  enumerateHooks,
  enumerateMcp,
  enumeratePlugins,
  enumerateOnePlugin,
  enumerateStandaloneAgents,
  enumerateStandaloneSkills,
  enumerateStandaloneCommands,
  run,
  checkoutOrRefresh,
  getCommitSha,
  getLastCommitDate,
  getDefaultBranch,
  countRecentCommits,
  main,
} from "../scan_repo.mjs";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  // SCRIPT_VERSION is the scanner format-version (community-index-bot lineage),
  // intentionally DECOUPLED from plugin.json — clarified in v0.6.6 by Eva PR #47.
  // We assert semver shape only, not value coupling.
  it("SCRIPT_VERSION has semver shape (not coupled to plugin.json)", () => {
    assert.match(SCRIPT_VERSION, /^\d+\.\d+\.\d+$/);
  });
  it("TTL_SECONDS is positive integer (7 days)", () => {
    assert.equal(TTL_SECONDS, 7 * 24 * 3600);
  });
  it("FRONTMATTER_RE matches a YAML frontmatter block", () => {
    assert.ok(FRONTMATTER_RE.test("---\nname: foo\n---\nbody"));
  });
});

// ---------------------------------------------------------------------------
// truncate (pure)
// ---------------------------------------------------------------------------

describe("truncate", () => {
  it("returns empty string for null / undefined / empty", () => {
    assert.equal(truncate(null, 10), "");
    assert.equal(truncate(undefined, 10), "");
    assert.equal(truncate("", 10), "");
  });
  it("collapses whitespace runs to single space", () => {
    assert.equal(truncate("a   b\n\t  c", 100), "a b c");
  });
  it("returns text unchanged when within limit", () => {
    assert.equal(truncate("hello", 10), "hello");
  });
  it("truncates with ellipsis when over limit", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
  });
  it("counts Unicode code points (not UTF-16 units) — emoji-safe", () => {
    // "ab👨‍👩‍👧cd" has emoji that's multiple code points; verify ellipsis lands sensibly.
    const out = truncate("abcdefghijklmnop", 6);
    assert.equal(out.length, 6);
    assert.ok(out.endsWith("…"));
  });
  it("trims leading/trailing whitespace before measuring", () => {
    assert.equal(truncate("  short  ", 10), "short");
  });
});

// ---------------------------------------------------------------------------
// escapeMdCell (pure) — CWE-116 fix: neutralizes Markdown table/code-span
// syntax in attacker-controlled scanned-repo content before interpolation.
// ---------------------------------------------------------------------------

describe("escapeMdCell", () => {
  it("returns empty string for null / undefined / empty", () => {
    assert.equal(escapeMdCell(null), "");
    assert.equal(escapeMdCell(undefined), "");
    assert.equal(escapeMdCell(""), "");
  });
  it("leaves plain text unchanged", () => {
    assert.equal(escapeMdCell("sonnet"), "sonnet");
  });
  it("escapes pipe so it can't fabricate a table column/row", () => {
    assert.equal(escapeMdCell("sonnet | [approve](javascript:x) | fake-row"), "sonnet \\| [approve](javascript:x) \\| fake-row");
  });
  it("replaces backticks so an inline code span can't be closed early", () => {
    assert.equal(escapeMdCell("code`span`break"), "code'span'break");
  });
  it("escapes backslashes before introducing its own", () => {
    assert.equal(escapeMdCell("a\\b|c"), "a\\\\b\\|c");
  });
  it("collapses embedded control characters (JSON-sourced values can carry literal \\n/\\r/\\t) to spaces", () => {
    assert.equal(escapeMdCell("line1\nline2\ttab\rcr"), "line1 line2 tab cr");
  });
  it("collapses whitespace runs and trims, mirroring truncate", () => {
    assert.equal(escapeMdCell("  a   b  "), "a b");
  });
  it("coerces non-string input to string", () => {
    assert.equal(escapeMdCell(42), "42");
  });
  it("preserves a literal 0 (falsy but meaningful) instead of treating it as absent", () => {
    assert.equal(escapeMdCell(0), "0");
  });
});

// ---------------------------------------------------------------------------
// isoNow / isoDate (pure-ish; Date wrapper)
// ---------------------------------------------------------------------------

describe("isoNow", () => {
  it("emits the Python-compatible '+00:00' suffix (not 'Z')", () => {
    const s = isoNow();
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  });
});

describe("isoDate", () => {
  it("default (0 days ago) returns today's UTC date", () => {
    const s = isoDate(0);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(s, today);
  });
  it("N days ago returns the past UTC date", () => {
    const s = isoDate(7);
    const now = new Date();
    now.setUTCDate(now.getUTCDate() - 7);
    assert.equal(s, now.toISOString().slice(0, 10));
  });
  it("output is YYYY-MM-DD shape (10 chars)", () => {
    assert.equal(isoDate(0).length, 10);
    assert.match(isoDate(0), /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// parseArgs (pure)
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns defaults for empty argv", () => {
    const a = parseArgs(["node", "scan_repo.mjs"]);
    assert.equal(a.repo, null);
    assert.equal(a.outputDir, ".");
    assert.equal(a.force, false);
    assert.match(a.checkoutDir, /\.ievo[\/\\]checkouts$/);
  });
  it("positional arg becomes repo", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/name"]);
    assert.equal(a.repo, "owner/name");
  });
  it("only the first positional is treated as repo", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "first", "second"]);
    assert.equal(a.repo, "first");
  });
  it("--output-dir overrides", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "--output-dir", "/tmp/out"]);
    assert.equal(a.outputDir, "/tmp/out");
  });
  it("--checkout-dir overrides", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "--checkout-dir", "/tmp/co"]);
    assert.equal(a.checkoutDir, "/tmp/co");
  });
  it("--force-refresh sets flag", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "--force-refresh"]);
    assert.equal(a.force, true);
  });
  it("combines flags and positional in any order", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "--output-dir", "/out", "owner/name", "--force-refresh"]);
    assert.equal(a.outputDir, "/out");
    assert.equal(a.repo, "owner/name");
    assert.equal(a.force, true);
  });
});

// ---------------------------------------------------------------------------
// isValidOwnerRepo / OWNER_REPO_RE (pure) — CWE-22 path-traversal guard
// ---------------------------------------------------------------------------

describe("isValidOwnerRepo", () => {
  it("OWNER_REPO_RE matches a plain owner/repo slug directly", () => {
    assert.ok(OWNER_REPO_RE.test("ievo-ai/skills"));
    assert.ok(!OWNER_REPO_RE.test("missing-slash"));
  });
  it("accepts a normal owner/repo slug", () => {
    assert.equal(isValidOwnerRepo("ievo-ai/skills"), true);
  });
  it("accepts a repo segment with dots/underscores/hyphens", () => {
    assert.equal(isValidOwnerRepo("owner/repo.name_with-chars"), true);
  });
  it("accepts a 39-char owner (GitHub's max)", () => {
    assert.equal(isValidOwnerRepo(`${"a".repeat(39)}/repo`), true);
  });
  it("rejects the exact traversal payload from the CWE-22 report", () => {
    assert.equal(isValidOwnerRepo("../../../../tmp/evil/payload"), false);
  });
  it("rejects a value with no slash", () => {
    assert.equal(isValidOwnerRepo("missing-slash"), false);
  });
  it("rejects a value with more than one slash", () => {
    assert.equal(isValidOwnerRepo("owner/sub/repo"), false);
  });
  it("rejects '..' as the whole repo segment even though its chars are in-charset", () => {
    assert.equal(isValidOwnerRepo("owner/.."), false);
  });
  it("rejects '../foo' — owner charset excludes '.' before includes('..') is even reached", () => {
    assert.equal(isValidOwnerRepo("../foo"), false);
  });
  it("rejects an owner segment over 39 chars", () => {
    assert.equal(isValidOwnerRepo(`${"a".repeat(40)}/repo`), false);
  });
  it("rejects an owner segment starting with a hyphen", () => {
    assert.equal(isValidOwnerRepo("-owner/repo"), false);
  });
  it("rejects null, undefined, and non-string input", () => {
    assert.equal(isValidOwnerRepo(null), false);
    assert.equal(isValidOwnerRepo(undefined), false);
    assert.equal(isValidOwnerRepo(42), false);
  });
  it("rejects the empty string", () => {
    assert.equal(isValidOwnerRepo(""), false);
  });
});

// ---------------------------------------------------------------------------
// assertContained (pure) — path-containment last line of defense
// ---------------------------------------------------------------------------

describe("assertContained", () => {
  it("does not throw when target is a child of parentDir", () => {
    assert.doesNotThrow(() => assertContained("/tmp/checkouts/owner-repo", "/tmp/checkouts"));
  });
  it("does not throw when target equals parentDir exactly", () => {
    assert.doesNotThrow(() => assertContained("/tmp/checkouts", "/tmp/checkouts"));
  });
  it("throws when target resolves outside parentDir via '..'", () => {
    assert.throws(
      () => assertContained("/tmp/checkouts/../../etc/passwd", "/tmp/checkouts"),
      /refusing to write outside/,
    );
  });
  it("throws when target is an unrelated sibling directory", () => {
    assert.throws(
      () => assertContained("/tmp/other-dir/file.md", "/tmp/checkouts"),
      /refusing to write outside/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter (impure — reads files)
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  const tmp = join(tmpdir(), `scan-repo-frontmatter-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  it("returns {} when file doesn't exist", () => {
    assert.deepEqual(parseFrontmatter(join(tmp, "nope.md")), {});
  });
  it("returns {} when file has no frontmatter", () => {
    const f = join(tmp, "no-fm.md");
    writeFileSync(f, "# Just a heading\n\nBody.\n", "utf-8");
    assert.deepEqual(parseFrontmatter(f), {});
  });
  it("parses simple key: value pairs", () => {
    const f = join(tmp, "basic.md");
    writeFileSync(f, "---\nname: my-skill\ndescription: short\n---\nBody\n", "utf-8");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "my-skill");
    assert.equal(fm.description, "short");
  });
  it("strips surrounding quotes from values", () => {
    const f = join(tmp, "quoted.md");
    writeFileSync(f, "---\nname: \"quoted\"\ndesc: 'single'\n---\nbody\n", "utf-8");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "quoted");
    assert.equal(fm.desc, "single");
  });
  it("skips comments and empty lines", () => {
    const f = join(tmp, "comments.md");
    writeFileSync(f, "---\n# this is a comment\nname: x\n\n# another\ndesc: y\n---\nbody\n", "utf-8");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "x");
    assert.equal(fm.desc, "y");
  });
  it("skips indented continuation lines under a key:", () => {
    const f = join(tmp, "indented.md");
    writeFileSync(f, "---\nname: x\nmetadata:\n  author: someone\nlicense: MIT\n---\nbody\n", "utf-8");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "x");
    assert.equal(fm.license, "MIT");
    assert.equal(fm.metadata, undefined); // empty value → tracked as currentKey, indented skipped
  });
  it("ignores lines without colon", () => {
    const f = join(tmp, "no-colon.md");
    writeFileSync(f, "---\nname: x\nrandomtext\ndesc: y\n---\nbody\n", "utf-8");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "x");
    assert.equal(fm.desc, "y");
  });
  it("returns {} when fileExists check rejects a directory path", () => {
    // Directories fail the fileExists() guard at the top, no read attempted.
    assert.deepEqual(parseFrontmatter(tmp), {});
  });

  it("returns {} when readFileSync throws (e.g. file unreadable post-check)", () => {
    // POSIX-only: chmod 000 makes the file unreadable so readFileSync throws
    // EACCES while statSync (used by fileExists) still says it's a file —
    // this exercises the try/catch branch around readFileSync.
    if (process.platform === "win32") return;
    const f = join(tmp, "unreadable.md");
    writeFileSync(f, "---\nname: x\n---\nbody\n", "utf-8");
    chmodSync(f, 0o000);
    try {
      assert.deepEqual(parseFrontmatter(f), {});
    } finally {
      chmodSync(f, 0o644);
    }
  });

  after(() => rmSync(tmp, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// isDir / fileExists
// ---------------------------------------------------------------------------

describe("isDir / fileExists", () => {
  const tmp = join(tmpdir(), `scan-repo-fs-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "afile"), "x", "utf-8");
  mkdirSync(join(tmp, "adir"), { recursive: true });

  it("isDir: true for existing directory", () => {
    assert.equal(isDir(join(tmp, "adir")), true);
  });
  it("isDir: false for a file", () => {
    assert.equal(isDir(join(tmp, "afile")), false);
  });
  it("isDir: false for a non-existent path", () => {
    assert.equal(isDir(join(tmp, "nope")), false);
  });
  it("fileExists: true for a file", () => {
    assert.equal(fileExists(join(tmp, "afile")), true);
  });
  it("fileExists: false for a directory", () => {
    assert.equal(fileExists(join(tmp, "adir")), false);
  });
  it("fileExists: false for a non-existent path", () => {
    assert.equal(fileExists(join(tmp, "nope")), false);
  });

  after(() => rmSync(tmp, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// detectLayout / listDirSorted / listFilesSorted
// ---------------------------------------------------------------------------

describe("detectLayout", () => {
  const root = join(tmpdir(), `scan-repo-layout-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  it("'other' for empty repo", () => {
    const d = join(root, "empty");
    mkdirSync(d, { recursive: true });
    assert.equal(detectLayout(d), "other");
  });
  it("'marketplace' when plugins/ exists", () => {
    const d = join(root, "mp");
    mkdirSync(join(d, "plugins"), { recursive: true });
    assert.equal(detectLayout(d), "marketplace");
  });
  it("'single-plugin' when .claude-plugin/ exists", () => {
    const d = join(root, "sp");
    mkdirSync(join(d, ".claude-plugin"), { recursive: true });
    assert.equal(detectLayout(d), "single-plugin");
  });
  it("'mixed' when skills/ and agents/ both exist", () => {
    const d = join(root, "mixed");
    mkdirSync(join(d, "skills"), { recursive: true });
    mkdirSync(join(d, "agents"), { recursive: true });
    assert.equal(detectLayout(d), "mixed");
  });
  it("'flat-skills' when only skills/ exists", () => {
    const d = join(root, "fs");
    mkdirSync(join(d, "skills"), { recursive: true });
    assert.equal(detectLayout(d), "flat-skills");
  });
  it("'flat-agents' when only agents/ exists", () => {
    const d = join(root, "fa");
    mkdirSync(join(d, "agents"), { recursive: true });
    assert.equal(detectLayout(d), "flat-agents");
  });
  it("'marketplace' wins over single-plugin when both markers exist", () => {
    const d = join(root, "both");
    mkdirSync(join(d, "plugins"), { recursive: true });
    mkdirSync(join(d, ".claude-plugin"), { recursive: true });
    assert.equal(detectLayout(d), "marketplace");
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});

describe("listDirSorted / listFilesSorted", () => {
  const root = join(tmpdir(), `scan-repo-list-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "b.md"), "", "utf-8");
  writeFileSync(join(root, "a.md"), "", "utf-8");
  writeFileSync(join(root, "c.json"), "", "utf-8");

  it("listDirSorted: returns alphabetically sorted entries", () => {
    assert.deepEqual(listDirSorted(root), ["a.md", "b.md", "c.json"]);
  });
  it("listDirSorted: returns [] for non-existent dir", () => {
    assert.deepEqual(listDirSorted(join(root, "nope")), []);
  });
  it("listFilesSorted: filters by extension", () => {
    assert.deepEqual(listFilesSorted(root, ".md"), ["a.md", "b.md"]);
    assert.deepEqual(listFilesSorted(root, ".json"), ["c.json"]);
  });
  it("listFilesSorted: returns [] for non-existent dir", () => {
    assert.deepEqual(listFilesSorted(join(root, "nope"), ".md"), []);
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// enumerateHooks / enumerateMcp
// ---------------------------------------------------------------------------

describe("enumerateHooks", () => {
  const tmp = join(tmpdir(), `scan-repo-hooks-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  it("returns absent shape when file doesn't exist", () => {
    const r = enumerateHooks(join(tmp, "nope.json"));
    assert.equal(r.present, false);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.entries, []);
  });
  it("returns absent shape when JSON is invalid", () => {
    const f = join(tmp, "bad.json");
    writeFileSync(f, "{not valid", "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.present, false);
  });
  it("enumerates events, entries, and event-presence booleans", () => {
    const f = join(tmp, "good.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "log" }] }],
      },
    }), "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.events.sort(), ["PreToolUse", "UserPromptSubmit"]);
    assert.equal(r.entries.length, 2);
    assert.equal(r.has_pretooluse, true);
    assert.equal(r.has_userpromptsubmit, true);
    assert.equal(r.has_posttooluse, false);
  });
  it("falls back to inner hook 'type' when 'command' is absent", () => {
    const f = join(tmp, "typeonly.json");
    writeFileSync(f, JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "internal" }] }] },
    }), "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].command, "internal");
  });
  it("uses '—' placeholders when matcher / hooks are missing", () => {
    const f = join(tmp, "minimal.json");
    writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [{}] } }), "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].matcher, "—");
    assert.equal(r.entries[0].command, "—");
  });
  it("skips non-array hook lists defensively", () => {
    const f = join(tmp, "weird.json");
    writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: "not-an-array" } }), "utf-8");
    const r = enumerateHooks(f);
    assert.deepEqual(r.entries, []);
  });

  after(() => rmSync(tmp, { recursive: true, force: true }));
});

describe("enumerateMcp", () => {
  const tmp = join(tmpdir(), `scan-repo-mcp-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });

  it("returns absent shape when file doesn't exist", () => {
    const r = enumerateMcp(join(tmp, "nope.json"));
    assert.equal(r.present, false);
    assert.deepEqual(r.servers, []);
  });
  it("returns absent shape when JSON is invalid", () => {
    const f = join(tmp, "bad.json");
    writeFileSync(f, "{garbage", "utf-8");
    const r = enumerateMcp(f);
    assert.equal(r.present, false);
  });
  it("enumerates servers with url and detects local addresses", () => {
    const f = join(tmp, "good.json");
    writeFileSync(f, JSON.stringify({
      mcpServers: {
        remote: { url: "https://api.example.com" },
        local1: { url: "http://localhost:8080" },
        local2: { url: "http://127.0.0.1:9000" },
        local3: { url: "http://[::1]:7000" },
      },
    }), "utf-8");
    const r = enumerateMcp(f);
    const byName = Object.fromEntries(r.servers.map((s) => [s.name, s]));
    assert.equal(byName.remote.is_local, false);
    assert.equal(byName.local1.is_local, true);
    assert.equal(byName.local2.is_local, true);
    assert.equal(byName.local3.is_local, true);
  });
  it("uses command field when url is absent", () => {
    const f = join(tmp, "cmd.json");
    writeFileSync(f, JSON.stringify({
      mcpServers: { stdio: { command: "node /path/server.mjs" } },
    }), "utf-8");
    const r = enumerateMcp(f);
    assert.equal(r.servers[0].endpoint, "node /path/server.mjs");
    assert.equal(r.servers[0].is_local, false);
  });
  it("empty mcpServers object returns present:true with empty list", () => {
    const f = join(tmp, "empty.json");
    writeFileSync(f, JSON.stringify({}), "utf-8");
    const r = enumerateMcp(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.servers, []);
  });

  after(() => rmSync(tmp, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// isCliEntry — pure predicate
// ---------------------------------------------------------------------------

describe("isCliEntry", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scan_repo.mjs");
  const scriptUrl = pathToFileURL(scriptPath).href;

  it("true when argv[1] is the absolute script path", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", scriptPath]), true);
  });
  it("true when argv[1] is a relative path that resolves to the script", () => {
    const cwdBefore = process.cwd();
    process.chdir(dirname(scriptPath));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./scan_repo.mjs"]), true);
    } finally {
      process.chdir(cwdBefore);
    }
  });
  it("false when argv[1] points to a different file", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other/file.mjs"]), false);
  });
  it("false when argv[1] is undefined (covers ?? \"\" fallback)", () => {
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
  });
});

// ---------------------------------------------------------------------------
// Phase C — execImpl-injected tests for shell-calling functions
//
// We supply a fake execImpl(cmd, args, opts) that records calls and
// returns scripted output, instead of running real git. Same pattern as
// fetchImpl in discover.mjs.
// ---------------------------------------------------------------------------

function makeFakeExec(responses) {
  // responses: Array of { args: <string[]|RegExp>, stdout?: string, throw?: Error }
  // Match cmd+args against the recorded list in order; throws on no-match.
  const calls = [];
  let i = 0;
  function fake(cmd, args, opts) {
    calls.push({ cmd, args, opts });
    const r = responses[i++];
    if (!r) throw new Error(`fake exec: no response scripted for ${cmd} ${args.join(" ")}`);
    if (r.throw) throw r.throw;
    return r.stdout ?? "";
  }
  fake.calls = calls;
  return fake;
}

describe("run", () => {
  it("returns trimmed stdout on success", () => {
    const fake = makeFakeExec([{ stdout: "  hello\n" }]);
    assert.equal(run("echo", ["hi"], { execImpl: fake }), "hello");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].cmd, "echo");
  });
  it("rethrows when check is true (default)", () => {
    const err = Object.assign(new Error("boom"), { stdout: "partial" });
    const fake = makeFakeExec([{ throw: err }]);
    assert.throws(() => run("git", ["bad"], { execImpl: fake }), /boom/);
  });
  it("returns trimmed partial stdout when check is false and command throws", () => {
    const err = Object.assign(new Error("nonzero"), { stdout: " partial-output \n" });
    const fake = makeFakeExec([{ throw: err }]);
    assert.equal(run("git", ["log"], { check: false, execImpl: fake }), "partial-output");
  });
  it("returns empty string when check is false and error has no stdout", () => {
    const fake = makeFakeExec([{ throw: new Error("no stdout") }]);
    assert.equal(run("git", ["x"], { check: false, execImpl: fake }), "");
  });
  it("passes cwd through to execImpl opts", () => {
    const fake = makeFakeExec([{ stdout: "ok" }]);
    run("git", ["status"], { cwd: "/tmp/somewhere", execImpl: fake });
    assert.equal(fake.calls[0].opts.cwd, "/tmp/somewhere");
  });
});

describe("getCommitSha / getLastCommitDate / getDefaultBranch", () => {
  it("getCommitSha returns trimmed sha", () => {
    const fake = makeFakeExec([{ stdout: "abc1234\n" }]);
    assert.equal(getCommitSha("/repo", fake), "abc1234");
    assert.deepEqual(fake.calls[0].args, ["rev-parse", "--short", "HEAD"]);
  });
  it("getLastCommitDate slices the ISO date out of git log", () => {
    const fake = makeFakeExec([{ stdout: "2026-05-22T10:30:00+00:00" }]);
    assert.equal(getLastCommitDate("/repo", fake), "2026-05-22");
  });
  it("getDefaultBranch returns symbolic-ref output", () => {
    const fake = makeFakeExec([{ stdout: "main" }]);
    assert.equal(getDefaultBranch("/repo", fake), "main");
  });
  it("getDefaultBranch falls back to 'main' on detached HEAD / error", () => {
    const fake = makeFakeExec([{ throw: new Error("ref is not a symbolic ref") }]);
    assert.equal(getDefaultBranch("/repo", fake), "main");
  });
});

describe("countRecentCommits", () => {
  it("counts non-empty lines in git log oneline output", () => {
    const fake = makeFakeExec([{ stdout: "abc commit one\ndef commit two\n123 commit three\n" }]);
    assert.equal(countRecentCommits("/repo", "2026-05-01", fake), 3);
    assert.match(fake.calls[0].args.join(" "), /--since=2026-05-01/);
  });
  it("returns 0 for empty output", () => {
    const fake = makeFakeExec([{ stdout: "" }]);
    assert.equal(countRecentCommits("/repo", "2026-05-01", fake), 0);
  });
  it("skips blank lines when counting", () => {
    const fake = makeFakeExec([{ stdout: "a\n\n  \nb\n" }]);
    assert.equal(countRecentCommits("/repo", "2026-05-01", fake), 2);
  });
  it("returns 0 when git log fails (check:false in run)", () => {
    const fake = makeFakeExec([{ throw: new Error("git error") }]);
    assert.equal(countRecentCommits("/repo", "2026-05-01", fake), 0);
  });
});

describe("checkoutOrRefresh", () => {
  const root = join(tmpdir(), `scan-repo-checkout-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  it("clones into a fresh checkout dir when target doesn't exist", () => {
    const co = join(root, "fresh");
    const fake = makeFakeExec([{ stdout: "" }]); // git clone
    const target = checkoutOrRefresh("owner/repo", co, false, fake);
    assert.equal(target, join(co, "owner-repo"));
    // The clone call URL is the GitHub https form
    const args = fake.calls[0].args;
    assert.equal(args[0], "clone");
    assert.ok(args.includes("https://github.com/owner/repo.git"));
  });

  it("uses cached target without git ops when checkout is fresh", () => {
    const co = join(root, "cached");
    // Set up a "checkout" that looks like a recent git repo
    const target = join(co, "owner-repo");
    mkdirSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    const fake = makeFakeExec([]); // no calls should be made
    const result = checkoutOrRefresh("owner/repo", co, false, fake);
    assert.equal(result, target);
    assert.equal(fake.calls.length, 0);
  });

  it("refreshes (fetch + reset) when force=true even if cached", () => {
    const co = join(root, "forced");
    const target = join(co, "owner-repo");
    mkdirSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    const fake = makeFakeExec([{ stdout: "" }, { stdout: "" }]); // fetch + reset
    const result = checkoutOrRefresh("owner/repo", co, true, fake);
    assert.equal(result, target);
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[0].args[0], "fetch");
    assert.equal(fake.calls[1].args[0], "reset");
  });

  it("refreshes when checkout is older than TTL and force=false", () => {
    const co = join(root, "stale");
    const target = join(co, "owner-repo");
    mkdirSync(join(target, ".git"), { recursive: true });
    const headFile = join(target, ".git", "HEAD");
    writeFileSync(headFile, "ref: refs/heads/main\n", "utf-8");
    // Backdate HEAD mtime past TTL_SECONDS so the cache check rejects it.
    const past = (Date.now() - (TTL_SECONDS + 60) * 1000) / 1000;
    utimesSync(headFile, past, past);
    const fake = makeFakeExec([{ stdout: "" }, { stdout: "" }]); // fetch + reset
    const result = checkoutOrRefresh("owner/repo", co, false, fake);
    assert.equal(result, target);
    assert.equal(fake.calls.length, 2, "fetch + reset should both fire");
  });

  it("returns target even if fetch/reset fails (uses stale cache)", () => {
    const co = join(root, "fetch-fail");
    const target = join(co, "owner-repo");
    mkdirSync(join(target, ".git"), { recursive: true });
    const headFile = join(target, ".git", "HEAD");
    writeFileSync(headFile, "ref: refs/heads/main\n", "utf-8");
    const past = (Date.now() - (TTL_SECONDS + 60) * 1000) / 1000;
    utimesSync(headFile, past, past);
    // fetch throws; the catch block returns target without retrying.
    const fake = makeFakeExec([{ throw: new Error("network down") }]);
    const result = checkoutOrRefresh("owner/repo", co, false, fake);
    assert.equal(result, target);
  });

  // CWE-22 regression: checkoutOrRefresh is exported and callable directly
  // (bypassing main()'s isValidOwnerRepo gate), so it must independently
  // resist a traversal payload — defense-in-depth via the global replace.
  it("flattens every '/' in a traversal payload into one literal dir name — never escapes checkoutDir", () => {
    const co = join(root, "traversal-guard");
    const fake = makeFakeExec([{ stdout: "" }]); // git clone
    const target = checkoutOrRefresh("../../../../tmp/evil/payload", co, false, fake);
    assert.equal(target, join(co, "..-..-..-..-tmp-evil-payload"));
    assert.ok(resolve(target).startsWith(resolve(co) + sep));
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// Phase D — integration tests via on-disk repo fixtures
//
// Build minimal "repo" trees in tmp dirs and assert what enumerate*
// functions extract. No network, no git, no LLM.
// ---------------------------------------------------------------------------

// Builds a marketplace-style fixture used by multiple tests below.
function buildMarketplaceFixture(root) {
  // Plugin 1: full surface (agents + skills + commands + hooks + mcp)
  const p1 = join(root, "plugins", "alpha");
  mkdirSync(join(p1, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(p1, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "alpha",
      description: "alpha plugin desc",
      version: "1.0.0",
      author: { name: "Alice" },
      license: "MIT",
    }),
    "utf-8",
  );

  mkdirSync(join(p1, "agents"), { recursive: true });
  writeFileSync(
    join(p1, "agents", "watcher.md"),
    "---\nname: watcher\nmodel: sonnet\ntools: Read, Bash\ndescription: watches things\n---\nbody\n",
    "utf-8",
  );

  mkdirSync(join(p1, "skills", "doer"), { recursive: true });
  mkdirSync(join(p1, "skills", "doer", "scripts"), { recursive: true });
  writeFileSync(
    join(p1, "skills", "doer", "SKILL.md"),
    "---\nname: doer\ndescription: does stuff\nlicense: MIT\ncompatibility: any\nallowed-tools: Bash(*), Read\n---\nbody\n",
    "utf-8",
  );

  mkdirSync(join(p1, "commands"), { recursive: true });
  writeFileSync(
    join(p1, "commands", "go.md"),
    "---\nname: go\ndescription: dispatcher\n---\nbody\n",
    "utf-8",
  );

  mkdirSync(join(p1, "hooks"), { recursive: true });
  writeFileSync(
    join(p1, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "log" }] }],
      },
    }),
    "utf-8",
  );

  writeFileSync(
    join(p1, ".mcp.json"),
    JSON.stringify({
      mcpServers: { srv: { url: "https://api.example.com" } },
    }),
    "utf-8",
  );

  // Plugin 2: minimal — only plugin.json
  const p2 = join(root, "plugins", "bare");
  mkdirSync(join(p2, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(p2, ".claude-plugin", "plugin.json"),
    "{}",
    "utf-8",
  );

  // Hidden dir and non-dir entry should be skipped
  mkdirSync(join(root, "plugins", ".hidden"), { recursive: true });
  writeFileSync(join(root, "plugins", "stray.md"), "not-a-plugin", "utf-8");
}

describe("enumeratePlugins / enumerateOnePlugin (integration)", () => {
  const root = join(tmpdir(), `scan-repo-mp-${Date.now()}`);
  buildMarketplaceFixture(root);

  it("returns [] when plugins/ doesn't exist", () => {
    const empty = join(tmpdir(), `scan-repo-no-plugins-${Date.now()}`);
    mkdirSync(empty, { recursive: true });
    assert.deepEqual(enumeratePlugins(empty), []);
    rmSync(empty, { recursive: true, force: true });
  });

  it("enumerates two plugins (alpha + bare), skipping hidden + non-dir", () => {
    const plugins = enumeratePlugins(root);
    const names = plugins.map((p) => p.name).sort();
    assert.deepEqual(names, ["alpha", "bare"]);
  });

  it("enumerates alpha with all sub-surfaces populated", () => {
    const alpha = enumeratePlugins(root).find((p) => p.name === "alpha");
    assert.equal(alpha.description, "alpha plugin desc");
    assert.equal(alpha.version, "1.0.0");
    assert.equal(alpha.author, "Alice");
    assert.equal(alpha.license, "MIT");
    assert.equal(alpha.path, "plugins/alpha/");
    // agents
    assert.equal(alpha.agents.length, 1);
    assert.equal(alpha.agents[0].name, "watcher");
    assert.equal(alpha.agents[0].model, "sonnet");
    // skills
    assert.equal(alpha.skills.length, 1);
    assert.equal(alpha.skills[0].name, "doer");
    assert.equal(alpha.skills[0].has_scripts, true);
    assert.equal(alpha.skills[0].broad_bash, true); // allowed-tools has Bash(*)
    // commands
    assert.equal(alpha.commands.length, 1);
    assert.equal(alpha.commands[0].name, "go");
    // hooks + mcp
    assert.equal(alpha.hooks.present, true);
    assert.equal(alpha.hooks.has_pretooluse, true);
    assert.equal(alpha.mcp.present, true);
    assert.equal(alpha.mcp.servers[0].name, "srv");
  });

  it("bare plugin falls back to defaults when manifest is empty", () => {
    const bare = enumeratePlugins(root).find((p) => p.name === "bare");
    assert.equal(bare.version, "unset");
    assert.equal(bare.author, "—");
    assert.equal(bare.license, "—");
    assert.equal(bare.agents.length, 0);
    assert.equal(bare.skills.length, 0);
    assert.equal(bare.commands.length, 0);
  });

  it("enumerateOnePlugin handles malformed plugin.json gracefully", () => {
    const bad = join(root, "plugins", "broken");
    mkdirSync(join(bad, ".claude-plugin"), { recursive: true });
    writeFileSync(join(bad, ".claude-plugin", "plugin.json"), "{not valid", "utf-8");
    const r = enumerateOnePlugin(bad);
    assert.equal(r.version, "unset");
    assert.equal(r.author, "—");
  });

  it("enumerateOnePlugin handles missing plugin.json (no .claude-plugin/)", () => {
    const bare = join(root, "plugins", "no-manifest");
    mkdirSync(bare, { recursive: true });
    const r = enumerateOnePlugin(bare);
    assert.equal(r.version, "unset");
    assert.equal(r.author, "—");
  });

  it("enumerateOnePlugin skips non-dir entries inside skills/", () => {
    const p = join(root, "plugins", "skills-mixed");
    mkdirSync(join(p, "skills", "real"), { recursive: true });
    writeFileSync(join(p, "skills", "real", "SKILL.md"), "---\nname: real\n---\n", "utf-8");
    writeFileSync(join(p, "skills", "notadir.txt"), "stray", "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.skills.length, 1);
    assert.equal(r.skills[0].name, "real");
  });

  it("enumerateOnePlugin skips skill directories without SKILL.md", () => {
    const p = join(root, "plugins", "skill-incomplete");
    mkdirSync(join(p, "skills", "missing-md"), { recursive: true });
    writeFileSync(join(p, "skills", "missing-md", "scripts.mjs"), "// no SKILL.md\n", "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.skills.length, 0);
  });

  it("enumerateOnePlugin: author falls back to '—' when manifest.author is not an object", () => {
    const p = join(root, "plugins", "author-string");
    mkdirSync(join(p, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(p, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "x", author: "Just a string" }),
      "utf-8",
    );
    const r = enumerateOnePlugin(p);
    assert.equal(r.author, "—");
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});

describe("enumerateStandaloneAgents / Skills / Commands", () => {
  const root = join(tmpdir(), `scan-repo-standalone-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  // Agents
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(
    join(root, "agents", "alpha.md"),
    "---\nname: alpha-agent\nmodel: opus\ndescription: solo agent\n---\nbody\n",
    "utf-8",
  );

  // Skills — direct SKILL.md
  mkdirSync(join(root, "skills", "direct"), { recursive: true });
  writeFileSync(
    join(root, "skills", "direct", "SKILL.md"),
    "---\nname: direct\ndescription: top-level skill\nlicense: MIT\n---\nbody\n",
    "utf-8",
  );
  // Skills — nested-grouping style: skills/group/<name>/SKILL.md
  mkdirSync(join(root, "skills", "group", "nested"), { recursive: true });
  writeFileSync(
    join(root, "skills", "group", "nested", "SKILL.md"),
    "---\nname: nested\ndescription: nested skill\n---\nbody\n",
    "utf-8",
  );
  // A skills/X dir with no SKILL.md and no nested SKILL.md sub-dirs → ignored
  mkdirSync(join(root, "skills", "ignored"), { recursive: true });
  writeFileSync(join(root, "skills", "ignored", "notes.md"), "no SKILL.md here", "utf-8");
  // A non-dir entry inside skills/ → ignored
  writeFileSync(join(root, "skills", "stray.txt"), "ignore me", "utf-8");

  // Commands
  mkdirSync(join(root, "commands"), { recursive: true });
  writeFileSync(
    join(root, "commands", "run.md"),
    "---\nname: run\ndescription: top-level command\n---\nbody\n",
    "utf-8",
  );

  it("enumerateStandaloneAgents finds agent .md files", () => {
    const r = enumerateStandaloneAgents(root);
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "alpha-agent");
    assert.equal(r[0].model, "opus");
    assert.equal(r[0].path, "agents/alpha.md");
  });
  it("enumerateStandaloneAgents returns [] when agents/ missing", () => {
    const empty = join(tmpdir(), `scan-repo-no-agents-${Date.now()}`);
    mkdirSync(empty, { recursive: true });
    assert.deepEqual(enumerateStandaloneAgents(empty), []);
    rmSync(empty, { recursive: true, force: true });
  });

  it("enumerateStandaloneSkills finds direct and nested skills", () => {
    const r = enumerateStandaloneSkills(root);
    const names = r.map((s) => s.name).sort();
    assert.deepEqual(names, ["direct", "nested"]);
    const direct = r.find((s) => s.name === "direct");
    assert.equal(direct.path, "skills/direct/SKILL.md");
    const nested = r.find((s) => s.name === "nested");
    assert.equal(nested.path, "skills/group/nested/SKILL.md");
  });
  it("enumerateStandaloneSkills returns [] when skills/ missing", () => {
    const empty = join(tmpdir(), `scan-repo-no-skills-${Date.now()}`);
    mkdirSync(empty, { recursive: true });
    assert.deepEqual(enumerateStandaloneSkills(empty), []);
    rmSync(empty, { recursive: true, force: true });
  });

  it("enumerateStandaloneCommands finds command .md files", () => {
    const r = enumerateStandaloneCommands(root);
    assert.equal(r.length, 1);
    assert.equal(r[0].name, "run");
    assert.equal(r[0].path, "commands/run.md");
  });
  it("enumerateStandaloneCommands returns [] when commands/ missing", () => {
    const empty = join(tmpdir(), `scan-repo-no-cmds-${Date.now()}`);
    mkdirSync(empty, { recursive: true });
    assert.deepEqual(enumerateStandaloneCommands(empty), []);
    rmSync(empty, { recursive: true, force: true });
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});

// ---------------------------------------------------------------------------
// renderIndexMd — exercise the full template against a realistic data shape
// ---------------------------------------------------------------------------

describe("renderIndexMd", () => {
  const baseData = () => ({
    owner_repo: "owner/repo",
    scanned_at: "2026-05-22T10:00:00+00:00",
    commit_sha: "abc1234",
    default_branch: "main",
    layout: "marketplace",
    description: "an example repo",
    license: "MIT",
    stars: 42,
    created: "2024-01-01",
    last_commit_date: "2026-05-20",
    recent_commits: { count: 7, from: "2026-04-22", to: "2026-05-22" },
    plugins: [],
    standalone_agents: [],
    standalone_skills: [],
    standalone_commands: [],
  });

  it("renders headers + metadata block + structural-signals block", () => {
    const md = renderIndexMd(baseData());
    assert.match(md, /# `owner\/repo` — community index/);
    assert.match(md, /> Scanner: ievo-ai\/community-index-bot v\d+\.\d+\.\d+/);
    assert.match(md, /> Scanned: 2026-05-22T10:00:00\+00:00/);
    assert.match(md, /\*\*License:\*\* MIT/);
    assert.match(md, /\*\*Stars:\*\* 42/);
    assert.match(md, /\*\*Recent commits:\*\* 7 commits between 2026-04-22 and 2026-05-22/);
    assert.match(md, /## Structural signals/);
  });

  it("substitutes 'missing' / 'unknown' for absent metadata", () => {
    const d = baseData();
    d.license = null;
    d.stars = undefined;
    d.created = "";
    const md = renderIndexMd(d);
    assert.match(md, /\*\*License:\*\* missing/);
    assert.match(md, /\*\*Stars:\*\* unknown/);
    assert.match(md, /\*\*Created:\*\* unknown/);
  });

  it("skips recent_commits line when count is undefined", () => {
    const d = baseData();
    d.recent_commits = {};
    const md = renderIndexMd(d);
    assert.doesNotMatch(md, /Recent commits:/);
  });

  it("includes plugins section with agents/skills/commands/hooks/mcp tables", () => {
    const d = baseData();
    d.plugins = [{
      name: "alpha",
      description: "alpha desc",
      version: "1.0.0",
      path: "plugins/alpha/",
      author: "Alice",
      license: "MIT",
      agents: [{ name: "watcher", model: "sonnet", tools: "Read", description: "" }],
      skills: [{
        name: "doer", description: "", has_scripts: true, has_refs: false,
        license: "MIT", compatibility: "any", broad_bash: true,
      }],
      commands: [{ name: "go", description: "" }],
      hooks: {
        present: true,
        events: ["PreToolUse"],
        entries: [{ event: "PreToolUse", matcher: "Bash", command: "echo pre" }],
        has_pretooluse: true,
        has_userpromptsubmit: false,
      },
      mcp: { present: true, servers: [{ name: "srv", endpoint: "https://example.com", is_local: false }] },
    }];
    const md = renderIndexMd(d);
    assert.match(md, /## Plugins \(1\)/);
    assert.match(md, /### alpha/);
    assert.match(md, /\*\*Agents \(1\):\*\*/);
    assert.match(md, /\| watcher \| sonnet \| Read \| — \|/);
    assert.match(md, /\*\*Skills \(1\):\*\*/);
    assert.match(md, /\| doer \| — \| yes \| MIT \| any \| yes \|/);
    assert.match(md, /\*\*Commands \(1\):\*\*/);
    assert.match(md, /\| go \| — \|/);
    assert.match(md, /\*\*Hooks:\*\*/);
    assert.match(md, /\*\*MCP servers:\*\*/);
    // Aggregate signals line
    assert.match(md, /PreToolUse: yes — alpha/);
    assert.match(md, /Skills with broad allowed-tools:\*\* 1 — alpha\/doer/);
  });

  it("renders standalone_agents / standalone_skills / standalone_commands sections", () => {
    const d = baseData();
    d.standalone_agents = [{ name: "a1", model: "opus", tools: "—", description: "", path: "agents/a1.md" }];
    d.standalone_skills = [{ name: "s1", description: "", license: "MIT", compatibility: "any", path: "skills/s1/SKILL.md" }];
    d.standalone_commands = [{ name: "c1", description: "", path: "commands/c1.md" }];
    const md = renderIndexMd(d);
    assert.match(md, /## Standalone agents \(1\)/);
    assert.match(md, /\| a1 \| opus \| — \| — \| `agents\/a1.md` \|/);
    assert.match(md, /## Standalone skills \(1\)/);
    assert.match(md, /## Standalone commands \(1\)/);
  });

  it("renders empty-PreToolUse / empty-UserPromptSubmit lines when no plugin has them", () => {
    const md = renderIndexMd(baseData());
    assert.match(md, /PreToolUse: no/);
    assert.match(md, /UserPromptSubmit: no/);
    assert.match(md, /MCP servers total:\*\* 0/);
    assert.match(md, /Skills with broad allowed-tools:\*\* 0$/m);
  });

  it("includes the untrusted-content banner ahead of the attacker-controlled default_branch line, not just ahead of Repo metadata", () => {
    const d = baseData();
    d.default_branch = "attacker-controlled-ref";
    const md = renderIndexMd(d);
    assert.match(md, /Untrusted content below/);
    const bannerIdx = md.indexOf("Untrusted content below");
    const defaultBranchIdx = md.indexOf("Default branch:");
    const metadataIdx = md.indexOf("## Repo metadata");
    // The banner must precede EVERY attacker-controlled field it warns about,
    // not merely precede the `## Repo metadata` heading — default_branch is
    // itself attacker-influenceable (an arbitrary git ref name) and is
    // rendered before that heading.
    assert.ok(bannerIdx > 0 && bannerIdx < defaultBranchIdx && defaultBranchIdx < metadataIdx);
  });

  it("escapes default_branch so an attacker-chosen ref name can't break the blockquote line", () => {
    const d = baseData();
    d.default_branch = "release | injected";
    const md = renderIndexMd(d);
    assert.match(md, /> Default branch: release \\\| injected/);
  });

  // CWE-116 regression: a malicious frontmatter/JSON field containing `|` or
  // a backtick must not fabricate extra table columns/rows or break out of
  // an inline code span — every table row must still parse to the expected
  // number of cells.
  it("escapes pipe/backtick table-breakout attempts across every plugin table", () => {
    const d = baseData();
    d.plugins = [{
      name: "evil|plugin",
      description: "desc | injected",
      version: "1.0.0 | fake",
      path: "plugins/evil/",
      author: "Mallory | Admin",
      license: "MIT | Fake",
      agents: [{ name: "a`gent", model: "sonnet | [pwn](javascript:x)", tools: "Read | Write", description: "d | esc" }],
      skills: [{
        name: "sk`ill", description: "desc | esc", has_scripts: true, has_refs: false,
        license: "MIT | X", compatibility: "any | X", broad_bash: true,
      }],
      commands: [{ name: "cmd | X", description: "d | esc" }],
      hooks: {
        present: true,
        events: ["Evt | X"],
        entries: [{ event: "Evt | X", matcher: "Bash | X", command: "echo `x`" }],
        has_pretooluse: false,
        has_userpromptsubmit: false,
      },
      mcp: { present: true, servers: [{ name: "srv | X", endpoint: "https://x?a=`b`", is_local: false }] },
    }];
    const md = renderIndexMd(d);

    // The plugin heading/name and every table row are still literal single
    // cells — a naive Markdown table parser splitting on unescaped `|`
    // would see extra columns if any of these values leaked through raw.
    assert.match(md, /### evil\\\|plugin/);
    assert.match(md, /\| a'gent \| sonnet \\\| \[pwn\]\(javascript:x\) \| Read \\\| Write \| d \\\| esc \|/);
    assert.match(md, /\| sk'ill \| desc \\\| esc \| yes \| MIT \\\| X \| any \\\| X \| yes \|/);
    assert.match(md, /\| cmd \\\| X \| d \\\| esc \|/);
    assert.match(md, /\| Evt \\\| X \| Bash \\\| X \| `echo 'x'` \|/);
    assert.match(md, /\| srv \\\| X \| `https:\/\/x\?a='b'` \| no \|/);

    // No unescaped, unbalanced pipe reaches the output: every remaining `|`
    // is either a table delimiter or immediately preceded by the escape.
    const rawPipeLeak = /[^\\]\| \[pwn\]/;
    assert.doesNotMatch(md, rawPipeLeak);
  });
});

// ---------------------------------------------------------------------------
// main — end-to-end with execImpl mock + tmp dirs
// ---------------------------------------------------------------------------

describe("main (end-to-end)", () => {
  const root = join(tmpdir(), `scan-repo-main-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  function captureRun() {
    const logs = [];
    const errs = [];
    let exitCode = null;
    const exit = (c) => { exitCode = c; };
    const log = (m) => logs.push(m);
    const errLog = (m) => errs.push(m);
    return { logs, errs, exit, log, errLog, get exitCode() { return exitCode; } };
  }

  it("exits 1 when repo arg is missing", () => {
    const r = captureRun();
    main(["node", "scan_repo.mjs"], undefined, r.log, r.errLog, r.exit);
    assert.equal(r.exitCode, 1);
    assert.match(r.errs.join("\n"), /repo must be in <owner>\/<repo> format/);
  });

  it("exits 1 when repo arg has no slash", () => {
    const r = captureRun();
    main(["node", "scan_repo.mjs", "missing-slash"], undefined, r.log, r.errLog, r.exit);
    assert.equal(r.exitCode, 1);
  });

  it("exits 1 on a CWE-22 traversal payload, without touching git/fs", () => {
    const r = captureRun();
    const fake = makeFakeExec([]); // no git/checkout call should be made
    main(["node", "scan_repo.mjs", "../../../../tmp/evil/payload"], fake, r.log, r.errLog, r.exit);
    assert.equal(r.exitCode, 1);
    assert.equal(fake.calls.length, 0, "must reject before any git/fs operation");
  });

  it("exits 2 when clone fails", () => {
    const r = captureRun();
    const outDir = join(root, "out-clone-fail");
    const coDir = join(root, "co-clone-fail");
    const fake = makeFakeExec([{ throw: new Error("clone failed") }]);
    main(
      ["node", "scan_repo.mjs", "owner/missing", "--output-dir", outDir, "--checkout-dir", coDir],
      fake, r.log, r.errLog, r.exit,
    );
    assert.equal(r.exitCode, 2);
    assert.match(r.errs.join("\n"), /Failed to clone owner\/missing/);
  });

  it("happy path: builds .md + .json artifacts, exits 0", () => {
    const r = captureRun();
    const outDir = join(root, "out-happy");
    const coDir = join(root, "co-happy");
    // Pre-populate the checkout to skip the clone path entirely.
    const target = join(coDir, "owner-target");
    mkdirSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    writeFileSync(join(target, "LICENSE"), "MIT", "utf-8");
    // Marketplace fixture so plugins/standalones are populated.
    buildMarketplaceFixture(target);

    // Order: getCommitSha, getLastCommitDate, getDefaultBranch, countRecentCommits.
    const fake = makeFakeExec([
      { stdout: "deadbeef\n" },          // rev-parse
      { stdout: "2026-05-22T10:00:00+00:00\n" }, // log -1 --format=%cI
      { stdout: "main\n" },              // symbolic-ref
      { stdout: "a\nb\n" },              // git log oneline → 2 commits
    ]);
    main(
      ["node", "scan_repo.mjs", "owner/target", "--output-dir", outDir, "--checkout-dir", coDir],
      fake, r.log, r.errLog, r.exit,
    );
    assert.equal(r.exitCode, 0, `errs: ${r.errs.join("\n")}`);
    // .md + .json artifacts present
    assert.ok(fileExists(join(outDir, "owner-target.md")));
    assert.ok(fileExists(join(outDir, "owner-target.json")));
    // stdout summary
    const summary = r.logs.join("\n");
    assert.match(summary, /owner\/target: indexed \(commit=deadbeef\)/);
    assert.match(summary, /hooks: yes/);
    assert.match(summary, /mcp: yes/);
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});



// ---------------------------------------------------------------------------
// Phase E — CLI subprocess (covers the module-load entry guard at line 665)
//
// The `if (isCliEntry(...)) { main(); }` block only executes when the module
// loads as the entry script. Importing it (as the tests above do) leaves
// that block unexercised. spawnSync launches scan_repo.mjs as the entry
// script so the guard's true branch is covered.
// ---------------------------------------------------------------------------

describe("CLI invocation (subprocess — covers entry guard)", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scan_repo.mjs");

  it("runs as CLI, exits 1 when no repo arg given", () => {
    const r = spawnSync(process.execPath, [scriptPath], { encoding: "utf-8", timeout: 30000 });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /repo must be in <owner>\/<repo> format/);
  });

  it("runs as CLI, exits 1 on malformed repo (no slash)", () => {
    const r = spawnSync(process.execPath, [scriptPath, "no-slash"], { encoding: "utf-8", timeout: 30000 });
    assert.equal(r.status, 1);
  });

  it("runs as CLI, exits 1 on a CWE-22 traversal payload", () => {
    const r = spawnSync(process.execPath, [scriptPath, "../../../../tmp/evil/payload"], { encoding: "utf-8", timeout: 30000 });
    assert.equal(r.status, 1);
  });
});

// ---------------------------------------------------------------------------
// Gap-fill — nullish-coalescing fallbacks + ternary false-paths that the
// happy-path fixtures don't exercise.
// ---------------------------------------------------------------------------

describe("nullish/ternary fallbacks", () => {
  const root = join(tmpdir(), `scan-repo-fallbacks-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  it("enumerateOnePlugin: agent without name/model/tools frontmatter uses defaults", () => {
    const p = join(root, "plugins", "p-no-fm-agent");
    mkdirSync(join(p, ".claude-plugin"), { recursive: true });
    writeFileSync(join(p, ".claude-plugin", "plugin.json"), "{}", "utf-8");
    mkdirSync(join(p, "agents"), { recursive: true });
    // No frontmatter — name falls back to filename, model/tools to "—"
    writeFileSync(join(p, "agents", "blank.md"), "no frontmatter here\n", "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.agents[0].name, "blank");
    assert.equal(r.agents[0].model, "—");
    assert.equal(r.agents[0].tools, "—");
  });

  it("enumerateOnePlugin: skill without name in frontmatter uses dir name", () => {
    const p = join(root, "plugins", "p-skill-noname");
    mkdirSync(join(p, "skills", "named-by-dir"), { recursive: true });
    writeFileSync(join(p, "skills", "named-by-dir", "SKILL.md"), "---\ndescription: no name field\n---\n", "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.skills[0].name, "named-by-dir");
  });

  it("enumerateOnePlugin: manifest.author null falls back to '—'", () => {
    const p = join(root, "plugins", "p-author-null");
    mkdirSync(join(p, ".claude-plugin"), { recursive: true });
    writeFileSync(join(p, ".claude-plugin", "plugin.json"), JSON.stringify({ author: null }), "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.author, "—");
  });

  it("enumerateOnePlugin: manifest.author object without .name → '—'", () => {
    const p = join(root, "plugins", "p-author-no-name");
    mkdirSync(join(p, ".claude-plugin"), { recursive: true });
    writeFileSync(join(p, ".claude-plugin", "plugin.json"), JSON.stringify({ author: { url: "https://example.com" } }), "utf-8");
    const r = enumerateOnePlugin(p);
    assert.equal(r.author, "—");
  });

  it("enumerateHooks: JSON without 'hooks' key returns present:true with empty arrays", () => {
    const f = join(root, "hooks-empty.json");
    writeFileSync(f, JSON.stringify({}), "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.entries, []);
  });

  it("enumerateHooks: inner hook with neither command nor type → '—'", () => {
    const f = join(root, "hooks-bare.json");
    writeFileSync(f, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{}] }] } }), "utf-8");
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].command, "—");
  });

  it("enumerateMcp: server with neither url nor command → empty endpoint", () => {
    const f = join(root, "mcp-bare.json");
    writeFileSync(f, JSON.stringify({ mcpServers: { x: {} } }), "utf-8");
    const r = enumerateMcp(f);
    assert.equal(r.servers[0].endpoint, "");
  });

  it("enumerateStandaloneAgents: file without name in frontmatter uses filename", () => {
    const root2 = join(root, "sa-noname");
    mkdirSync(join(root2, "agents"), { recursive: true });
    writeFileSync(join(root2, "agents", "filename.md"), "no frontmatter\n", "utf-8");
    const r = enumerateStandaloneAgents(root2);
    assert.equal(r[0].name, "filename");
    assert.equal(r[0].model, "—");
  });

  it("enumerateStandaloneSkills: nested skill without name uses sub-dir name", () => {
    const root2 = join(root, "ss-nested-noname");
    mkdirSync(join(root2, "skills", "outer", "innerdir"), { recursive: true });
    writeFileSync(join(root2, "skills", "outer", "innerdir", "SKILL.md"), "---\ndescription: x\n---\n", "utf-8");
    const r = enumerateStandaloneSkills(root2);
    assert.equal(r[0].name, "innerdir");
    assert.equal(r[0].license, "—");
  });

  it("enumerateStandaloneSkills: direct skill without name uses skill-dir name", () => {
    const root2 = join(root, "ss-direct-noname");
    mkdirSync(join(root2, "skills", "skill-dir-name"), { recursive: true });
    writeFileSync(join(root2, "skills", "skill-dir-name", "SKILL.md"), "---\ndescription: x\n---\n", "utf-8");
    const r = enumerateStandaloneSkills(root2);
    assert.equal(r[0].name, "skill-dir-name");
  });

  it("renderIndexMd: skill row with has_scripts=false / broad_bash=false renders 'no'", () => {
    const md = renderIndexMd({
      owner_repo: "o/r", scanned_at: "t", commit_sha: "s", default_branch: "main", layout: "marketplace",
      description: "d", license: "MIT", stars: 1, created: "c", last_commit_date: "lc",
      recent_commits: { count: 0, from: "f", to: "t" },
      plugins: [{
        name: "p", description: "", version: "1", path: "p/", author: "—", license: "—",
        agents: [],
        skills: [{ name: "n", description: "", has_scripts: false, has_refs: false, license: "—", compatibility: "any", broad_bash: false }],
        commands: [],
        hooks: { present: false, entries: [] },
        mcp: { present: false, servers: [] },
      }],
      standalone_agents: [], standalone_skills: [], standalone_commands: [],
    });
    assert.match(md, /\| n \| — \| no \| — \| any \| no \|/);
  });

  it("renderIndexMd: MCP server with is_local=true renders 'yes'", () => {
    const md = renderIndexMd({
      owner_repo: "o/r", scanned_at: "t", commit_sha: "s", default_branch: "main", layout: "marketplace",
      description: "", license: "", stars: 0, created: "", last_commit_date: "",
      recent_commits: { count: 0, from: "f", to: "t" },
      plugins: [{
        name: "p", description: "", version: "1", path: "p/", author: "—", license: "—",
        agents: [], skills: [], commands: [],
        hooks: { present: false, entries: [] },
        mcp: { present: true, servers: [{ name: "local", endpoint: "localhost:8080", is_local: true }] },
      }],
      standalone_agents: [], standalone_skills: [], standalone_commands: [],
    });
    assert.match(md, /\| local \| `localhost:8080` \| yes \|/);
  });

  it("renderIndexMd: hooks/mcp without entries/servers arrays — ?? 0 fallbacks fire", () => {
    // Realistic call site (enumerateOnePlugin) always populates entries/servers,
    // but the optional-chain ?? 0 fallbacks guard against future shape drift.
    // Exercise them explicitly.
    const md = renderIndexMd({
      owner_repo: "o/r", scanned_at: "t", commit_sha: "s", default_branch: "main", layout: "marketplace",
      description: "", license: "", stars: 0, created: "", last_commit_date: "",
      recent_commits: { count: 0, from: "f", to: "t" },
      plugins: [{
        name: "p", description: "", version: "1", path: "p/", author: "—", license: "—",
        agents: [], skills: [], commands: [],
        hooks: { present: false }, // no entries → ?? 0 path
        mcp: { present: false },   // no servers → ?? 0 path
      }],
      standalone_agents: [], standalone_skills: [], standalone_commands: [],
    });
    assert.match(md, /Hooks total:\*\* 0 across/);
    assert.match(md, /MCP servers total:\*\* 0/);
  });

  it("renderIndexMd: data.recent_commits undefined → no Recent commits line", () => {
    const md = renderIndexMd({
      owner_repo: "o/r", scanned_at: "t", commit_sha: "s", default_branch: "main", layout: "marketplace",
      description: "", license: "", stars: 0, created: "", last_commit_date: "",
      // recent_commits intentionally absent → `?? {}` fallback
      plugins: [], standalone_agents: [], standalone_skills: [], standalone_commands: [],
    });
    assert.doesNotMatch(md, /Recent commits:/);
  });

  it("main: writes license:null when no LICENSE/LICENSE.md/LICENSE.txt exists, summary shows hooks:no, mcp:no", () => {
    const outDir = join(root, "main-no-license-out");
    const coDir = join(root, "main-no-license-co");
    const target = join(coDir, "owner-nolic");
    mkdirSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git", "HEAD"), "ref: refs/heads/main\n", "utf-8");
    // No LICENSE file. No plugins/, no skills/, no agents/.
    const logs = [];
    const errs = [];
    let code = null;
    const fake = makeFakeExec([
      { stdout: "cafe1\n" },                     // rev-parse
      { stdout: "2026-05-22T10:00:00+00:00\n" }, // log -1 --format=%cI
      { stdout: "main\n" },                       // symbolic-ref
      { stdout: "\n" },                           // git log oneline → 0 commits
    ]);
    main(
      ["node", "scan_repo.mjs", "owner/nolic", "--output-dir", outDir, "--checkout-dir", coDir],
      fake, (m) => logs.push(m), (m) => errs.push(m), (c) => { code = c; },
    );
    assert.equal(code, 0, `errs: ${errs.join("\n")}`);
    // The .json manifest should have license null (verifies licenseFileExists=false branch).
    const manifest = JSON.parse(readFileSync(join(outDir, "owner-nolic.json"), "utf-8"));
    assert.equal(manifest.has_hooks, false);
    assert.equal(manifest.has_mcp, false);
    // Summary line shows "hooks: no, mcp: no" (covers ternary false branches)
    const summary = logs.join("\n");
    assert.match(summary, /hooks: no/);
    assert.match(summary, /mcp: no/);
  });

  after(() => rmSync(root, { recursive: true, force: true }));
});


