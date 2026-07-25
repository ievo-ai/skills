// Tests for check-version-bump.mjs — the plugins/ievo/** "absent version
// bump" CI gate.
// Run: node --test --experimental-test-coverage .github/scripts/validators/tests/check-version-bump.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  PLUGIN_JSON_PATH,
  MARKETPLACE_JSON_PATH,
  SCRIPTS_DIR,
  DECOUPLED_SCRIPTS,
  isPluginPath,
  parseArgs,
  getMergeBase,
  getChangedPaths,
  readFileAtRef,
  findScriptFiles,
  extractScriptVersion,
  checkVersionBump,
  main,
  isCliEntry,
} from "../../check-version-bump.mjs";

// ---------------------------------------------------------------------------
// Fakes — same pattern as scan_repo.test.mjs's makeFakeExec: a fake
// execImpl(cmd, args, opts) that records calls and returns scripted output
// in order, instead of running real git.
// ---------------------------------------------------------------------------

function makeFakeExec(responses) {
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

function makeFakeReadFile(map) {
  return (path) => {
    if (!(path in map)) throw new Error(`fake readFile: no fixture for '${path}'`);
    return map[path];
  };
}

function makeFakeReaddir(map) {
  return (dir) => {
    if (!(dir in map)) throw new Error(`fake readdir: no fixture for '${dir}'`);
    return map[dir];
  };
}

const scriptSrc = (v) => `export const SCRIPT_VERSION = "${v}";\n`;
const noVersionSrc = "export function foo() { return 1; }\n";

// ---------------------------------------------------------------------------
// isPluginPath
// ---------------------------------------------------------------------------

describe("isPluginPath", () => {
  it("matches plugins/ievo/** paths", () => {
    assert.ok(isPluginPath("plugins/ievo/scripts/discover.mjs"));
  });
  it("matches .claude-plugin/** paths", () => {
    assert.ok(isPluginPath(".claude-plugin/marketplace.json"));
  });
  it("does not match infra/docs paths", () => {
    assert.ok(!isPluginPath("README.md"));
    assert.ok(!isPluginPath(".github/workflows/pre-commit-gate.yml"));
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses --base and --head", () => {
    assert.deepEqual(parseArgs(["node", "script", "--base", "abc", "--head", "def"]), { base: "abc", head: "def" });
  });
  it("returns {} when no flags given", () => {
    assert.deepEqual(parseArgs(["node", "script"]), {});
  });
  it("parses --base alone", () => {
    assert.deepEqual(parseArgs(["node", "script", "--base", "abc"]), { base: "abc" });
  });
  it("parses --head alone", () => {
    assert.deepEqual(parseArgs(["node", "script", "--head", "def"]), { head: "def" });
  });
});

// ---------------------------------------------------------------------------
// getMergeBase / getChangedPaths / readFileAtRef
// ---------------------------------------------------------------------------

describe("getMergeBase", () => {
  it("returns the trimmed merge-base sha and calls git merge-base", () => {
    const fake = makeFakeExec([{ stdout: "  sha123\n" }]);
    assert.equal(getMergeBase("main", "HEAD", fake), "sha123");
    assert.deepEqual(fake.calls[0].args, ["merge-base", "main", "HEAD"]);
  });
});

describe("getChangedPaths", () => {
  it("splits non-empty diff output into paths", () => {
    const fake = makeFakeExec([{ stdout: "a.mjs\nb.md\n" }]);
    assert.deepEqual(getChangedPaths("base", "head", fake), ["a.mjs", "b.md"]);
    assert.deepEqual(fake.calls[0].args, ["diff", "--name-only", "base", "head"]);
  });
  it("returns [] for empty diff output", () => {
    const fake = makeFakeExec([{ stdout: "" }]);
    assert.deepEqual(getChangedPaths("base", "head", fake), []);
  });
  it("drops blank lines from the output", () => {
    const fake = makeFakeExec([{ stdout: "a.mjs\n\nb.md\n" }]);
    assert.deepEqual(getChangedPaths("base", "head", fake), ["a.mjs", "b.md"]);
  });
});

describe("readFileAtRef", () => {
  it("returns file content at the given ref", () => {
    const fake = makeFakeExec([{ stdout: '{"version":"1.0.0"}' }]);
    assert.equal(readFileAtRef("sha123", "plugin.json", fake), '{"version":"1.0.0"}');
    assert.deepEqual(fake.calls[0].args, ["show", "sha123:plugin.json"]);
  });
  it("returns null when the path did not exist at that ref", () => {
    const fake = makeFakeExec([{ throw: new Error("path does not exist") }]);
    assert.equal(readFileAtRef("sha123", "new-file.json", fake), null);
  });
});

// ---------------------------------------------------------------------------
// findScriptFiles / extractScriptVersion
// ---------------------------------------------------------------------------

describe("findScriptFiles", () => {
  it("filters to .mjs files and sorts them, dropping non-.mjs entries", () => {
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["b.mjs", "a.mjs", "tests", "README.md"] });
    assert.deepEqual(findScriptFiles(SCRIPTS_DIR, readdirImpl), ["a.mjs", "b.mjs"]);
  });
});

describe("extractScriptVersion", () => {
  it("extracts the SCRIPT_VERSION literal", () => {
    assert.equal(extractScriptVersion(scriptSrc("0.62.4")), "0.62.4");
  });
  it("returns null when no SCRIPT_VERSION constant is present", () => {
    assert.equal(extractScriptVersion(noVersionSrc), null);
  });
});

// ---------------------------------------------------------------------------
// checkVersionBump — the core gate logic
// ---------------------------------------------------------------------------

describe("checkVersionBump", () => {
  it("skips infra/docs-only PRs (no plugins/ievo/** or .claude-plugin/** change)", () => {
    const execImpl = makeFakeExec([{ stdout: "README.md\nCHANGELOG.md\n" }]);
    const readFileImpl = () => {
      throw new Error("must not read files when skipping");
    };
    const readdirImpl = () => {
      throw new Error("must not list scripts when skipping");
    };
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.skipped, true);
    assert.match(result.reason, /infra\/docs-only/);
    assert.deepEqual(result.errors, []);
  });

  it("flags an absent bump: plugin.json version unchanged from merge-base", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) }, // plugin.json @ merge-base — same as head
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.0" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.0"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "1.0.0" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.skipped, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /version unchanged/);
  });

  it("flags plugin.json missing at merge-base (new file introduced without valid history)", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/.claude-plugin/plugin.json\n" },
      { throw: new Error("path does not exist") },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.0" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.0"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "1.0.0" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /missing at merge-base/);
  });

  it("flags plugin.json invalid JSON at merge-base", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/.claude-plugin/plugin.json\n" },
      { stdout: "{not valid json" },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.0" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.0"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "1.0.0" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /invalid JSON at merge-base/);
  });

  it("flags a script whose SCRIPT_VERSION was left behind", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) }, // merge-base version
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }), // bumped at head
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"), // bumped
      [`${SCRIPTS_DIR}/evolution_candidates.mjs`]: scriptSrc("1.0.0"), // forgotten!
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs", "evolution_candidates.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /evolution_candidates\.mjs/);
    assert.match(result.errors[0], /SCRIPT_VERSION/);
  });

  it("does not flag scan_repo.mjs — intentionally decoupled from plugin.json", () => {
    assert.ok(DECOUPLED_SCRIPTS.has("scan_repo.mjs"));
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [`${SCRIPTS_DIR}/scan_repo.mjs`]: scriptSrc("1.1.6"), // deliberately different, must not error
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs", "scan_repo.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.deepEqual(result.errors, []);
  });

  it("does not flag a script with no SCRIPT_VERSION constant at all", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/validate_agents.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/validate_agents.mjs`]: noVersionSrc,
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["validate_agents.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.deepEqual(result.errors, []);
  });

  it("flags marketplace.json metadata.version drift, including a missing metadata key", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ plugins: [{ version: "1.0.1" }] }), // metadata key absent
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /metadata\.version/);
  });

  it("flags marketplace.json metadata.version drift when metadata is present but stale (not just missing)", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /metadata\.version \('1\.0\.0'\)/);
  });

  it("flags marketplace.json plugins[0].version drift, including an empty plugins array", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [] }), // no plugins[0]
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /plugins\[0\]\.version/);
  });

  it("flags marketplace.json plugins[0].version drift when plugins[0] is present but stale (not just an empty array)", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.0" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /plugins\[0\]\.version \('1\.0\.0'\)/);
  });

  it("passes a correctly-bumped PR with no errors", () => {
    const execImpl = makeFakeExec([
      { stdout: "plugins/ievo/scripts/discover.mjs\n.claude-plugin/marketplace.json\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [`${SCRIPTS_DIR}/evolution_candidates.mjs`]: scriptSrc("1.0.1"),
      [`${SCRIPTS_DIR}/scrub.mjs`]: scriptSrc("1.0.1"),
      [`${SCRIPTS_DIR}/scan_repo.mjs`]: scriptSrc("1.1.6"),
      [`${SCRIPTS_DIR}/validate_agents.mjs`]: noVersionSrc,
      [`${SCRIPTS_DIR}/validate_skills.mjs`]: noVersionSrc,
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({
      [SCRIPTS_DIR]: ["discover.mjs", "evolution_candidates.mjs", "scrub.mjs", "scan_repo.mjs", "validate_agents.mjs", "validate_skills.mjs"],
    });
    const result = checkVersionBump({ mergeBase: "base", head: "HEAD", execImpl, readFileImpl, readdirImpl });
    assert.equal(result.skipped, false);
    assert.deepEqual(result.errors, []);
  });
});

// ---------------------------------------------------------------------------
// main — CLI/env wiring
// ---------------------------------------------------------------------------

function makeRecorder() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

function makeExitRecorder() {
  const calls = [];
  const fn = (code) => {
    calls.push(code);
    return code;
  };
  fn.calls = calls;
  return fn;
}

describe("main", () => {
  it("skips entirely on a non-pull_request event, without touching git", () => {
    const execImpl = () => {
      throw new Error("must not call git on a non-pull_request event");
    };
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(["node", "script"], { GITHUB_EVENT_NAME: "push" }, execImpl, () => {}, () => [], log, errLog, exit);
    assert.equal(exit.calls[0], 0);
    assert.match(log.calls[0][0], /skip/);
  });

  it("errors when no base ref is available", () => {
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(["node", "script"], { GITHUB_EVENT_NAME: "pull_request" }, () => {}, () => {}, () => [], log, errLog, exit);
    assert.equal(exit.calls[0], 2);
    assert.match(errLog.calls[0][0], /no base ref/);
  });

  it("errors when getMergeBase throws", () => {
    const execImpl = () => {
      throw new Error("git not found");
    };
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(["node", "script", "--base", "main", "--head", "HEAD"], { GITHUB_EVENT_NAME: "pull_request" }, execImpl, () => {}, () => [], log, errLog, exit);
    assert.equal(exit.calls[0], 2);
    assert.match(errLog.calls[0][0], /failed to compute merge-base/);
  });

  it("resolves base from $BASE_SHA and head defaults to HEAD when neither --head nor $HEAD_SHA is given, then reports skip", () => {
    const execImpl = makeFakeExec([
      { stdout: "sha123" }, // merge-base
      { stdout: "README.md\n" }, // diff --name-only — infra-only
    ]);
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(["node", "script"], { GITHUB_EVENT_NAME: "pull_request", BASE_SHA: "origin/main" }, execImpl, () => {}, () => [], log, errLog, exit);
    assert.deepEqual(execImpl.calls[0].args, ["merge-base", "origin/main", "HEAD"]);
    assert.equal(exit.calls[0], 0);
    assert.match(log.calls[0][0], /skip/);
  });

  it("prefers --head over $HEAD_SHA", () => {
    const execImpl = makeFakeExec([{ stdout: "sha123" }, { stdout: "README.md\n" }]);
    const exit = makeExitRecorder();
    main(
      ["node", "script", "--base", "main", "--head", "pr-head"],
      { GITHUB_EVENT_NAME: "pull_request", HEAD_SHA: "should-not-be-used" },
      execImpl,
      () => {},
      () => [],
      makeRecorder(),
      makeRecorder(),
      exit,
    );
    assert.deepEqual(execImpl.calls[0].args, ["merge-base", "main", "pr-head"]);
  });

  it("falls back to $HEAD_SHA when --head is absent", () => {
    const execImpl = makeFakeExec([{ stdout: "sha123" }, { stdout: "README.md\n" }]);
    const exit = makeExitRecorder();
    main(
      ["node", "script", "--base", "main"],
      { GITHUB_EVENT_NAME: "pull_request", HEAD_SHA: "env-head" },
      execImpl,
      () => {},
      () => [],
      makeRecorder(),
      makeRecorder(),
      exit,
    );
    assert.deepEqual(execImpl.calls[0].args, ["merge-base", "main", "env-head"]);
  });

  it("fails the gate and reports every stale file when the bump is absent", () => {
    const execImpl = makeFakeExec([
      { stdout: "sha123" },
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.0" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.0"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "1.0.0" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(
      ["node", "script", "--base", "main", "--head", "HEAD"],
      { GITHUB_EVENT_NAME: "pull_request" },
      execImpl,
      readFileImpl,
      readdirImpl,
      log,
      errLog,
      exit,
    );
    assert.equal(exit.calls[0], 1);
    assert.match(errLog.calls[0][0], /Version-bump gate FAILED/);
    assert.match(errLog.calls[1][0], /version unchanged/);
  });

  it("passes the gate and exits 0 on a correctly-bumped PR", () => {
    const execImpl = makeFakeExec([
      { stdout: "sha123" },
      { stdout: "plugins/ievo/scripts/discover.mjs\n" },
      { stdout: JSON.stringify({ version: "1.0.0" }) },
    ]);
    const readFileImpl = makeFakeReadFile({
      [PLUGIN_JSON_PATH]: JSON.stringify({ version: "1.0.1" }),
      [`${SCRIPTS_DIR}/discover.mjs`]: scriptSrc("1.0.1"),
      [MARKETPLACE_JSON_PATH]: JSON.stringify({ metadata: { version: "1.0.1" }, plugins: [{ version: "1.0.1" }] }),
    });
    const readdirImpl = makeFakeReaddir({ [SCRIPTS_DIR]: ["discover.mjs"] });
    const log = makeRecorder();
    const errLog = makeRecorder();
    const exit = makeExitRecorder();
    main(
      ["node", "script", "--base", "main", "--head", "HEAD"],
      { GITHUB_EVENT_NAME: "pull_request" },
      execImpl,
      readFileImpl,
      readdirImpl,
      log,
      errLog,
      exit,
    );
    assert.equal(exit.calls[0], 0);
    assert.match(log.calls[0][0], /gate OK/);
  });
});

// ---------------------------------------------------------------------------
// isCliEntry
// ---------------------------------------------------------------------------

describe("isCliEntry", () => {
  it("is true when metaUrl matches the invoked script path", () => {
    assert.ok(isCliEntry("file:///path/to/check-version-bump.mjs", ["node", "/path/to/check-version-bump.mjs"]));
  });
  it("is false when imported as a module (different path)", () => {
    assert.ok(!isCliEntry("file:///path/to/check-version-bump.mjs", ["node", "/path/to/other-script.mjs"]));
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess (covers the module-scope entry guard — `if (isCliEntry(...))
// main();` only runs when the file is executed directly, never on import)
// ---------------------------------------------------------------------------

describe("CLI invocation (subprocess — covers entry guard)", () => {
  const SCRIPT_PATH = fileURLToPath(new URL("../../check-version-bump.mjs", import.meta.url));

  it("invoked directly, skips on a non-pull_request event and exits 0", () => {
    const r = spawnSync(process.execPath, [SCRIPT_PATH], {
      encoding: "utf-8",
      timeout: 30000,
      env: { ...process.env, GITHUB_EVENT_NAME: "push" },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /skip/);
  });
});
