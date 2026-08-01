#!/usr/bin/env node
// evolution_candidates.mjs — per-session evolution-candidate accumulator for
// iEvo auto-evolution mode (see /ievo:evo-auto-enable, /ievo:evo-auto-disable).
//
// Auto-evolution's correction-capture hook (a UserPromptSubmit nudge, wired by
// evo-auto-enable) asks the agent to self-judge "was that a correction?" and, if
// so, record it verbatim by calling this script's `append` command. The
// SessionStart analysis nudge calls `count` (to decide whether to surface the
// backlog) and `prune` (retention). The analysis itself runs through the normal
// /ievo:evo flow at the next session — this script only ACCUMULATES; it
// never classifies scope or writes overlays (per #293 Q3: no LLM work at
// teardown, analyze at next SessionStart).
//
// Storage: one JSONL file per session under
//   <project>/.ievo/evolution-candidates/<session-id>.jsonl
// each line: {"ts":"<ISO-8601 UTC>","scope":"<scope>","text":"<correction>"}.
// The human-review queue `pending.md` (scaffolded by evo-auto-enable) is a
// SEPARATE, .md file and is never touched here (the `.jsonl` filter excludes it).
//
// Retention (per #293 Q4): keep the last 10 sessions; `prune` removes older
// per-session files. Dedup: an identical (scope, text) candidate is not appended
// twice within the same session.
//
// Stdlib only (Node 18+, bundled with Claude Code / Codex) — no dependencies.
//
// Usage:
//   node evolution_candidates.mjs append --session <id> (--text "<correction>" | --text-file <path>) \
//        [--scope <scope>] [--project <root>] [--ts <iso>]
//   node evolution_candidates.mjs count  [--project <root>]
//   node evolution_candidates.mjs list   [--project <root>]
//   node evolution_candidates.mjs prune  [--keep N] [--project <root>]
//   node evolution_candidates.mjs --version | --help
//
// --text-file <path> reads the correction from disk instead of argv (added
// v0.51.2, closes #373): the correction-capture hook now has the agent write
// free-form correction text to a file via the Write tool, then invoke this
// script with a fixed --text-file path — never interpolating the text itself
// into a Bash argument, which was exploitable as CWE-78 shell injection when
// the correction contained an unescaped quote or shell metacharacter.
// --text-file takes precedence when both --text and --text-file are given.
//
// --text-file is untrusted input (added v0.75.11, closes #523): the path can
// be influenced by a compromised or prompt-injected agent turn issuing a
// different --text-file value directly via Bash, so it is treated the same
// as any other attacker-influenced filesystem input this plugin reads —
// contained to the project's own .ievo/ directory, both lexically up front
// (assertTextFileAllowed, mirrors scan_repo.mjs's assertContained()) and
// again by realpath once the target is known to exist (assertTextFileReadable,
// mirrors scan_repo.mjs's assertCheckoutContained() — closes the gap a
// lexical-only check leaves open when an ancestor directory under .ievo/ is
// itself a symlink), required to be a regular file under a size cap
// (assertTextFileReadable, mirrors scan_repo.mjs's MAX_SCAN_FILE_BYTES/
// isOversized()), and run through scrub.mjs's scrub() before it is trimmed
// and persisted — giving --text-file the same redaction guarantee the
// failure-capture hook already applies externally before writing its own
// --text-file.
//
// scrub() is NOT redaction-only, so this changes what a captured correction
// looks like on disk (corrections were persisted verbatim before v0.75.11):
// after redacting, scrub() also rewrites $HOME-absolute paths to ~-relative
// ones and caps the result at scrub.mjs's MAX_CODEPOINTS (500 Unicode code
// points) with a "…[truncated]" marker. Accepted deliberately rather than
// cherry-picking only the redaction stages: capture parity with the
// failure-capture path (which has always applied the whole transform) is the
// point, a correction worth reviewing is a sentence or two rather than 500+
// code points, and a ~-relative path is the more useful form in a review
// queue anyway. Pinned by tests so a later scrub.mjs change can't move this
// silently. The --text (argv) path is untouched: no production caller
// uses it today, and any future one is expected to redact upstream, same as
// already documented above.

import { readFileSync, appendFileSync, mkdirSync, readdirSync, unlinkSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { scrub } from "./scrub.mjs";

// SCRIPT_VERSION is coupled to plugin.json (asserted in the test) — the same
// drift guard discover.mjs uses. Bump both in the same PR.
export const SCRIPT_VERSION = "0.76.5";
export const IEVO_DIR = ".ievo";
export const CANDIDATES_DIR = "evolution-candidates";
export const SESSION_EXT = ".jsonl";
export const DEFAULT_RETENTION = 10;
// Capture is scope-agnostic: classification is deferred to the next-session
// analysis pass, so freshly captured candidates carry this placeholder scope.
export const DEFAULT_SCOPE = "unclassified";

const HELP_TEXT = `evolution_candidates.mjs — iEvo auto-evolution candidate accumulator
Usage:
  append --session <id> (--text "<correction>" | --text-file <path>) [--scope <scope>] [--project <root>] [--ts <iso>]
  count  [--project <root>]
  list   [--project <root>]
  prune  [--keep N] [--project <root>]
  --version
  --help

Notes:
  --text-file <path> is untrusted input: it must be an existing regular file
  inside <project root>/.ievo/ and under a fixed size cap — any other path is
  rejected rather than read. Its content is scrubbed before it is persisted:
  secrets redacted, $HOME-absolute paths rewritten to ~-relative ones, and
  over-long text truncated.`;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function candidatesDir(projectRoot = ".") {
  return join(projectRoot, IEVO_DIR, CANDIDATES_DIR);
}

// Session ids come from the host agent (a UUID in practice), but treat them as
// untrusted: strip anything outside a safe filename charset so a crafted id can
// never escape the candidates dir. Require at least one alphanumeric so a
// pathological id (empty / only separators) fails loudly instead of writing to
// a surprising filename.
export function sanitizeSessionId(id) {
  const s = String(id).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!/[A-Za-z0-9]/.test(s)) {
    throw new Error(`invalid session id '${id}' — needs at least one alphanumeric character`);
  }
  return s;
}

export function sessionFilePath(projectRoot, sessionId) {
  return join(candidatesDir(projectRoot), `${sanitizeSessionId(sessionId)}${SESSION_EXT}`);
}

// ---------------------------------------------------------------------------
// Read / parse
// ---------------------------------------------------------------------------

// Tolerant JSONL parse: skip blank and unparseable lines (a crashed session may
// leave a half-written final line), and drop records without a non-empty string
// `text` — those are malformed candidates, not something to surface for review.
export function parseCandidates(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (obj && typeof obj === "object" && typeof obj.text === "string" && obj.text.length > 0) {
      out.push(obj);
    }
  }
  return out;
}

// Latest ISO-8601 UTC timestamp among candidates ("" if none). ISO-8601 UTC
// strings sort lexically in chronological order, so a plain string compare is a
// correct recency key — used to order sessions for retention.
export function latestTimestamp(candidates) {
  let latest = "";
  for (const c of candidates) {
    if (typeof c.ts === "string" && c.ts > latest) latest = c.ts;
  }
  return latest;
}

export function readSessionCandidates(filePath, readImpl = readFileSync) {
  let text;
  try {
    text = readImpl(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return parseCandidates(text);
}

// ---------------------------------------------------------------------------
// --text-file containment + size cap (#523)
// ---------------------------------------------------------------------------

function ievoRoot(projectRoot) {
  return resolve(projectRoot, IEVO_DIR);
}

// Throws if `target` would resolve outside `allowedDir` — shared by the
// lexical pre-check (assertTextFileAllowed, below) and the realpath re-check
// (assertTextFileReadable, below). Mirrors scan_repo.mjs's assertContained().
function assertContainedIn(target, allowedDir) {
  if (target !== allowedDir && !target.startsWith(allowedDir + sep)) {
    throw new Error(`must be inside ${allowedDir}`);
  }
}

// Throws if `textFile` would resolve outside <projectRoot>/.ievo/ — the
// project's own scratch directory both hook callers already write their
// fixed pending-file paths under (.ievo/hooks/tmp/correction-pending.txt,
// .ievo/hooks/tmp/failure-pending.txt). The first line of defense against a
// compromised/prompt-injected agent turn passing an arbitrary path (e.g.
// ~/.aws/credentials, ~/.netrc, a project .env) directly via Bash — purely
// lexical (no filesystem access), so it rejects an out-of-bounds path even
// before anything on disk is touched. Returns the resolved absolute path so
// the caller reads the exact path that was just validated. NOT sufficient on
// its own against a symlinked ancestor directory — see assertTextFileReadable's
// realpath re-check below.
export function assertTextFileAllowed(textFile, projectRoot) {
  const resolvedTarget = resolve(textFile);
  assertContainedIn(resolvedTarget, ievoRoot(projectRoot));
  return resolvedTarget;
}

// Frontmatter/manifest files elsewhere in this plugin cap reads at 256 KB
// (scan_repo.mjs's MAX_SCAN_FILE_BYTES) — a captured correction/failure
// record is free-form agent-authored text and is never legitimately anywhere
// near that.
export const MAX_TEXT_FILE_BYTES = 256 * 1024;

// lstat (not stat/readFileSync) so a symlink AT THE LEAF is judged on its own
// type without following it — a symlink planted directly at the --text-file
// path would otherwise be followed straight through to its real target by a
// plain readFileSync (CWE-59). Throws (rather than returning a boolean) since
// an unreadable/oversized/non-regular --text-file must abort the append, not
// silently degrade like scan_repo.mjs's optional-entry skips.
//
// lstat's non-follow behavior applies only to the path's FINAL component —
// every ANCESTOR directory component is still resolved normally, so a
// symlinked ancestor (e.g. `.ievo/link -> ~/.aws`, then --text-file
// `.ievo/link/credentials`) passes assertTextFileAllowed's lexical check
// (the string is inside .ievo/) and then lstats/reads straight through to the
// real target anyway — the same class of gap scan_repo.mjs's
// assertCheckoutContained() closes for its own ancestor-symlink concern
// (found in review). Re-verify containment against the REALPATH of both
// sides after the type/size checks succeed (only then do we know the path —
// and therefore every ancestor in it — actually exists to realpath).
export function assertTextFileReadable(
  resolvedPath,
  projectRoot,
  capBytes = MAX_TEXT_FILE_BYTES,
  statImpl = lstatSync,
  realpathImpl = realpathSync,
) {
  const st = statImpl(resolvedPath);
  if (!st.isFile()) {
    throw new Error("not a regular file");
  }
  if (st.size > capBytes) {
    throw new Error(`exceeds ${capBytes} bytes`);
  }
  assertContainedIn(realpathImpl(resolvedPath), realpathImpl(ievoRoot(projectRoot)));
}

// ---------------------------------------------------------------------------
// Append (dedup within session)
// ---------------------------------------------------------------------------

export function appendCandidate(
  { projectRoot = ".", sessionId, text, textFile, scope = DEFAULT_SCOPE, ts } = {},
  deps = {},
) {
  const {
    mkdir = mkdirSync,
    appendFile = appendFileSync,
    readImpl = readFileSync,
    statImpl = lstatSync,
    realpathImpl = realpathSync,
    now = () => new Date().toISOString(),
  } = deps;

  // --text-file takes precedence: read the correction from disk instead of
  // trusting a caller-supplied `text` string, so the correction-capture hook
  // never has to interpolate free-form user text into a Bash argument. The
  // path itself is untrusted too (see the header comment and #523) — contain
  // it to .ievo/, require a regular file under the size cap, then scrub()
  // before trim/persist, same redaction guarantee the failure-capture hook
  // already gets externally — and, since scrub() is not redaction-only, the
  // same $HOME-path rewriting and 500-code-point truncation too (see the
  // header note: this is why a --text-file correction is no longer persisted
  // verbatim).
  // Known residual risk (found by /ievo:vuln-scan on this diff): the
  // assertTextFileReadable check and this read are separate syscalls on the
  // same path, so there is a narrow TOCTOU window in which a file that passed
  // containment/type/size could be swapped for a symlink before it is read.
  // Exploiting it needs an attacker who can already run a concurrent local
  // process racing the filesystem against this single-threaded CLI — at that
  // capability level, simpler direct-read exfiltration paths already exist,
  // and this mirrors an already-accepted pattern elsewhere in this plugin
  // (scan_repo.mjs's isOversized() followed by a separate readFileSync()).
  // Closing it fully would mean re-reading through a single fd (open with
  // O_NOFOLLOW, fstat, read, close) instead of three path-resolving calls — a
  // larger architectural change deferred as out of scope for #523.
  let resolvedText = text;
  if (textFile != null) {
    try {
      const allowedPath = assertTextFileAllowed(textFile, projectRoot);
      assertTextFileReadable(allowedPath, projectRoot, MAX_TEXT_FILE_BYTES, statImpl, realpathImpl);
      resolvedText = scrub(readImpl(allowedPath, "utf-8"));
    } catch (err) {
      throw new Error(`could not read --text-file '${textFile}': ${err.message}`);
    }
  }

  if (typeof resolvedText !== "string" || resolvedText.trim().length === 0) {
    throw new Error("append requires a non-empty --text or --text-file");
  }
  const cleanText = resolvedText.trim();
  // sessionFilePath throws on an unusable session id — surfaced by the caller.
  const filePath = sessionFilePath(projectRoot, sessionId);

  const existing = readSessionCandidates(filePath, readImpl);
  if (existing.some((c) => c.text === cleanText && (c.scope ?? DEFAULT_SCOPE) === scope)) {
    return { written: false, reason: "duplicate", filePath };
  }

  const record = { ts: ts ?? now(), scope, text: cleanText };
  mkdir(dirname(filePath), { recursive: true });
  appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
  return { written: true, filePath, record };
}

// ---------------------------------------------------------------------------
// List / count / prune
// ---------------------------------------------------------------------------

export function listSessions(projectRoot = ".", deps = {}) {
  const { readdir = readdirSync, readImpl = readFileSync } = deps;
  const dir = candidatesDir(projectRoot);
  let entries;
  try {
    entries = readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const sessions = [];
  for (const name of entries) {
    // Only per-session accumulator files — never pending.md or other artefacts.
    if (!name.endsWith(SESSION_EXT)) continue;
    const filePath = join(dir, name);
    const candidates = readSessionCandidates(filePath, readImpl);
    sessions.push({
      sessionId: name.slice(0, -SESSION_EXT.length),
      filePath,
      candidates,
      latestTs: latestTimestamp(candidates),
    });
  }
  return sessions;
}

export function countPending(projectRoot = ".", deps = {}) {
  return listSessions(projectRoot, deps).reduce((n, s) => n + s.candidates.length, 0);
}

export function pruneSessions(projectRoot = ".", keep = DEFAULT_RETENTION, deps = {}) {
  const { unlink = unlinkSync } = deps;
  const sessions = listSessions(projectRoot, deps);
  // Most-recent first (latest candidate ts desc; tiebreak sessionId desc for a
  // deterministic order when two sessions share a timestamp). Keep the first
  // `keep`, remove the rest.
  const ordered = [...sessions].sort((a, b) => {
    if (a.latestTs !== b.latestTs) return a.latestTs < b.latestTs ? 1 : -1;
    return a.sessionId < b.sessionId ? 1 : -1;
  });
  const removed = [];
  for (const s of ordered.slice(keep)) {
    unlink(s.filePath);
    removed.push(s.filePath);
  }
  return { kept: Math.min(ordered.length, keep), removed };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireValue(argv, i, flag) {
  const v = argv[i];
  if (v === undefined) throw new Error(`${flag} requires a value, got end of arguments`);
  if (v.startsWith("--")) throw new Error(`${flag} requires a value, got flag '${v}'`);
  return v;
}

function parseCount(value, flag) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${flag} requires a non-negative integer, got '${value}'`);
  }
  return n;
}

export function parseArgs(argv) {
  const args = {
    command: null,
    session: null,
    text: null,
    textFile: null,
    scope: DEFAULT_SCOPE,
    project: ".",
    keep: DEFAULT_RETENTION,
    ts: null,
  };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") args.session = requireValue(argv, ++i, "--session");
    else if (a === "--text") args.text = requireValue(argv, ++i, "--text");
    else if (a === "--text-file") args.textFile = requireValue(argv, ++i, "--text-file");
    else if (a === "--scope") args.scope = requireValue(argv, ++i, "--scope");
    else if (a === "--project") args.project = requireValue(argv, ++i, "--project");
    else if (a === "--ts") args.ts = requireValue(argv, ++i, "--ts");
    else if (a === "--keep") args.keep = parseCount(requireValue(argv, ++i, "--keep"), "--keep");
    else if (a.startsWith("--")) throw new Error(`unknown flag '${a}'`);
    else positional.push(a);
  }
  args.command = positional[0] ?? null;
  return args;
}

export function main(argv = process.argv, io = {}) {
  const { log = console.log, errLog = console.error, exit = process.exit, deps = {} } = io;

  if (argv.includes("--version")) {
    log(SCRIPT_VERSION);
    return exit(0);
  }
  if (argv.includes("--help")) {
    log(HELP_TEXT);
    return exit(0);
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    errLog(`Error: ${err.message}`);
    return exit(2);
  }

  try {
    switch (args.command) {
      case "append": {
        const result = appendCandidate(
          {
            projectRoot: args.project,
            sessionId: args.session,
            text: args.text,
            textFile: args.textFile,
            scope: args.scope,
            ts: args.ts ?? undefined,
          },
          deps,
        );
        log(JSON.stringify(result));
        return exit(0);
      }
      case "count": {
        log(String(countPending(args.project, deps)));
        return exit(0);
      }
      case "list": {
        log(JSON.stringify(listSessions(args.project, deps)));
        return exit(0);
      }
      case "prune": {
        const result = pruneSessions(args.project, args.keep, deps);
        log(JSON.stringify(result));
        return exit(0);
      }
      default:
        errLog(`Error: unknown or missing command '${args.command ?? ""}' — use: append | count | list | prune (or --help)`);
        return exit(2);
    }
  } catch (err) {
    errLog(`Error: ${err.message}`);
    return exit(3);
  }
}

export function mainSafe(argv = process.argv, io = {}) {
  try {
    return main(argv, io);
  } catch (err) {
    const errLog = io.errLog ?? console.error;
    const exit = io.exit ?? process.exit;
    errLog(`fatal: ${err.message}`);
    return exit(2);
  }
}

// Pure entry-guard predicate — extracted so the `argv[1] ?? ""` fallback branch
// is reachable from tests (mirrors discover.mjs). Normalises both sides:
// process.argv[1] may be relative while import.meta.url is always absolute.
export function isCliEntry(metaUrl, argv) {
  return fileURLToPath(metaUrl) === resolve(argv[1] ?? "");
}

if (isCliEntry(import.meta.url, process.argv)) {
  mainSafe();
}
