import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractFrontmatter,
  checkYamlFrontmatter,
  DESCRIPTION_MAX_LENGTH,
} from "../yaml-frontmatter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../yaml-frontmatter.mjs");
const TMP = resolve(__dirname, "tmp-yaml-fm-test");

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });
}

// ── extractFrontmatter ──────────────────────────────────────────────────

describe("extractFrontmatter", () => {
  it("returns null for files without frontmatter", () => {
    assert.equal(extractFrontmatter("# Just a heading\nSome text"), null);
  });

  it("returns null for files starting with non-frontmatter dashes", () => {
    assert.equal(extractFrontmatter("-- not yaml --\ncontent"), null);
  });

  it("returns null for empty string", () => {
    assert.equal(extractFrontmatter(""), null);
  });

  it("returns closeMissing when no closing delimiter", () => {
    const result = extractFrontmatter("---\nname: foo\ndescription: bar\n");
    assert.equal(result.closeMissing, true);
    assert.equal(result.lines, null);
  });

  it("extracts lines between delimiters", () => {
    const result = extractFrontmatter("---\nname: foo\n---\nbody");
    assert.equal(result.closeMissing, false);
    assert.deepEqual(result.lines, ["name: foo"]);
    assert.equal(result.startLine, 2);
  });

  it("handles multiple lines", () => {
    const text = "---\nname: test\ndescription: hello\nlicense: MIT\n---\n";
    const result = extractFrontmatter(text);
    assert.deepEqual(result.lines, [
      "name: test",
      "description: hello",
      "license: MIT",
    ]);
  });

  it("handles empty frontmatter", () => {
    const result = extractFrontmatter("---\n---\nbody");
    assert.deepEqual(result.lines, [""]);
  });

  it("does not treat ---more as closing delimiter", () => {
    const result = extractFrontmatter("---\nname: test\n---more text\n---\n");
    assert.deepEqual(result.lines, ["name: test", "---more text"]);
  });

  it("handles closing --- at end of file without trailing newline", () => {
    const result = extractFrontmatter("---\nname: test\n---");
    assert.deepEqual(result.lines, ["name: test"]);
    assert.equal(result.closeMissing, false);
  });

  it("normalizes CRLF to LF", () => {
    const result = extractFrontmatter("---\r\nname: foo\r\n---\r\nbody");
    assert.deepEqual(result.lines, ["name: foo"]);
  });

  it("normalizes bare CR to LF", () => {
    const result = extractFrontmatter("---\rname: foo\r---\rbody");
    assert.deepEqual(result.lines, ["name: foo"]);
  });

  it("handles file that is just '---'", () => {
    const result = extractFrontmatter("---");
    assert.equal(result.closeMissing, true);
  });
});

// ── checkYamlFrontmatter — valid inputs ─────────────────────────────────

describe("checkYamlFrontmatter — valid inputs", () => {
  it("returns no errors for valid simple frontmatter", () => {
    const text = "---\nname: test\ndescription: hello world\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("returns no errors for double-quoted values", () => {
    const text =
      '---\nname: test\ndescription: "has: colons and #hashes"\n---\n';
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("returns no errors for single-quoted values", () => {
    const text =
      "---\nname: test\ndescription: 'has: colons and #hashes'\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("returns no errors for files without frontmatter", () => {
    assert.deepEqual(checkYamlFrontmatter("# Just a heading"), []);
  });

  it("ignores blank lines in frontmatter", () => {
    const text = "---\nname: test\n\ndescription: hello\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("ignores comment lines in frontmatter", () => {
    const text = "---\n# a comment\nname: test\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("skips indented lines (nested structures)", () => {
    const text =
      "---\nmetadata:\n  author: ievo-ai\n  homepage: https://example.com\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("skips sequence items under a key", () => {
    const text =
      "---\nallowed-tools:\n  - Read\n  - Write\n  - Glob\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("accepts keys with hyphens", () => {
    const text = "---\nallowed-tools: Read\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("accepts empty values (key with no value)", () => {
    const text = "---\nmetadata:\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("accepts value with colon not followed by space", () => {
    const text = "---\nhomepage: https://example.com\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });

  it("accepts tab-indented nested lines", () => {
    const text = "---\nmetadata:\n\tauthor: test\n---\n";
    assert.deepEqual(checkYamlFrontmatter(text), []);
  });
});

// ── checkYamlFrontmatter — error detection ──────────────────────────────

describe("checkYamlFrontmatter — error detection", () => {
  it("detects missing closing delimiter", () => {
    const errors = checkYamlFrontmatter("---\nname: test\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /no closing '---' was found/);
  });

  it("detects unquoted colon-space in value", () => {
    const errors = checkYamlFrontmatter(
      "---\ndescription: foo: bar baz\n---\n"
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /colon-space/);
    assert.match(errors[0], /line 2/);
    assert.match(errors[0], /"description"/);
  });

  it("detects unterminated double-quoted string", () => {
    const errors = checkYamlFrontmatter(
      '---\ndescription: "unterminated\n---\n'
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unterminated double-quoted/);
  });

  it("detects unterminated single-quoted string", () => {
    const errors = checkYamlFrontmatter(
      "---\ndescription: 'unterminated\n---\n"
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unterminated single-quoted/);
  });

  it("detects single-char double quote as unterminated", () => {
    const errors = checkYamlFrontmatter('---\ndescription: "\n---\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unterminated double-quoted/);
  });

  it("detects single-char single quote as unterminated", () => {
    const errors = checkYamlFrontmatter("---\ndescription: '\n---\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unterminated single-quoted/);
  });

  it("detects duplicate keys", () => {
    const errors = checkYamlFrontmatter(
      "---\nname: foo\nname: bar\n---\n"
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /duplicate key "name"/);
    assert.match(errors[0], /first seen at line 2/);
  });

  it("detects flow indicator at start of unquoted value", () => {
    for (const ch of ["{", "}", "[", "]"]) {
      const errors = checkYamlFrontmatter(
        `---\nvalue: ${ch}something\n---\n`
      );
      assert.ok(
        errors.some((e) => e.includes("flow indicator")),
        `should flag '${ch}' as flow indicator`
      );
    }
  });

  it("detects inline comment ambiguity", () => {
    const errors = checkYamlFrontmatter(
      "---\ndescription: some text #comment\n---\n"
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0], /YAML interprets as an inline comment/);
  });

  it("detects invalid mapping (line without colon)", () => {
    const errors = checkYamlFrontmatter("---\njust-a-word\n---\n");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid YAML mapping/);
  });

  it("reports multiple errors in same file", () => {
    const text =
      '---\nname: has: colon\ndescription: "unterminated\nname: duplicate\n---\n';
    const errors = checkYamlFrontmatter(text);
    assert.ok(errors.length >= 3, `expected >= 3 errors, got ${errors.length}`);
  });

  it("includes correct line numbers", () => {
    const text = "---\nname: ok\n\nbad: has: colon\n---\n";
    const errors = checkYamlFrontmatter(text);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /line 4/);
  });
});

// ── checkYamlFrontmatter — SKILL.md checks ──────────────────────────────

describe("checkYamlFrontmatter — SKILL.md checks", () => {
  it("requires name field in SKILL.md", () => {
    const errors = checkYamlFrontmatter(
      "---\ndescription: hello\n---\n",
      "/path/to/SKILL.md"
    );
    assert.ok(errors.some((e) => e.includes("missing required") && e.includes("name")));
  });

  it("requires description field in SKILL.md", () => {
    const errors = checkYamlFrontmatter(
      "---\nname: test\n---\n",
      "/path/to/SKILL.md"
    );
    assert.ok(errors.some((e) => e.includes("missing required") && e.includes("description")));
  });

  it("reports both missing fields", () => {
    const errors = checkYamlFrontmatter(
      "---\nlicense: MIT\n---\n",
      "/path/to/SKILL.md"
    );
    assert.ok(errors.some((e) => e.includes("name")));
    assert.ok(errors.some((e) => e.includes("description")));
  });

  it("no field errors when both present", () => {
    const errors = checkYamlFrontmatter(
      "---\nname: test\ndescription: hello\n---\n",
      "/path/to/SKILL.md"
    );
    assert.deepEqual(errors, []);
  });

  it("does not require name/description for non-SKILL files", () => {
    const errors = checkYamlFrontmatter(
      "---\nlicense: MIT\n---\n",
      "/path/to/agents/reviewer.md"
    );
    assert.deepEqual(errors, []);
  });

  it("detects description exceeding length limit", () => {
    const longDesc = "a".repeat(DESCRIPTION_MAX_LENGTH + 1);
    const errors = checkYamlFrontmatter(
      `---\nname: test\ndescription: ${longDesc}\n---\n`,
      "/path/to/SKILL.md"
    );
    assert.ok(errors.some((e) => e.includes("exceeds limit")));
  });

  it("accepts description at exact length limit", () => {
    const exactDesc = "a".repeat(DESCRIPTION_MAX_LENGTH);
    const errors = checkYamlFrontmatter(
      `---\nname: test\ndescription: ${exactDesc}\n---\n`,
      "/path/to/SKILL.md"
    );
    assert.deepEqual(errors, []);
  });

  it("strips quotes before checking description length", () => {
    const innerDesc = "a".repeat(DESCRIPTION_MAX_LENGTH);
    const errors = checkYamlFrontmatter(
      `---\nname: test\ndescription: "${innerDesc}"\n---\n`,
      "/path/to/SKILL.md"
    );
    assert.deepEqual(errors, []);
  });

  it("strips single quotes before checking description length", () => {
    const innerDesc = "a".repeat(DESCRIPTION_MAX_LENGTH);
    const errors = checkYamlFrontmatter(
      `---\nname: test\ndescription: '${innerDesc}'\n---\n`,
      "/path/to/SKILL.md"
    );
    assert.deepEqual(errors, []);
  });

  it("detects long description inside quotes", () => {
    const innerDesc = "a".repeat(DESCRIPTION_MAX_LENGTH + 1);
    const errors = checkYamlFrontmatter(
      `---\nname: test\ndescription: "${innerDesc}"\n---\n`,
      "/path/to/SKILL.md"
    );
    assert.ok(errors.some((e) => e.includes("exceeds limit")));
  });

  it("uses null filePath gracefully (no SKILL checks)", () => {
    const errors = checkYamlFrontmatter("---\nlicense: MIT\n---\n", null);
    assert.deepEqual(errors, []);
  });

  it("uses undefined filePath gracefully (no SKILL checks)", () => {
    const errors = checkYamlFrontmatter("---\nlicense: MIT\n---\n");
    assert.deepEqual(errors, []);
  });
});

// ── CLI (main) ──────────────────────────────────────────────────────────

describe("main (CLI entry)", () => {
  before(() => {
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("exits 2 with no arguments", () => {
    const r = run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage:/);
  });

  it("exits 0 for valid file", () => {
    const f = resolve(TMP, "valid.md");
    writeFileSync(f, "---\nname: test\n---\nbody\n");
    const r = run(f);
    assert.equal(r.status, 0);
  });

  it("exits 1 for file with errors", () => {
    const f = resolve(TMP, "bad.md");
    writeFileSync(f, "---\ndescription: has: colon issue\n---\n");
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /colon-space/);
  });

  it("includes file path in error output", () => {
    const f = resolve(TMP, "pathcheck.md");
    writeFileSync(f, "---\nfoo: bar: baz\n---\n");
    const r = run(f);
    assert.match(r.stderr, /pathcheck\.md/);
  });

  it("handles unreadable file gracefully", () => {
    const r = run(resolve(TMP, "nonexistent.md"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
  });

  it("processes multiple files", () => {
    const f1 = resolve(TMP, "ok.md");
    const f2 = resolve(TMP, "bad2.md");
    writeFileSync(f1, "---\nname: ok\n---\n");
    writeFileSync(f2, "---\nbad: has: colons\n---\n");
    const r = run(f1, f2);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /bad2\.md/);
  });

  it("exits 0 for file without frontmatter", () => {
    const f = resolve(TMP, "nofm.md");
    writeFileSync(f, "# Just a heading\nNo frontmatter here.\n");
    const r = run(f);
    assert.equal(r.status, 0);
  });

  it("applies SKILL.md checks based on filename", () => {
    const f = resolve(TMP, "SKILL.md");
    writeFileSync(f, "---\nlicense: MIT\n---\n");
    const r = run(f);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /missing required/);
  });

  it("exits 0 for valid SKILL.md", () => {
    const f = resolve(TMP, "SKILL.md");
    writeFileSync(f, "---\nname: test\ndescription: hello\n---\n");
    const r = run(f);
    assert.equal(r.status, 0);
  });

  it("accumulates errors across files without stopping early", () => {
    const f1 = resolve(TMP, "err1.md");
    const f2 = resolve(TMP, "err2.md");
    writeFileSync(f1, "---\na: b: c\n---\n");
    writeFileSync(f2, "---\nx: y: z\n---\n");
    const r = run(f1, f2);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /err1\.md/);
    assert.match(r.stderr, /err2\.md/);
  });
});

// ── Real-world frontmatter samples ──────────────────────────────────────

describe("real-world frontmatter (regression)", () => {
  it("accepts properly quoted description with colons", () => {
    const text = `---
name: debug-off
description: "Disable verbose / trace-level logging for the iEvo pipeline. Reverts to normal logging (concise \`.ievo/log/init-*.md\` only). Use when debugging is complete."
license: MIT
effort: low
compatibility: "Works on any agent platform that supports the agentskills.io standard."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---
`;
    assert.deepEqual(checkYamlFrontmatter(text, "/skills/debug-off/SKILL.md"), []);
  });

  it("accepts agent frontmatter with model field", () => {
    const text = `---
name: deep-reviewer
description: Independent code reviewer dispatched by deep-review for gap-detection analysis.
model: sonnet
tools:
  - Read
  - Grep
---
`;
    assert.deepEqual(checkYamlFrontmatter(text, "/agents/deep-reviewer.md"), []);
  });

  it("accepts command frontmatter without name field", () => {
    const text = `---
description: Uninstall iEvo from the current project.
allowed-tools: Read, Edit, Glob, Bash, AskUserQuestion
---
`;
    assert.deepEqual(checkYamlFrontmatter(text, "/commands/uninstall.md"), []);
  });

  it("catches pre-PR#122 unquoted colon pattern", () => {
    const text = `---
name: hooks-setup
description: Configure Claude Code lifecycle hooks for iEvo pipeline events — uses exec-form (args: string[]) and terminalSequence for notifications.
---
`;
    const errors = checkYamlFrontmatter(text, "/skills/hooks-setup/SKILL.md");
    assert.ok(errors.some((e) => e.includes("colon-space")));
  });
});
