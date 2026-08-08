#!/usr/bin/env node
// validate_agents.mjs — lint check for agent .md files in the ievo plugin.
//
// Rules enforced (v0.5.2+):
//   1. `model:` frontmatter, if present, MUST be one of: sonnet | opus | haiku | fable | inherit
//   2. NEVER use vendor-specific or version-pinned IDs like claude-sonnet-4-6, gpt-5, etc.
//   3. Required frontmatter fields: name, description
//   4. `effort:` frontmatter, if present, MUST be one of: low | medium | high | xhigh | max
//
// Exit codes:
//   0 — all agents pass
//   1 — at least one violation
//   2 — script error (no agents found, missing dir, etc.)
//
// Usage:
//   node validate_agents.mjs                     (defaults to plugins/ievo/agents/)
//   node validate_agents.mjs <agents-dir>        (explicit dir)
//   node validate_agents.mjs --quiet             (only print violations, suppress passes)

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
export const REQUIRED_FIELDS = ["name", "description"];

// Agent frontmatter is never legitimately larger than this — guards the
// readFileSync call in validateAgent() below against a multi-GB blob (or a
// symlink pointed at a non-EOF-terminating device such as /dev/zero) OOMing
// or hanging the validator inside CI or a contributor's local `pre-commit
// run` (CWE-400). Mirrors scan_repo.mjs's MAX_SCAN_FILE_BYTES.
export const MAX_VALIDATE_FILE_BYTES = 256 * 1024;

// Uses lstatSync (not statSync) so a symlink is judged on its own metadata
// and never followed — a symlink pointed at a device file is rejected
// outright by type (isFile() is false for a symlink under lstat) instead of
// being stat'd through to the target, whose reported size can be misleading
// (character devices commonly report size 0 while still streaming
// unboundedly on read).
export function isOversized(p, capBytes = MAX_VALIDATE_FILE_BYTES) {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return false;
  }
  return !st.isFile() || st.size > capBytes;
}

// `effort:` overrides the session effort level for this sub-agent. Validate-if-present,
// mirroring how `model:` is handled here: an absent value is fine (the agent inherits
// session effort), but a mistyped value silently does nothing at runtime, so we error
// on it. Value set matches validate_skills.mjs (the same agentskills.io field).
export const VALID_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

// YAML block (`|`) / folded (`>`) scalar indicator, with optional chomping
// (`+`/`-`) and/or explicit indentation-indicator digit, in EITHER order —
// e.g. `|`, `>-`, `|2`, `>+1`, and (per the YAML 1.2 block-header grammar)
// `|2-` / `>+1` are equally valid with the digit before the chomping mark.
// Matched against a key's same-line value to detect a multi-line scalar so
// parseFrontmatter() can consume its body instead of treating the 1-3 char
// indicator itself as the field's whole value — missing either ordering
// would leave that exact CWE-20 bypass (skills#392) reachable via the other.
export const BLOCK_SCALAR_RE = /^[|>](?:[+-]?\d*|\d[+-]?)$/;

// Strips C0 control characters (and DEL) from a parsed frontmatter value
// before it can ever reach a violation message or console.log (CWE-150).
// `checkModelField`/`checkEffortField` interpolate `fm.model`/`fm.effort`
// verbatim into messages that `main()` prints to stdout — a raw ESC byte
// (0x1B) in a crafted `model:`/`effort:` value survives untouched otherwise
// and can inject ANSI/control sequences into a CI log or terminal viewer.
// Excludes tab/LF/CR (\x09/\x0a/\x0d) so a legitimate multi-line block-scalar
// body (assembled by parseFrontmatter() below) keeps its real line breaks —
// mirrors scan_repo.mjs's escapeMdCell control-char strip, which excludes the
// same three codes for the same reason.
// Also strips every code point with the Unicode Bidi_Control property \u2014
// U+061C (ALM), U+200E-U+200F (LRM/RLM), U+202A-U+202E, U+2066-U+2069 \u2014 plus
// zero-width characters (U+200B-U+200F, U+FEFF); the U+2066-U+2069 isolates
// are widened to the full U+2060-U+2069 invisible-operator block (CWE-116
// follow-up, skills#600). The ASCII-only range above didn't touch any of
// these, so a crafted `name:`/`description:` value could carry a
// Trojan-Source-style spoof straight into a violation message unneutralized.
// The Bidi_Control set is closed at those six ranges \u2014 adding a code point
// outside them means the enumeration above is no longer exhaustive and the
// comment must say so.
export const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

// Patterns that indicate vendor-specific or version-pinned IDs
export const FORBIDDEN_MODEL_PATTERNS = [
  { pattern: /^claude-/, why: "Anthropic-specific ID — locks to one vendor" },
  { pattern: /^gpt-/, why: "OpenAI-specific ID — locks to one vendor" },
  { pattern: /^gemini-/, why: "Google-specific ID — locks to one vendor" },
  { pattern: /^o[12345]/, why: "OpenAI o-series ID — locks to one vendor" },
  { pattern: /-\d+-\d+/, why: "Version-pinned ID (e.g., sonnet-4-6) — drift risk + vendor lock" },
  { pattern: /-\d{8}/, why: "Date-pinned snapshot — too specific, drifts on bump" },
  { pattern: /^\S+@\S+/, why: "Provider-namespaced model — vendor lock" },
];

export function parseArgs(argv) {
  const args = { agentsDir: "plugins/ievo/agents", quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") args.quiet = true;
    else if (!a.startsWith("--")) args.agentsDir = a;
  }
  return args;
}

export function parseFrontmatter(content) {
  // Normalize CRLF and CR line endings to LF before parsing.
  // Original regex was \n-only — files with Windows line endings could bypass.
  const normalized = content.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    // SECURITY: scan indented lines too — original `if (/^\s+/.test(line)) continue;`
    // would silently skip a `model:` field nested under another key, letting
    // attackers bypass the validator with deceptively-structured YAML.
    // We don't try to be a real YAML parser — we just won't ignore the line.
    // The one exception is a genuine block/folded scalar body (below): those
    // indented lines are the literal string content of the key that declared
    // `|`/`>`, not a separate nested mapping, so consuming them here matches
    // how any real YAML parser would resolve the same frontmatter — it does
    // not reopen the nested-model bypass this comment guards against.
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    let isBlockScalar = false;

    if (BLOCK_SCALAR_RE.test(value)) {
      isBlockScalar = true;
      const bodyLines = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || /^\s/.test(lines[i + 1]))) {
        i++;
        bodyLines.push(lines[i].replace(/^\s+/, ""));
      }
      value = bodyLines.join("\n").trim();
    }

    // A block/folded scalar body is never quote-delimited in YAML (leading/
    // trailing `"`/`'` are literal content) — only strip surrounding quotes
    // from a plain single-line scalar.
    if (value) {
      const unquoted = isBlockScalar ? value : value.replace(/^["']|["']$/g, "");
      fm[key] = unquoted.replace(CONTROL_CHAR_RE, "");
    }
  }
  return fm;
}

export function checkModelField(model) {
  const violations = [];
  if (ALLOWED_MODELS.has(model)) return [];

  for (const { pattern, why } of FORBIDDEN_MODEL_PATTERNS) {
    if (pattern.test(model)) {
      violations.push({
        severity: "error",
        rule: "model-vendor-locked",
        message: `\`model: ${model}\` is forbidden — ${why}. Use one of: ${[...ALLOWED_MODELS].join(", ")}.`,
      });
      return violations; // first match is enough
    }
  }

  // Generic "not in allowed set" if no specific pattern matched
  violations.push({
    severity: "error",
    rule: "model-not-allowed",
    message: `\`model: ${model}\` not in allowed aliases. Use one of: ${[...ALLOWED_MODELS].join(", ")}.`,
  });
  return violations;
}

export function checkEffortField(effort) {
  if (!effort) return [];
  if (!VALID_EFFORT_VALUES.has(effort)) {
    return [{
      severity: "error",
      rule: "invalid-effort-value",
      message: `\`effort: ${effort}\` is not a valid value. Allowed: ${[...VALID_EFFORT_VALUES].join(", ")}.`,
    }];
  }
  return [];
}

export function validateAgent(filePath) {
  if (isOversized(filePath)) {
    return [{
      severity: "error",
      rule: "file-too-large",
      message: `Agent file exceeds ${MAX_VALIDATE_FILE_BYTES} bytes (or is not a regular file — e.g. a symlink) — refusing to read`,
    }];
  }
  const content = readFileSync(filePath, "utf-8");
  return validateAgentContent(content);
}

// Pure-function form for testing without filesystem
export function validateAgentContent(content) {
  const fm = parseFrontmatter(content);
  const violations = [];

  if (!fm) {
    violations.push({ severity: "error", rule: "no-frontmatter", message: "Agent file has no YAML frontmatter" });
    return violations;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!fm[field]) {
      violations.push({
        severity: "error",
        rule: "missing-required-field",
        message: `Missing required frontmatter field: ${field}`,
      });
    }
  }

  if (fm.model) {
    violations.push(...checkModelField(fm.model));
  }

  violations.push(...checkEffortField(fm.effort));

  return violations;
}

export function main(argv = process.argv, exit = process.exit, log = console.log, errLog = console.error) {
  const args = parseArgs(argv);
  const agentsDir = resolve(args.agentsDir);

  let entries;
  try {
    entries = readdirSync(agentsDir);
  } catch (err) {
    errLog(`Error: cannot read agents directory '${agentsDir}': ${err.message}`);
    return exit(2);
  }

  const agentFiles = entries.filter((f) => f.endsWith(".md")).map((f) => resolve(agentsDir, f));

  if (agentFiles.length === 0) {
    errLog(`Error: no .md files found in '${agentsDir}'`);
    return exit(2);
  }

  let totalViolations = 0;
  let totalPassed = 0;

  for (const filePath of agentFiles) {
    // A crafted file path (e.g. a PR-added agent .md file with an embedded
    // ESC byte) reaches this unstripped otherwise — same CWE-150 guard as
    // CONTROL_CHAR_RE's use on frontmatter values, extended to path echoing
    // (skills#495).
    const rel = relative(process.cwd(), filePath).replace(CONTROL_CHAR_RE, "");
    let violations;
    try {
      violations = validateAgent(filePath);
    } catch (err) {
      // Per-file isolation: a single unreadable file (permission, EISDIR, symlink
      // loop, etc.) must NOT halt the loop. Record as a violation so the file is
      // counted in totals and surfaces in the summary, then continue.
      // Node's fs error messages (ENOENT, EACCES, EISDIR, ...) embed the
      // offending path verbatim — the same attacker-influenceable path this
      // file's CONTROL_CHAR_RE guard exists for, reachable through a third
      // call site the rel fix above didn't cover (skills#495 deep-review
      // follow-up).
      violations = [{
        severity: "error",
        rule: "file-unreadable",
        message: `Could not read agent file: ${err.message.replace(CONTROL_CHAR_RE, "")}`,
      }];
    }

    if (violations.length === 0) {
      totalPassed++;
      if (!args.quiet) log(`✓ ${rel}`);
    } else {
      totalViolations += violations.length;
      log(`✗ ${rel}`);
      for (const v of violations) {
        log(`    [${v.severity}] ${v.rule}: ${v.message}`);
      }
    }
  }

  log("");
  log(`Summary: ${totalPassed} passed, ${totalViolations} violations across ${agentFiles.length} files`);

  if (totalViolations > 0) {
    log("");
    log("Fix: see AGENTS.md → agent frontmatter rules (model + effort) for the rule and rationale.");
    return exit(1);
  }
  return exit(0);
}

// Pure entry-guard predicate — extracted so the `argv[1] ?? ""` fallback
// branch is reachable from tests. Module-scope `if` runs at import time
// with whatever argv Node populated; tests can call this directly with
// argv shapes Node would never produce (e.g. `["node"]` from `node -e`).
//
// Normalises both sides: process.argv[1] is often a relative path
// (`node plugins/ievo/scripts/validate_agents.mjs`) while import.meta.url
// is always absolute. Without resolve() the equality check silently fails
// and main() never runs.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

// CLI entry — only run when invoked directly, not when imported for testing.
if (isCliEntry(import.meta.url, process.argv)) {
  main();
}
