#!/usr/bin/env node
// crlf-frontmatter.mjs — flag CRLF (\r\n) or CR-only (\r) line endings in
// YAML frontmatter regions of markdown files.
//
// Why: validators that split on \n only can miss frontmatter keys whose
// value has a trailing \r — the value parses as 'sonnet\r' instead of
// 'sonnet', and forbidden-pattern checks (e.g. claude-* vendor IDs) can
// be bypassed by a Windows author committing CRLF. validate_agents.mjs
// normalises this server-side, but committing LF-only at source closes
// the bypass surface entirely.
//
// Scope: only the frontmatter region (lines between the opening `---`
// and the next `---`). Body text with CRLF is annoying for diffs but
// not a security issue.
//
// Usage:
//   node crlf-frontmatter.mjs <file>...
// Exit codes:
//   0 — all files clean
//   1 — at least one file has CRLF/CR in frontmatter
//   2 — usage error
//
// Lives outside plugins/ievo/scripts/ — the 100% rule doesn't apply here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function checkCrlfFrontmatter(text) {
  // Operate on raw bytes (no \r normalisation) so we see CRLF directly.
  // Find frontmatter bounds: the file must start with `---\n` or `---\r\n`.
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return []; // no frontmatter → nothing to check
  }
  // Find the closing `---` (on its own line, after the opening).
  // Split on \n only (preserve \r for inspection). First line is `---`.
  const lines = text.split("\n");
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    const stripped = lines[i].replace(/\r$/, "");
    if (stripped === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) {
    return ["frontmatter: opens with --- but no closing --- found"];
  }
  const errors = [];
  // Inspect lines 0..closeIdx (the frontmatter block, both fences inclusive).
  for (let i = 0; i <= closeIdx; i++) {
    if (lines[i].endsWith("\r")) {
      errors.push(`line ${i + 1}: CRLF (\\r\\n) line ending in frontmatter — re-save the file as LF-only. Windows authors: in VSCode use the bottom-right CRLF→LF toggle; in git, .gitattributes 'text eol=lf' enforces conversion on commit.`);
    }
  }
  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: crlf-frontmatter.mjs <file>...");
    process.exit(2);
  }
  let totalErrors = 0;
  for (const path of files) {
    let text;
    try {
      text = readFileSync(path, "utf-8");
    } catch (err) {
      console.error(`${path}: cannot read (${err.message})`);
      totalErrors++;
      continue;
    }
    const errors = checkCrlfFrontmatter(text);
    for (const e of errors) {
      console.error(`${path}:${e}`);
      totalErrors++;
    }
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main(process.argv);
}
