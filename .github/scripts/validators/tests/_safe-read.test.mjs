import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { safeReadFileSync, SymlinkRejectedError } from "../_safe-read.mjs";

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
