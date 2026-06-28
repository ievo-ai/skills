#!/usr/bin/env node
// validate_skills.mjs — lint check for SKILL.md files against agentskills.io spec.
//
// Rules enforced:
//   1. YAML frontmatter present and parseable
//   2. `name`: required, ≤64 chars, lowercase alnum + hyphens (no consecutive --,
//      no leading/trailing hyphens), must match parent directory basename
//   3. `description`: required, ≤1024 chars
//   4. `compatibility`: optional, but if present ≤500 chars
//   5. `model:`, if present, must be a vendor-neutral family alias
//      (sonnet | opus | haiku | fable | inherit) — never a vendor-pinned ID
//   6. `effort:` optional but recommended; warns on absent, errors on invalid value
//
// Exit codes:
//   0 — all skills pass
//   1 — at least one violation
//   2 — script error (no files found, etc.)
//
// Usage:
//   node validate_skills.mjs                          (scans plugins/ievo/skills/)
//   node validate_skills.mjs <file1> <file2> ...      (explicit files)
//   node validate_skills.mjs --quiet                   (only print violations)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NAME_MAX_LENGTH = 64;
export const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const DESCRIPTION_MAX_LENGTH = 1024;
export const COMPATIBILITY_MAX_LENGTH = 500;

export const VALID_EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"]);

export const ALLOWED_MODELS = new Set(["sonnet", "opus", "haiku", "fable", "inherit"]);

export const FORBIDDEN_MODEL_PATTERNS = [
  { pattern: /^claude-/, why: "Anthropic-specific ID" },
  { pattern: /^gpt-/, why: "OpenAI-specific ID" },
  { pattern: /^gemini-/, why: "Google-specific ID" },
  { pattern: /^o\d/, why: "OpenAI o-series ID" },
  { pattern: /-\d+-\d+/, why: "Version-pinned ID" },
  { pattern: /-\d{8}/, why: "Date-pinned snapshot" },
  { pattern: /^\S+@\S+/, why: "Provider-namespaced model" },
];

export const DEFAULT_SKILLS_DIR = "plugins/ievo/skills";

export function parseArgs(argv) {
  const args = { files: [], quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") args.quiet = true;
    else if (!a.startsWith("--")) args.files.push(a);
  }
  return args;
}

/**
 * Minimal single-line-only YAML frontmatter parser.
 *
 * Limitation: this handles only simple `key: value` lines. Multi-line YAML
 * constructs — block scalars (`|`, `>`), continuation/folded lines, sequences
 * (`- item`), and nested mappings — are silently skipped. Any line without a
 * top-level colon is ignored. This is intentional: SKILL.md frontmatter uses
 * only flat scalar fields (name, description, license, compatibility, model),
 * so a full YAML parser is unnecessary. If the agentskills.io spec ever adds
 * structured frontmatter fields, this function must be replaced with a proper
 * YAML parser (e.g. `yaml` npm package).
 */
export function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

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
  if (ALLOWED_MODELS.has(model)) return [];

  for (const { pattern, why } of FORBIDDEN_MODEL_PATTERNS) {
    if (pattern.test(model)) {
      return [{
        severity: "error",
        rule: "model-vendor-locked",
        message: `\`model: ${model}\` is forbidden — ${why}. Use only vendor-neutral family aliases for turn-level pins; omit \`model:\` for skills without pinning needs.`,
      }];
    }
  }

  return [{
    severity: "error",
    rule: "model-not-allowed",
    message: `\`model: ${model}\` not in allowed aliases (${[...ALLOWED_MODELS].join(", ")}). Use only vendor-neutral family aliases for turn-level pins; omit \`model:\` for skills without pinning needs.`,
  }];
}

export function checkEffortField(effort) {
  if (!effort) {
    return [{
      severity: "warning",
      rule: "missing-effort-field",
      message: "Missing recommended frontmatter field: effort (values: low, medium, high, xhigh, max). " +
               "Claude Code v2.1.149+ shows this in the status bar.",
    }];
  }
  if (!VALID_EFFORT_VALUES.has(effort)) {
    return [{
      severity: "error",
      rule: "invalid-effort-value",
      message: `effort: "${effort}" is not a valid value. Allowed: ${[...VALID_EFFORT_VALUES].join(", ")}`,
    }];
  }
  return [];
}

export function validateSkillContent(content, parentDirName) {
  const fm = parseFrontmatter(content);
  const violations = [];

  if (!fm) {
    violations.push({ severity: "error", rule: "no-frontmatter", message: "SKILL.md has no YAML frontmatter" });
    return violations;
  }

  if (!fm.name) {
    violations.push({
      severity: "error",
      rule: "missing-required-field",
      message: "Missing required frontmatter field: name",
    });
  } else {
    if (fm.name.length > NAME_MAX_LENGTH) {
      violations.push({
        severity: "error",
        rule: "name-too-long",
        message: `name is ${fm.name.length} chars — exceeds agentskills.io spec limit of ${NAME_MAX_LENGTH}`,
      });
    }
    if (fm.name.includes("--")) {
      violations.push({
        severity: "error",
        rule: "name-consecutive-hyphens",
        message: "name contains consecutive hyphens (--) — not allowed by agentskills.io spec",
      });
    } else if (!NAME_PATTERN.test(fm.name)) {
      violations.push({
        severity: "error",
        rule: "name-invalid-format",
        message: `name "${fm.name}" does not match required pattern: lowercase alnum + hyphens, no leading/trailing hyphens`,
      });
    }
    if (parentDirName && fm.name !== parentDirName) {
      violations.push({
        severity: "error",
        rule: "name-dir-mismatch",
        message: `name "${fm.name}" does not match parent directory "${parentDirName}"`,
      });
    }
  }

  if (!fm.description) {
    violations.push({
      severity: "error",
      rule: "missing-required-field",
      message: "Missing required frontmatter field: description",
    });
  } else if (fm.description.length > DESCRIPTION_MAX_LENGTH) {
    violations.push({
      severity: "error",
      rule: "description-too-long",
      message: `description is ${fm.description.length} chars — exceeds agentskills.io spec limit of ${DESCRIPTION_MAX_LENGTH}`,
    });
  }

  if (fm.compatibility && fm.compatibility.length > COMPATIBILITY_MAX_LENGTH) {
    violations.push({
      severity: "error",
      rule: "compatibility-too-long",
      message: `compatibility is ${fm.compatibility.length} chars — exceeds agentskills.io spec limit of ${COMPATIBILITY_MAX_LENGTH}`,
    });
  }

  if (fm.model) {
    violations.push(...checkModelField(fm.model));
  }

  violations.push(...checkEffortField(fm.effort));

  return violations;
}

export function validateSkill(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const parentDirName = basename(dirname(filePath));
  return validateSkillContent(content, parentDirName);
}

export function discoverSkillFiles(skillsDir) {
  const resolved = resolve(skillsDir);
  const entries = readdirSync(resolved);
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(resolved, entry);
    try {
      if (statSync(entryPath).isDirectory()) {
        const skillPath = resolve(entryPath, "SKILL.md");
        try {
          statSync(skillPath);
          files.push(skillPath);
        } catch {
          // no SKILL.md in this subdirectory
        }
      }
    } catch {
      // stat failed — skip
    }
  }
  return files;
}

export function main(argv = process.argv, exit = process.exit, log = console.log, errLog = console.error) {
  const args = parseArgs(argv);

  let files;
  if (args.files.length > 0) {
    files = args.files.map((f) => resolve(f));
  } else {
    try {
      files = discoverSkillFiles(DEFAULT_SKILLS_DIR);
    } catch (err) {
      errLog(`Error: cannot scan skills directory '${DEFAULT_SKILLS_DIR}': ${err.message}`);
      return exit(2);
    }
  }

  if (files.length === 0) {
    errLog("Error: no SKILL.md files found");
    return exit(2);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  let totalPassed = 0;

  for (const filePath of files) {
    const rel = relative(process.cwd(), filePath);
    let violations;
    try {
      violations = validateSkill(filePath);
    } catch (err) {
      violations = [{
        severity: "error",
        rule: "file-unreadable",
        message: `Could not read SKILL.md file: ${err.message}`,
      }];
    }

    const errors = violations.filter((v) => v.severity === "error");
    const warnings = violations.filter((v) => v.severity === "warning");
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (errors.length === 0) {
      totalPassed++;
      if (!args.quiet) {
        log(`✓ ${rel}`);
        for (const w of warnings) {
          log(`    [${w.severity}] ${w.rule}: ${w.message}`);
        }
      }
    } else {
      log(`✗ ${rel}`);
      for (const v of violations) {
        log(`    [${v.severity}] ${v.rule}: ${v.message}`);
      }
    }
  }

  log("");
  log(`Summary: ${totalPassed} passed, ${totalErrors} errors, ${totalWarnings} warnings across ${files.length} files`);

  if (totalErrors > 0) {
    log("");
    log("Fix: see agentskills.io/specification for field constraints.");
    return exit(1);
  }
  return exit(0);
}

export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

if (isCliEntry(import.meta.url, process.argv)) {
  main();
}
