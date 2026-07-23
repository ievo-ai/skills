// Tests for validate_agents.mjs — agent frontmatter linter.
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/validate_agents.test.mjs

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ALLOWED_MODELS,
  FORBIDDEN_MODEL_PATTERNS,
  BLOCK_SCALAR_RE,
  REQUIRED_FIELDS,
  VALID_EFFORT_VALUES,
  MAX_VALIDATE_FILE_BYTES,
  isOversized,
  parseArgs,
  parseFrontmatter,
  checkModelField,
  checkEffortField,
  validateAgent,
  validateAgentContent,
  main,
  isCliEntry,
} from "../validate_agents.mjs";

describe("constants", () => {
  it("ALLOWED_MODELS contains all canonical aliases", () => {
    assert.deepEqual([...ALLOWED_MODELS].sort(), ["fable", "haiku", "inherit", "opus", "sonnet"]);
  });

  it("REQUIRED_FIELDS lists name and description", () => {
    assert.deepEqual(REQUIRED_FIELDS, ["name", "description"]);
  });

  it("VALID_EFFORT_VALUES contains the five agentskills.io effort levels", () => {
    assert.deepEqual([...VALID_EFFORT_VALUES].sort(), ["high", "low", "max", "medium", "xhigh"]);
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

  it("BLOCK_SCALAR_RE matches block/folded scalar indicators, rejects plain values", () => {
    for (const v of ["|", ">", "|-", "|+", ">-2", "|+1"]) {
      assert.ok(BLOCK_SCALAR_RE.test(v), `expected ${v} to match`);
    }
    for (const v of ["", "foo", "|bar"]) {
      assert.ok(!BLOCK_SCALAR_RE.test(v), `expected ${v} not to match`);
    }
  });

  it("BLOCK_SCALAR_RE matches the digit-before-chomping YAML ordering too (regression: skills#392 review)", () => {
    // YAML 1.2's block-header grammar allows the indentation digit and
    // chomping indicator in EITHER order — |2- and |-2 are equivalent.
    for (const v of ["|2-", "|2+", ">3+", ">1-"]) {
      assert.ok(BLOCK_SCALAR_RE.test(v), `expected ${v} to match`);
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

  it("does NOT skip indented lines — security gate (post-review)", () => {
    // Originally `if (/^\s+/.test(line)) continue;` would silently skip indented
    // lines. An attacker could nest `model: claude-sonnet-4-6` under another key
    // and bypass the validator. Now indented lines parse too — they still need
    // a `key: value` form to register.
    const fm = parseFrontmatter("---\nname: foo\ntools:\n  model: claude-sonnet-4-6\n---");
    assert.equal(fm.name, "foo");
    // The indented `model:` line is now picked up (key trimmed)
    assert.equal(fm.model, "claude-sonnet-4-6");
  });

  it("handles CRLF line endings (Windows files) — security gate", () => {
    // Original regex was \n-only; CRLF-encoded files would partially fail or
    // skip lines. After fix: normalize CRLF→LF before parsing.
    const fm = parseFrontmatter("---\r\nname: foo\r\nmodel: claude-sonnet-4-6\r\n---\r\nBody");
    assert.equal(fm.name, "foo");
    assert.equal(fm.model, "claude-sonnet-4-6");
  });

  it("handles CR-only line endings (old Mac files)", () => {
    const fm = parseFrontmatter("---\rname: foo\rmodel: gpt-5\r---\rBody");
    assert.equal(fm.name, "foo");
    assert.equal(fm.model, "gpt-5");
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

  it("consumes a block scalar (|) body so its true content is captured, not the indicator (skills#392 twin)", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  first line\n  second line\n---");
    assert.equal(fm.description, "first line\nsecond line");
  });

  it("consumes a folded scalar (>) body with a chomping indicator", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: >-\n  folded text\n---");
    assert.equal(fm.description, "folded text");
  });

  it("block scalar with no indented body lines leaves the field unset", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\nmodel: sonnet\n---");
    assert.equal(fm.description, undefined);
    assert.equal(fm.model, "sonnet");
  });

  it("a model: line nested inside another key's block scalar body is NOT treated as a real model field", () => {
    // Correct YAML semantics: the indented `model:` line here is literal
    // string content of `description`, not a smuggled top-level key — a real
    // YAML parser resolves it the same way, so this isn't a re-opening of the
    // nested-model-bypass fix above (that fix concerns a BARE parent key with
    // no `|`/`>` value, which this test does not use).
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  model: claude-sonnet-4-6\n---");
    assert.equal(fm.description, "model: claude-sonnet-4-6");
    assert.equal(fm.model, undefined);
  });

  it("does not strip quote characters from a block scalar body (they are literal YAML content, not delimiters)", () => {
    const fm = parseFrontmatter('---\nname: foo\ndescription: |\n  "quoted" text\n---');
    assert.equal(fm.description, '"quoted" text');
  });

  it("strips a raw ESC byte from a plain scalar value — CWE-150 log-injection guard", () => {
    const fm = parseFrontmatter("---\nname: foo\nmodel: sonnet\x1b[31m\n---");
    assert.equal(fm.model, "sonnet[31m");
  });

  it("strips other C0 control characters (e.g. NUL, BEL) from a plain scalar value", () => {
    const fm = parseFrontmatter("---\nname: foo\neffort: hi\x00\x07gh\n---");
    assert.equal(fm.effort, "high");
  });

  it("strips C0 control characters from a block scalar body while preserving real newlines", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  line one\x1b bad\n  line two\n---");
    assert.equal(fm.description, "line one bad\nline two");
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

describe("checkEffortField", () => {
  it("returns empty array for each valid effort level", () => {
    for (const level of VALID_EFFORT_VALUES) {
      assert.deepEqual(checkEffortField(level), [], `${level} should be valid`);
    }
  });

  it("returns empty array when effort is absent (undefined)", () => {
    assert.deepEqual(checkEffortField(undefined), []);
  });

  it("returns empty array when effort is an empty string", () => {
    assert.deepEqual(checkEffortField(""), []);
  });

  it("errors on an invalid effort value", () => {
    const v = checkEffortField("medium-high");
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "invalid-effort-value");
    assert.match(v[0].message, /medium-high/);
    assert.match(v[0].message, /low, medium, high, xhigh, max/);
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

  it("passes a valid agent with a valid effort value", () => {
    const content = "---\nname: foo\ndescription: bar\neffort: high\n---";
    assert.deepEqual(validateAgentContent(content), []);
  });

  it("flags an invalid effort value", () => {
    const content = "---\nname: foo\ndescription: bar\neffort: fast\n---";
    const v = validateAgentContent(content);
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "invalid-effort-value");
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

// isOversized — CWE-400 guard for validateAgent's readFileSync call site.
// Mirrors scan_repo.mjs's isOversized/MAX_SCAN_FILE_BYTES pair, but uses
// lstatSync (not statSync) — see #391 / #363 — so a symlink is rejected by
// type instead of being followed to a target whose size can be misleading.
describe("isOversized", () => {
  const tmp = join(tmpdir(), `validate-agents-oversized-${Date.now()}`);

  it("false for a normal small file", () => {
    mkdirSync(tmp, { recursive: true });
    const f = join(tmp, "small.md");
    writeFileSync(f, "hello", "utf-8");
    assert.equal(isOversized(f), false);
  });

  it("true when a file exceeds MAX_VALIDATE_FILE_BYTES", () => {
    const f = join(tmp, "big.md");
    writeFileSync(f, "x".repeat(MAX_VALIDATE_FILE_BYTES + 1), "utf-8");
    assert.equal(isOversized(f), true);
  });

  it("false when a file is exactly at the cap (boundary)", () => {
    const f = join(tmp, "exact.md");
    writeFileSync(f, "x".repeat(MAX_VALIDATE_FILE_BYTES), "utf-8");
    assert.equal(isOversized(f), false);
  });

  it("respects a custom capBytes argument", () => {
    const f = join(tmp, "custom-cap.md");
    writeFileSync(f, "x".repeat(100), "utf-8");
    assert.equal(isOversized(f, 50), true);
    assert.equal(isOversized(f, 200), false);
  });

  it("false for a nonexistent path (lstat fails)", () => {
    assert.equal(isOversized(join(tmp, "nope.md")), false);
  });

  it("true for a symlink, regardless of the target's size — rejected by type via lstatSync", () => {
    const target = join(tmp, "symlink-target.md");
    writeFileSync(target, "tiny", "utf-8");
    const link = join(tmp, "symlink-source.md");
    symlinkSync(target, link);
    assert.equal(isOversized(link), true);
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
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

  it("throws on missing file (caller's main loop should catch)", () => {
    assert.throws(() => validateAgent(join(tmpDir, "does-not-exist.md")), /ENOENT/);
  });

  it("returns a file-too-large violation without reading when file exceeds the size cap (CWE-400)", () => {
    const filePath = join(tmpDir, "oversized.md");
    writeFileSync(filePath, "x".repeat(MAX_VALIDATE_FILE_BYTES + 1), "utf-8");
    const v = validateAgent(filePath);
    assert.deepEqual(v, [{
      severity: "error",
      rule: "file-too-large",
      message: `Agent file exceeds ${MAX_VALIDATE_FILE_BYTES} bytes (or is not a regular file — e.g. a symlink) — refusing to read`,
    }]);
  });

  it("returns a file-too-large violation for a symlink instead of following it", () => {
    const target = join(tmpDir, "symlink-target.md");
    writeFileSync(target, "---\nname: sym\ndescription: ok\n---", "utf-8");
    const filePath = join(tmpDir, "symlink-source.md");
    symlinkSync(target, filePath);
    const v = validateAgent(filePath);
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "file-too-large");
  });

  // Cleanup once after all tests in this suite
  after(() => {
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

  it("continues past unreadable file — does NOT halt on first read error (CI gate correctness)", () => {
    // POSIX-only: chmod 000 makes the file unreadable so readFileSync throws
    // EACCES while isOversized's lstatSync (which only needs dir execute
    // permission) still sees a normal-sized regular file — this exercises
    // main()'s try/catch around validateAgent(), distinct from the
    // isOversized short-circuit (a directory-named .md would be caught by
    // isOversized's isFile() check before ever reaching readFileSync).
    if (process.platform === "win32") return;
    const mixedDir = join(tmpDir, "mixed");
    mkdirSync(mixedDir, { recursive: true });
    // file 1: good agent
    writeFileSync(join(mixedDir, "1-good.md"), "---\nname: good\ndescription: ok\n---", "utf-8");
    // file 2: unreadable (permission-denied) — readFileSync throws EACCES
    const trapFile = join(mixedDir, "2-trap.md");
    writeFileSync(trapFile, "---\nname: trap\ndescription: ok\n---", "utf-8");
    chmodSync(trapFile, 0o000);
    // file 3: another good agent
    writeFileSync(join(mixedDir, "3-good.md"), "---\nname: also-good\ndescription: ok\n---", "utf-8");
    const run = makeRun();
    try {
      main(["node", "validate_agents.mjs", mixedDir], run.exit, run.log, run.errLog);
    } finally {
      chmodSync(trapFile, 0o644);
    }
    // 1 pass + 1 unreadable + 1 pass = exit 1 (any violation = 1)
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /file-unreadable/);
    // Critical: file 3 was still processed (loop didn't halt at file 2)
    assert.match(run.logs.join("\n"), /3-good\.md/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("isCliEntry", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "validate_agents.mjs");
  // pathToFileURL produces a platform-correct file URL — on Windows `file://C:\…`
  // (raw concatenation) is invalid, `file:///C:/…` (pathToFileURL output) is correct.
  const scriptUrl = pathToFileURL(scriptPath).href;

  it("returns true when argv[1] is the absolute script path", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", scriptPath]), true);
  });

  it("returns true when argv[1] is a relative path that resolves to the script", () => {
    const cwdBefore = process.cwd();
    process.chdir(dirname(scriptPath));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./validate_agents.mjs"]), true);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("returns false when argv[1] points to a different file", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other/file.mjs"]), false);
  });

  it("returns false when argv[1] is undefined (covers `?? \"\"` fallback)", () => {
    // Node populates argv[1] = undefined when launched via `node -e '...'` or REPL.
    // The `?? ""` fallback resolves to cwd, which won't equal the script's absolute path.
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
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

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
