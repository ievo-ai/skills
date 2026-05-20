// Tests for validate_agents.mjs — agent frontmatter linter.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/validate_agents.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_MODELS,
  FORBIDDEN_MODEL_PATTERNS,
  REQUIRED_FIELDS,
  parseArgs,
  parseFrontmatter,
  checkModelField,
  validateAgent,
  validateAgentContent,
  main,
} from "../validate_agents.mjs";

describe("constants", () => {
  it("ALLOWED_MODELS contains the four canonical aliases", () => {
    assert.deepEqual([...ALLOWED_MODELS].sort(), ["haiku", "inherit", "opus", "sonnet"]);
  });

  it("REQUIRED_FIELDS lists name and description", () => {
    assert.deepEqual(REQUIRED_FIELDS, ["name", "description"]);
  });

  it("FORBIDDEN_MODEL_PATTERNS covers vendor-specific + version-pinned IDs", () => {
    const patterns = FORBIDDEN_MODEL_PATTERNS.map((p) => p.pattern.source);
    assert.ok(patterns.includes("^claude-"));
    assert.ok(patterns.includes("^gpt-"));
    assert.ok(patterns.includes("^gemini-"));
    assert.ok(patterns.includes("^o[12345]"));
    assert.ok(patterns.some((p) => p.includes("\\d+-\\d+")));
    assert.ok(patterns.some((p) => p.includes("\\d{8}")));
  });

  it("every forbidden pattern has a non-empty `why` reason", () => {
    for (const { pattern, why } of FORBIDDEN_MODEL_PATTERNS) {
      assert.ok(why.length > 10, `Pattern ${pattern.source} missing rationale`);
    }
  });
});

describe("parseArgs", () => {
  it("default agentsDir is plugins/ievo/agents", () => {
    const args = parseArgs(["node", "validate_agents.mjs"]);
    assert.equal(args.agentsDir, "plugins/ievo/agents");
    assert.equal(args.quiet, false);
  });

  it("positional arg overrides agentsDir", () => {
    const args = parseArgs(["node", "validate_agents.mjs", "custom/dir"]);
    assert.equal(args.agentsDir, "custom/dir");
  });

  it("--quiet flag sets quiet=true", () => {
    const args = parseArgs(["node", "validate_agents.mjs", "--quiet"]);
    assert.equal(args.quiet, true);
  });

  it("--quiet + positional dir both work", () => {
    const args = parseArgs(["node", "validate_agents.mjs", "--quiet", "custom/dir"]);
    assert.equal(args.quiet, true);
    assert.equal(args.agentsDir, "custom/dir");
  });

  it("unknown -- flag is silently ignored (not parsed as dir)", () => {
    const args = parseArgs(["node", "validate_agents.mjs", "--unknown"]);
    assert.equal(args.agentsDir, "plugins/ievo/agents");
  });
});

describe("parseFrontmatter", () => {
  it("returns null for content without frontmatter", () => {
    assert.equal(parseFrontmatter("no frontmatter here"), null);
    assert.equal(parseFrontmatter(""), null);
  });

  it("parses simple key: value pairs", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: bar\n---\nbody");
    assert.deepEqual(fm, { name: "foo", description: "bar" });
  });

  it("strips surrounding single or double quotes from values", () => {
    const fm = parseFrontmatter('---\nname: "quoted"\nmodel: \'alias\'\n---\nbody');
    assert.equal(fm.name, "quoted");
    assert.equal(fm.model, "alias");
  });

  it("skips empty lines and YAML comments", () => {
    const fm = parseFrontmatter("---\n# comment\nname: foo\n\ndescription: bar\n---");
    assert.deepEqual(fm, { name: "foo", description: "bar" });
  });

  it("ignores indented (continuation) lines", () => {
    const fm = parseFrontmatter("---\ntools:\n  - Read\n  - Write\nname: foo\n---");
    assert.equal(fm.name, "foo");
    assert.equal(fm.tools, undefined); // empty value, then indented children skipped
  });

  it("ignores lines without colon", () => {
    const fm = parseFrontmatter("---\nname: foo\nno-colon-line\ndescription: bar\n---");
    assert.equal(fm.name, "foo");
    assert.equal(fm.description, "bar");
  });

  it("skips key with empty value", () => {
    const fm = parseFrontmatter("---\nname: foo\nempty:\ndescription: bar\n---");
    assert.equal(fm.empty, undefined);
    assert.equal(fm.description, "bar");
  });
});

describe("checkModelField", () => {
  it("returns empty array for each allowed alias", () => {
    for (const alias of ALLOWED_MODELS) {
      assert.deepEqual(checkModelField(alias), [], `${alias} should be allowed`);
    }
  });

  it("rejects claude-* vendor-specific IDs", () => {
    const v = checkModelField("claude-sonnet-4-6");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "model-vendor-locked");
    assert.match(v[0].message, /Anthropic-specific/);
  });

  it("rejects gpt-* OpenAI IDs", () => {
    const v = checkModelField("gpt-5");
    assert.equal(v[0].rule, "model-vendor-locked");
    assert.match(v[0].message, /OpenAI-specific/);
  });

  it("rejects gemini-* Google IDs", () => {
    const v = checkModelField("gemini-pro");
    assert.equal(v[0].rule, "model-vendor-locked");
    assert.match(v[0].message, /Google-specific/);
  });

  it("rejects o-series OpenAI IDs", () => {
    for (const id of ["o1", "o3-mini", "o5-preview"]) {
      const v = checkModelField(id);
      assert.equal(v.length, 1, `${id} should be flagged`);
      assert.match(v[0].message, /o-series/);
    }
  });

  it("rejects version-pinned -N-M IDs", () => {
    const v = checkModelField("sonnet-4-6");
    assert.equal(v.length, 1);
    assert.match(v[0].message, /Version-pinned/);
  });

  it("rejects date-pinned snapshots", () => {
    const v = checkModelField("foo-20251001");
    assert.equal(v.length, 1);
    assert.match(v[0].message, /Date-pinned/);
  });

  it("rejects provider-namespaced IDs", () => {
    const v = checkModelField("openai@gpt-5");
    assert.equal(v.length, 1);
    assert.match(v[0].message, /(Provider-namespaced|OpenAI)/);
  });

  it("rejects entirely unknown unrecognized strings as 'not in allowed set'", () => {
    const v = checkModelField("randomalias");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "model-not-allowed");
  });
});

describe("validateAgentContent", () => {
  it("passes a valid minimal agent", () => {
    const content = "---\nname: foo\ndescription: bar\n---\nBody";
    assert.deepEqual(validateAgentContent(content), []);
  });

  it("passes valid agent with allowed model alias", () => {
    const content = "---\nname: foo\ndescription: bar\nmodel: sonnet\n---";
    assert.deepEqual(validateAgentContent(content), []);
  });

  it("flags missing frontmatter", () => {
    const v = validateAgentContent("just body, no frontmatter");
    assert.equal(v[0].rule, "no-frontmatter");
  });

  it("flags missing name", () => {
    const v = validateAgentContent("---\ndescription: bar\n---");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "missing-required-field");
    assert.match(v[0].message, /name/);
  });

  it("flags missing description", () => {
    const v = validateAgentContent("---\nname: foo\n---");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "missing-required-field");
    assert.match(v[0].message, /description/);
  });

  it("flags both missing fields", () => {
    const v = validateAgentContent("---\nfoo: bar\n---");
    assert.equal(v.length, 2);
    assert.deepEqual(v.map((x) => x.rule), ["missing-required-field", "missing-required-field"]);
  });

  it("flags forbidden model + missing field together", () => {
    const v = validateAgentContent("---\nname: foo\nmodel: gpt-5\n---");
    assert.equal(v.length, 2);
    const rules = v.map((x) => x.rule).sort();
    assert.deepEqual(rules, ["missing-required-field", "model-vendor-locked"]);
  });

  it("ignores model field when absent (optional)", () => {
    const v = validateAgentContent("---\nname: foo\ndescription: bar\n---");
    assert.deepEqual(v, []);
  });
});

describe("validateAgent (filesystem)", () => {
  const tmpDir = join(tmpdir(), `validate-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  it("reads file from disk and applies validation", () => {
    const filePath = join(tmpDir, "good.md");
    writeFileSync(filePath, "---\nname: good\ndescription: ok\n---", "utf-8");
    assert.deepEqual(validateAgent(filePath), []);
  });

  it("propagates violations from disk content", () => {
    const filePath = join(tmpDir, "bad.md");
    writeFileSync(filePath, "---\nname: bad\ndescription: x\nmodel: claude-sonnet-4-6\n---", "utf-8");
    const v = validateAgent(filePath);
    assert.equal(v[0].rule, "model-vendor-locked");
  });

  // Cleanup once after all tests in this suite
  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("main (CLI entry)", () => {
  const tmpDir = join(tmpdir(), `validate-cli-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  function makeRun() {
    const logs = [];
    const errs = [];
    let exitCode = null;
    return {
      log: (...args) => logs.push(args.join(" ")),
      errLog: (...args) => errs.push(args.join(" ")),
      exit: (code) => { exitCode = code; },
      logs,
      errs,
      get exitCode() { return exitCode; },
    };
  }

  it("exits 2 when agents dir does not exist", () => {
    const run = makeRun();
    main(["node", "validate_agents.mjs", "/nonexistent/dir"], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 2);
    assert.match(run.errs.join("\n"), /cannot read agents directory/);
  });

  it("exits 2 when no .md files in dir", () => {
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const run = makeRun();
    main(["node", "validate_agents.mjs", emptyDir], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 2);
    assert.match(run.errs.join("\n"), /no .md files/);
  });

  it("exits 0 when all agents pass", () => {
    const passDir = join(tmpDir, "pass");
    mkdirSync(passDir, { recursive: true });
    writeFileSync(join(passDir, "a.md"), "---\nname: a\ndescription: ok\n---", "utf-8");
    writeFileSync(join(passDir, "b.md"), "---\nname: b\ndescription: ok\nmodel: opus\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_agents.mjs", passDir], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 0);
    assert.match(run.logs.join("\n"), /2 passed, 0 violations/);
    assert.match(run.logs.join("\n"), /✓/);
  });

  it("exits 1 when violations found", () => {
    const failDir = join(tmpDir, "fail");
    mkdirSync(failDir, { recursive: true });
    writeFileSync(join(failDir, "bad.md"), "---\nname: bad\ndescription: x\nmodel: gpt-5\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_agents.mjs", failDir], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
    assert.match(run.logs.join("\n"), /Fix: see AGENTS.md/);
  });

  it("--quiet suppresses pass messages", () => {
    const passDir = join(tmpDir, "pass-quiet");
    mkdirSync(passDir, { recursive: true });
    writeFileSync(join(passDir, "a.md"), "---\nname: a\ndescription: ok\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_agents.mjs", passDir, "--quiet"], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 0);
    // No ✓ pass line, but summary line still present
    assert.ok(!run.logs.some((l) => l.includes("✓")));
    assert.match(run.logs.join("\n"), /1 passed/);
  });

  it("--quiet still shows violations", () => {
    const failDir = join(tmpDir, "fail-quiet");
    mkdirSync(failDir, { recursive: true });
    writeFileSync(join(failDir, "bad.md"), "---\nname: bad\ndescription: x\nmodel: claude-foo\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_agents.mjs", failDir, "--quiet"], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
  });

  it("cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("CLI invocation (subprocess — covers entry guard)", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "validate_agents.mjs");
  const tmpDir = join(tmpdir(), `validate-spawn-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  it("runs as CLI, exits 0 on valid agent", () => {
    writeFileSync(join(tmpDir, "good.md"), "---\nname: good\ndescription: ok\n---", "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, tmpDir], { encoding: "utf-8" });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /1 passed/);
  });

  it("runs as CLI, exits 1 on violation", () => {
    const failDir = join(tmpDir, "fail");
    mkdirSync(failDir, { recursive: true });
    writeFileSync(join(failDir, "bad.md"), "---\nname: bad\ndescription: x\nmodel: claude-sonnet-4-6\n---", "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, failDir], { encoding: "utf-8" });
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /model-vendor-locked/);
  });

  it("spawn cleanup", () => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
