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

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { safeReadFileSync, sanitizeForLog } from "./_safe-read.mjs";

// Split text into { content, ending } records. Recognises three line endings
// distinctly: "CRLF" (\r\n), "CR" (bare \r, legacy Mac OS), "LF" (\n). The
// last line gets ending "" if the file has no trailing newline.
function splitLines(text) {
  const lines = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\r") {
      if (text[i + 1] === "\n") {
        lines.push({ content: buf, ending: "CRLF" });
        i++;
      } else {
        lines.push({ content: buf, ending: "CR" });
      }
      buf = "";
    } else if (c === "\n") {
      lines.push({ content: buf, ending: "LF" });
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) lines.push({ content: buf, ending: "" });
  return lines;
}

export function checkCrlfFrontmatter(text) {
  // Accept any file that starts with the three-dash opener, regardless of
  // which line-ending follows. The old `startsWith("---\n")` check missed
  // CR-only files entirely: `---\r…` matched neither `---\n` nor `---\r\n`
  // and the validator silently returned [] — bypass of the exact surface
  // this validator was built to close.
  if (!text.startsWith("---") || (text[3] !== "\n" && text[3] !== "\r")) {
    return [];
  }
  const lines = splitLines(text);
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].content === "---") {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) {
    return ["line 1: frontmatter opens with '---' but no closing '---' was found"];
  }
  const errors = [];
  for (let i = 0; i <= closeIdx; i++) {
    if (lines[i].ending === "CRLF") {
      errors.push(`line ${i + 1}: CRLF (\\r\\n) line ending in frontmatter — re-save the file as LF-only. Windows authors: in VSCode use the bottom-right CRLF→LF toggle; in git, .gitattributes 'text eol=lf' enforces conversion on commit.`);
    } else if (lines[i].ending === "CR") {
      errors.push(`line ${i + 1}: bare CR (\\r) line ending in frontmatter — legacy Mac OS line ending. Re-save the file as LF-only.`);
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
      text = safeReadFileSync(path, "utf-8");
    } catch (err) {
      console.error(sanitizeForLog(`${path}: cannot read (${err.message})`));
      totalErrors++;
      continue;
    }
    const errors = checkCrlfFrontmatter(text);
    for (const e of errors) {
      console.error(sanitizeForLog(`${path}:${e}`));
      totalErrors++;
    }
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main(process.argv);
}
