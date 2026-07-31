// _safe-read.mjs — symlink-safe, size-capped file read shared by the six
// pre-commit validators in this directory.
//
// Why (symlinks): readFileSync follows symlinks by default. actions/checkout
// (and git generally) materializes a committed symlink blob (mode 120000) as
// a real OS-level symlink, so a fork PR can commit a filename that matches a
// validator's `files:` regex and point it at an arbitrary path (/etc/passwd,
// .git/config, /proc/self/environ, a sibling checkout). Every validator here
// takes its paths straight from argv and had no preceding symlink check —
// see #364 (CWE-61).
//
// Guard: lstatSync the path first — lstat reports the entry's OWN type and
// never follows the final path component, so a symlink is judged as a
// symlink regardless of what it points to (or whether the target even
// exists). Reject anything that isn't a regular file *before* any read is
// attempted, so the target is never opened, stat'd-through, or otherwise
// touched — no existence/content oracle survives. Mirrors the lstatSync
// convention validate_agents.mjs / validate_skills.mjs already use for the
// same reason (see their isOversized()).
//
// Why (size): the same lstatSync call already reports `.size` at no extra
// cost, but until now nothing here checked it — readFileSync unconditionally
// buffered the whole file, and crlf-frontmatter.mjs / yaml-frontmatter.mjs
// additionally split it into a line array, doubling+ the live allocation. A
// fork PR committing one oversized file matching any validator's `files:`
// glob could OOM-kill the CI runner's Node process or a contributor's local
// `pre-commit run` (CWE-770). Reject before the read, mirroring the
// SymlinkRejectedError shape below.
//
// The cap is intentionally much larger than validate_agents.mjs /
// validate_skills.mjs's 256 KB MAX_VALIDATE_FILE_BYTES: those gate individual
// SKILL.md/agent files, but these six validators also run against repo-wide
// docs like CHANGELOG.md (already ~342 KB and append-only-growing) via a bare
// `\.md$` glob — a 256 KB cap here would reject legitimate content. 10 MB
// bounds worst-case memory to a small, fixed multiple while staying far below
// the multi-GB range that actually risks an OOM-kill.
//
// Same signature and throw behaviour as node:fs readFileSync (options
// forwarded as-is, ENOENT/EACCES/etc. still propagate from the underlying
// lstat/read), so every call site swaps in as a 1:1 replacement — existing
// try/catch blocks around readFileSync need no changes.

import { lstatSync, readFileSync } from "node:fs";

export const MAX_SAFE_READ_FILE_BYTES = 10 * 1024 * 1024;

export class SymlinkRejectedError extends Error {
  constructor(path, st) {
    const reason = st.isSymbolicLink() ? "a symlink" : "not a regular file";
    super(`refusing to read '${path}': path is ${reason}`);
    this.name = "SymlinkRejectedError";
    this.code = "ESYMLINK";
  }
}

export class SizeExceededError extends Error {
  constructor(path, size, capBytes) {
    super(
      `refusing to read '${path}': file is ${size} bytes, exceeding the ${capBytes}-byte (${Math.floor(capBytes / 1024 / 1024)} MB) cap`,
    );
    this.name = "SizeExceededError";
    this.code = "EFBIG";
  }
}

export function safeReadFileSync(path, options) {
  const st = lstatSync(path);
  if (!st.isFile()) {
    throw new SymlinkRejectedError(path, st);
  }
  if (st.size > MAX_SAFE_READ_FILE_BYTES) {
    throw new SizeExceededError(path, st.size, MAX_SAFE_READ_FILE_BYTES);
  }
  return readFileSync(path, options);
}
