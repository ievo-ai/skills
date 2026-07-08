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
//   node evolution_candidates.mjs append --session <id> --text "<correction>" \
//        [--scope <scope>] [--project <root>] [--ts <iso>]
//   node evolution_candidates.mjs count  [--project <root>]
//   node evolution_candidates.mjs list   [--project <root>]
//   node evolution_candidates.mjs prune  [--keep N] [--project <root>]
//   node evolution_candidates.mjs --version | --help

import { readFileSync, appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SCRIPT_VERSION is coupled to plugin.json (asserted in the test) — the same
// drift guard discover.mjs uses. Bump both in the same PR.
export const SCRIPT_VERSION = "0.50.0";
export const IEVO_DIR = ".ievo";
export const CANDIDATES_DIR = "evolution-candidates";
export const SESSION_EXT = ".jsonl";
export const DEFAULT_RETENTION = 10;
// Capture is scope-agnostic: classification is deferred to the next-session
// analysis pass, so freshly captured candidates carry this placeholder scope.
export const DEFAULT_SCOPE = "unclassified";

const HELP_TEXT = `evolution_candidates.mjs — iEvo auto-evolution candidate accumulator
Usage:
  append --session <id> --text "<correction>" [--scope <scope>] [--project <root>] [--ts <iso>]
  count  [--project <root>]
  list   [--project <root>]
  prune  [--keep N] [--project <root>]
  --version
  --help`;

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
// Append (dedup within session)
// ---------------------------------------------------------------------------

export function appendCandidate(
  { projectRoot = ".", sessionId, text, scope = DEFAULT_SCOPE, ts } = {},
  deps = {},
) {
  const {
    mkdir = mkdirSync,
    appendFile = appendFileSync,
    readImpl = readFileSync,
    now = () => new Date().toISOString(),
  } = deps;

  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("append requires a non-empty --text");
  }
  const cleanText = text.trim();
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
