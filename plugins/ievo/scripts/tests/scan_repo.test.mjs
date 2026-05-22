// Tests for scan_repo.mjs — deterministic repo scanner.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/scan_repo.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync,
  utimesSync, chmodSync, statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SCRIPT_VERSION,
  TTL_SECONDS,
  run,
  isDir,
  fileExists,
  defaultUrlFn,
  checkoutOrRefresh,
  getCommitSha,
  getLastCommitDate,
  getDefaultBranch,
  countRecentCommits,
  parseFrontmatter,
  truncate,
  detectLayout,
  listDirSorted,
  listFilesSorted,
  enumeratePlugins,
  enumerateOnePlugin,
  enumerateHooks,
  enumerateMcp,
  enumerateStandaloneAgents,
  enumerateStandaloneSkills,
  enumerateStandaloneCommands,
  renderIndexMd,
  isoNow,
  isoDate,
  parseArgs,
  main,
  isCliEntry,
} from "../scan_repo.mjs";

const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../scan_repo.mjs",
);

// ---------------------------------------------------------------------------
// Shared test fixtures (created once, cleaned up after all tests)
// ---------------------------------------------------------------------------

let tmpRoot;
let gitRepo;             // real local git repo for git-op tests
let noRemote;            // git init'd but no remote — fetch will fail
let gitRepoWithPlugins;  // repo with plugins, hooks, mcp, LICENSE for main() coverage

function gitExec(args, opts = {}) {
  execSync("git " + args, { stdio: "ignore", ...opts });
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "scan-repo-test-"));

  // Create a real local git repo with one commit
  gitRepo = join(tmpRoot, "src-repo");
  mkdirSync(gitRepo);
  gitExec("init", { cwd: gitRepo });
  gitExec("-C " + JSON.stringify(gitRepo) + " config user.email test@example.com");
  gitExec("-C " + JSON.stringify(gitRepo) + " config user.name Test");
  writeFileSync(join(gitRepo, "README.md"), "# test");
  gitExec("-C " + JSON.stringify(gitRepo) + " add README.md");
  gitExec("-C " + JSON.stringify(gitRepo) + " commit -m init", {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-01-15T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2026-01-15T12:00:00+00:00",
    },
  });

  // Create a git repo with no remote (for fetch-failure tests)
  noRemote = join(tmpRoot, "no-remote");
  mkdirSync(noRemote);
  gitExec("init", { cwd: noRemote });
  gitExec("-C " + JSON.stringify(noRemote) + " config user.email test@example.com");
  gitExec("-C " + JSON.stringify(noRemote) + " config user.name Test");
  writeFileSync(join(noRemote, "x.md"), "x");
  gitExec("-C " + JSON.stringify(noRemote) + " add x.md");
  gitExec("-C " + JSON.stringify(noRemote) + " commit -m init");

  // Create a repo with plugins, hooks, MCP, and LICENSE — for main() branch coverage
  gitRepoWithPlugins = join(tmpRoot, "plugins-repo");
  mkdirSync(gitRepoWithPlugins);
  gitExec("init", { cwd: gitRepoWithPlugins });
  gitExec("-C " + JSON.stringify(gitRepoWithPlugins) + " config user.email test@example.com");
  gitExec("-C " + JSON.stringify(gitRepoWithPlugins) + " config user.name Test");

  // LICENSE file → licenseFileExists = true
  writeFileSync(join(gitRepoWithPlugins, "LICENSE"), "MIT License");

  // Plugin structure
  const pDir = join(gitRepoWithPlugins, "plugins", "test-plugin");
  mkdirSync(join(pDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pDir, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "test-plugin", version: "1.0.0", description: "Test", license: "MIT",
    author: { name: "Test Author" },
  }));
  mkdirSync(join(pDir, "agents"), { recursive: true });
  writeFileSync(join(pDir, "agents", "test-agent.md"), "---\nname: test-agent\nmodel: sonnet\ntools: Bash\ndescription: A test agent\n---\n");
  mkdirSync(join(pDir, "skills", "test-skill"), { recursive: true });
  writeFileSync(join(pDir, "skills", "test-skill", "SKILL.md"), "---\nname: test-skill\ndescription: A test skill\nallowed-tools: Write\n---\n");
  mkdirSync(join(pDir, "hooks"), { recursive: true });
  writeFileSync(join(pDir, "hooks", "hooks.json"), JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ command: "echo pre" }] }],
      UserPromptSubmit: [{ matcher: "*", hooks: [{ command: "echo up" }] }],
    },
  }));
  writeFileSync(join(pDir, ".mcp.json"), JSON.stringify({
    mcpServers: { "test-srv": { url: "http://localhost:9000/mcp" } },
  }));

  gitExec("-C " + JSON.stringify(gitRepoWithPlugins) + " add .");
  gitExec("-C " + JSON.stringify(gitRepoWithPlugins) + " commit -m init");
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SCRIPT_VERSION
// ---------------------------------------------------------------------------

describe("SCRIPT_VERSION", () => {
  it("is a semver-ish string", () => {
    assert.match(SCRIPT_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("is intentionally decoupled from plugin.json (scan_repo tracks its own format-version)", () => {
    // scan_repo.mjs tracks the community-index output format version (1.x lineage
    // inherited from the Python predecessor). This is intentionally DIFFERENT from
    // plugin.json's release version. The discover.test.mjs enforces plugin.json
    // coupling for discover.mjs only — this test documents the decoupling for scan_repo.
    const pluginJsonPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../.claude-plugin/plugin.json",
    );
    const { version: pluginVersion } = JSON.parse(readFileSync(pluginJsonPath, "utf-8"));
    assert.notEqual(
      SCRIPT_VERSION,
      pluginVersion,
      "scan_repo SCRIPT_VERSION must NOT match plugin.json — it tracks the index format version independently",
    );
  });

  it("TTL_SECONDS is 7 days in seconds", () => {
    assert.equal(TTL_SECONDS, 7 * 24 * 3600);
  });
});

// ---------------------------------------------------------------------------
// defaultUrlFn()
// ---------------------------------------------------------------------------

describe("defaultUrlFn()", () => {
  it("returns GitHub HTTPS .git URL for owner/repo", () => {
    assert.equal(defaultUrlFn("owner/repo"), "https://github.com/owner/repo.git");
    assert.equal(defaultUrlFn("ievo-ai/skills"), "https://github.com/ievo-ai/skills.git");
  });
});

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

describe("run()", () => {
  it("returns trimmed stdout on success", () => {
    const out = run("node", ["-e", "process.stdout.write('  hello  \\n')"]);
    assert.equal(out, "hello");
  });

  it("throws on non-zero exit when check=true (default)", () => {
    assert.throws(
      () => run("node", ["-e", "process.exit(1)"]),
      (err) => err.status === 1,
    );
  });

  it("returns stdout on non-zero exit when check=false and stdout present", () => {
    const out = run("node", ["-e", "process.stdout.write('got it'); process.exit(1)"], { check: false });
    assert.equal(out, "got it");
  });

  it("returns empty string on non-zero exit when check=false and no stdout", () => {
    const out = run("node", ["-e", "process.exit(1)"], { check: false });
    assert.equal(out, "");
  });

  it("accepts cwd option", () => {
    const out = run("node", ["-e", "process.stdout.write(process.cwd())"], { cwd: tmpRoot });
    assert.equal(out, tmpRoot);
  });
});

// ---------------------------------------------------------------------------
// isDir()
// ---------------------------------------------------------------------------

describe("isDir()", () => {
  it("returns true for an existing directory", () => {
    assert.equal(isDir(tmpRoot), true);
  });

  it("returns false for a non-existent path", () => {
    assert.equal(isDir(join(tmpRoot, "nonexistent-xyz")), false);
  });

  it("returns false for a regular file", () => {
    const f = join(tmpRoot, "isdir-test.txt");
    writeFileSync(f, "x");
    assert.equal(isDir(f), false);
  });
});

// ---------------------------------------------------------------------------
// fileExists()
// ---------------------------------------------------------------------------

describe("fileExists()", () => {
  it("returns true for an existing file", () => {
    const f = join(tmpRoot, "fe-test.txt");
    writeFileSync(f, "x");
    assert.equal(fileExists(f), true);
  });

  it("returns false for a non-existent path", () => {
    assert.equal(fileExists(join(tmpRoot, "nope-xyz.txt")), false);
  });

  it("returns false for a directory", () => {
    assert.equal(fileExists(tmpRoot), false);
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter()
// ---------------------------------------------------------------------------

describe("parseFrontmatter()", () => {
  it("returns {} for a non-existent file", () => {
    assert.deepEqual(parseFrontmatter(join(tmpRoot, "missing.md")), {});
  });

  it("returns {} when file has no frontmatter delimiter", () => {
    const f = join(tmpRoot, "no-fm.md");
    writeFileSync(f, "# Just a heading\n\nSome content.\n");
    assert.deepEqual(parseFrontmatter(f), {});
  });

  it("parses basic key:value frontmatter", () => {
    const f = join(tmpRoot, "basic-fm.md");
    writeFileSync(f, "---\nname: my-skill\ndescription: does things\n---\n# Body\n");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "my-skill");
    assert.equal(fm.description, "does things");
  });

  it("strips surrounding quotes from values", () => {
    const f = join(tmpRoot, "quoted-fm.md");
    writeFileSync(f, `---\nname: "quoted-name"\ndescription: 'single-quoted'\n---\n`);
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "quoted-name");
    assert.equal(fm.description, "single-quoted");
  });

  it("skips blank and whitespace-only lines", () => {
    const f = join(tmpRoot, "blank-fm.md");
    writeFileSync(f, "---\n\n   \nname: ok\n---\n");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "ok");
    assert.equal(Object.keys(fm).length, 1);
  });

  it("skips comment lines starting with #", () => {
    const f = join(tmpRoot, "comment-fm.md");
    writeFileSync(f, "---\n# this is a comment\nname: ok\n---\n");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "ok");
    assert.ok(!("# this is a comment" in fm));
  });

  it("skips indented continuation lines when currentKey is set", () => {
    const f = join(tmpRoot, "indent-fm.md");
    // multi-line value: key with empty value, then indented lines
    writeFileSync(f, "---\ncompatibility:\n  - claude\n  - codex\nname: ok\n---\n");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "ok");
    // "compatibility" has empty value → currentKey set; indented lines skipped
    assert.ok(!fm.compatibility);
  });

  it("handles key with empty value (sets currentKey)", () => {
    const f = join(tmpRoot, "empty-val-fm.md");
    writeFileSync(f, "---\nblock:\nname: after\n---\n");
    const fm = parseFrontmatter(f);
    assert.equal(fm.name, "after");
    assert.ok(!fm.block);
  });

  if (process.getuid?.() !== 0) {
    it("returns {} for an unreadable file (permission denied)", () => {
      const f = join(tmpRoot, "no-read.md");
      writeFileSync(f, "---\nname: test\n---\n");
      chmodSync(f, 0o000);
      try {
        assert.deepEqual(parseFrontmatter(f), {});
      } finally {
        chmodSync(f, 0o644);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// truncate()
// ---------------------------------------------------------------------------

describe("truncate()", () => {
  it("returns empty string for null/undefined/empty", () => {
    assert.equal(truncate(null, 10), "");
    assert.equal(truncate(undefined, 10), "");
    assert.equal(truncate("", 10), "");
  });

  it("returns text unchanged when within limit", () => {
    assert.equal(truncate("hello", 10), "hello");
    assert.equal(truncate("hello", 5), "hello");
  });

  it("truncates and appends ellipsis when over limit", () => {
    const result = truncate("abcdefghij", 5);
    assert.equal(result.length, 5);
    assert.ok(result.endsWith("…"));
    assert.equal(result, "abcd…");
  });

  it("collapses internal whitespace before truncating", () => {
    const result = truncate("a  b   c", 10);
    assert.equal(result, "a b c");
  });

  it("counts Unicode code points (not UTF-16 units) for emoji", () => {
    // Each emoji is 2 UTF-16 units (surrogate pair) but 1 Unicode code point.
    // "abcd🎉" = 5 code points; truncating at 5 keeps all 5.
    const emoji = "abcd🎉"; // 🎉
    assert.equal(truncate(emoji, 5), emoji);
    // At limit 4 → "abc…"
    const r = truncate(emoji, 4);
    assert.equal(r, "abc…");
  });
});

// ---------------------------------------------------------------------------
// detectLayout()
// ---------------------------------------------------------------------------

describe("detectLayout()", () => {
  function makeLayout(dirs) {
    const d = mkdtempSync(join(tmpdir(), "layout-"));
    for (const dir of dirs) mkdirSync(join(d, dir), { recursive: true });
    return d;
  }

  it("returns 'marketplace' when plugins/ dir exists", () => {
    const d = makeLayout(["plugins"]);
    try {
      assert.equal(detectLayout(d), "marketplace");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns 'single-plugin' when .claude-plugin/ exists (no plugins/)", () => {
    const d = makeLayout([".claude-plugin"]);
    try {
      assert.equal(detectLayout(d), "single-plugin");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns 'mixed' when both skills/ and agents/ exist (no plugins/)", () => {
    const d = makeLayout(["skills", "agents"]);
    try {
      assert.equal(detectLayout(d), "mixed");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns 'flat-skills' when only skills/ exists", () => {
    const d = makeLayout(["skills"]);
    try {
      assert.equal(detectLayout(d), "flat-skills");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns 'flat-agents' when only agents/ exists", () => {
    const d = makeLayout(["agents"]);
    try {
      assert.equal(detectLayout(d), "flat-agents");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns 'other' for empty directory", () => {
    const d = makeLayout([]);
    try {
      assert.equal(detectLayout(d), "other");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// listDirSorted() / listFilesSorted()
// ---------------------------------------------------------------------------

describe("listDirSorted()", () => {
  it("returns sorted list of entries for existing dir", () => {
    const d = mkdtempSync(join(tmpdir(), "ldir-"));
    writeFileSync(join(d, "b.md"), "");
    writeFileSync(join(d, "a.md"), "");
    writeFileSync(join(d, "c.txt"), "");
    try {
      assert.deepEqual(listDirSorted(d), ["a.md", "b.md", "c.txt"]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns [] for a non-existing dir", () => {
    assert.deepEqual(listDirSorted(join(tmpRoot, "does-not-exist")), []);
  });
});

describe("listFilesSorted()", () => {
  it("filters by extension and returns sorted list", () => {
    const d = mkdtempSync(join(tmpdir(), "lfs-"));
    writeFileSync(join(d, "b.md"), "");
    writeFileSync(join(d, "a.md"), "");
    writeFileSync(join(d, "c.txt"), "");
    try {
      assert.deepEqual(listFilesSorted(d, ".md"), ["a.md", "b.md"]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns [] for non-existing dir", () => {
    assert.deepEqual(listFilesSorted(join(tmpRoot, "nope"), ".md"), []);
  });
});

// ---------------------------------------------------------------------------
// enumerateHooks()
// ---------------------------------------------------------------------------

describe("enumerateHooks()", () => {
  it("returns not-present when file does not exist", () => {
    const r = enumerateHooks(join(tmpRoot, "no-hooks.json"));
    assert.equal(r.present, false);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.entries, []);
  });

  it("returns not-present on invalid JSON", () => {
    const f = join(tmpRoot, "bad-hooks.json");
    writeFileSync(f, "{ broken json");
    assert.equal(enumerateHooks(f).present, false);
  });

  it("handles hooks with PreToolUse, UserPromptSubmit, PostToolUse", () => {
    const f = join(tmpRoot, "full-hooks.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ command: "echo pre" }] }],
        UserPromptSubmit: [{ matcher: "*", hooks: [{ command: "echo up" }] }],
        PostToolUse: [{ matcher: "Write", hooks: [{ type: "custom-type" }] }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.present, true);
    assert.equal(r.has_pretooluse, true);
    assert.equal(r.has_userpromptsubmit, true);
    assert.equal(r.has_posttooluse, true);
    assert.equal(r.entries.length, 3);
    // Command from first.command
    assert.equal(r.entries[0].command, "echo pre");
    // Command from first.type when no command field
    assert.equal(r.entries[2].command, "custom-type");
  });

  it("uses '—' when innerHooks is empty", () => {
    const f = join(tmpRoot, "empty-inner-hooks.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [] }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].command, "—");
  });

  it("uses '—' for matcher when not present", () => {
    const f = join(tmpRoot, "no-matcher-hooks.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ command: "echo x" }] }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].matcher, "—");
  });

  it("skips hookList entries that are not arrays", () => {
    const f = join(tmpRoot, "nonarray-hooks.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        SomeEvent: "not-an-array",
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.present, true);
    assert.equal(r.entries.length, 0);
    assert.equal(r.events.length, 1);
  });

  it("returns present with empty events when hooks JSON has no 'hooks' key", () => {
    const f = join(tmpRoot, "no-hooks-key.json");
    writeFileSync(f, JSON.stringify({ otherKey: {} }));
    const r = enumerateHooks(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.entries, []);
  });

  it("uses '—' command when hook entry has no 'hooks' key (h.hooks is undefined)", () => {
    const f = join(tmpRoot, "no-inner-hooks-key.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash" }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].command, "—");
  });

  it("uses '—' command when innerHooks entry has neither command nor type", () => {
    const f = join(tmpRoot, "no-cmd-type.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ unknownField: "x" }] }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.entries[0].command, "—");
  });

  it("has_pretooluse / has_userpromptsubmit / has_posttooluse false when those events absent", () => {
    const f = join(tmpRoot, "other-event-hooks.json");
    writeFileSync(f, JSON.stringify({
      hooks: {
        AfterAgent: [{ matcher: "*", hooks: [{ command: "echo" }] }],
      },
    }));
    const r = enumerateHooks(f);
    assert.equal(r.has_pretooluse, false);
    assert.equal(r.has_userpromptsubmit, false);
    assert.equal(r.has_posttooluse, false);
  });
});

// ---------------------------------------------------------------------------
// enumerateMcp()
// ---------------------------------------------------------------------------

describe("enumerateMcp()", () => {
  it("returns not-present when file does not exist", () => {
    const r = enumerateMcp(join(tmpRoot, "no-mcp.json"));
    assert.equal(r.present, false);
    assert.deepEqual(r.servers, []);
  });

  it("returns not-present on invalid JSON", () => {
    const f = join(tmpRoot, "bad-mcp.json");
    writeFileSync(f, "{ bad");
    assert.equal(enumerateMcp(f).present, false);
  });

  it("returns present with empty servers when mcpServers is empty", () => {
    const f = join(tmpRoot, "empty-mcp.json");
    writeFileSync(f, JSON.stringify({ mcpServers: {} }));
    const r = enumerateMcp(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.servers, []);
  });

  it("marks localhost URLs as local", () => {
    const f = join(tmpRoot, "local-mcp.json");
    writeFileSync(f, JSON.stringify({
      mcpServers: {
        local: { url: "http://localhost:3000/mcp" },
        loop: { url: "http://127.0.0.1:8080/mcp" },
        ipv6: { url: "http://[::1]:9000/mcp" },
      },
    }));
    const r = enumerateMcp(f);
    assert.equal(r.servers.length, 3);
    assert.equal(r.servers[0].is_local, true);
    assert.equal(r.servers[1].is_local, true);
    assert.equal(r.servers[2].is_local, true);
  });

  it("marks remote URLs as not local", () => {
    const f = join(tmpRoot, "remote-mcp.json");
    writeFileSync(f, JSON.stringify({
      mcpServers: {
        remote: { url: "https://api.example.com/mcp" },
      },
    }));
    const r = enumerateMcp(f);
    assert.equal(r.servers[0].is_local, false);
  });

  it("returns present with empty servers when JSON has no 'mcpServers' key", () => {
    const f = join(tmpRoot, "no-mcp-key.json");
    writeFileSync(f, JSON.stringify({ otherKey: {} }));
    const r = enumerateMcp(f);
    assert.equal(r.present, true);
    assert.deepEqual(r.servers, []);
  });

  it("returns empty endpoint when server has neither url nor command", () => {
    const f = join(tmpRoot, "no-url-cmd-mcp.json");
    writeFileSync(f, JSON.stringify({ mcpServers: { empty: {} } }));
    const r = enumerateMcp(f);
    assert.equal(r.servers[0].endpoint, "");
    assert.equal(r.servers[0].is_local, false);
  });

  it("uses command field when url is absent", () => {
    const f = join(tmpRoot, "cmd-mcp.json");
    writeFileSync(f, JSON.stringify({
      mcpServers: {
        stdio: { command: "uvx my-mcp-server" },
      },
    }));
    const r = enumerateMcp(f);
    assert.equal(r.servers[0].endpoint, "uvx my-mcp-server");
    assert.equal(r.servers[0].is_local, false);
  });
});

// ---------------------------------------------------------------------------
// enumerateOnePlugin()
// ---------------------------------------------------------------------------

describe("enumerateOnePlugin()", () => {
  function makePlugin(opts = {}) {
    const d = mkdtempSync(join(tmpdir(), "plugin-"));
    // manifest
    if (opts.manifest !== false) {
      mkdirSync(join(d, ".claude-plugin"), { recursive: true });
      const m = opts.manifest ?? {
        name: "test-plugin",
        description: "A test plugin",
        version: "1.2.3",
        license: "MIT",
        author: { name: "Alice" },
      };
      writeFileSync(join(d, ".claude-plugin", "plugin.json"), JSON.stringify(m));
    }
    // agents
    if (opts.agents) {
      mkdirSync(join(d, "agents"), { recursive: true });
      for (const [name, content] of Object.entries(opts.agents)) {
        writeFileSync(join(d, "agents", name), content);
      }
    }
    // skills
    if (opts.skills) {
      for (const [name, content] of Object.entries(opts.skills)) {
        mkdirSync(join(d, "skills", name), { recursive: true });
        writeFileSync(join(d, "skills", name, "SKILL.md"), content);
        if (opts.skillScripts?.[name]) {
          mkdirSync(join(d, "skills", name, "scripts"), { recursive: true });
        }
        if (opts.skillRefs?.[name]) {
          mkdirSync(join(d, "skills", name, "references"), { recursive: true });
        }
      }
    }
    // commands
    if (opts.commands) {
      mkdirSync(join(d, "commands"), { recursive: true });
      for (const [name, content] of Object.entries(opts.commands)) {
        writeFileSync(join(d, "commands", name), content);
      }
    }
    // hooks
    if (opts.hooks) {
      mkdirSync(join(d, "hooks"), { recursive: true });
      writeFileSync(join(d, "hooks", "hooks.json"), JSON.stringify(opts.hooks));
    }
    // mcp
    if (opts.mcp) {
      writeFileSync(join(d, ".mcp.json"), JSON.stringify(opts.mcp));
    }
    return d;
  }

  it("uses defaults when no manifest file present", () => {
    const d = makePlugin({ manifest: false });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.version, "unset");
      assert.equal(r.author, "—");
      assert.equal(r.license, "—");
      assert.equal(r.description, "");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("handles bad JSON in manifest gracefully", () => {
    const d = mkdtempSync(join(tmpdir(), "plugin-bad-"));
    mkdirSync(join(d, ".claude-plugin"), { recursive: true });
    writeFileSync(join(d, ".claude-plugin", "plugin.json"), "{ bad json");
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.version, "unset");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("reads manifest fields correctly", () => {
    const d = makePlugin();
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.version, "1.2.3");
      assert.equal(r.author, "Alice");
      assert.equal(r.license, "MIT");
      assert.equal(r.description, "A test plugin");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("author stays '—' when manifest.author is a string (not object)", () => {
    const d = makePlugin({ manifest: { name: "x", version: "1.0.0", author: "Bob String" } });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.author, "—");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("author stays '—' when manifest.author is an object without a name property", () => {
    const d = makePlugin({ manifest: { name: "x", version: "1.0.0", author: {} } });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.author, "—");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("enumerates agents with frontmatter fields", () => {
    const d = makePlugin({
      agents: {
        "my-agent.md": "---\nname: my-agent\nmodel: sonnet\ntools: Bash\ndescription: Does things\n---\n",
        "no-fm.md": "no frontmatter",
      },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.agents.length, 2);
      assert.equal(r.agents[0].name, "my-agent");
      assert.equal(r.agents[0].model, "sonnet");
      assert.equal(r.agents[0].tools, "Bash");
      // no-fm agent falls back to filename sans .md
      assert.equal(r.agents[1].name, "no-fm");
      assert.equal(r.agents[1].model, "—");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("enumerates skills with broad_bash detection", () => {
    const d = makePlugin({
      skills: {
        "broad-skill": "---\nname: broad\ndescription: A broad skill\nallowed-tools: Bash(*), Write\n---\n",
        "narrow-skill": "---\nname: narrow\ndescription: Narrow\nallowed-tools: Write, Read\n---\n",
        "rm-skill": "---\nname: rm\ndescription: RM\nallowed-tools: Bash(rm:*)\n---\n",
        "sudo-skill": "---\nname: sudo\ndescription: Sudo\nallowed-tools: Bash(sudo:*)\n---\n",
        "curl-skill": "---\nname: curl\ndescription: Curl\nallowed-tools: Bash(curl:*)\n---\n",
      },
      skillScripts: { "broad-skill": true },
      skillRefs: { "broad-skill": true },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.skills.length, 5);
      const broad = r.skills.find((s) => s.name === "broad");
      assert.equal(broad.broad_bash, true);
      assert.equal(broad.has_scripts, true);
      assert.equal(broad.has_refs, true);
      const narrow = r.skills.find((s) => s.name === "narrow");
      assert.equal(narrow.broad_bash, false);
      assert.equal(narrow.has_scripts, false);
      const rm = r.skills.find((s) => s.name === "rm");
      assert.equal(rm.broad_bash, true);
      const sudo = r.skills.find((s) => s.name === "sudo");
      assert.equal(sudo.broad_bash, true);
      const curl = r.skills.find((s) => s.name === "curl");
      assert.equal(curl.broad_bash, true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips skills dir entries that are not directories", () => {
    const d = makePlugin({
      skills: { "real-skill": "---\nname: real\ndescription: Real\n---\n" },
    });
    // Add a file directly in skills/ (not a dir)
    writeFileSync(join(d, "skills", "flat-file.md"), "not a dir");
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.skills.length, 1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips skill subdirectories without SKILL.md", () => {
    const d = mkdtempSync(join(tmpdir(), "plugin-noskillmd-"));
    mkdirSync(join(d, "skills", "orphan"), { recursive: true });
    // No SKILL.md inside orphan/
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.skills.length, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skill name falls back to directory name when frontmatter has no name field", () => {
    const d = makePlugin({
      skills: { "dir-name-skill": "---\ndescription: No name field here\n---\n" },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.skills[0].name, "dir-name-skill");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skill compatibility defaults to 'any' when empty", () => {
    const d = makePlugin({
      skills: { "compat-skill": "---\nname: cs\ndescription: x\ncompatibility: \n---\n" },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.skills[0].compatibility, "any");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("enumerates commands", () => {
    const d = makePlugin({
      commands: {
        "install.md": "---\ndescription: Install command\n---\n",
        "remove.md": "---\ndescription: Remove command\n---\n",
      },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.commands.length, 2);
      assert.equal(r.commands[0].name, "install");
      assert.equal(r.commands[1].name, "remove");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("includes hooks and mcp in plugin result", () => {
    const d = makePlugin({
      hooks: {
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ command: "check" }] }],
        },
      },
      mcp: { mcpServers: { srv: { url: "http://localhost:4000" } } },
    });
    try {
      const r = enumerateOnePlugin(d);
      assert.equal(r.hooks.present, true);
      assert.equal(r.mcp.present, true);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// enumeratePlugins()
// ---------------------------------------------------------------------------

describe("enumeratePlugins()", () => {
  it("returns [] when no plugins/ dir", () => {
    const d = mkdtempSync(join(tmpdir(), "noplugins-"));
    try {
      assert.deepEqual(enumeratePlugins(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips hidden dirs (starting with .)", () => {
    const d = mkdtempSync(join(tmpdir(), "plugins-"));
    mkdirSync(join(d, "plugins", ".hidden"), { recursive: true });
    mkdirSync(join(d, "plugins", "real-plugin"), { recursive: true });
    try {
      const r = enumeratePlugins(d);
      assert.equal(r.length, 1);
      assert.equal(r[0].name, "real-plugin");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips files (not dirs) in plugins/", () => {
    const d = mkdtempSync(join(tmpdir(), "plugins-file-"));
    mkdirSync(join(d, "plugins"), { recursive: true });
    writeFileSync(join(d, "plugins", "not-a-dir.json"), "{}");
    try {
      const r = enumeratePlugins(d);
      assert.equal(r.length, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// enumerateStandaloneAgents()
// ---------------------------------------------------------------------------

describe("enumerateStandaloneAgents()", () => {
  it("returns [] when agents/ dir does not exist", () => {
    const d = mkdtempSync(join(tmpdir(), "noagents-"));
    try {
      assert.deepEqual(enumerateStandaloneAgents(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns agent entries with frontmatter fallbacks", () => {
    const d = mkdtempSync(join(tmpdir(), "agents-"));
    mkdirSync(join(d, "agents"), { recursive: true });
    writeFileSync(join(d, "agents", "coder.md"), "---\nname: coder\nmodel: opus\ntools: Bash\ndescription: Writes code\n---\n");
    writeFileSync(join(d, "agents", "no-fm.md"), "no frontmatter here");
    try {
      const r = enumerateStandaloneAgents(d);
      assert.equal(r.length, 2);
      assert.equal(r[0].name, "coder");
      assert.equal(r[0].model, "opus");
      assert.equal(r[0].path, "agents/coder.md");
      assert.equal(r[1].name, "no-fm");
      assert.equal(r[1].model, "—");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// enumerateStandaloneSkills()
// ---------------------------------------------------------------------------

describe("enumerateStandaloneSkills()", () => {
  it("returns [] when skills/ dir does not exist", () => {
    const d = mkdtempSync(join(tmpdir(), "noskills-"));
    try {
      assert.deepEqual(enumerateStandaloneSkills(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns flat skills with SKILL.md", () => {
    const d = mkdtempSync(join(tmpdir(), "flat-skills-"));
    mkdirSync(join(d, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(d, "skills", "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: Desc\nlicense: MIT\ncompatibility: claude-code\n---\n");
    try {
      const r = enumerateStandaloneSkills(d);
      assert.equal(r.length, 1);
      assert.equal(r[0].name, "my-skill");
      assert.equal(r[0].path, "skills/my-skill/SKILL.md");
      assert.equal(r[0].license, "MIT");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips skills/ entries that are files (not dirs)", () => {
    const d = mkdtempSync(join(tmpdir(), "skills-file-"));
    mkdirSync(join(d, "skills"), { recursive: true });
    writeFileSync(join(d, "skills", "flat.md"), "not a dir");
    try {
      assert.deepEqual(enumerateStandaloneSkills(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("finds nested sub-skills when outer SKILL.md is absent", () => {
    const d = mkdtempSync(join(tmpdir(), "nested-skills-"));
    mkdirSync(join(d, "skills", "bundle", "sub-skill"), { recursive: true });
    writeFileSync(
      join(d, "skills", "bundle", "sub-skill", "SKILL.md"),
      "---\nname: sub-skill\ndescription: Sub\nlicense: MIT\ncompatibility: any\n---\n",
    );
    try {
      const r = enumerateStandaloneSkills(d);
      assert.equal(r.length, 1);
      assert.equal(r[0].path, "skills/bundle/sub-skill/SKILL.md");
      assert.equal(r[0].name, "sub-skill");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("flat skill uses directory name and defaults when frontmatter fields are absent", () => {
    const d = mkdtempSync(join(tmpdir(), "flat-defaults-"));
    mkdirSync(join(d, "skills", "fallback-skill"), { recursive: true });
    // SKILL.md with no name, no license, no compatibility
    writeFileSync(join(d, "skills", "fallback-skill", "SKILL.md"), "---\ndescription: A skill\n---\n");
    try {
      const r = enumerateStandaloneSkills(d);
      assert.equal(r[0].name, "fallback-skill");   // fm.name ?? skillName
      assert.equal(r[0].license, "—");              // fm.license ?? "—"
      assert.equal(r[0].compatibility, "any");      // truncate(undefined, 80) || "any"
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("nested sub-skill uses directory name and defaults when frontmatter fields are absent", () => {
    const d = mkdtempSync(join(tmpdir(), "nested-defaults-"));
    mkdirSync(join(d, "skills", "bundle", "sub"), { recursive: true });
    // SKILL.md with no name, no license, no compatibility
    writeFileSync(join(d, "skills", "bundle", "sub", "SKILL.md"), "---\ndescription: A sub skill\n---\n");
    try {
      const r = enumerateStandaloneSkills(d);
      assert.equal(r[0].name, "sub");     // fm.name ?? subName
      assert.equal(r[0].license, "—");   // fm.license ?? "—"
      assert.equal(r[0].compatibility, "any");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("skips nested subdirs without SKILL.md when outer SKILL.md is absent", () => {
    const d = mkdtempSync(join(tmpdir(), "nested-noskill-"));
    mkdirSync(join(d, "skills", "bundle", "empty-sub"), { recursive: true });
    // No SKILL.md anywhere
    try {
      assert.deepEqual(enumerateStandaloneSkills(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// enumerateStandaloneCommands()
// ---------------------------------------------------------------------------

describe("enumerateStandaloneCommands()", () => {
  it("returns [] when commands/ dir does not exist", () => {
    const d = mkdtempSync(join(tmpdir(), "nocmds-"));
    try {
      assert.deepEqual(enumerateStandaloneCommands(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("returns command entries", () => {
    const d = mkdtempSync(join(tmpdir(), "cmds-"));
    mkdirSync(join(d, "commands"), { recursive: true });
    writeFileSync(join(d, "commands", "deploy.md"), "---\ndescription: Deploy app\n---\n");
    try {
      const r = enumerateStandaloneCommands(d);
      assert.equal(r.length, 1);
      assert.equal(r[0].name, "deploy");
      assert.equal(r[0].description, "Deploy app");
      assert.equal(r[0].path, "commands/deploy.md");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// isoNow() / isoDate()
// ---------------------------------------------------------------------------

describe("isoNow()", () => {
  it("returns ISO 8601 UTC timestamp with +00:00 suffix", () => {
    const t = isoNow();
    assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
  });
});

describe("isoDate()", () => {
  it("returns today as YYYY-MM-DD when daysAgo=0", () => {
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(isoDate(0), today);
  });

  it("returns a past date for daysAgo > 0", () => {
    const past = isoDate(30);
    assert.match(past, /^\d{4}-\d{2}-\d{2}$/);
    const diff = (new Date() - new Date(past)) / (1000 * 60 * 60 * 24);
    assert.ok(diff >= 29 && diff <= 31, `Expected ~30 days ago, got ${diff.toFixed(1)} days`);
  });
});

// ---------------------------------------------------------------------------
// parseArgs()
// ---------------------------------------------------------------------------

describe("parseArgs()", () => {
  it("parses positional repo argument", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo"]);
    assert.equal(a.repo, "owner/repo");
  });

  it("parses --output-dir", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo", "--output-dir", "/tmp/out"]);
    assert.equal(a.outputDir, "/tmp/out");
  });

  it("parses --checkout-dir", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo", "--checkout-dir", "/tmp/co"]);
    assert.equal(a.checkoutDir, "/tmp/co");
  });

  it("parses --force-refresh", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo", "--force-refresh"]);
    assert.equal(a.force, true);
  });

  it("defaults repo to null when not provided", () => {
    const a = parseArgs(["node", "scan_repo.mjs"]);
    assert.equal(a.repo, null);
  });

  it("defaults outputDir to '.'", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo"]);
    assert.equal(a.outputDir, ".");
  });

  it("defaults checkoutDir to ~/.ievo/checkouts", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo"]);
    assert.equal(a.checkoutDir, join(homedir(), ".ievo", "checkouts"));
  });

  it("defaults force to false", () => {
    const a = parseArgs(["node", "scan_repo.mjs", "owner/repo"]);
    assert.equal(a.force, false);
  });
});

// ---------------------------------------------------------------------------
// renderIndexMd()
// ---------------------------------------------------------------------------

describe("renderIndexMd()", () => {
  const baseData = {
    owner_repo: "test/repo",
    scanned_at: "2026-01-15T12:00:00+00:00",
    commit_sha: "abc1234",
    default_branch: "main",
    layout: "marketplace",
    last_commit_date: "2026-01-15",
    recent_commits: { count: 5, from: "2025-12-16", to: "2026-01-15" },
    description: "A test repo",
    license: "MIT",
    stars: 42,
    created: "2025-01-01",
    plugins: [],
    standalone_agents: [],
    standalone_skills: [],
    standalone_commands: [],
  };

  it("renders header with repo name and metadata", () => {
    const md = renderIndexMd(baseData);
    assert.ok(md.includes("# `test/repo` — community index"));
    assert.ok(md.includes("Commit SHA: abc1234"));
    assert.ok(md.includes("Layout: marketplace"));
    assert.ok(md.includes("**License:** MIT"));
    assert.ok(md.includes("**Stars:** 42"));
    assert.ok(md.includes("**Recent commits:** 5 commits"));
  });

  it("renders '—' for empty description", () => {
    const md = renderIndexMd({ ...baseData, description: "" });
    assert.ok(md.includes("**Description:** —"));
  });

  it("omits recent_commits line when recent_commits is undefined", () => {
    const md = renderIndexMd({ ...baseData, recent_commits: undefined });
    assert.ok(!md.includes("Recent commits:"));
  });

  it("omits recent_commits line when count is undefined", () => {
    const md = renderIndexMd({ ...baseData, recent_commits: {} });
    assert.ok(!md.includes("Recent commits:"));
  });

  it("renders 'missing' for null/falsy license", () => {
    const md = renderIndexMd({ ...baseData, license: null });
    assert.ok(md.includes("**License:** missing"));
  });

  it("renders plugins section with agents, skills, commands", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "my-plugin",
        description: "Plugin desc",
        version: "1.0.0",
        path: "plugins/my-plugin/",
        author: "Bob",
        license: "MIT",
        agents: [{ name: "agent1", model: "sonnet", tools: "Bash", description: "Agent one" }],
        skills: [{
          name: "skill1",
          description: "Skill one",
          has_scripts: false,
          has_refs: false,
          license: "MIT",
          compatibility: "any",
          broad_bash: false,
        }],
        commands: [{ name: "cmd1", description: "Command one" }],
        hooks: { present: false, entries: [] },
        mcp: { present: false, servers: [] },
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("## Plugins (1)"));
    assert.ok(md.includes("### my-plugin"));
    assert.ok(md.includes("**Agents (1):**"));
    assert.ok(md.includes("| agent1 |"));
    assert.ok(md.includes("**Skills (1):**"));
    assert.ok(md.includes("| skill1 |"));
    assert.ok(md.includes("**Commands (1):**"));
    assert.ok(md.includes("| cmd1 |"));
  });

  it("renders hooks table when hooks are present", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "hook-plugin",
        description: "",
        version: "1.0.0",
        path: "plugins/hook-plugin/",
        author: "—",
        license: "—",
        agents: [],
        skills: [],
        commands: [],
        hooks: {
          present: true,
          has_pretooluse: true,
          has_userpromptsubmit: false,
          entries: [{ event: "PreToolUse", matcher: "Bash", command: "echo x" }],
        },
        mcp: { present: false, servers: [] },
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("**Hooks:**"));
    assert.ok(md.includes("| PreToolUse | Bash |"));
    assert.ok(md.includes("PreToolUse: yes — hook-plugin"));
  });

  it("renders MCP servers table when MCP is present", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "mcp-plugin",
        description: "",
        version: "1.0.0",
        path: "plugins/mcp-plugin/",
        author: "—",
        license: "—",
        agents: [],
        skills: [],
        commands: [],
        hooks: { present: false, entries: [] },
        mcp: {
          present: true,
          servers: [{ name: "srv", endpoint: "http://localhost:3000", is_local: true }],
        },
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("**MCP servers:**"));
    assert.ok(md.includes("| srv |"));
    assert.ok(md.includes("**MCP servers total:** 1"));
  });

  it("renders broad_bash in structural signals section", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "broad-plugin",
        description: "",
        version: "1.0.0",
        path: "plugins/broad-plugin/",
        author: "—",
        license: "—",
        agents: [],
        skills: [{ name: "wide", description: "", has_scripts: false, has_refs: false, license: "—", compatibility: "any", broad_bash: true }],
        commands: [],
        hooks: { present: false, entries: [] },
        mcp: { present: false, servers: [] },
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("**Skills with broad allowed-tools:** 1 — broad-plugin/wide"));
  });

  it("renders standalone agents section", () => {
    const data = {
      ...baseData,
      standalone_agents: [{ name: "sa", model: "opus", tools: "Bash", description: "Standalone agent", path: "agents/sa.md" }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("## Standalone agents (1)"));
    assert.ok(md.includes("| sa |"));
  });

  it("renders standalone skills section", () => {
    const data = {
      ...baseData,
      standalone_skills: [{ name: "ss", description: "Standalone skill", license: "MIT", compatibility: "any", path: "skills/ss/SKILL.md" }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("## Standalone skills (1)"));
  });

  it("renders standalone commands section", () => {
    const data = {
      ...baseData,
      standalone_commands: [{ name: "sc", description: "Standalone cmd", path: "commands/sc.md" }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("## Standalone commands (1)"));
  });

  it("renders 'no' for UserPromptSubmit when absent", () => {
    const md = renderIndexMd(baseData);
    assert.ok(md.includes("UserPromptSubmit: no"));
  });

  it("renders UserPromptSubmit 'yes' when a plugin has has_userpromptsubmit", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "up-plugin",
        description: "",
        version: "1.0.0",
        path: "plugins/up-plugin/",
        author: "—",
        license: "—",
        agents: [],
        skills: [],
        commands: [],
        hooks: {
          present: true,
          has_pretooluse: false,
          has_userpromptsubmit: true,
          entries: [],
        },
        mcp: { present: false, servers: [] },
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("UserPromptSubmit: yes — up-plugin"));
  });

  it("handles plugins with undefined hooks and mcp (?.  short-circuit, ?? 0 fallback)", () => {
    const data = {
      ...baseData,
      plugins: [{
        name: "bare-plugin",
        description: "",
        version: "1.0.0",
        path: "plugins/bare-plugin/",
        author: "—",
        license: "—",
        agents: [],
        skills: [],          // empty but defined (skills ?? [] guard removed — always defined)
        commands: [],
        hooks: undefined,    // tests p.hooks?.present, p.hooks?.entries?.length ?? 0
        mcp: undefined,      // tests p.mcp?.present, p.mcp?.servers?.length ?? 0
      }],
    };
    const md = renderIndexMd(data);
    assert.ok(md.includes("**Hooks total:** 0 across 0 plugins"));
    assert.ok(md.includes("**MCP servers total:** 0"));
    // undefined hooks → no hooks table rendered
    assert.ok(!md.includes("**Hooks:**"));
  });
});

// ---------------------------------------------------------------------------
// git operations (require real git repo)
// ---------------------------------------------------------------------------

describe("getCommitSha()", () => {
  it("returns a short SHA string", () => {
    const sha = getCommitSha(gitRepo);
    assert.match(sha, /^[0-9a-f]{7,}$/);
  });
});

describe("getLastCommitDate()", () => {
  it("returns YYYY-MM-DD format", () => {
    const d = getLastCommitDate(gitRepo);
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(d, "2026-01-15");
  });
});

describe("getDefaultBranch()", () => {
  it("returns branch name for a real git repo", () => {
    const b = getDefaultBranch(gitRepo);
    assert.ok(typeof b === "string" && b.length > 0);
  });

  it("returns 'main' when repo has no git symbolic-ref (non-git dir)", () => {
    const d = mkdtempSync(join(tmpdir(), "no-git-"));
    try {
      assert.equal(getDefaultBranch(d), "main");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("countRecentCommits()", () => {
  it("counts commits since a date", () => {
    // Our commit was on 2026-01-15; counting since 2026-01-01 should find it
    const count = countRecentCommits(gitRepo, "2026-01-01");
    assert.ok(count >= 1);
  });

  it("returns 0 when no commits since future date", () => {
    const count = countRecentCommits(gitRepo, "2099-01-01");
    assert.equal(count, 0);
  });
});

// ---------------------------------------------------------------------------
// checkoutOrRefresh()
// ---------------------------------------------------------------------------

describe("checkoutOrRefresh()", () => {
  it("clones a fresh repo when target does not exist", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-fresh-"));
    try {
      const target = checkoutOrRefresh(
        "test/fresh",
        checkoutDir,
        false,
        () => `file://${gitRepo}`,
      );
      assert.equal(target, join(checkoutDir, "test-fresh"));
      assert.ok(isDir(join(target, ".git")));
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });

  it("returns target early when within TTL", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-ttl-"));
    const target = join(checkoutDir, "test-ttl");
    mkdirSync(join(target, ".git"), { recursive: true });
    // Write HEAD with current mtime (fresh)
    const headFile = join(target, ".git", "HEAD");
    writeFileSync(headFile, "ref: refs/heads/main\n");
    try {
      const result = checkoutOrRefresh("test/ttl", checkoutDir, false);
      assert.equal(result, target);
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });

  it("attempts git fetch when HEAD is stale (age >= TTL), returns target if fetch fails", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-stale-"));
    const target = join(checkoutDir, "test-stale");
    // Use no-remote repo as the pre-existing checkout
    execSync(`git clone ${JSON.stringify(noRemote)} ${JSON.stringify(target)}`, { stdio: "ignore" });
    // Make HEAD file appear stale (old mtime — way beyond TTL)
    const headFile = join(target, ".git", "HEAD");
    const staleTime = new Date(Date.now() - (TTL_SECONDS + 3600) * 1000);
    utimesSync(headFile, staleTime, staleTime);
    // Remove the remote so git fetch will fail
    execSync("git -C " + JSON.stringify(target) + " remote remove origin", { stdio: "ignore" });
    try {
      const result = checkoutOrRefresh("test/stale", checkoutDir, false);
      assert.equal(result, target);
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });

  it("attempts git fetch when force=true, returns target if fetch fails", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-force-"));
    const target = join(checkoutDir, "test-force");
    mkdirSync(join(target, ".git"), { recursive: true });
    writeFileSync(join(target, ".git", "HEAD"), "ref: refs/heads/main\n");
    // No real git remote → fetch will fail
    try {
      const result = checkoutOrRefresh("test/force", checkoutDir, true);
      assert.equal(result, target);
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });

  it("attempts git fetch when HEAD file is absent, returns target if fetch fails", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-nohead-"));
    const target = join(checkoutDir, "test-nohead");
    // Create target dir but no .git/HEAD
    mkdirSync(join(target, "subdir"), { recursive: true });
    try {
      const result = checkoutOrRefresh("test/nohead", checkoutDir, false);
      assert.equal(result, target);
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });

  it("force-refreshes successfully when target has a valid remote", () => {
    const checkoutDir = mkdtempSync(join(tmpdir(), "co-force-ok-"));
    try {
      // First: fresh clone
      checkoutOrRefresh("test/forceok", checkoutDir, false, () => `file://${gitRepo}`);
      // Second: force refresh — git fetch + reset should succeed
      const result = checkoutOrRefresh(
        "test/forceok",
        checkoutDir,
        true,
        () => `file://${gitRepo}`,
      );
      assert.ok(isDir(join(result, ".git")));
    } finally { rmSync(checkoutDir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

describe("main()", () => {
  it("calls exit(1) when no repo argument", () => {
    let exitCode = null;
    const errors = [];
    main(["node", "scan_repo.mjs"], undefined, (c) => { exitCode = c; }, () => {}, (msg) => errors.push(msg));
    assert.equal(exitCode, 1);
    assert.ok(errors.some((e) => e.includes("repo must be in")));
  });

  it("calls exit(1) when repo has no slash", () => {
    let exitCode = null;
    main(["node", "scan_repo.mjs", "noslash"], undefined, (c) => { exitCode = c; }, () => {}, () => {});
    assert.equal(exitCode, 1);
  });

  it("calls exit(2) when clone fails", () => {
    let exitCode = null;
    const errors = [];
    const outputDir = mkdtempSync(join(tmpdir(), "main-fail-"));
    const checkoutDir = mkdtempSync(join(tmpdir(), "main-fail-co-"));
    try {
      main(
        ["node", "scan_repo.mjs", "owner/repo", "--output-dir", outputDir, "--checkout-dir", checkoutDir],
        () => { throw new Error("clone failed"); },
        (c) => { exitCode = c; },
        () => {},
        (msg) => errors.push(msg),
      );
      assert.equal(exitCode, 2);
      assert.ok(errors.some((e) => e.includes("Failed to clone")));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(checkoutDir, { recursive: true, force: true });
    }
  });

  it("writes .md and .json with correct flags for repo with plugins, hooks, mcp, LICENSE", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "main-plugins-"));
    const checkoutDir = mkdtempSync(join(tmpdir(), "main-plugins-co-"));
    const logged = [];
    try {
      main(
        ["node", "scan_repo.mjs", "owner/plugrepo", "--output-dir", outputDir, "--checkout-dir", checkoutDir],
        () => `file://${gitRepoWithPlugins}`,
        (c) => { throw new Error(`Unexpected exit(${c})`); },
        (msg) => logged.push(msg),
        (msg) => { throw new Error(`Unexpected error: ${msg}`); },
      );
      assert.ok(fileExists(join(outputDir, "owner-plugrepo.md")));
      const manifest = JSON.parse(readFileSync(join(outputDir, "owner-plugrepo.json"), "utf-8"));
      // License file exists → "MIT"
      const md = readFileSync(join(outputDir, "owner-plugrepo.md"), "utf-8");
      assert.ok(md.includes("**License:** MIT"));
      // has_hooks and has_mcp should be true
      assert.equal(manifest.has_hooks, true);
      assert.equal(manifest.has_mcp, true);
      // log message should say "hooks: yes, mcp: yes"
      assert.ok(logged.some((l) => l.includes("hooks: yes") && l.includes("mcp: yes")));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(checkoutDir, { recursive: true, force: true });
    }
  });

  it("writes .md and .json output files on success", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "main-out-"));
    const checkoutDir = mkdtempSync(join(tmpdir(), "main-co-"));
    const logged = [];
    try {
      main(
        ["node", "scan_repo.mjs", "owner/repo", "--output-dir", outputDir, "--checkout-dir", checkoutDir],
        () => `file://${gitRepo}`,
        (c) => { throw new Error(`Unexpected exit(${c})`); },
        (msg) => logged.push(msg),
        (msg) => { throw new Error(`Unexpected error: ${msg}`); },
      );
      assert.ok(fileExists(join(outputDir, "owner-repo.md")));
      assert.ok(fileExists(join(outputDir, "owner-repo.json")));
      assert.ok(logged.some((l) => l.includes("owner/repo: indexed")));
      // Validate JSON structure
      const manifest = JSON.parse(readFileSync(join(outputDir, "owner-repo.json"), "utf-8"));
      assert.ok(manifest.last_scan);
      assert.ok(manifest.stats);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(checkoutDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// isCliEntry()
// ---------------------------------------------------------------------------

describe("isCliEntry()", () => {
  it("returns true when metaUrl matches argv[1]", () => {
    const fakeUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(fakeUrl, ["node", SCRIPT_PATH]), true);
  });

  it("returns false when metaUrl does not match argv[1]", () => {
    const fakeUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(fakeUrl, ["node", "/other/script.mjs"]), false);
  });

  it("returns false when argv[1] is undefined", () => {
    const fakeUrl = pathToFileURL(SCRIPT_PATH).href;
    assert.equal(isCliEntry(fakeUrl, ["node"]), false);
  });
});

// ---------------------------------------------------------------------------
// CLI invocation via spawnSync
// ---------------------------------------------------------------------------

describe("CLI invocation", () => {
  it("exits with code 1 and prints error when called without args", () => {
    const r = spawnSync("node", [SCRIPT_PATH], { encoding: "utf-8" });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("repo must be in"));
  });

  it("exits with code 1 when repo has no slash", () => {
    const r = spawnSync("node", [SCRIPT_PATH, "noslash"], { encoding: "utf-8" });
    assert.equal(r.status, 1);
  });

  it("exits 0 and produces output files for a valid local repo", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "cli-out-"));
    const checkoutDir = mkdtempSync(join(tmpdir(), "cli-co-"));
    try {
      // We can't inject urlFn via CLI, so pre-clone the repo into checkoutDir
      // with the expected safeName so the TTL check returns it immediately.
      const target = join(checkoutDir, "cli-repo");
      execSync(`git clone ${JSON.stringify(gitRepo)} ${JSON.stringify(target)}`, { stdio: "ignore" });
      // Set HEAD mtime to now (within TTL)
      const headFile = join(target, ".git", "HEAD");
      const now = new Date();
      utimesSync(headFile, now, now);

      const r = spawnSync("node", [
        SCRIPT_PATH, "cli/repo",
        "--output-dir", outputDir,
        "--checkout-dir", checkoutDir,
      ], { encoding: "utf-8" });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      assert.ok(fileExists(join(outputDir, "cli-repo.md")));
      assert.ok(fileExists(join(outputDir, "cli-repo.json")));
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
      rmSync(checkoutDir, { recursive: true, force: true });
    }
  });
});
