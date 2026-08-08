// Tests for validate_skills.mjs — SKILL.md frontmatter linter (agentskills.io spec).
// Run: node --test --experimental-test-coverage plugins/ievo/scripts/tests/validate_skills.test.mjs

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  DESCRIPTION_MAX_LENGTH,
  COMPATIBILITY_MAX_LENGTH,
  VALID_EFFORT_VALUES,
  ALLOWED_MODELS,
  FORBIDDEN_MODEL_PATTERNS,
  BLOCK_SCALAR_RE,
  CONTROL_CHAR_RE,
  DEFAULT_SKILLS_DIR,
  MAX_VALIDATE_FILE_BYTES,
  isOversized,
  parseArgs,
  parseFrontmatter,
  checkModelField,
  checkEffortField,
  validateSkillContent,
  validateSkill,
  discoverSkillFiles,
  main,
  isCliEntry,
} from "../validate_skills.mjs";

describe("constants", () => {
  it("NAME_MAX_LENGTH is 64", () => {
    assert.equal(NAME_MAX_LENGTH, 64);
  });

  it("NAME_PATTERN matches valid skill names", () => {
    assert.ok(NAME_PATTERN.test("init"));
    assert.ok(NAME_PATTERN.test("debug-on"));
    assert.ok(NAME_PATTERN.test("a"));
    assert.ok(NAME_PATTERN.test("a1b2"));
    assert.ok(NAME_PATTERN.test("my-skill-name"));
  });

  it("NAME_PATTERN rejects invalid names", () => {
    assert.ok(!NAME_PATTERN.test("-start"));
    assert.ok(!NAME_PATTERN.test("end-"));
    assert.ok(!NAME_PATTERN.test("UPPER"));
    assert.ok(!NAME_PATTERN.test("has space"));
    assert.ok(!NAME_PATTERN.test("under_score"));
    assert.ok(!NAME_PATTERN.test(""));
  });

  it("DESCRIPTION_MAX_LENGTH is 1024", () => {
    assert.equal(DESCRIPTION_MAX_LENGTH, 1024);
  });

  it("COMPATIBILITY_MAX_LENGTH is 500", () => {
    assert.equal(COMPATIBILITY_MAX_LENGTH, 500);
  });

  it("VALID_EFFORT_VALUES contains the five canonical effort levels", () => {
    assert.deepEqual([...VALID_EFFORT_VALUES].sort(), ["high", "low", "max", "medium", "xhigh"]);
  });

  it("ALLOWED_MODELS contains the five canonical aliases", () => {
    assert.deepEqual([...ALLOWED_MODELS].sort(), ["fable", "haiku", "inherit", "opus", "sonnet"]);
  });

  it("FORBIDDEN_MODEL_PATTERNS covers vendor-specific + version-pinned IDs", () => {
    const patterns = FORBIDDEN_MODEL_PATTERNS.map((p) => p.pattern.source);
    assert.ok(patterns.includes("^claude-"));
    assert.ok(patterns.includes("^gpt-"));
    assert.ok(patterns.includes("^gemini-"));
    assert.ok(patterns.includes("^o\\d"));
  });

  it("every forbidden pattern has a non-empty why reason", () => {
    for (const { pattern, why } of FORBIDDEN_MODEL_PATTERNS) {
      assert.ok(why.length > 5, `Pattern ${pattern.source} missing rationale`);
    }
  });

  it("DEFAULT_SKILLS_DIR points to skills directory", () => {
    assert.equal(DEFAULT_SKILLS_DIR, "plugins/ievo/skills");
  });

  it("BLOCK_SCALAR_RE matches block/folded scalar indicators with chomping/indentation", () => {
    for (const v of ["|", ">", "|-", "|+", ">-", ">+", "|2", ">1", "|-2", ">+1"]) {
      assert.ok(BLOCK_SCALAR_RE.test(v), `expected ${v} to match`);
    }
  });

  it("BLOCK_SCALAR_RE matches the digit-before-chomping YAML ordering too (regression: skills#392 review)", () => {
    // YAML 1.2's block-header grammar allows the indentation digit and
    // chomping indicator in EITHER order — |2- and |-2 are equivalent.
    // Missing this ordering left the exact CWE-20 bypass reachable via
    // `description: |2-` instead of `description: |`.
    for (const v of ["|2-", "|2+", ">3+", ">1-"]) {
      assert.ok(BLOCK_SCALAR_RE.test(v), `expected ${v} to match`);
    }
  });

  it("BLOCK_SCALAR_RE rejects plain scalar values", () => {
    for (const v of ["", "foo", "|bar", "a|b", "3", "-", "+"]) {
      assert.ok(!BLOCK_SCALAR_RE.test(v), `expected ${v} not to match`);
    }
  });

  it("CONTROL_CHAR_RE matches C0 controls and DEL, excludes tab/LF/CR (CWE-150)", () => {
    // CONTROL_CHAR_RE carries the `g` flag (needed for the .replace() call
    // site in parseFrontmatter) — reset lastIndex before each .test() call
    // so this loop isn't tripped up by the stateful global-regex gotcha.
    for (const ch of ["\x00", "\x1b", "\x07", "\x7f"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} to match`);
    }
    for (const ch of ["\t", "\n", "\r", "a"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(!CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} not to match`);
    }
  });

  it("CONTROL_CHAR_RE matches Unicode bidi-override/isolate and zero-width characters incl. BOM (Trojan-Source spoof guard, skills#600)", () => {
    for (const ch of ["\u200b", "\u200d", "\u200f", "\u202a", "\u202e", "\u2060", "\u2066", "\u2069", "\ufeff"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} to match`);
    }
    for (const ch of ["\u2059", "\u2070", "a"]) {
      CONTROL_CHAR_RE.lastIndex = 0;
      assert.ok(!CONTROL_CHAR_RE.test(ch), `expected ${JSON.stringify(ch)} not to match`);
    }
  });
});

describe("parseArgs", () => {
  it("default returns empty files and quiet=false", () => {
    const args = parseArgs(["node", "validate_skills.mjs"]);
    assert.deepEqual(args.files, []);
    assert.equal(args.quiet, false);
  });

  it("positional args become files", () => {
    const args = parseArgs(["node", "validate_skills.mjs", "a.md", "b.md"]);
    assert.deepEqual(args.files, ["a.md", "b.md"]);
  });

  it("--quiet flag sets quiet=true", () => {
    const args = parseArgs(["node", "validate_skills.mjs", "--quiet"]);
    assert.equal(args.quiet, true);
    assert.deepEqual(args.files, []);
  });

  it("--quiet + files both work", () => {
    const args = parseArgs(["node", "validate_skills.mjs", "--quiet", "a.md"]);
    assert.equal(args.quiet, true);
    assert.deepEqual(args.files, ["a.md"]);
  });

  it("unknown -- flag is silently ignored", () => {
    const args = parseArgs(["node", "validate_skills.mjs", "--unknown"]);
    assert.deepEqual(args.files, []);
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

  it("strips surrounding quotes from values", () => {
    const fm = parseFrontmatter('---\nname: "quoted"\ncompatibility: \'single\'\n---');
    assert.equal(fm.name, "quoted");
    assert.equal(fm.compatibility, "single");
  });

  it("skips empty lines and YAML comments", () => {
    const fm = parseFrontmatter("---\n# comment\nname: foo\n\ndescription: bar\n---");
    assert.deepEqual(fm, { name: "foo", description: "bar" });
  });

  it("parses indented lines (security: nested model bypass)", () => {
    const fm = parseFrontmatter("---\nname: foo\ntools:\n  model: claude-sonnet-4-6\n---");
    assert.equal(fm.model, "claude-sonnet-4-6");
  });

  it("handles CRLF line endings", () => {
    const fm = parseFrontmatter("---\r\nname: foo\r\nmodel: gpt-5\r\n---\r\nBody");
    assert.equal(fm.name, "foo");
    assert.equal(fm.model, "gpt-5");
  });

  it("handles CR-only line endings", () => {
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

  it("consumes a block scalar (|) body so length reflects real content, not the indicator (skills#392)", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  first line\n  second line\n---");
    assert.equal(fm.description, "first line\nsecond line");
  });

  it("consumes a folded scalar (>) body with chomping/indentation indicators", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: >-\n  folded text\n---");
    assert.equal(fm.description, "folded text");
  });

  it("block scalar with no indented body lines leaves the field unset", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\nmodel: sonnet\n---");
    assert.equal(fm.description, undefined);
    assert.equal(fm.model, "sonnet");
  });

  it("block scalar body can include blank lines", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  para one\n\n  para two\n---");
    assert.equal(fm.description, "para one\n\npara two");
  });

  it("resumes normal key scanning immediately after a block scalar's body ends", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  some text\nmodel: claude-sonnet-4-6\n---");
    assert.equal(fm.description, "some text");
    assert.equal(fm.model, "claude-sonnet-4-6");
  });

  it("a model: line nested inside another key's block scalar body is NOT treated as a real model field", () => {
    // Correct YAML semantics: the indented `model:` line here is literal
    // string content of `description`, not a smuggled top-level key — a real
    // YAML parser resolves it the same way, so this isn't a re-opening of the
    // "security: nested model bypass" test above (that test uses a BARE
    // parent key with no `|`/`>` value, which this test does not use).
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  model: claude-sonnet-4-6\n---");
    assert.equal(fm.description, "model: claude-sonnet-4-6");
    assert.equal(fm.model, undefined);
  });

  it("does not strip quote characters from a block scalar body (they are literal YAML content, not delimiters)", () => {
    const fm = parseFrontmatter('---\nname: foo\ndescription: |\n  "quoted" text\n---');
    assert.equal(fm.description, '"quoted" text');
  });

  it("strips a raw ESC byte from a plain scalar value — CWE-150 log-injection guard", () => {
    const fm = parseFrontmatter("---\nname: foo\x1b[31m\ndescription: bar\n---");
    assert.equal(fm.name, "foo[31m");
  });

  it("strips other C0 control characters (e.g. NUL, BEL) from a plain scalar value", () => {
    const fm = parseFrontmatter("---\nname: foo\neffort: hi\x00\x07gh\n---");
    assert.equal(fm.effort, "high");
  });

  it("strips C0 control characters from a block scalar body while preserving real newlines", () => {
    const fm = parseFrontmatter("---\nname: foo\ndescription: |\n  line one\x1b bad\n  line two\n---");
    assert.equal(fm.description, "line one bad\nline two");
  });

  it("strips a Unicode bidi-override from a plain scalar value (Trojan-Source spoof guard, skills#600)", () => {
    const fm = parseFrontmatter(`---\nname: foo\ndescription: evil\u202edesrever\n---`);
    assert.equal(fm.description, "evildesrever");
  });

  it("strips zero-width characters incl. BOM from a plain scalar value (Trojan-Source spoof guard, skills#600)", () => {
    const fm = parseFrontmatter(`---\nname: foo\ndescription: zero\u200bwidth\ufeffbom\n---`);
    assert.equal(fm.description, "zerowidthbom");
  });
});

describe("checkModelField", () => {
  it("returns empty array for each allowed alias", () => {
    for (const alias of ALLOWED_MODELS) {
      assert.deepEqual(checkModelField(alias), [], `${alias} should be allowed`);
    }
  });

  it("accepts fable (parity with validate_agents.mjs v0.21.0)", () => {
    assert.deepEqual(checkModelField("fable"), []);
  });

  it("rejects fable5 as not-allowed (no vendor-prefix match, routes to allowlist check)", () => {
    // fable5 matches none of FORBIDDEN_MODEL_PATTERNS (no -N-N pair, no
    // ^claude-/^gpt-/^gemini-/^o\d prefix), so it falls through to the
    // generic allowlist branch — pin the rule label, not vendor-locked.
    const v = checkModelField("fable5");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "model-not-allowed");
    assert.match(v[0].message, /not in allowed aliases/);
    assert.match(v[0].message, /model: fable5/);
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
    const v = checkModelField("o1");
    assert.equal(v.length, 1);
    assert.match(v[0].message, /o-series/);
  });

  it("rejects version-pinned IDs", () => {
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

  it("rejects unknown strings as not-allowed", () => {
    const v = checkModelField("randomalias");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "model-not-allowed");
    assert.match(v[0].message, /not in allowed aliases/);
  });
});

describe("checkEffortField", () => {
  it("returns error for absent effort field", () => {
    const v = checkEffortField(undefined);
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "missing-effort-field");
    assert.match(v[0].message, /Missing required/);
    assert.match(v[0].message, /v2\.1\.162/);
  });

  it("returns empty array for effort: low", () => {
    assert.deepEqual(checkEffortField("low"), []);
  });

  it("returns empty array for effort: medium", () => {
    assert.deepEqual(checkEffortField("medium"), []);
  });

  it("returns empty array for effort: high", () => {
    assert.deepEqual(checkEffortField("high"), []);
  });

  it("returns empty array for effort: xhigh", () => {
    assert.deepEqual(checkEffortField("xhigh"), []);
  });

  it("returns empty array for effort: max", () => {
    assert.deepEqual(checkEffortField("max"), []);
  });

  it("returns error for typo effort: hight", () => {
    const v = checkEffortField("hight");
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "invalid-effort-value");
    assert.match(v[0].message, /hight/);
    assert.match(v[0].message, /Allowed:/);
  });

  it("returns error for wrong case effort: High", () => {
    const v = checkEffortField("High");
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "invalid-effort-value");
  });

  it("returns error for plausible but invalid effort: critical", () => {
    const v = checkEffortField("critical");
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "invalid-effort-value");
    assert.match(v[0].message, /critical/);
  });
});

describe("validateSkillContent", () => {
  it("passes a valid skill with effort field", () => {
    const content = "---\nname: foo\ndescription: A short description.\neffort: medium\n---\nBody";
    assert.deepEqual(validateSkillContent(content, "foo"), []);
  });

  it("errors on otherwise-valid skill without effort field", () => {
    const content = "---\nname: foo\ndescription: A short description.\n---\nBody";
    const v = validateSkillContent(content, "foo");
    assert.equal(v.length, 1);
    assert.equal(v[0].severity, "error");
    assert.equal(v[0].rule, "missing-effort-field");
  });

  it("passes when parentDirName is null (no dir check)", () => {
    const content = "---\nname: foo\ndescription: A short description.\neffort: low\n---";
    assert.deepEqual(validateSkillContent(content, null), []);
  });

  it("flags missing frontmatter", () => {
    const v = validateSkillContent("just body, no frontmatter", "foo");
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "no-frontmatter");
  });

  it("flags missing name", () => {
    const v = validateSkillContent("---\ndescription: bar\n---", "foo");
    assert.ok(v.some((x) => x.rule === "missing-required-field" && x.message.includes("name")));
  });

  it("flags missing description", () => {
    const v = validateSkillContent("---\nname: foo\n---", "foo");
    assert.ok(v.some((x) => x.rule === "missing-required-field" && x.message.includes("description")));
  });

  it("flags both missing fields", () => {
    const v = validateSkillContent("---\nlicense: MIT\n---", "foo");
    const missingFields = v.filter((x) => x.rule === "missing-required-field");
    assert.equal(missingFields.length, 2);
  });

  it("flags name too long", () => {
    const longName = "a".repeat(65);
    const content = `---\nname: ${longName}\ndescription: ok\n---`;
    const v = validateSkillContent(content, longName);
    assert.ok(v.some((x) => x.rule === "name-too-long"));
  });

  it("allows name at exactly 64 chars", () => {
    const name64 = "a".repeat(64);
    const content = `---\nname: ${name64}\ndescription: ok\n---`;
    const v = validateSkillContent(content, name64);
    assert.ok(!v.some((x) => x.rule === "name-too-long"));
  });

  it("flags name with consecutive hyphens", () => {
    const v = validateSkillContent("---\nname: bad--name\ndescription: ok\n---", "bad--name");
    assert.ok(v.some((x) => x.rule === "name-consecutive-hyphens"));
  });

  it("flags name with invalid format (uppercase)", () => {
    const v = validateSkillContent("---\nname: BadName\ndescription: ok\n---", "BadName");
    assert.ok(v.some((x) => x.rule === "name-invalid-format"));
  });

  it("flags name with leading hyphen", () => {
    const v = validateSkillContent("---\nname: -leading\ndescription: ok\n---", "-leading");
    assert.ok(v.some((x) => x.rule === "name-invalid-format"));
  });

  it("flags name with trailing hyphen", () => {
    const v = validateSkillContent("---\nname: trailing-\ndescription: ok\n---", "trailing-");
    assert.ok(v.some((x) => x.rule === "name-invalid-format"));
  });

  it("flags name with underscore", () => {
    const v = validateSkillContent("---\nname: under_score\ndescription: ok\n---", "under_score");
    assert.ok(v.some((x) => x.rule === "name-invalid-format"));
  });

  it("flags name-dir mismatch", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\n---", "bar");
    assert.ok(v.some((x) => x.rule === "name-dir-mismatch"));
    assert.match(v.find((x) => x.rule === "name-dir-mismatch").message, /foo.*bar/);
  });

  it("flags description too long", () => {
    const longDesc = "x".repeat(1025);
    const content = `---\nname: foo\ndescription: ${longDesc}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(v.some((x) => x.rule === "description-too-long"));
  });

  it("allows description at exactly 1024 chars", () => {
    const desc1024 = "x".repeat(1024);
    const content = `---\nname: foo\ndescription: ${desc1024}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(!v.some((x) => x.rule === "description-too-long"));
  });

  it("flags description too long even when authored as a YAML block scalar (regression: CWE-20, skills#392)", () => {
    const longLine = "x".repeat(1025);
    const content = `---\nname: foo\ndescription: |\n  ${longLine}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(v.some((x) => x.rule === "description-too-long"));
  });

  it("flags description too long via the digit-before-chomping indicator ordering too (regression: skills#392 review)", () => {
    const longLine = "x".repeat(1025);
    const content = `---\nname: foo\ndescription: |2-\n  ${longLine}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(v.some((x) => x.rule === "description-too-long"));
  });

  it("flags compatibility too long", () => {
    const longCompat = "x".repeat(501);
    const content = `---\nname: foo\ndescription: ok\ncompatibility: ${longCompat}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(v.some((x) => x.rule === "compatibility-too-long"));
  });

  it("allows compatibility at exactly 500 chars", () => {
    const compat500 = "x".repeat(500);
    const content = `---\nname: foo\ndescription: ok\ncompatibility: ${compat500}\n---`;
    const v = validateSkillContent(content, "foo");
    assert.ok(!v.some((x) => x.rule === "compatibility-too-long"));
  });

  it("ignores absent compatibility (optional field)", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\n---", "foo");
    assert.ok(!v.some((x) => x.rule === "compatibility-too-long"));
  });

  it("flags forbidden model field", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\nmodel: gpt-5\n---", "foo");
    assert.ok(v.some((x) => x.rule === "model-vendor-locked"));
  });

  it("ignores absent model (optional)", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\neffort: low\n---", "foo");
    assert.ok(!v.some((x) => x.rule === "model-vendor-locked" || x.rule === "model-not-allowed"));
  });

  it("flags invalid effort value in validateSkillContent", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\neffort: hight\n---", "foo");
    assert.ok(v.some((x) => x.rule === "invalid-effort-value"));
  });

  it("passes valid effort value in validateSkillContent", () => {
    const v = validateSkillContent("---\nname: foo\ndescription: ok\neffort: high\n---", "foo");
    assert.ok(!v.some((x) => x.rule === "invalid-effort-value" || x.rule === "missing-effort-field"));
  });

  it("accumulates multiple violations", () => {
    const longDesc = "x".repeat(1025);
    const longCompat = "x".repeat(501);
    const content = `---\nname: Bad--Name\ndescription: ${longDesc}\ncompatibility: ${longCompat}\nmodel: claude-foo\n---`;
    const v = validateSkillContent(content, "other-dir");
    assert.ok(v.length >= 4);
  });
});

// isOversized — CWE-400 guard for validateSkill's readFileSync call site.
// Mirrors scan_repo.mjs's isOversized/MAX_SCAN_FILE_BYTES pair, but uses
// lstatSync (not statSync) — see #391 / #363 — so a symlink is rejected by
// type instead of being followed to a target whose size can be misleading.
describe("isOversized", () => {
  const tmp = join(tmpdir(), `validate-skills-oversized-${Date.now()}`);

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

describe("validateSkill (filesystem)", () => {
  const tmpDir = join(tmpdir(), `validate-skills-test-${Date.now()}`);

  it("reads file from disk and extracts parent dir name", () => {
    const skillDir = join(tmpDir, "my-skill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: my-skill\ndescription: ok\neffort: low\n---", "utf-8");
    assert.deepEqual(validateSkill(filePath), []);
  });

  it("detects name-dir mismatch from filesystem", () => {
    const skillDir = join(tmpDir, "actual-dir");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: different-name\ndescription: ok\n---", "utf-8");
    const v = validateSkill(filePath);
    assert.ok(v.some((x) => x.rule === "name-dir-mismatch"));
  });

  it("throws on missing file", () => {
    assert.throws(() => validateSkill(join(tmpDir, "nonexistent", "SKILL.md")), /ENOENT/);
  });

  it("returns a file-too-large violation without reading when file exceeds the size cap (CWE-400)", () => {
    const skillDir = join(tmpDir, "oversized-skill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "x".repeat(MAX_VALIDATE_FILE_BYTES + 1), "utf-8");
    const v = validateSkill(filePath);
    assert.deepEqual(v, [{
      severity: "error",
      rule: "file-too-large",
      message: `SKILL.md exceeds ${MAX_VALIDATE_FILE_BYTES} bytes (or is not a regular file — e.g. a symlink) — refusing to read`,
    }]);
  });

  it("returns a file-too-large violation for a symlink instead of following it", () => {
    const skillDir = join(tmpDir, "symlink-skill");
    mkdirSync(skillDir, { recursive: true });
    const target = join(tmpDir, "symlink-skill-target.md");
    writeFileSync(target, "---\nname: symlink-skill\ndescription: ok\n---", "utf-8");
    const filePath = join(skillDir, "SKILL.md");
    symlinkSync(target, filePath);
    const v = validateSkill(filePath);
    assert.equal(v.length, 1);
    assert.equal(v[0].rule, "file-too-large");
  });

  it("strips control characters from parentDirName before it reaches the name-dir-mismatch message (CWE-150, skills#495)", () => {
    // A git tree entry name may contain arbitrary bytes other than `/` and NUL
    // — an ESC byte here must never survive into a violation message that CI
    // echoes to an ANSI-interpreting log viewer.
    const skillDir = join(tmpDir, "actual\x1bdir");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: foo\ndescription: ok\neffort: low\n---", "utf-8");
    const v = validateSkill(filePath);
    const mismatch = v.find((x) => x.rule === "name-dir-mismatch");
    assert.ok(mismatch, "expected a name-dir-mismatch violation");
    assert.ok(!mismatch.message.includes("\x1b"), "message must not contain the raw ESC byte");
    assert.match(mismatch.message, /actualdir/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("discoverSkillFiles", () => {
  const tmpDir = join(tmpdir(), `discover-skills-test-${Date.now()}`);

  it("discovers SKILL.md files in subdirectories", () => {
    mkdirSync(join(tmpDir, "skill-a"), { recursive: true });
    mkdirSync(join(tmpDir, "skill-b"), { recursive: true });
    mkdirSync(join(tmpDir, "empty-dir"), { recursive: true });
    writeFileSync(join(tmpDir, "skill-a", "SKILL.md"), "---\nname: skill-a\n---", "utf-8");
    writeFileSync(join(tmpDir, "skill-b", "SKILL.md"), "---\nname: skill-b\n---", "utf-8");
    // empty-dir has no SKILL.md — should be skipped
    const files = discoverSkillFiles(tmpDir);
    assert.equal(files.length, 2);
    assert.ok(files.some((f) => f.includes("skill-a")));
    assert.ok(files.some((f) => f.includes("skill-b")));
  });

  it("returns empty array when no SKILL.md found", () => {
    const emptyDir = join(tmpDir, "no-skills");
    mkdirSync(emptyDir, { recursive: true });
    mkdirSync(join(emptyDir, "sub"), { recursive: true });
    const files = discoverSkillFiles(emptyDir);
    assert.equal(files.length, 0);
  });

  it("skips non-directory entries", () => {
    const mixedDir = join(tmpDir, "mixed");
    mkdirSync(mixedDir, { recursive: true });
    writeFileSync(join(mixedDir, "not-a-dir.txt"), "text", "utf-8");
    mkdirSync(join(mixedDir, "real-skill"), { recursive: true });
    writeFileSync(join(mixedDir, "real-skill", "SKILL.md"), "---\nname: real-skill\n---", "utf-8");
    const files = discoverSkillFiles(mixedDir);
    assert.equal(files.length, 1);
  });

  it("skips a symlink entry via lstat (not-a-directory), even with a dangling target", () => {
    const symlinkDir = join(tmpDir, "symlink-test");
    mkdirSync(symlinkDir, { recursive: true });
    symlinkSync(join(symlinkDir, "nonexistent-target"), join(symlinkDir, "broken-link"));
    const files = discoverSkillFiles(symlinkDir);
    assert.equal(files.length, 0);
  });

  it("does not follow a symlink pointed at a real directory (CWE-59)", () => {
    const symlinkDir = join(tmpDir, "symlink-follow-test");
    const realSkillDir = join(tmpDir, "symlink-follow-target");
    mkdirSync(symlinkDir, { recursive: true });
    mkdirSync(realSkillDir, { recursive: true });
    writeFileSync(join(realSkillDir, "SKILL.md"), "---\nname: target-skill\n---", "utf-8");
    symlinkSync(realSkillDir, join(symlinkDir, "linked-skill"));
    const files = discoverSkillFiles(symlinkDir);
    assert.equal(files.length, 0, "a symlinked directory entry must not be followed into");
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("main (CLI entry)", () => {
  const tmpDir = join(tmpdir(), `validate-skills-cli-test-${Date.now()}`);
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

  it("exits 2 and prints error when discover fails (no default skills dir)", () => {
    // Exercise main()'s try/catch around discoverSkillFiles synchronously by
    // changing cwd to a directory where plugins/ievo/skills/ doesn't exist.
    const emptyRoot = join(tmpDir, "empty-root-sync");
    mkdirSync(emptyRoot, { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(emptyRoot);
      const run = makeRun();
      main(["node", "validate_skills.mjs"], run.exit, run.log, run.errLog);
      assert.equal(run.exitCode, 2);
      assert.ok(run.errs.some((e) => e.includes("cannot scan skills directory")));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("exits 0 when all skills pass (explicit files)", () => {
    const skillDir = join(tmpDir, "good-skill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: good-skill\ndescription: A good skill.\neffort: low\n---\nBody", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 0);
    assert.match(run.logs.join("\n"), /1 passed, 0 errors/);
    assert.match(run.logs.join("\n"), /✓/);
  });

  it("exits 1 when violations found", () => {
    const skillDir = join(tmpDir, "bad-skill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: WRONG\ndescription: ok\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
    assert.match(run.logs.join("\n"), /agentskills\.io/);
  });

  it("exits 1 for missing effort (errors fail CI)", () => {
    const skillDir = join(tmpDir, "missing-effort-skill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: missing-effort-skill\ndescription: ok\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
    assert.match(run.logs.join("\n"), /missing-effort-field/);
    assert.match(run.logs.join("\n"), /1 errors/);
  });

  it("exits 1 for invalid effort value (error severity)", () => {
    const skillDir = join(tmpDir, "bad-effort");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: bad-effort\ndescription: ok\neffort: hight\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
    assert.match(run.logs.join("\n"), /invalid-effort-value/);
  });

  it("--quiet suppresses pass messages", () => {
    const skillDir = join(tmpDir, "quiet-pass");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: quiet-pass\ndescription: ok\neffort: low\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", "--quiet", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 0);
    assert.ok(!run.logs.some((l) => l.includes("✓")));
    assert.match(run.logs.join("\n"), /1 passed/);
    assert.match(run.logs.join("\n"), /0 warnings/);
  });

  it("--quiet still shows violations", () => {
    const skillDir = join(tmpDir, "quiet-fail");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: WRONG\ndescription: ok\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", "--quiet", filePath], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /✗/);
  });

  it("continues past unreadable file — per-file isolation", () => {
    // POSIX-only: chmod 000 makes the file unreadable so readFileSync throws
    // EACCES while isOversized's lstatSync (which only needs dir execute
    // permission) still sees a normal-sized regular file — this exercises
    // main()'s try/catch around validateSkill(), distinct from the
    // isOversized short-circuit (a directory-named SKILL.md would be caught
    // by isOversized's isFile() check before ever reaching readFileSync).
    if (process.platform === "win32") return;
    const mixedDir = join(tmpDir, "mixed-files");
    const goodDir = join(mixedDir, "good");
    mkdirSync(goodDir, { recursive: true });
    writeFileSync(join(goodDir, "SKILL.md"), "---\nname: good\ndescription: ok\neffort: low\n---", "utf-8");
    const trapDir = join(mixedDir, "trap");
    mkdirSync(trapDir, { recursive: true });
    const trapFile = join(trapDir, "SKILL.md");
    writeFileSync(trapFile, "---\nname: trap\ndescription: ok\n---", "utf-8");
    chmodSync(trapFile, 0o000);
    const goodFile = join(goodDir, "SKILL.md");
    const run = makeRun();
    try {
      main(["node", "validate_skills.mjs", trapFile, goodFile], run.exit, run.log, run.errLog);
    } finally {
      chmodSync(trapFile, 0o644);
    }
    assert.equal(run.exitCode, 1);
    assert.match(run.logs.join("\n"), /file-unreadable/);
    assert.match(run.logs.join("\n"), /good/);
  });

  it("strips control characters from the file-unreadable message's embedded path (CWE-150, skills#495 deep-review follow-up)", () => {
    // Node's fs error messages (EACCES here) embed the offending path
    // verbatim — a third call site the rel/parentDirName fix didn't cover.
    if (process.platform === "win32") return;
    const trapDir = join(tmpDir, "trap\x1bunreadable");
    mkdirSync(trapDir, { recursive: true });
    const trapFile = join(trapDir, "SKILL.md");
    writeFileSync(trapFile, "---\nname: trap\ndescription: ok\n---", "utf-8");
    chmodSync(trapFile, 0o000);
    const run = makeRun();
    try {
      main(["node", "validate_skills.mjs", trapFile], run.exit, run.log, run.errLog);
    } finally {
      chmodSync(trapFile, 0o644);
    }
    const output = run.logs.join("\n");
    assert.match(output, /file-unreadable/);
    assert.ok(!output.includes("\x1b"), "output must not contain the raw ESC byte");
    assert.match(output, /trapunreadable/);
  });

  it("strips control characters from the printed rel path (CWE-150, skills#495)", () => {
    // Same log-injection guard as name-dir-mismatch above, but for the path
    // echoed on every ✓/✗ line in main() — the fix must cover both call sites.
    const skillDir = join(tmpDir, "esc\x1bskill");
    mkdirSync(skillDir, { recursive: true });
    const filePath = join(skillDir, "SKILL.md");
    writeFileSync(filePath, "---\nname: esc\x1bskill\ndescription: ok\neffort: low\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", filePath], run.exit, run.log, run.errLog);
    const output = run.logs.join("\n");
    assert.ok(!output.includes("\x1b"), "output must not contain the raw ESC byte");
    assert.match(output, /escskill/);
  });

  it("handles multiple valid files", () => {
    const dir1 = join(tmpDir, "multi-a");
    const dir2 = join(tmpDir, "multi-b");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    writeFileSync(join(dir1, "SKILL.md"), "---\nname: multi-a\ndescription: ok\neffort: low\n---", "utf-8");
    writeFileSync(join(dir2, "SKILL.md"), "---\nname: multi-b\ndescription: ok\neffort: high\n---", "utf-8");
    const run = makeRun();
    main(["node", "validate_skills.mjs", join(dir1, "SKILL.md"), join(dir2, "SKILL.md")], run.exit, run.log, run.errLog);
    assert.equal(run.exitCode, 0);
    assert.match(run.logs.join("\n"), /2 passed, 0 errors/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("main (discover mode — no explicit files)", () => {
  const tmpDir = join(tmpdir(), `validate-skills-discover-${Date.now()}`);

  it("scans default skills dir when no files given", () => {
    // This test verifies the discover path works against the real skills dir
    // (which exists in the repo). If run from the project root, DEFAULT_SKILLS_DIR resolves.
    const run = {
      logs: [],
      errs: [],
      exitCode: null,
      log: (...args) => run.logs.push(args.join(" ")),
      errLog: (...args) => run.errs.push(args.join(" ")),
      exit: (code) => { run.exitCode = code; },
    };
    main(["node", "validate_skills.mjs"], run.exit, run.log, run.errLog);
    // Should find and validate skills — either 0 (all pass) or 1 (violations).
    // After we fix the existing violations, this should be 0.
    assert.ok(run.exitCode === 0 || run.exitCode === 1);
    assert.match(run.logs.join("\n"), /Summary:/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("isCliEntry", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "validate_skills.mjs");
  const scriptUrl = pathToFileURL(scriptPath).href;

  it("returns true when argv[1] is the absolute script path", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", scriptPath]), true);
  });

  it("returns true when argv[1] is a relative path that resolves to the script", () => {
    const cwdBefore = process.cwd();
    process.chdir(dirname(scriptPath));
    try {
      assert.equal(isCliEntry(scriptUrl, ["node", "./validate_skills.mjs"]), true);
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it("returns false when argv[1] points to a different file", () => {
    assert.equal(isCliEntry(scriptUrl, ["node", "/some/other/file.mjs"]), false);
  });

  it("returns false when argv[1] is undefined (covers ?? fallback)", () => {
    assert.equal(isCliEntry(scriptUrl, ["node"]), false);
  });
});

describe("CLI invocation (subprocess — covers entry guard)", () => {
  const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "validate_skills.mjs");
  const tmpDir = join(tmpdir(), `validate-skills-spawn-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  it("runs as CLI, exits 0 on valid skill", () => {
    const skillDir = join(tmpDir, "ok-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: ok-skill\ndescription: A valid skill.\neffort: low\n---\nBody", "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, join(skillDir, "SKILL.md")], { encoding: "utf-8" });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /1 passed/);
  });

  it("runs as CLI, exits 1 on violation", () => {
    const skillDir = join(tmpDir, "bad-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: BAD\ndescription: ok\n---", "utf-8");
    const r = spawnSync(process.execPath, [scriptPath, join(skillDir, "SKILL.md")], { encoding: "utf-8" });
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /name-invalid-format/);
  });

  it("runs as CLI, exits 2 when default dir missing", () => {
    const emptyRoot = join(tmpDir, "empty-root");
    mkdirSync(emptyRoot, { recursive: true });
    const r = spawnSync(process.execPath, [scriptPath], { encoding: "utf-8", cwd: emptyRoot });
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /cannot scan/);
  });

  it("runs as CLI, exits 2 when skills dir exists but has no SKILL.md files", () => {
    const fakeRoot = join(tmpDir, "fake-root");
    mkdirSync(join(fakeRoot, "plugins", "ievo", "skills", "empty-sub"), { recursive: true });
    const r = spawnSync(process.execPath, [scriptPath], { encoding: "utf-8", cwd: fakeRoot });
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /no SKILL\.md files found/);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
