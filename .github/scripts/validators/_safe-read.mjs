// _safe-read.mjs — symlink-safe file read shared by the six pre-commit
// validators in this directory.
//
// Why: readFileSync follows symlinks by default. actions/checkout (and git
// generally) materializes a committed symlink blob (mode 120000) as a real
// OS-level symlink, so a fork PR can commit a filename that matches a
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
// Same signature and throw behaviour as node:fs readFileSync (options
// forwarded as-is, ENOENT/EACCES/etc. still propagate from the underlying
// lstat/read), so every call site swaps in as a 1:1 replacement — existing
// try/catch blocks around readFileSync need no changes.

import { lstatSync, readFileSync } from "node:fs";

export class SymlinkRejectedError extends Error {
  constructor(path, st) {
    const reason = st.isSymbolicLink() ? "a symlink" : "not a regular file";
    super(`refusing to read '${path}': path is ${reason}`);
    this.name = "SymlinkRejectedError";
    this.code = "ESYMLINK";
  }
}

export function safeReadFileSync(path, options) {
  const st = lstatSync(path);
  if (!st.isFile()) {
    throw new SymlinkRejectedError(path, st);
  }
  return readFileSync(path, options);
}
