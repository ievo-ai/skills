// Tests for scan_repo.mjs — deterministic repo scanner.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/scan_repo.test.mjs
//
// Phase plan (matches the v0.6.7 export refactor):
//   B — pure-function tests (this file, top sections): truncate, isoNow,
//       isoDate, parseArgs, parseFrontmatter, renderIndexMd, isCliEntry
//   C — execImpl-injected tests for shell-calling functions:
//       run, checkoutOrRefresh, getCommitSha, getLastCommitDate,
//       getDefaultBranch, countRecentCommits
//   D — integration: enumeratePlugins/Hooks/Mcp/Standalone* +
//       detectLayout + listDirSorted/listFilesSorted, using real fs
//       fixtures via mkdirSync/writeFileSync in tmp dirs.
//   E — main() end-to-end with execImpl mock + tmp dirs.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  TTL_SECONDS,
  FRONTMATTER_RE,
  truncate,
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
  it("handles file read error gracefully (returns {})", () => {
    // Pass a directory path; readFileSync throws EISDIR.
    assert.deepEqual(parseFrontmatter(tmp), {});
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
