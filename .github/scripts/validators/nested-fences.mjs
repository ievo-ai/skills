#!/usr/bin/env node
// nested-fences.mjs — detect markdown code-fence nesting bugs.
//
// The bug: a 3-backtick block tagged ```markdown (or any language) that
// contains an inner ```X fence with a language tag. Per CommonMark, the
// inner ``` line closes the outer fence (same-or-more backticks closes),
// leaving the inner's tag as stray text and breaking rendering downstream.
// The fix: outer fence uses 4+ backticks so the inner 3-backtick fence is
// preserved as content.
//
// Detection: for each open fence, look for a subsequent line with >=outer
// count of backticks AND a non-empty info string. That's the broken
// pattern; a clean close has no info string.
//
// Usage:
//   node nested-fences.mjs <file>...
// Exit codes:
//   0 — all files pass
//   1 — at least one file has nested-fence issues
//   2 — usage error
//
// Lives outside plugins/ievo/scripts/ — the 100% rule doesn't apply here.
// Exercised on real data by pre-commit + .github/workflows/pre-commit-gate.yml.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { safeReadFileSync } from "./_safe-read.mjs";

const FENCE_RE = /^(`{3,})(.*)$/;

export function checkNestedFences(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  let inside = false;
  let outerCount = 0;
  let outerLine = -1;
  let outerTag = "";

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_RE);
    if (!m) continue;

    const count = m[1].length;
    const tag = m[2].trim();

    if (!inside) {
      inside = true;
      outerCount = count;
      outerLine = i + 1;
      outerTag = tag;
    } else if (count >= outerCount) {
      // Same-or-more backticks closes the outer per CommonMark.
      if (tag !== "") {
        const outerLabel = outerTag || "<no-tag>";
        errors.push(
          `line ${outerLine}: outer \`${"`".repeat(outerCount - 1)}${outerLabel} fence is closed at line ${i + 1} by a tagged fence \`${"`".repeat(count - 1)}${tag}. The inner fence's tag becomes stray text and rendering breaks. Use ${outerCount + 1}+ backticks for the outer fence so nested ${count}-backtick fences stay as content.`,
        );
      }
      // After flagging, the scanner exits the outer fence and continues at top
      // level. CommonMark agrees: same-or-more-backticks closes the outer, so
      // the next fence we see opens a fresh block. Note: secondary errors in
      // the same file after this point may be cascaded artefacts of the first
      // bad nesting — fix the first one and re-run for a clean report.
      inside = false;
    }
    // count < outerCount → inner content, not a close (legitimate nesting).
  }

  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: nested-fences.mjs <file>...");
    process.exit(2);
  }
  let totalErrors = 0;
  for (const path of files) {
    let text;
    try {
      text = safeReadFileSync(path, "utf-8");
    } catch (err) {
      console.error(`${path}: cannot read (${err.message})`);
      totalErrors++;
      continue;
    }
    const errors = checkNestedFences(text);
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
