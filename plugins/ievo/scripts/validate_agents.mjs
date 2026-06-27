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

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);
export const REQUIRED_FIELDS = ["name", "description"];
// `effort:` overrides the session effort level for this sub-agent. Validate-if-present,
// mirroring how `model:` is handled here: an absent value is fine (the agent inherits
// session effort), but a mistyped value silently does nothing at runtime, so we error
// on it. Value set matches validate_skills.mjs (the same agentskills.io field).
export const VALID_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

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
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    // SECURITY: scan indented lines too — original `if (/^\s+/.test(line)) continue;`
    // would silently skip a `model:` field nested under another key, letting
    // attackers bypass the validator with deceptively-structured YAML.
    // We don't try to be a real YAML parser — we just won't ignore the line.
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value) fm[key] = value.replace(/^["']|["']$/g, "");
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
    const rel = relative(process.cwd(), filePath);
    let violations;
    try {
      violations = validateAgent(filePath);
    } catch (err) {
      // Per-file isolation: a single unreadable file (permission, EISDIR, symlink
      // loop, etc.) must NOT halt the loop. Record as a violation so the file is
      // counted in totals and surfaces in the summary, then continue.
      violations = [{
        severity: "error",
        rule: "file-unreadable",
        message: `Could not read agent file: ${err.message}`,
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
