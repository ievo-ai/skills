#!/usr/bin/env node
// machine-local-paths.mjs — flag absolute paths containing concrete user
// home directories (committing them leaks the author's username and breaks
// portability for any other contributor).
//
// Detected patterns:
//   /Users/<name>/…             POSIX (macOS home)
//   /home/<name>/…              POSIX (Linux home)
//   C:\Users\<name>\…           Windows home
//   /private/var/folders/…      macOS sandbox / TMPDIR (often contains PII)
//
// Allowed exceptions (false-positive guards):
//   - Placeholder syntax: `/Users/<name>/`, `/home/$USER/`, `~/path` — the
//     concrete-username pattern requires a literal identifier after the
//     prefix, not `<…>`, `$…`, `~`.
//   - GitHub Actions runner home `/home/runner/...` — recurring legitimate
//     mention in CI documentation; whitelisted by name.
//   - Lines containing the literal marker `machine-local-ok` — explicit
//     opt-out for legitimate documentation examples.
//
// Usage:
//   node machine-local-paths.mjs <file>...
// Exit codes:
//   0 — all files clean
//   1 — at least one leak found
//   2 — usage error
//
// Lives outside plugins/ievo/scripts/ — the 100% rule doesn't apply here.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { safeReadFileSync } from "./_safe-read.mjs";

// Pattern requires the prefix to start at a word boundary or path-separator
// context and the username segment to start with a letter (excludes purely
// numeric "directory" mentions like /home/123).
const PATTERNS = [
  /(?<![\w<$~])(\/(?:Users|home)\/[A-Za-z][A-Za-z0-9_-]+)(?:[/\s"`'.,;:)\]]|$)/g,
  /(?<!\w)(C:\\Users\\[A-Za-z][A-Za-z0-9_-]+)/g,
  /(\/private\/var\/folders\/[A-Za-z0-9_+/]+)/g,
];
const ALLOWLIST_MARKER = "machine-local-ok";

// Known-good system home directories that legitimately appear in CI / system
// documentation. Matched against the captured path (case-insensitive).
const WHITELISTED_HOMES = new Set([
  "/home/runner",  // GitHub Actions runner
]);

export function checkMachineLocalPaths(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOWLIST_MARKER)) continue;
    const hits = new Set();
    for (const re of PATTERNS) {
      for (const match of line.matchAll(re)) {
        if (!WHITELISTED_HOMES.has(match[1].toLowerCase())) {
          hits.add(match[1]);
        }
      }
    }
    for (const hit of hits) {
      errors.push(`line ${i + 1}: machine-local path leak: '${hit}' — replace with a placeholder (\`<name>\`, \`$HOME\`, \`~/\`) or add 'machine-local-ok' on the line if intentional.`);
    }
  }
  return errors;
}

function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: machine-local-paths.mjs <file>...");
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
    const errors = checkMachineLocalPaths(text);
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
