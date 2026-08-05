#!/usr/bin/env node
// yaml-frontmatter.mjs — validate YAML frontmatter syntax in markdown files.
//
// Catches YAML parse errors that minimal regex-based parsers miss:
//   1. Unquoted values containing ": " (colon-space) — breaks YAML parsers
//   2. Unterminated quoted strings
//   3. Missing closing "---" delimiter
//   4. Duplicate frontmatter keys
//   5. Unquoted values starting with YAML flow indicators
//   6. Inline comment ambiguity (" #" in unquoted values)
//   7. SKILL.md required fields (name, description) + description length
//
// Complements validate_skills.mjs / validate_agents.mjs (semantic checks)
// and crlf-frontmatter.mjs (line endings) — this validator covers syntax.
//
// Exit codes:
//   0 — all files clean
//   1 — at least one file has YAML frontmatter errors
//   2 — usage error
//
// Usage:
//   node yaml-frontmatter.mjs <file>...
//
// Lives outside plugins/ievo/scripts/ — the 100% rule does not apply here.

import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeReadFileSync, sanitizeForLog } from "./_safe-read.mjs";

export const DESCRIPTION_MAX_LENGTH = 1024;

const FLOW_INDICATOR_START = new Set(["{", "}", "[", "]"]);

export function extractFrontmatter(text) {
  const normalized = text.replace(/\r\n?/g, "\n");

  if (!normalized.startsWith("---\n") && normalized !== "---") {
    return null;
  }

  const closeMatch = normalized.slice(3).search(/\n---(\n|$)/);
  if (closeMatch < 0) {
    return { lines: null, closeMissing: true };
  }
  const closeIdx = closeMatch + 3;

  const content = normalized.slice(4, closeIdx);
  return { lines: content.split("\n"), startLine: 2, closeMissing: false };
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function checkYamlFrontmatter(text, filePath) {
  const errors = [];
  const isSkillFile = filePath ? basename(filePath) === "SKILL.md" : false;

  const fm = extractFrontmatter(text);
  if (!fm) return errors;

  if (fm.closeMissing) {
    errors.push(
      "line 1: frontmatter opens with '---' but no closing '---' was found"
    );
    return errors;
  }

  const keys = new Map();

  for (let i = 0; i < fm.lines.length; i++) {
    const line = fm.lines[i];
    const lineNum = fm.startLine + i;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (line[0] === " " || line[0] === "\t") continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 1) {
      errors.push(
        `line ${lineNum}: invalid YAML mapping — expected "key: value" but found: ${trimmed}`
      );
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (keys.has(key)) {
      errors.push(
        `line ${lineNum}: duplicate key "${key}" (first seen at line ${keys.get(key).lineNum})`
      );
    } else {
      keys.set(key, { lineNum, rawValue: value });
    }

    if (!value) continue;

    if (value.startsWith('"')) {
      if (value.length < 2 || !value.endsWith('"')) {
        errors.push(
          `line ${lineNum}: unterminated double-quoted string for key "${key}"`
        );
      }
    } else if (value.startsWith("'")) {
      if (value.length < 2 || !value.endsWith("'")) {
        errors.push(
          `line ${lineNum}: unterminated single-quoted string for key "${key}"`
        );
      }
    } else {
      if (value.includes(": ")) {
        errors.push(
          `line ${lineNum}: unquoted value for "${key}" contains ": " (colon-space) — YAML parsers interpret this as a nested mapping. Wrap the value in double quotes.`
        );
      }
      if (FLOW_INDICATOR_START.has(value[0])) {
        errors.push(
          `line ${lineNum}: unquoted value for "${key}" starts with flow indicator '${value[0]}' — wrap in quotes`
        );
      }
      if (value.includes(" #")) {
        errors.push(
          `line ${lineNum}: unquoted value for "${key}" contains " #" which YAML interprets as an inline comment — wrap in quotes or remove the hash`
        );
      }
    }
  }

  if (isSkillFile) {
    if (!keys.has("name")) {
      errors.push("line 1: SKILL.md missing required frontmatter field: name");
    }
    if (!keys.has("description")) {
      errors.push(
        "line 1: SKILL.md missing required frontmatter field: description"
      );
    } else {
      const desc = keys.get("description");
      const descValue = stripQuotes(desc.rawValue);
      if (descValue.length > DESCRIPTION_MAX_LENGTH) {
        errors.push(
          `line ${desc.lineNum}: description is ${descValue.length} chars — exceeds limit of ${DESCRIPTION_MAX_LENGTH}`
        );
      }
    }
  }

  return errors;
}

export function main(argv) {
  const files = argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: yaml-frontmatter.mjs <file>...");
    process.exit(2);
  }
  let totalErrors = 0;
  for (const filePath of files) {
    let text;
    try {
      text = safeReadFileSync(filePath, "utf-8");
    } catch (err) {
      console.error(sanitizeForLog(`${filePath}: cannot read (${err.message})`));
      totalErrors++;
      continue;
    }
    const errors = checkYamlFrontmatter(text, filePath);
    for (const e of errors) {
      console.error(sanitizeForLog(`${filePath}:${e}`));
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
