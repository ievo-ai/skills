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
// the `model`/`effort`/`name` values into messages that `main()` prints to
// stdout — a raw ESC byte (0x1B) in a crafted frontmatter value survives
// untouched otherwise and can inject ANSI/control sequences into a CI log or
// terminal viewer. Those three checks read the RAW value for their verdict
// (the strip would otherwise normalize the spoof away) and apply this regex
// at the interpolation site instead; see their comments below.
// Excludes tab/LF/CR (\x09/\x0a/\x0d) so a legitimate multi-line block-scalar
// body (assembled by parseFrontmatter() below) keeps its real line breaks —
// mirrors scan_repo.mjs's escapeMdCell control-char strip, which excludes the
// same three codes for the same reason.
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

// Display-only: strips CONTROL_CHAR_RE's class PLUS \r/\n from a value right
// before it is interpolated into a violation message. CONTROL_CHAR_RE alone
// is not enough at every interpolation site — it deliberately excludes
// \x0a/\x0d (see above) so a legitimate block-scalar body keeps its line
// breaks, but that same exclusion lets a `model:`/`effort:`/`name:` value
// whose ONLY non-standard byte is `\n` reach a message unstripped (`shown`/
// `fm.name` still carry it), carrying the raw newline into main()'s stdout
// verbatim. `pre-commit-gate.yml` streams that stdout straight into the
// GitHub Actions job log, where a line starting with `::` is parsed as a
// workflow command (CWE-117, skills#648) — e.g. `::add-mask::` or
// `::stop-commands::` forging or suppressing CI annotations. Never use this
// for a verdict comparison — only at a message-interpolation site, after the
// raw value has already been judged.
export function stripForDisplay(value) {
  return value.replace(CONTROL_CHAR_RE, "").replace(/[\r\n]/g, "");
}

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
 * see what the file actually contains, not its normalized display form. Every
 * such check reads the raw view (name format, `model:`, `effort:`, and the
 * `description:`/`compatibility:` length caps — skills#600 review); every
 * value that reaches a printed message must still come from the stripped view,
 * or be stripped at the interpolation site.
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

// `model` arrives RAW (see validateSkillContent) — the allowlist test below
// has to see what the file actually contains. Every code point
// CONTROL_CHAR_RE removes is outside the charset of every allowed alias, so
// testing the STRIPPED value normalizes the very spoof this check exists to
// reject: `model: opus<U+200B>` collapses to a clean `opus`, is found in
// ALLOWED_MODELS, and lints clean — the same verdict-flips-on-strip defect
// fixed for `name` (skills#600 review). Compare on raw, render stripped.
export function checkModelField(model) {
  if (ALLOWED_MODELS.has(model)) return [];

  const shown = model.replace(CONTROL_CHAR_RE, "");
  if (shown !== model) {
    // Its own branch purely for the message, mirroring name-invalid-format:
    // interpolating `shown` into either message below (mandatory — the raw
    // value must never reach a printed message) would render a model that
    // visibly *is* an allowed alias, or visibly *isn't* vendor-pinned, while
    // erroring on it. Past this point `model` is CONTROL_CHAR_RE-identical,
    // but may still carry a raw `\n`/`\r` (CONTROL_CHAR_RE excludes those,
    // see its comment) — `shown` came from CONTROL_CHAR_RE alone, so it can
    // too; use stripForDisplay() below.
    return [{
      severity: "error",
      rule: "model-not-allowed",
      message: `\`model: ${stripForDisplay(model)}\` (shown stripped) contains control or invisible characters — C0/DEL, bidi control, or zero-width — so it is not one of the allowed aliases (${[...ALLOWED_MODELS].join(", ")}). Use only vendor-neutral family aliases for turn-level pins; omit \`model:\` for skills without pinning needs.`,
    }];
  }

  for (const { pattern, why } of FORBIDDEN_MODEL_PATTERNS) {
    if (pattern.test(model)) {
      return [{
        severity: "error",
        rule: "model-vendor-locked",
        message: `\`model: ${stripForDisplay(model)}\` is forbidden — ${why}. Use only vendor-neutral family aliases (${[...ALLOWED_MODELS].join(", ")}) for turn-level pins; omit \`model:\` for skills without pinning needs.`,
      }];
    }
  }

  return [{
    severity: "error",
    rule: "model-not-allowed",
    message: `\`model: ${stripForDisplay(model)}\` not in allowed aliases (${[...ALLOWED_MODELS].join(", ")}). Use only vendor-neutral family aliases for turn-level pins; omit \`model:\` for skills without pinning needs.`,
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
  // Same raw-verdict/stripped-render split as checkModelField above: `effort`
  // arrives RAW, because every code point CONTROL_CHAR_RE removes is outside
  // the charset of every VALID_EFFORT_VALUES member, so testing the stripped
  // value would let `effort: high<U+200B>` collapse to a clean `high` and lint
  // clean (skills#600 review).
  const shown = effort.replace(CONTROL_CHAR_RE, "");
  if (shown !== effort) {
    return [{
      severity: "error",
      rule: "invalid-effort-value",
      message: `effort: "${stripForDisplay(effort)}" (shown stripped) contains control or invisible characters — C0/DEL, bidi control, or zero-width — and is not a valid value. Allowed: ${[...VALID_EFFORT_VALUES].join(", ")}`,
    }];
  }
  if (!VALID_EFFORT_VALUES.has(effort)) {
    return [{
      severity: "error",
      rule: "invalid-effort-value",
      message: `effort: "${stripForDisplay(effort)}" is not a valid value. Allowed: ${[...VALID_EFFORT_VALUES].join(", ")}`,
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

  // The same frontmatter, unstripped. `parseFrontmatter()` is deterministic
  // over `content` and the strip touches values only, never the key set, so
  // the two views always carry the same keys and `raw` is non-null whenever
  // `fm` is. Every check whose verdict CONTROL_CHAR_RE could flip reads from
  // here (name format, model, effort, and all three length caps); every check
  // that measures "is this field effectively empty", and every value that
  // reaches a printed message, still reads from the stripped `fm`.
  const raw = parseFrontmatter(content, { strip: false });

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
    const rawName = raw.name;

    if (rawName.length > NAME_MAX_LENGTH) {
      violations.push({
        severity: "error",
        rule: "name-too-long",
        message: `name is ${rawName.length} chars — exceeds agentskills.io spec limit of ${NAME_MAX_LENGTH}`,
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
      // `fm.name` is only CONTROL_CHAR_RE-stripped (by parseFrontmatter) — it
      // can still carry a raw `\n`/`\r` (CONTROL_CHAR_RE excludes those), so
      // this still needs stripForDisplay() below (CWE-117, skills#648).
      violations.push({
        severity: "error",
        rule: "name-invalid-format",
        message: `name "${stripForDisplay(fm.name)}" (shown stripped) contains control or invisible characters — C0/DEL, bidi control, or zero-width — which are not lowercase alnum + hyphens`,
      });
    } else if (!NAME_PATTERN.test(fm.name)) {
      // `fm.name` reaches here strip-identical to `rawName` under
      // CONTROL_CHAR_RE, but a bare `\n`/`\r` fails NAME_PATTERN too (it's
      // outside the allowed charset) without tripping the branch above —
      // stripForDisplay() below closes that gap (CWE-117, skills#648).
      violations.push({
        severity: "error",
        rule: "name-invalid-format",
        message: `name "${stripForDisplay(fm.name)}" does not match required pattern: lowercase alnum + hyphens, no leading/trailing hyphens`,
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
      // Both sides need stripForDisplay(), not just CONTROL_CHAR_RE: `fm.name`
      // can still carry a raw `\n`/`\r` (see above), and POSIX directory
      // basenames are unrestricted beyond NUL/`/`, so `parentDirName` could
      // too (CWE-117, skills#648).
      violations.push({
        severity: "error",
        rule: "name-dir-mismatch",
        message: `name "${stripForDisplay(fm.name)}" does not match parent directory "${stripForDisplay(parentDirName)}"`,
      });
    }
  }

  // Presence is judged on the STRIPPED view (a value made only of invisible
  // code points is an empty description, not a one-character one), but every
  // length cap below is measured on the RAW value: the strip shortens what it
  // touches, so counting the normalized form under-reports and lets a
  // description padded past the spec limit with zero-width characters lint
  // clean (skills#600 review). Only the counts reach the messages, never the
  // values, so no CWE-150 sink is opened by reading raw here.
  if (!fm.description) {
    violations.push({
      severity: "error",
      rule: "missing-required-field",
      message: "Missing required frontmatter field: description",
    });
  } else if (raw.description.length > DESCRIPTION_MAX_LENGTH) {
    violations.push({
      severity: "error",
      rule: "description-too-long",
      message: `description is ${raw.description.length} chars — exceeds agentskills.io spec limit of ${DESCRIPTION_MAX_LENGTH}`,
    });
  }

  if (fm.compatibility && raw.compatibility.length > COMPATIBILITY_MAX_LENGTH) {
    violations.push({
      severity: "error",
      rule: "compatibility-too-long",
      message: `compatibility is ${raw.compatibility.length} chars — exceeds agentskills.io spec limit of ${COMPATIBILITY_MAX_LENGTH}`,
    });
  }

  // Both read RAW — see checkModelField/checkEffortField. The `raw.model`
  // guard matters too: a `model:` whose value is nothing but invisible code
  // points strips to "", which the stripped view would skip entirely instead
  // of rejecting as a non-alias.
  if (raw.model) {
    violations.push(...checkModelField(raw.model));
  }

  violations.push(...checkEffortField(raw.effort));

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
      // `DEFAULT_SKILLS_DIR` is a module constant, but `err.message` is not:
      // discoverSkillFiles() resolve()s it against cwd, so the ENOENT text
      // embeds the ABSOLUTE path — and a checkout directory (or any ancestor)
      // may itself carry a raw `\n`, since a POSIX path component is
      // unrestricted beyond NUL/`/`. That reaches errLog(), which
      // pre-commit-gate.yml streams into the job log. Same CWE-117 strip as the
      // per-file `rel` echo below (skills#648); the scan itself still ran on the
      // RAW path.
      errLog(
        `Error: cannot scan skills directory '${DEFAULT_SKILLS_DIR}': ${stripForDisplay(err.message)}`,
      );
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
    // (skills#495). A POSIX filename is unrestricted beyond NUL/`/`, so it
    // can carry a raw `\n` too — stripForDisplay() closes that CWE-117 gap
    // (skills#648) the same way it does for frontmatter values above.
    const rel = stripForDisplay(relative(process.cwd(), filePath));
    let violations;
    try {
      violations = validateSkill(filePath);
    } catch (err) {
      // Node's fs error messages (ENOENT, EACCES, EISDIR, ...) embed the
      // offending path verbatim — the same attacker-influenceable path this
      // file's CONTROL_CHAR_RE guard exists for, reachable through a third
      // call site the rel/parentDirName fix above didn't cover (skills#495
      // deep-review follow-up; stripForDisplay() applied here too as of
      // skills#648).
      violations = [{
        severity: "error",
        rule: "file-unreadable",
        message: `Could not read SKILL.md file: ${stripForDisplay(err.message)}`,
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
