#!/usr/bin/env node
// utf8-validate.mjs — flag files containing byte sequences that are not valid
// UTF-8. Closes a Codex-compatibility hole: Codex `rust-v0.133.0` (May 2026)
// started warning on invalid UTF-8 in AGENTS / SKILL.md files instead of
// silently dropping them, but neither behaviour is good for our users —
// silent drop loses the skill, warning surfaces a broken file at install
// time. Catching the bad bytes at commit time is cheap and prevents both.
//
// Concrete failure modes this catches:
//   - Copy-paste from a Word document (Microsoft uses CP-1252 for "smart"
//     quotes; bytes 0x91-0x94, 0x96-0x97 are invalid as standalone UTF-8).
//   - A Windows author committing a file saved as CP-1252 or Latin-1.
//   - A misencoded escape sequence inside a `terminalSequence` example
//     (the hooks-setup skill ships BEL / OSC escapes that survive only
//     under UTF-8 round-tripping).
//   - A truncated multi-byte sequence at EOF.
//
// What we DON'T flag (BOM):
//   The UTF-8 BOM (EF BB BF at file start) is technically valid UTF-8 and
//   `TextDecoder` with `fatal: true` accepts it. BOM can cause separate
//   issues for YAML frontmatter parsers, but that's a different concern —
//   `crlf-frontmatter.mjs` is the right place to add a BOM check later if
//   needed. This validator stays narrowly focused on byte-level decode
//   validity.
//
// Usage:
//   node utf8-validate.mjs <file>...
// Exit codes:
//   0 — all files are valid UTF-8
//   1 — at least one file has invalid UTF-8 bytes
//   2 — usage error
//
// Lives outside plugins/ievo/scripts/ — the 100% rule does not apply here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Returns null if the buffer is valid UTF-8; otherwise the TextDecoder
// error message. `fatal: true` makes the decoder throw on the first
// invalid byte sequence instead of silently emitting U+FFFD replacement
// characters — that's the whole point of using fatal mode here. Without
// fatal:true the decoder masks corruption and we'd ship green commits.
export function checkUtf8(buf) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return null;
  } catch (err) {
    return err.message;
  }
}

export function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: utf8-validate.mjs <file>...");
    process.exit(2);
  }
  let totalErrors = 0;
  for (const path of files) {
    let buf;
    try {
      buf = readFileSync(path);
    } catch (err) {
      console.error(`${path}: cannot read (${err.message})`);
      totalErrors++;
      continue;
    }
    const errMsg = checkUtf8(buf);
    if (errMsg !== null) {
      console.error(`${path}:0: invalid UTF-8 bytes (${errMsg})`);
      totalErrors++;
    }
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

export function isCliEntry() {
  return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "");
}

if (isCliEntry()) {
  main(process.argv);
}
