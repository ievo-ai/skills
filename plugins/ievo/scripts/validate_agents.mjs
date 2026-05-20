#!/usr/bin/env node
// validate_agents.mjs — lint check for agent .md files in the ievo plugin.
//
// Rules enforced (v0.5.2+):
//   1. `model:` frontmatter, if present, MUST be one of: sonnet | opus | haiku | inherit
//   2. NEVER use vendor-specific or version-pinned IDs like claude-sonnet-4-6, gpt-5, etc.
//   3. Required frontmatter fields: name, description
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

const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku", "inherit"]);
const REQUIRED_FIELDS = ["name", "description"];

// Patterns that indicate vendor-specific or version-pinned IDs
const FORBIDDEN_MODEL_PATTERNS = [
  { pattern: /^claude-/, why: "Anthropic-specific ID — locks to one vendor" },
  { pattern: /^gpt-/, why: "OpenAI-specific ID — locks to one vendor" },
  { pattern: /^gemini-/, why: "Google-specific ID — locks to one vendor" },
  { pattern: /^o[12345]/, why: "OpenAI o-series ID — locks to one vendor" },
  { pattern: /-\d+-\d+/, why: "Version-pinned ID (e.g., sonnet-4-6) — drift risk + vendor lock" },
  { pattern: /-\d{8}/, why: "Date-pinned snapshot — too specific, drifts on bump" },
  { pattern: /^\S+@\S+/, why: "Provider-namespaced model — vendor lock" },
];

function parseArgs(argv) {
  const args = { agentsDir: "plugins/ievo/agents", quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") args.quiet = true;
    else if (!a.startsWith("--")) args.agentsDir = a;
  }
  return args;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\s+/.test(line)) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (value) fm[key] = value.replace(/^["']|["']$/g, "");
    }
  }
  return fm;
}

function checkModelField(model) {
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

function validateAgent(filePath) {
  const content = readFileSync(filePath, "utf-8");
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

  return violations;
}

function main() {
  const args = parseArgs(process.argv);
  const agentsDir = resolve(args.agentsDir);

  let entries;
  try {
    entries = readdirSync(agentsDir);
  } catch (err) {
    console.error(`Error: cannot read agents directory '${agentsDir}': ${err.message}`);
    process.exit(2);
  }

  const agentFiles = entries.filter((f) => f.endsWith(".md")).map((f) => resolve(agentsDir, f));

  if (agentFiles.length === 0) {
    console.error(`Error: no .md files found in '${agentsDir}'`);
    process.exit(2);
  }

  let totalViolations = 0;
  let totalPassed = 0;

  for (const filePath of agentFiles) {
    const rel = relative(process.cwd(), filePath);
    const violations = validateAgent(filePath);

    if (violations.length === 0) {
      totalPassed++;
      if (!args.quiet) console.log(`✓ ${rel}`);
    } else {
      totalViolations += violations.length;
      console.log(`✗ ${rel}`);
      for (const v of violations) {
        console.log(`    [${v.severity}] ${v.rule}: ${v.message}`);
      }
    }
  }

  console.log();
  console.log(`Summary: ${totalPassed} passed, ${totalViolations} violations across ${agentFiles.length} files`);

  if (totalViolations > 0) {
    console.log();
    console.log("Fix: see AGENTS.md → 'Agent model frontmatter' for the rule and rationale.");
    process.exit(1);
  }
  process.exit(0);
}

main();
