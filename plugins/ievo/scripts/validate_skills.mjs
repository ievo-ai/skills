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
//   6. `effort:` required; errors on absent, errors on invalid value
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

import { lstatSync, readFileSync, readdirSync } from "node:fs";
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
// `checkModelField`/`checkEffortField`/the name-mismatch checks interpolate
// `fm.model`/`fm.effort`/`fm.name` verbatim into messages that `main()`
// prints to stdout — a raw ESC byte (0x1B) in a crafted frontmatter value
// survives untouched otherwise and can inject ANSI/control sequences into a
// CI log or terminal viewer. Excludes tab/LF/CR (\x09/\x0a/\x0d) so a
// legitimate multi-line block-scalar body (assembled by parseFrontmatter()
// below) keeps its real line breaks — mirrors scan_repo.mjs's escapeMdCell
// control-char strip, which excludes the same three codes for the same
// reason.
// Also strips every code point with the Unicode Bidi_Control property —
// U+061C (ALM), U+200E-U+200F (LRM/RLM), U+202A-U+202E, U+2066-U+2069 — plus
// zero-width characters (U+200B-U+200F, U+FEFF); the U+2066-U+2069 isolates
// are widened to the full U+2060-U+2069 invisible-operator block (CWE-116
// follow-up, skills#600). The ASCII-only range above didn't touch any of
// these, so a crafted `name:`/`description:` value could carry a
// Trojan-Source-style spoof straight into a violation message unneutralized.
// The Bidi_Control set is closed at those six ranges — adding a code point
// outside them means the enumeration above is no longer exhaustive and the
// comment must say so.
export const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

// SKILL.md frontmatter is never legitimately larger than this — guards the
// readFileSync call in validateSkill() below against a multi-GB blob (or a
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
 * Minimal YAML frontmatter parser for flat scalar fields.
 *
 * Limitation: this handles only simple `key: value` lines, plus block (`|`)
 * and folded (`>`) scalars — a same-line value matching BLOCK_SCALAR_RE
 * consumes the following indented/blank lines into that key's true
 * multi-line value, so length-based checks (DESCRIPTION_MAX_LENGTH etc.)
 * measure real content instead of the 1-2 char indicator (CWE-20, skills#392).
 * Sequences (`- item`) and nested mappings are still not modeled: a bare
 * `key:` with nothing on the same line just leaves that key unset, and every
 * other line (indented or not) is independently checked for its own
 * `key: value` pattern — deliberately, so a forbidden field (e.g. `model:`)
 * can't be smuggled past this validator by nesting it under an unrelated
 * parent key. This is intentional: every field this validator ENFORCES
 * (name, description, compatibility, model, effort) is a flat scalar, so a
 * full YAML parser is unnecessary.
 *
 * Consequence worth knowing before adding a rule (skills#443): the
 * list-valued frontmatter fields SKILL.md does use — `allowed-tools` and
 * `paths` — are consequently INVISIBLE here. A `paths:` list is never parsed,
 * so AGENTS.md § Skills format's root-anchoring rule (a pattern is anchored at
 * the project root unless it opens with a globstar segment) cannot be enforced
 * by this script and a typo'd or mis-anchored pattern lints clean; it is
 * checked by hand in review instead.
 * Enforcing it would require modeling sequences, which would forfeit the
 * nested-key-smuggling guarantee above unless carefully re-established. If
 * the agentskills.io spec ever adds a structured field this validator must
 * ENFORCE, replace this function with a proper YAML parser (e.g. the `yaml`
 * npm package) rather than extending it ad hoc.
 *
 * Values are CONTROL_CHAR_RE-stripped by default — that strip is the CWE-150
 * guard every violation message downstream relies on. Pass `{ strip: false }`
 * to get the RAW values instead: a check whose verdict the strip can flip must
 * see what the file actually contains, not its normalized display form. Only
 * the name-format check needs that (skills#600 review) — every value that
 * reaches a printed message must still come from the stripped view.
 */
export function parseFrontmatter(content, { strip = true } = {}) {
  const normalized = content.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

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
      fm[key] = strip ? unquoted.replace(CONTROL_CHAR_RE, "") : unquoted;
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
        message: `\`model: ${model}\` is forbidden — ${why}. Use only vendor-neutral family aliases (${[...ALLOWED_MODELS].join(", ")}) for turn-level pins; omit \`model:\` for skills without pinning needs.`,
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
      severity: "error",
      rule: "missing-effort-field",
      message: "Missing required frontmatter field: effort (values: low, medium, high, xhigh, max). " +
               "Claude Code v2.1.162+ persists effort between sessions — skills without effort: " +
               "inherit the session effort unexpectedly.",
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
    // The RAW `name:` value, straight off disk. `fm.name` has already been
    // through CONTROL_CHAR_RE (CWE-150), and every code point that strip
    // removes — C0/DEL, bidi controls, zero-width — is outside NAME_PATTERN's
    // `[a-z0-9-]` class, so testing the STRIPPED value normalizes the very
    // spoof the pattern is meant to reject: `name: deep<U+200B>-review` in a
    // directory named `deep-review` collapses to a clean `deep-review` and
    // passes both this check and name-dir-mismatch below, shipping a homograph
    // name (skills#600 review — the mirror image of the dir-side double-strip
    // fixed there). Compare on raw, render from the stripped view.
    // parseFrontmatter() is deterministic over `content` and the strip touches
    // values only, never the key set, so `name` is present in both views.
    const rawName = parseFrontmatter(content, { strip: false }).name;

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
    } else if (rawName !== fm.name) {
      // Same rule as the pattern check below — a name carrying any of these
      // code points fails NAME_PATTERN on its raw form by construction. Split
      // into its own branch purely for the message: interpolating `fm.name`
      // (mandatory — the raw value must never reach a printed message) would
      // otherwise render a name that visibly *does* match the pattern.
      violations.push({
        severity: "error",
        rule: "name-invalid-format",
        message: `name "${fm.name}" (shown stripped) contains control or invisible characters — C0/DEL, bidi control, or zero-width — which are not lowercase alnum + hyphens`,
      });
    } else if (!NAME_PATTERN.test(fm.name)) {
      violations.push({
        severity: "error",
        rule: "name-invalid-format",
        message: `name "${fm.name}" does not match required pattern: lowercase alnum + hyphens, no leading/trailing hyphens`,
      });
    }
    // Compared RAW, stripped only where it is interpolated into the message.
    // `fm.name` is already stripped by parseFrontmatter(), so normalizing this
    // side too would make both sides collapse to the same value and defeat the
    // check: a directory literally named `deep<U+200B>-review` alongside
    // `name: deep-review` would stop tripping this rule, which is precisely
    // the on-disk spoof it exists to catch (a directory name is filesystem-
    // controlled and nothing downstream ever strips it). Stripping at the
    // interpolation still keeps the CWE-150 guarantee that no raw control byte
    // reaches a message main() prints (skills#495).
    if (parentDirName && fm.name !== parentDirName) {
      violations.push({
        severity: "error",
        rule: "name-dir-mismatch",
        message: `name "${fm.name}" does not match parent directory "${parentDirName.replace(CONTROL_CHAR_RE, "")}"`,
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
  if (isOversized(filePath)) {
    return [{
      severity: "error",
      rule: "file-too-large",
      message: `SKILL.md exceeds ${MAX_VALIDATE_FILE_BYTES} bytes (or is not a regular file — e.g. a symlink) — refusing to read`,
    }];
  }
  const content = readFileSync(filePath, "utf-8");
  // Deliberately RAW. The CWE-150 strip that skills#495 added here (a git tree
  // entry name may contain arbitrary bytes other than `/` and NUL, and an ESC
  // byte must never reach the name-dir-mismatch message main() prints) now
  // happens inside validateSkillContent(), at the message interpolation only —
  // stripping it *here* would also normalize one side of that function's
  // equality test against the already-stripped `fm.name`, weakening the spoof
  // check itself. See the name-dir-mismatch comment there.
  const parentDirName = basename(dirname(filePath));
  return validateSkillContent(content, parentDirName);
}

// Uses lstatSync (not statSync) so a symlinked directory entry under
// skillsDir is judged on its own metadata and never followed (CWE-59) — the
// same rationale as isOversized() above. A crafted PR could otherwise add a
// symlink under plugins/ievo/skills/ pointing outside the repo tree (e.g.
// ../../../../etc), causing this scan to walk and validate content that
// isn't actually part of the shipped skill set. Unlike statSync, lstatSync
// never throws on a dangling symlink target — it reports the link's own
// metadata — so entryPath's lstat needs no try/catch of its own: a
// non-directory entry (regular file, symlink of any kind) simply fails
// isDirectory() and is skipped. A genuine lstat failure on a name
// readdirSync just returned (e.g. a TOCTOU race) is left to propagate to
// main()'s existing try/catch around this call, rather than being silently
// swallowed here.
export function discoverSkillFiles(skillsDir) {
  const resolved = resolve(skillsDir);
  const entries = readdirSync(resolved);
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(resolved, entry);
    if (!lstatSync(entryPath).isDirectory()) continue;
    const skillPath = resolve(entryPath, "SKILL.md");
    try {
      lstatSync(skillPath);
      files.push(skillPath);
    } catch {
      // no SKILL.md in this subdirectory
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
    // A crafted file path (e.g. a PR-added SKILL.md directory with an embedded
    // ESC byte) reaches this unstripped otherwise — same CWE-150 guard as
    // CONTROL_CHAR_RE's use on frontmatter values, extended to path echoing
    // (skills#495).
    const rel = relative(process.cwd(), filePath).replace(CONTROL_CHAR_RE, "");
    let violations;
    try {
      violations = validateSkill(filePath);
    } catch (err) {
      // Node's fs error messages (ENOENT, EACCES, EISDIR, ...) embed the
      // offending path verbatim — the same attacker-influenceable path this
      // file's CONTROL_CHAR_RE guard exists for, reachable through a third
      // call site the rel/parentDirName fix above didn't cover (skills#495
      // deep-review follow-up).
      violations = [{
        severity: "error",
        rule: "file-unreadable",
        message: `Could not read SKILL.md file: ${err.message.replace(CONTROL_CHAR_RE, "")}`,
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
