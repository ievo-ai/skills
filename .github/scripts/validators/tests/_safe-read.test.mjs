import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  safeReadFileSync,
  sanitizeForLog,
  SymlinkRejectedError,
  SizeExceededError,
  MAX_SAFE_READ_FILE_BYTES,
} from "../_safe-read.mjs";

// Imported to mechanically assert the superset relationship sanitizeForLog's
// own comment claims (skills#600 review) -- both modules guard their CLI entry
// with isCliEntry(), so importing them here runs no validator.
import { CONTROL_CHAR_RE as SKILLS_CONTROL_CHAR_RE } from "../../../../plugins/ievo/scripts/validate_skills.mjs";
import { CONTROL_CHAR_RE as AGENTS_CONTROL_CHAR_RE } from "../../../../plugins/ievo/scripts/validate_agents.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, "tmp-safe-read-test");

describe("safeReadFileSync", () => {
  before(() => {
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it("reads a regular file's content", () => {
    const f = resolve(TMP, "regular.txt");
    writeFileSync(f, "hello world");
    assert.equal(safeReadFileSync(f, "utf-8"), "hello world");
  });

  it("returns a Buffer when no encoding is given", () => {
    const f = resolve(TMP, "regular-buf.txt");
    writeFileSync(f, "hello world");
    const buf = safeReadFileSync(f);
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString("utf-8"), "hello world");
  });

  it("rejects a symlink without reading the target", () => {
    const target = resolve(TMP, "secret.txt");
    writeFileSync(target, "sensitive content");
    const link = resolve(TMP, "link.txt");
    symlinkSync(target, link);

    assert.throws(() => safeReadFileSync(link, "utf-8"), SymlinkRejectedError);
  });

  it("rejects a symlink pointing at a nonexistent target (dangling)", () => {
    const link = resolve(TMP, "dangling.txt");
    symlinkSync(resolve(TMP, "does-not-exist.txt"), link);

    assert.throws(() => safeReadFileSync(link, "utf-8"), SymlinkRejectedError);
  });

  it("propagates ENOENT for a nonexistent path (no regression vs. readFileSync)", () => {
    assert.throws(
      () => safeReadFileSync(resolve(TMP, "missing.txt"), "utf-8"),
      (err) => err.code === "ENOENT"
    );
  });

  it("SymlinkRejectedError carries a descriptive message and stable code", () => {
    const link = resolve(TMP, "link2.txt");
    symlinkSync(resolve(TMP, "whatever.txt"), link);
    try {
      safeReadFileSync(link, "utf-8");
      assert.fail("expected safeReadFileSync to throw");
    } catch (err) {
      assert.ok(err instanceof SymlinkRejectedError);
      assert.equal(err.code, "ESYMLINK");
      assert.match(err.message, /symlink/);
      assert.match(err.message, /link2\.txt/);
    }
  });

  it("rejects a directory with an accurate (non-symlink) message", () => {
    const dir = resolve(TMP, "a-directory");
    mkdirSync(dir, { recursive: true });
    try {
      safeReadFileSync(dir, "utf-8");
      assert.fail("expected safeReadFileSync to throw");
    } catch (err) {
      assert.ok(err instanceof SymlinkRejectedError);
      assert.equal(err.code, "ESYMLINK");
      // A directory is not a symlink — the message must not misreport it as one.
      assert.match(err.message, /not a regular file/);
      assert.doesNotMatch(err.message, /is a symlink/);
    }
  });

  it("reads a file exactly at the size cap", () => {
    const f = resolve(TMP, "at-cap.txt");
    writeFileSync(f, Buffer.alloc(MAX_SAFE_READ_FILE_BYTES, "a"));
    const content = safeReadFileSync(f, "utf-8");
    assert.equal(content.length, MAX_SAFE_READ_FILE_BYTES);
  });

  it("rejects a file one byte over the size cap without buffering it", () => {
    const f = resolve(TMP, "over-cap.txt");
    writeFileSync(f, Buffer.alloc(MAX_SAFE_READ_FILE_BYTES + 1, "a"));
    assert.throws(() => safeReadFileSync(f, "utf-8"), SizeExceededError);
  });

  it("SizeExceededError carries a descriptive message and stable code", () => {
    const f = resolve(TMP, "over-cap-2.txt");
    const size = MAX_SAFE_READ_FILE_BYTES + 5;
    writeFileSync(f, Buffer.alloc(size, "a"));
    try {
      safeReadFileSync(f, "utf-8");
      assert.fail("expected safeReadFileSync to throw");
    } catch (err) {
      assert.ok(err instanceof SizeExceededError);
      assert.equal(err.code, "EFBIG");
      assert.match(err.message, /over-cap-2\.txt/);
      assert.match(err.message, new RegExp(String(size)));
      assert.match(err.message, /10 MB/);
    }
  });
});

describe("sanitizeForLog", () => {
  it("strips ESC (terminal SGR/cursor-control) sequences", () => {
    const evil = "before" + String.fromCharCode(0x1b) + "[31mRED" + String.fromCharCode(0x1b) + "[0m";
    assert.equal(sanitizeForLog(evil), "before[31mRED[0m");
  });

  it("strips bare CR (cursor-return log spoofing)", () => {
    const evil = "before" + String.fromCharCode(0x0d) + "after";
    assert.equal(sanitizeForLog(evil), "beforeafter");
  });

  it("strips the Unicode line-separator trio (U+2028, U+2029, U+0085)", () => {
    for (const cp of [0x2028, 0x2029, 0x85]) {
      const evil = "before" + String.fromCharCode(cp) + "after";
      assert.equal(sanitizeForLog(evil), "beforeafter", `code point 0x${cp.toString(16)}`);
    }
  });

  it("strips other C0 control bytes and DEL", () => {
    const evil = "bell" + String.fromCharCode(0x07) + "backspace" + String.fromCharCode(0x08) + "del" + String.fromCharCode(0x7f);
    assert.equal(sanitizeForLog(evil), "bellbackspacedel");
  });

  it("strips every Bidi_Control character (Trojan-Source log spoof, skills#600)", () => {
    assert.equal(sanitizeForLog(`evil\u202edesrever`), "evildesrever");
    assert.equal(sanitizeForLog(`a\u2066b\u2069c`), "abc");
    // A raw terminal is where RLO actually re-orders the line, so this sink
    // needs the whole Bidi_Control set -- U+061C, U+200E-U+200F, U+202A-U+202E,
    // U+2066-U+2069 -- not just the ASCII controls it started with. Assert each
    // one so a narrowing of the class is caught.
    for (const cp of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      const label = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.equal(sanitizeForLog(`a${String.fromCodePoint(cp)}b`), "ab", `expected ${label} to be stripped`);
    }
  });

  it("strips zero-width characters incl. BOM (Trojan-Source log spoof, skills#600)", () => {
    assert.equal(sanitizeForLog(`zero\u200bwidth`), "zerowidth");
    assert.equal(sanitizeForLog(`joi\u200dner`), "joiner");
    assert.equal(sanitizeForLog(`bom\ufeffchar`), "bomchar");
  });

  it("does not strip Unicode characters just outside the bidi/zero-width ranges", () => {
    // Boundaries either side of every added range. Unlike escapeMdCell, this
    // sink does no `\s+` collapse, so the Unicode spaces neighbouring the
    // ranges (U+200A, U+202F, U+205F) must survive verbatim too.
    for (const cp of [0x061b, 0x061d, 0x200a, 0x2010, 0x202f, 0x205f, 0x206a, 0xfefe, 0xff00]) {
      const ch = String.fromCodePoint(cp);
      const label = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      assert.equal(sanitizeForLog(`a${ch}b`), `a${ch}b`, `expected ${label} to be preserved`);
    }
  });

  it("strips a strict superset of validate_skills/validate_agents' CONTROL_CHAR_RE", () => {
    // The comment above LOG_UNSAFE_RE claims superset, not divergence. That
    // claim silently went stale once before (their class was widened for
    // skills#600, this one was not), so assert it mechanically rather than in
    // prose: every BMP code point either validator strips must vanish here too.
    for (const [name, re] of [
      ["validate_skills.mjs", SKILLS_CONTROL_CHAR_RE],
      ["validate_agents.mjs", AGENTS_CONTROL_CHAR_RE],
    ]) {
      for (let cp = 0; cp <= 0xffff; cp++) {
        const ch = String.fromCodePoint(cp);
        // String.replace resets lastIndex on a /g regex, so reusing the
        // imported pattern across iterations is safe.
        if (ch.replace(re, "") !== "") continue;
        const label = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
        assert.equal(sanitizeForLog(ch), "", `${name} strips ${label} but sanitizeForLog does not`);
      }
    }
  });

  it("preserves tab and newline so ordinary multi-line messages read naturally", () => {
    const benign = "line 1: a\tb\nline 2: c";
    assert.equal(sanitizeForLog(benign), benign);
  });

  it("preserves ordinary printable content unchanged", () => {
    const benign = "plugins/ievo/skills/init/SKILL.md:42: some ordinary message";
    assert.equal(sanitizeForLog(benign), benign);
  });

  it("coerces a non-string argument via String()", () => {
    assert.equal(sanitizeForLog(42), "42");
  });
});

// ── CLI regression: each validator refuses a symlinked argument ──────────
//
// One end-to-end check per validator confirming the CLI (not just the unit
// function) rejects a symlink instead of following it into its target's
// content — the actual attack surface described in #364.

describe("validators refuse symlinked CLI arguments", () => {
  const VALIDATORS_DIR = resolve(__dirname, "..");
  const VALIDATORS = [
    "nested-fences.mjs",
    "crlf-frontmatter.mjs",
    "machine-local-paths.mjs",
    "placeholder-leakage.mjs",
    "utf8-validate.mjs",
    "yaml-frontmatter.mjs",
  ];

  before(() => {
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  for (const validator of VALIDATORS) {
    it(`${validator} exits non-zero and never echoes the target's content`, () => {
      const target = resolve(TMP, `secret-${validator}.txt`);
      writeFileSync(target, "TOP-SECRET-MARKER-DO-NOT-LEAK");
      const link = resolve(TMP, `evil-${validator}.md`);
      symlinkSync(target, link);

      const r = spawnSync(process.execPath, [resolve(VALIDATORS_DIR, validator), link], {
        encoding: "utf-8",
      });

      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /symlink/);
      assert.doesNotMatch(r.stdout + r.stderr, /TOP-SECRET-MARKER-DO-NOT-LEAK/);
    });
  }
});

// ── CLI regression: each validator refuses an oversized CLI argument ─────
//
// One end-to-end check per validator confirming the CLI rejects a file over
// MAX_SAFE_READ_FILE_BYTES via the stat-derived size check, instead of
// buffering the whole thing into memory (CWE-770).

describe("validators refuse oversized CLI arguments", () => {
  const VALIDATORS_DIR = resolve(__dirname, "..");
  const VALIDATORS = [
    "nested-fences.mjs",
    "crlf-frontmatter.mjs",
    "machine-local-paths.mjs",
    "placeholder-leakage.mjs",
    "utf8-validate.mjs",
    "yaml-frontmatter.mjs",
  ];

  before(() => {
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  for (const validator of VALIDATORS) {
    it(`${validator} exits non-zero on a file over the size cap`, () => {
      const oversized = resolve(TMP, `oversized-${validator}.md`);
      writeFileSync(oversized, Buffer.alloc(MAX_SAFE_READ_FILE_BYTES + 1, "a"));

      const r = spawnSync(process.execPath, [resolve(VALIDATORS_DIR, validator), oversized], {
        encoding: "utf-8",
      });

      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /exceeding/);
    });
  }
});

// ── CLI regression: each validator strips control chars from an ─────────
// attacker-controlled path before it reaches stderr (CWE-150)
//
// A committed filename is exactly as attacker-controlled as file content —
// git/actions/checkout permit any byte but NUL and '/' in a path component.
// A symlinked argument whose OWN filename carries an ESC byte exercises the
// full sink: safeReadFileSync's SymlinkRejectedError embeds `path` in its
// message, and the calling validator's `${path}: cannot read (...)` line
// must come out through sanitizeForLog with the ESC byte gone.

describe("validators strip control characters from attacker-controlled paths", () => {
  const VALIDATORS_DIR = resolve(__dirname, "..");
  const VALIDATORS = [
    "nested-fences.mjs",
    "crlf-frontmatter.mjs",
    "machine-local-paths.mjs",
    "placeholder-leakage.mjs",
    "utf8-validate.mjs",
    "yaml-frontmatter.mjs",
  ];

  before(() => {
    mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  for (const validator of VALIDATORS) {
    it(`${validator} never echoes a raw ESC byte or bidi-override from a crafted path`, () => {
      const target = resolve(TMP, `secret-ctl-${validator}.txt`);
      writeFileSync(target, "irrelevant");
      const evilName =
        "evil-" + String.fromCharCode(0x1b) + "[31m-\u202edm.-" + validator + ".md";
      const link = resolve(TMP, evilName);
      symlinkSync(target, link);

      const r = spawnSync(process.execPath, [resolve(VALIDATORS_DIR, validator), link], {
        encoding: "utf-8",
      });

      assert.notEqual(r.status, 0);
      assert.doesNotMatch(r.stderr, new RegExp(String.fromCharCode(0x1b)));
      assert.doesNotMatch(r.stderr, /[\u202e]/);
    });
  }
});
