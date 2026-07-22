#!/usr/bin/env node
// placeholder-leakage.mjs — flag TODO/FIXME/XXX/HACK markers without a tracking reference. placeholder-ok: self-describing docstring
// trackable reference (issue link or PR number). Orphan placeholders rot
// silently; tracked ones expire deterministically.
//
// Accepted forms (no error): placeholder-ok
//   TODO(#42): rewire the gizmo                                   // placeholder-ok
//   FIXME(https://github.com/org/repo/issues/123): see context    // placeholder-ok
//   TODO(v0.7.0): roadmap-pinned, valid until that release        // placeholder-ok
//   TODO(ticket-link-pending) — explicit acknowledgement that no  // placeholder-ok
//     tracker exists yet; CI lets it through. Re-flagged by deep-review
//     as a sister-check.
//
// Rejected (error): placeholder-ok
//   TODO: do the thing       // placeholder-ok
//   FIXME urgent             // placeholder-ok
//   XXX broken               // placeholder-ok
//   HACK temporary           // placeholder-ok
//
// Allowed exceptions:
//   - Lines containing the literal marker `placeholder-ok` — explicit
//     opt-out for legitimate documentation examples.
//
// Usage:
//   node placeholder-leakage.mjs <file>...
// Exit codes:
//   0 — all files clean
//   1 — at least one orphan placeholder
//   2 — usage error
//
// Lives outside plugins/ievo/scripts/ — the 100% rule doesn't apply here.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { safeReadFileSync } from "./_safe-read.mjs";

// Marker followed by an opening `(` indicates a tracked reference;
// `(<anything>)` consumes the reference content and we don't validate
// the inside (issue-link validity is the deep-reviewer's job).
//
// The check: regex matches the four markers when not followed by `(`. (placeholder-ok)
const ORPHAN_RE = /\b(TODO|FIXME|XXX|HACK)\b(?!\()/g; // placeholder-ok: this regex literal defines the validator's pattern
const ALLOWLIST_MARKER = "placeholder-ok";

export function checkPlaceholderLeakage(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOWLIST_MARKER)) continue;
    const hits = new Set();
    for (const match of line.matchAll(ORPHAN_RE)) {
      hits.add(match[1]);
    }
    for (const hit of hits) {
      errors.push(`line ${i + 1}: orphan '${hit}' marker — add a tracking reference: '${hit}(#NNN)', '${hit}(<issue-url>)', '${hit}(v0.X.Y)' for roadmap-pinned, or '${hit}(ticket-link-pending)' to explicitly acknowledge. Add 'placeholder-ok' on the line if intentional.`);
    }
  }
  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: placeholder-leakage.mjs <file>...");
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
    const errors = checkPlaceholderLeakage(text);
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
