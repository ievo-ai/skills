// Regression test for skills#446, skills#551, AND skills#552 (evo-auto-enable
// hook lifecycle).
//
// History, for a future reader wondering why this file looks the way it
// does:
//
// - skills#446: `/ievo:evo-auto-enable` wired committed `.claude/settings.json`
//   hook entries at paths that lived entirely under gitignored `.ievo/hooks/`
//   — a clean clone had the entries but not the scripts they pointed at, so
//   `sh .ievo/hooks/scripts/correction-capture.sh` exited 127 (and
//   `UserPromptSubmit` fires on every message, so the failure was not a
//   one-time cosmetic error). Fixed by committing a TINY, STATIC, tracked
//   dispatcher shim at each wired path that `exec`'d a gitignored
//   `*.local.sh` companion holding the real logic — the shim never 127'd
//   because it was always present in the clone, and the real logic stayed
//   gitignored (regenerated per clone by re-running the skill) so a PR to a
//   consumer project could never alter it.
// - skills#551: that fix could itself go silently missing end-to-end — a
//   hand-written `.ievo/evo-auto.flag`, or a fresh clone where the companion
//   was never regenerated, left the flag claiming ENABLED with the shim
//   present but no-oping (real logic lived only in the gitignored, never-
//   regenerated companion). Fixed by teaching the SessionStart shim to warn
//   when its own companion was missing, and by having the companion itself
//   assert the rest of the wiring (vendored copies, sibling companions, hook
//   entries in `.claude/settings.json`/`.codex/hooks.json`) every session,
//   not just at enable time.
// - skills#552 (the redesign this file now tests): the shim/companion/vendor
//   split is GONE. It bought PR-tamper-resistance for the real capture logic
//   at the cost of a structural drift window (every gap #551 had to detect
//   was a direct consequence of "the real logic lives somewhere gitignored,
//   possibly never regenerated"). This version accepts a different, explicit
//   tradeoff instead: the three hook scripts
//   (`correction-capture.sh`/`evo-analysis-nudge.sh`/`failure-capture.sh`)
//   and their two shared dependencies (`evolution_candidates.mjs`,
//   `scrub.mjs`) are now committed DIRECTLY, holding their full real logic —
//   copied verbatim from the plugin's own
//   `plugins/ievo/skills/evo-auto-enable/scripts/*.sh` and
//   `plugins/ievo/scripts/*.mjs` by evo-auto-enable/SKILL.md's Step 3.5.1.
//   No dispatcher, no companion, no vendor/ directory, no per-clone
//   regeneration step. A plain `git clone` gets working hooks immediately.
//   Trust ordinary code review over gitignore-enforced immutability — any
//   diff to `.ievo/hooks/scripts/*` in a consumer project is now a normal,
//   reviewable code change. The gitignore negation block widened from three
//   carved-out filenames (six lines) to five (eight lines) to match.
//
// What this file actually exercises, post-#552:
//
// - The two markdown-fence-extraction helpers the pre-#552 version of this
//   file needed (`extractFencedScript` for the three shim bodies,
//   `extractPlainFencedBlock` for the pending.md scaffold) are reduced to
//   one: the three hook scripts no longer live as fenced code blocks in
//   `evo-auto-enable/SKILL.md` at all (the SKILL.md text now POINTS at the
//   real files and describes their contract in prose) — this suite executes
//   the actual committed files under
//   `plugins/ievo/skills/evo-auto-enable/scripts/` directly via `spawnSync`,
//   never a copy or a literal re-typed into this file. The pending.md
//   scaffold fence is unrelated to the hook scripts and is untouched by
//   #552, so its extraction helper survives unchanged.
// - The gitignore-negation-pattern tests still prove real git behavior via a
//   scratch git repo (init → commit → clone) — now for five carved-out
//   filenames instead of three, since a directory-form `dir/` ignore cannot
//   be selectively un-ignored later, the exact trap the block has to avoid.
// - The scratch-git-repo "companions regenerated locally" describe from the
//   pre-#552 version is gone entirely — there is nothing left to regenerate.
// - The `evo-analysis-nudge.sh` wiring-integrity check (skills#551) is
//   simplified to match the real file: the file-presence half of the check
//   (vendored copies, sibling companions) no longer exists — git guarantees
//   every file this hook needs is on disk the moment `.claude/settings.json`
//   itself is — so only the hook-CONFIG-ENTRY half of the check survives,
//   and this suite's expectations are simplified to match.
// - NEW coverage that the pre-#552 file could not provide for real: direct
//   execution of `correction-capture.sh`'s CWE-78-safe session_id handling
//   and `failure-capture.sh`'s scrub-before-persist / fail-closed /
//   outcome-mapping contract. Before #552 that logic lived only in
//   gitignored `*.local.sh` companions this suite never generated (it used a
//   generic `realCompanion()` stand-in instead, to avoid re-testing logic
//   that lived only in prose); now it is real, committed, executable source,
//   so this suite exercises it directly.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The SKILL.md this file re-derives the gitignore-block invariant from. Read
// once, asserted against every literal below so a SKILL.md-side edit can
// never ship with this suite green.
const ENABLE_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/evo-auto-enable/SKILL.md",
);
const ENABLE_SKILL_SRC = readFileSync(ENABLE_SKILL, "utf-8");

// `/ievo:init` Step 10 writes the SAME gitignore block (skills#446, widened
// in skills#552): an init re-run must never re-add a blanket `.ievo/hooks/`
// line over the negations, so the skills have to agree byte-for-byte.
const INIT_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/init/SKILL.md",
);
const INIT_SKILL_SRC = readFileSync(INIT_SKILL, "utf-8");

// `/ievo:hooks-setup` Step 8 is the third writer of this block: it may run
// standalone in a project that never ran init. A blanket line appended there
// re-ignores the committed files just as effectively as one appended by
// init, so it is pinned the same way.
const HOOKS_SETUP_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/hooks-setup/SKILL.md",
);
const HOOKS_SETUP_SKILL_SRC = readFileSync(HOOKS_SETUP_SKILL, "utf-8");

// The real, committed hook scripts this suite executes directly — never a
// literal re-typed into this file, never a markdown-fence extraction (the
// fences these used to live in are gone as of #552; the SKILL.md now only
// describes their contract in prose and points here).
const SCRIPTS_DIR = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/evo-auto-enable/scripts",
);
const CORRECTION_CAPTURE_SCRIPT = join(SCRIPTS_DIR, "correction-capture.sh");
const NUDGE_SCRIPT = join(SCRIPTS_DIR, "evo-analysis-nudge.sh");
const FAILURE_CAPTURE_SCRIPT = join(SCRIPTS_DIR, "failure-capture.sh");

// The two shared dependencies these hooks call — same canonical files
// `/ievo:evo` Step 0 already reads, unchanged by #552 (only newly committed
// alongside the hook scripts instead of gitignored).
const SHARED_SCRIPTS_DIR = resolve(__dirname, "../../../../plugins/ievo/scripts");

const HOOK_SCRIPT_NAMES = [
  "correction-capture.sh",
  "evo-analysis-nudge.sh",
  "failure-capture.sh",
];
const DEPENDENCY_NAMES = ["evolution_candidates.mjs", "scrub.mjs"];
const ALL_COMMITTED_NAMES = [...HOOK_SCRIPT_NAMES, ...DEPENDENCY_NAMES];

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", env: GIT_ENV });
  assert.equal(
    r.status,
    0,
    `git ${args.join(" ")} failed (${cwd}): ${r.stderr}`,
  );
  return r.stdout;
}

// Every real-script invocation in this file routes through this env
// constructor. Two things it strips matter for correctness, not just
// hygiene: `$CLAUDECODE`/`$CODEX_CLI`/platform-detection vars (so each
// test's env fully controls platform detection instead of partially
// inheriting the test runner's own — unreliable across Node versions if you
// instead override-to-undefined in spawnSync's env option), and
// `$CLAUDE_PLUGIN_ROOT` specifically: all three real scripts prefer a live
// `$CLAUDE_PLUGIN_ROOT/scripts/{evolution_candidates,scrub}.mjs` over the
// project-local committed copy when present. If this test process happens to
// inherit a real `$CLAUDE_PLUGIN_ROOT` (e.g. this suite itself running
// inside a Claude Code session with the iEvo plugin installed), every
// stubbed-accumulator test below would silently exercise the REAL
// accumulator instead of the stub — green here, environment-dependent
// elsewhere. Stripped by default; set explicitly only in the tests that
// assert the CLAUDE_PLUGIN_ROOT branch itself.
function baseEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CODEX_CLI;
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  delete env.__CFBundleIdentifier;
  delete env.CLAUDE_PLUGIN_ROOT;
  return { ...env, ...extra };
}

function additionalContextOf(stdout) {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

// correction-capture.sh and failure-capture.sh both shell out to `jq`. If it
// is unavailable, correction-capture.sh degrades gracefully (its `sid`
// extraction has an `|| echo unknown` fallback), but failure-capture.sh's
// record-building would silently no-op on every test case, turning "no jq"
// into a wall of confusing false negatives rather than a clear signal.
// Skip-with-reason instead of guessing.
const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;
const JQ_SKIP = HAS_JQ ? false : "jq not available in this environment";

// Byte-identical to the block `evo-auto-enable/SKILL.md` Step 3.5.1,
// `init/SKILL.md` Step 10, and `hooks-setup/SKILL.md` Step 8 all write.
// Widened from three carved-out filenames (six lines, pre-#552) to five
// (eight lines): the two shared dependencies are now committed alongside the
// three hook scripts, so the negation has to carve them out too.
const GITIGNORE_BLOCK = `.ievo/hooks/*
!.ievo/hooks/scripts/
.ievo/hooks/scripts/*
!.ievo/hooks/scripts/correction-capture.sh
!.ievo/hooks/scripts/evo-analysis-nudge.sh
!.ievo/hooks/scripts/failure-capture.sh
!.ievo/hooks/scripts/evolution_candidates.mjs
!.ievo/hooks/scripts/scrub.mjs
`;

// Same JSON shape evo-auto-enable/SKILL.md Step 3.5.4/3.6 writes into
// .claude/settings.json — the wired paths are unchanged by #552 (only the
// content of the files they point at changed).
const SETTINGS_JSON = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "sh",
            args: [".ievo/hooks/scripts/correction-capture.sh"],
          },
        ],
      },
    ],
    SessionStart: [
      {
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: "sh",
            args: [".ievo/hooks/scripts/evo-analysis-nudge.sh"],
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          {
            type: "command",
            command: "sh",
            args: [".ievo/hooks/scripts/failure-capture.sh"],
          },
        ],
      },
    ],
    PermissionDenied: [
      {
        hooks: [
          {
            type: "command",
            command: "sh",
            args: [".ievo/hooks/scripts/failure-capture.sh"],
          },
        ],
      },
    ],
  },
};

// Same JSON shape evo-auto-enable/SKILL.md Step 3.5.4/3.6 writes into
// .codex/hooks.json on Codex ($CODEX_CLI) -- a Codex handler's `command` is a
// single shell string (no exec-form `args` array), unlike Claude Code's
// entries above, but it wires the SAME script paths.
const CODEX_HOOKS_JSON = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: "sh .ievo/hooks/scripts/correction-capture.sh",
          },
        ],
      },
    ],
    SessionStart: [
      {
        matcher: "startup",
        hooks: [
          {
            type: "command",
            command: "sh .ievo/hooks/scripts/evo-analysis-nudge.sh",
          },
        ],
      },
    ],
    PermissionRequest: [
      {
        hooks: [
          {
            type: "command",
            command: "sh .ievo/hooks/scripts/failure-capture.sh",
          },
        ],
      },
    ],
  },
};

describe("literals stay in sync with their SKILL.md sources", () => {
  // Without these, every assertion below tests only this file's own copy of
  // the gitignore block: a SKILL.md-side edit (the source of truth users
  // actually get) would ship broken with the suite green.
  it("the gitignore block appears verbatim in Step 3.5.1", () => {
    assert.ok(
      ENABLE_SKILL_SRC.includes(GITIGNORE_BLOCK),
      `this file's gitignore block is not present verbatim in ${ENABLE_SKILL} — one side drifted; re-sync both`,
    );
  });

  it("init/SKILL.md Step 10 writes the same block, never a blanket line", () => {
    assert.ok(
      INIT_SKILL_SRC.includes(GITIGNORE_BLOCK),
      `${INIT_SKILL} Step 10 no longer emits the negation-capable block verbatim — an init re-run would re-ignore the committed hook files; re-sync both`,
    );
    // A bare `.ievo/hooks/` directory-form entry re-ignores everything under
    // it and cannot be un-ignored by the negations that follow, so it must not
    // survive anywhere in the file. Matched line-anchored: `.ievo/hooks/*` and
    // `!.ievo/hooks/scripts/` are legitimate and must not trip this.
    const blanket = INIT_SKILL_SRC.split("\n").filter(
      (l) => l.trim() === ".ievo/hooks/",
    );
    assert.deepEqual(
      blanket,
      [],
      `${INIT_SKILL} still emits a blanket \`.ievo/hooks/\` gitignore line`,
    );
  });

  it("hooks-setup/SKILL.md Step 8 writes the same block, never a blanket line", () => {
    assert.ok(
      HOOKS_SETUP_SKILL_SRC.includes(GITIGNORE_BLOCK),
      `${HOOKS_SETUP_SKILL} Step 8 no longer emits the negation-capable block verbatim — a standalone hooks-setup run would re-ignore the committed hook files; re-sync both`,
    );
    const blanket = HOOKS_SETUP_SKILL_SRC.split("\n").filter(
      (l) => l.trim() === ".ievo/hooks/",
    );
    assert.deepEqual(
      blanket,
      [],
      `${HOOKS_SETUP_SKILL} still emits a blanket \`.ievo/hooks/\` gitignore line`,
    );
  });

  it("the wired-command dry-run (Check 2) is ordered after Step 3.6, which wires the last hook-config entry", () => {
    // Step 3.5.1 copies all five files up front, so (post-#552) the old
    // "companion-on-disk" ordering trap this test used to guard is gone —
    // file presence is guaranteed by git before either step runs. What
    // survives: the dry-run loop (`for f in correction-capture
    // evo-analysis-nudge failure-capture; do sh ".ievo/hooks/scripts/$f.sh"
    // ...`) still has to run AFTER Step 3.6 wires the failure-capture
    // hook-CONFIG-ENTRY — run earlier (from Step 3.5.4), evo-analysis-
    // nudge.sh's own wiring-integrity check would report that entry as drift
    // against a run whose own rule is "do NOT claim success".
    const step36At = ENABLE_SKILL_SRC.indexOf(
      "### 3.6 Write + wire the failure-capture hook",
    );
    const dryRunAt = ENABLE_SKILL_SRC.indexOf(
      'sh ".ievo/hooks/scripts/$f.sh" < /dev/null',
    );
    assert.ok(step36At > 0, "Step 3.6 heading missing from " + ENABLE_SKILL);
    assert.ok(dryRunAt > 0, "wired-command dry-run missing from " + ENABLE_SKILL);
    assert.ok(
      dryRunAt > step36At,
      `the wired-command dry-run precedes Step 3.6 in ${ENABLE_SKILL} — run before Step 3.6 wires the failure-capture hook-config entry, evo-analysis-nudge.sh's own wiring check would report that entry as spurious drift on a perfectly healthy linear enable`,
    );
  });

  it("SKILL.md wires exactly the three hook script paths this file exercises", () => {
    for (const name of HOOK_SCRIPT_NAMES) {
      assert.ok(
        ENABLE_SKILL_SRC.includes(`.ievo/hooks/scripts/${name}`),
        `${name}: wired path missing from ${ENABLE_SKILL}`,
      );
    }
  });

  it("the five committed files this SKILL.md installs all exist in the plugin at the documented source paths", () => {
    // Ties Step 3.5.1's install table to reality: a rename of any real
    // script file without a matching SKILL.md update (or vice versa) fails
    // here instead of shipping a copy command that silently no-ops.
    for (const name of HOOK_SCRIPT_NAMES) {
      assert.ok(
        existsSync(join(SCRIPTS_DIR, name)),
        `missing plugin source file: ${join(SCRIPTS_DIR, name)}`,
      );
    }
    for (const name of DEPENDENCY_NAMES) {
      assert.ok(
        existsSync(join(SHARED_SCRIPTS_DIR, name)),
        `missing plugin source file: ${join(SHARED_SCRIPTS_DIR, name)}`,
      );
    }
  });
});

// A scratch git repo (init → commit → clone) shared by the next three
// describes, mirroring a real project's lifecycle: seed with what
// `/ievo:evo-auto-enable` installs, prove gitignore semantics against the
// seed (ORIGIN), prove a clean clone works immediately with no per-clone
// step (CLONE), then prove `/ievo:evo-auto-disable` leaves the committed
// files alone (CLONE again, mutated in place). Content is read from the REAL
// plugin files at test-run time, not a literal copy, so an edit to a real
// script is exercised here automatically.
const ROOT = join(tmpdir(), `evo-auto-hooks-lifecycle-${process.pid}`);
const ORIGIN = join(ROOT, "origin");
const CLONE = join(ROOT, "clone");

function writeCommittedFiles(dir) {
  mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, ".codex"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), GITIGNORE_BLOCK);
  for (const name of ALL_COMMITTED_NAMES) {
    const isScript = name.endsWith(".sh");
    const src = join(isScript ? SCRIPTS_DIR : SHARED_SCRIPTS_DIR, name);
    const dest = join(dir, ".ievo/hooks/scripts", name);
    writeFileSync(dest, readFileSync(src, "utf-8"));
    if (isScript) chmodSync(dest, 0o755);
  }
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify(SETTINGS_JSON, null, 2),
  );
  writeFileSync(
    join(dir, ".codex/hooks.json"),
    JSON.stringify(CODEX_HOOKS_JSON, null, 2),
  );
  writeFileSync(
    join(dir, ".ievo/evo-auto.flag"),
    "enabled: true\nenabled_at: 2026-07-25T00:00:00Z\nenabled_by: test\nsignal: corrections-only\nauto_write_scope: project-wide-only\n",
  );
}

before(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ORIGIN, { recursive: true });

  git(ORIGIN, "init", "-q");
  writeCommittedFiles(ORIGIN);
  git(ORIGIN, "add", "-A");
  git(ORIGIN, "commit", "-q", "-m", "seed");

  git(ROOT, "clone", "-q", ORIGIN, CLONE);
});

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("gitignore negation pattern (real git, skills#446, widened in skills#552)", () => {
  it("tracks exactly the five committed hook/dependency files, nothing else under .ievo/hooks/", () => {
    const tracked = git(ORIGIN, "ls-files", ".ievo/hooks/")
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(
      tracked,
      ALL_COMMITTED_NAMES.map((n) => `.ievo/hooks/scripts/${n}`).sort(),
    );
  });

  it("still ignores .ievo/hooks/tmp/, init-complete, and any non-carved-out file under scripts/", () => {
    // `git check-ignore` evaluates pathnames against the ignore rules — none
    // of these need to exist on disk for the check to be meaningful.
    for (const p of [
      ".ievo/hooks/tmp/correction-pending.txt",
      ".ievo/hooks/init-complete",
      ".ievo/hooks/scripts/some-other-file.sh",
    ]) {
      const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: ORIGIN });
      assert.equal(r.status, 0, `expected ${p} to be ignored`);
    }
  });

  it("does NOT ignore any of the five committed paths", () => {
    for (const name of ALL_COMMITTED_NAMES) {
      const p = `.ievo/hooks/scripts/${name}`;
      const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: ORIGIN });
      assert.equal(r.status, 1, `expected ${p} to NOT be ignored`);
    }
  });
});

describe("clean clone (skills#446/#552 — a plain git clone works immediately, no per-clone step)", () => {
  it("tracks exactly the five committed files plus settings/flag; nothing from the retired shim/companion/vendor design", () => {
    const tracked = git(CLONE, "ls-files").trim().split("\n").sort();
    assert.ok(tracked.includes(".claude/settings.json"));
    assert.ok(tracked.includes(".codex/hooks.json"));
    assert.ok(tracked.includes(".ievo/evo-auto.flag"));
    for (const name of ALL_COMMITTED_NAMES) {
      assert.ok(tracked.includes(`.ievo/hooks/scripts/${name}`));
    }
    for (const retired of [
      ".ievo/hooks/scripts/vendor/evolution_candidates.mjs",
      ".ievo/hooks/scripts/correction-capture.local.sh",
      ".ievo/hooks/scripts/evo-analysis-nudge.local.sh",
      ".ievo/hooks/scripts/failure-capture.local.sh",
      ".ievo/hooks/init-complete",
    ]) {
      assert.ok(
        !tracked.includes(retired),
        `${retired} belongs to the retired shim/companion/vendor design and must not be tracked`,
      );
    }
  });

  it("never exits 127 on the reported repro command (sh <script>), for all three .sh entrypoints", () => {
    for (const name of HOOK_SCRIPT_NAMES) {
      const result = spawnSync("sh", [`.ievo/hooks/scripts/${name}`], {
        cwd: CLONE,
        input: '{"session_id":"repro"}',
        encoding: "utf-8",
        env: baseEnv(),
      });
      assert.notEqual(
        result.status,
        127,
        `${name}: expected no "command not found", got ${JSON.stringify(result)}`,
      );
      assert.equal(result.status, 0, `${name}: expected exit 0`);
    }
  });

  it("evo-analysis-nudge.sh stays silent on a clean clone that is fully wired with zero pending candidates (skills#551's bug class structurally closed by skills#552)", () => {
    // Pre-#552, this exact state (flag committed, shim committed, everything
    // else gitignored and never regenerated) was the skills#551 repro: the
    // shim ran but its companion — holding the wiring-integrity check — was
    // missing, so nothing could report the drift. Post-#552 there is no
    // companion to regenerate: the clone's own committed evolution_candi-
    // dates.mjs answers `count` for real (0 sessions exist yet, this is the
    // very first session), and .claude/settings.json is fully wired by the
    // seed above, so the wiring check this script runs internally finds
    // nothing to report. This is the structural fix, not a behavioral patch.
    const result = spawnSync("sh", [".ievo/hooks/scripts/evo-analysis-nudge.sh"], {
      cwd: CLONE,
      input: '{"session_id":"repro"}',
      encoding: "utf-8",
      env: baseEnv({ CLAUDECODE: "1" }),
    });
    assert.equal(result.status, 0);
    assert.equal(
      result.stdout,
      "",
      "expected silence on a healthy clean clone, not a drift warning",
    );
  });

  it("resolves the exact command+args .claude/settings.json wires, with no 127", () => {
    const settings = JSON.parse(
      readFileSync(join(CLONE, ".claude/settings.json"), "utf-8"),
    );
    const invocations = [
      ...settings.hooks.UserPromptSubmit.flatMap((e) => e.hooks),
      ...settings.hooks.SessionStart.flatMap((e) => e.hooks),
      ...settings.hooks.PostToolUseFailure.flatMap((e) => e.hooks),
      ...settings.hooks.PermissionDenied.flatMap((e) => e.hooks),
    ];
    assert.ok(invocations.length >= 4);
    for (const hook of invocations) {
      const result = spawnSync(hook.command, hook.args, {
        cwd: CLONE,
        input: "{}",
        encoding: "utf-8",
        env: baseEnv(),
      });
      assert.notEqual(result.status, 127, JSON.stringify(hook));
      assert.equal(result.status, 0, JSON.stringify(hook));
    }
  });

  it("resolves the exact Codex command string .codex/hooks.json wires, with no 127", () => {
    const hooksJson = JSON.parse(
      readFileSync(join(CLONE, ".codex/hooks.json"), "utf-8"),
    );
    const invocations = [
      ...hooksJson.hooks.UserPromptSubmit.flatMap((e) => e.hooks),
      ...hooksJson.hooks.SessionStart.flatMap((e) => e.hooks),
      ...hooksJson.hooks.PermissionRequest.flatMap((e) => e.hooks),
    ];
    assert.ok(invocations.length >= 3);
    for (const hook of invocations) {
      // Codex's `command` is a single shell string, not command+args --
      // matches how Codex itself would invoke it.
      const result = spawnSync("sh", ["-c", hook.command], {
        cwd: CLONE,
        input: "{}",
        encoding: "utf-8",
        env: baseEnv(),
      });
      assert.notEqual(result.status, 127, JSON.stringify(hook));
      assert.equal(result.status, 0, JSON.stringify(hook));
    }
  });
});

describe("disable (flag + hook-config entries removed, committed files left in place)", () => {
  before(() => {
    // Models evo-auto-disable/SKILL.md Step 3 (remove the flag) + Step 3.5
    // (remove the wired hook-config entries from BOTH client configs)
    // exactly. Step 3.5's own rule: "the committed hook/dependency files are
    // left in place, untouched" — there is nothing left to regenerate or
    // delete on disable now that skills#552 made them ordinary tracked
    // files, unlike the pre-#552 "companions removed, shim left in place"
    // step this describe used to model.
    rmSync(join(CLONE, ".ievo/evo-auto.flag"), { force: true });
    writeFileSync(join(CLONE, ".claude/settings.json"), JSON.stringify({ hooks: {} }, null, 2));
    writeFileSync(join(CLONE, ".codex/hooks.json"), JSON.stringify({ hooks: {} }, null, 2));
  });

  it("every hook script returns to a safe silent no-op once the flag is gone", () => {
    for (const name of HOOK_SCRIPT_NAMES) {
      const result = spawnSync("sh", [`.ievo/hooks/scripts/${name}`], {
        cwd: CLONE,
        input: "{}",
        encoding: "utf-8",
        env: baseEnv(),
      });
      assert.equal(result.status, 0, name);
      assert.equal(result.stdout, "", name);
    }
  });

  it("the five committed files remain tracked and unmodified by disable", () => {
    const tracked = git(CLONE, "ls-files", ".ievo/hooks/")
      .trim()
      .split("\n")
      .sort();
    assert.deepEqual(
      tracked,
      ALL_COMMITTED_NAMES.map((n) => `.ievo/hooks/scripts/${n}`).sort(),
    );
    const status = git(CLONE, "status", "--porcelain", ".ievo/hooks/");
    assert.equal(
      status.trim(),
      "",
      "disable must not touch .ievo/hooks/scripts/* — only the flag and the hook-config entries",
    );
  });
});

// Regression coverage for skills#551, re-derived against the real,
// post-#552 evo-analysis-nudge.sh. The ORIGINAL vendored-copy / sibling
// *.local.sh-companion presence check is gone -- those concepts no longer
// exist (skills#552 dropped the vendor/ subdirectory and the shim/companion
// split entirely). But a flat, five-filename presence check REPLACES it
// (restored after PR review on skills#552's own follow-up PR): committing
// the five files only guarantees their presence on a clone whose
// .gitignore was actually widened to all five negations by evo-auto-enable
// Step 3.5.1 -- an LLM-interpreted prose step, not compiled code. A stale
// or partially-applied .gitignore can leave evolution_candidates.mjs/
// scrub.mjs gitignored while the three .sh files land committed, so
// capture silently dies on the next clone with nothing surfacing it --
// unless this check catches it. Alongside that: the hook-CONFIG-ENTRY half
// (is the path actually wired into the client's own config file), the
// pending-candidate count, and the autocommit-failed note (skills#552's
// own earlier addition, layered on top of the same nudge). This describe
// executes the REAL file directly — no extraction, no stand-in.
describe("evo-analysis-nudge.sh wiring-integrity check (skills#551, re-derived for skills#552)", () => {
  const NUDGE_SRC = readFileSync(NUDGE_SCRIPT, "utf-8");

  it("the real file matches its documented contract and no longer carries the RETIRED vendor/companion presence checks", () => {
    assert.ok(NUDGE_SRC.startsWith("#!/bin/sh\n"));
    assert.ok(NUDGE_SRC.includes("evo-auto.flag"));
    assert.ok(NUDGE_SRC.includes("HOOKS_FILE"));
    // A flat, five-filename presence check DOES still exist (restored after
    // PR review) -- what must never reappear is the OLD vendor-subdirectory /
    // *.local.sh-companion-aware version of it. Checked by exact path
    // fragment, not the bare word "vendor" or the substring ".local.sh" --
    // this file's own comments legitimately reference the retired design by
    // name when explaining why the current check is shaped the way it is.
    assert.ok(
      !NUDGE_SRC.includes("scripts/vendor/"),
      "the old vendor/-subdirectory path should no longer exist in evo-analysis-nudge.sh",
    );
    assert.ok(
      !NUDGE_SRC.includes(".local.sh\""),
      "no *.local.sh companion filename should be referenced as a real path in evo-analysis-nudge.sh",
    );
    // The restored check DOES exist -- pin its presence too, so a future
    // "simplify this" pass can't silently delete it again without failing
    // the tests below (which exercise it directly).
    assert.ok(
      NUDGE_SRC.includes('for f in correction-capture.sh evo-analysis-nudge.sh failure-capture.sh evolution_candidates.mjs scrub.mjs'),
      "the flat five-filename presence check must be present",
    );
  });

  const NUDGE_ROOT = join(tmpdir(), `evo-analysis-nudge-wiring-${process.pid}`);

  before(() => {
    rmSync(NUDGE_ROOT, { recursive: true, force: true });
    mkdirSync(NUDGE_ROOT, { recursive: true });
  });

  after(() => {
    rmSync(NUDGE_ROOT, { recursive: true, force: true });
  });

  function freshProject() {
    const dir = join(NUDGE_ROOT, `proj-${Math.floor(1e9 * Math.random())}`);
    mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
    return dir;
  }

  function writeFlag(dir) {
    writeFileSync(
      join(dir, ".ievo/evo-auto.flag"),
      "enabled: true\nenabled_at: 2026-08-05T00:00:00Z\nenabled_by: test\nsignal: corrections-only\nauto_write_scope: project-wide-only\n",
    );
  }

  // A minimal accumulator stand-in whose `count` subcommand prints a fixed
  // value -- exercises this script's drift check without re-testing
  // evolution_candidates.mjs itself (covered by its own suite). Written
  // directly under .ievo/hooks/scripts/ (post-#552 there is no vendor/
  // subdirectory to route through).
  function stubAccumulator(dir, { count = "0", broken = false, missing = false } = {}) {
    if (missing) return; // exercise the real, non-stubbed node ENOENT fallback
    const p = join(dir, ".ievo/hooks/scripts/evolution_candidates.mjs");
    const body = broken
      ? `process.stdout.write("not-a-number");\nprocess.exit(0);\n`
      : `const cmd = process.argv[2];\nif (cmd === "count") process.stdout.write(${JSON.stringify(String(count))});\nprocess.exit(0);\n`;
    writeFileSync(p, body);
  }

  // Post-#552, the SessionStart nudge checks that all five installed files
  // are actually present on disk (skills#552 review finding: a stale/partial
  // .gitignore reconciliation could leave the two .mjs deps ignored while
  // the three .sh files land committed -- see the restored check in the
  // real evo-analysis-nudge.sh). Tests that want a "fully wired, no drift"
  // baseline call this; tests that want a specific file missing pass `omit`.
  const ALL_HOOK_FILES = ["correction-capture.sh", "evo-analysis-nudge.sh", "failure-capture.sh", "scrub.mjs"];
  function writeHookFiles(dir, { omit = [] } = {}) {
    for (const f of ALL_HOOK_FILES) {
      if (omit.includes(f)) continue;
      writeFileSync(join(dir, ".ievo/hooks/scripts", f), "#!/bin/sh\nexit 0\n");
    }
  }

  function writeClaudeSettings(dir, { includeFailure = true } = {}) {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const hooks = {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "sh", args: [".ievo/hooks/scripts/correction-capture.sh"] }] }],
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "sh", args: [".ievo/hooks/scripts/evo-analysis-nudge.sh"] }] }],
    };
    if (includeFailure) {
      hooks.PostToolUseFailure = [{ hooks: [{ type: "command", command: "sh", args: [".ievo/hooks/scripts/failure-capture.sh"] }] }];
      hooks.PermissionDenied = [{ hooks: [{ type: "command", command: "sh", args: [".ievo/hooks/scripts/failure-capture.sh"] }] }];
    }
    writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ hooks }, null, 2));
  }

  function writeCodexHooks(dir) {
    mkdirSync(join(dir, ".codex"), { recursive: true });
    const hooks = {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "sh .ievo/hooks/scripts/correction-capture.sh" }] }],
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "sh .ievo/hooks/scripts/evo-analysis-nudge.sh" }] }],
      PermissionRequest: [{ hooks: [{ type: "command", command: "sh .ievo/hooks/scripts/failure-capture.sh" }] }],
    };
    writeFileSync(join(dir, ".codex/hooks.json"), JSON.stringify({ hooks }, null, 2));
  }

  function runNudge(dir, env = {}) {
    return spawnSync("sh", [NUDGE_SCRIPT], {
      cwd: dir,
      input: "{}",
      encoding: "utf-8",
      env: baseEnv(env),
    });
  }

  it("flag absent -> completely silent, wiring check never runs", () => {
    const dir = freshProject();
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("flag present, no hook config wiring at all -> drift naming the missing config file (skills#551 repro, simplified)", () => {
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "expected a drift nudge, got silence -- the exact skills#551 bug class");
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes(".claude/settings.json itself (no hook config file at all)"));
    assert.ok(ctx.includes("/ievo:evo-auto-enable"));
    assert.ok(!ctx.includes("vendored"), "the retired vendored-copy check must not reappear");
    assert.ok(!ctx.includes(".local.sh"), "the retired companion-presence check must not reappear");
    assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
  });

  it("accumulator file genuinely missing -> node's own ENOENT fallback supplies 0, AND the restored file-presence check reports it as drift (no crash either way)", () => {
    // Pre-#552-review-fix this asserted total silence: "n falls back to 0,
    // nothing to report" -- but a genuinely-missing evolution_candidates.mjs
    // is real drift (the exact partial-gitignore-reconciliation class this
    // file-presence check exists to catch), and staying silent about it was
    // itself a blind spot -- a broken accumulator on a real project would
    // have silently reported "0 candidates" instead of surfacing the break.
    // What this test still proves: `node "$ACC" count 2>/dev/null || echo 0`
    // does not crash the whole script when $ACC is absent -- count still
    // resolves to 0, and the script goes on to run its other checks (which
    // now correctly flag the same absence as drift) rather than dying.
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir);
    writeClaudeSettings(dir); // fully wired, so the only variable is the accumulator's absence
    stubAccumulator(dir, { missing: true });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0, "a missing accumulator must not crash the script");
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("drift detected"), "a missing evolution_candidates.mjs is real drift, not silence");
    assert.ok(ctx.includes("evolution_candidates.mjs"), `expected it named as missing; got: ${ctx}`);
    assert.ok(!ctx.includes("hook entry"), "settings.json IS fully wired -- only the file itself is missing");
  });

  it("accumulator missing AND a hook entry missing -> the drift check still fires despite the accumulator ENOENT", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeClaudeSettings(dir, { includeFailure: false });
    stubAccumulator(dir, { missing: true });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("failure-capture hook entry in .claude/settings.json"));
  });

  it("mid-enable state (Step 3.5.4 done, Step 3.6 not yet) -> drift naming exactly the one hook-config entry Step 3.6 writes", () => {
    // Why SKILL.md orders Check (2)'s dry-run at the END of Step 3.6 (pinned
    // structurally by the ordering test in the first describe): at the point
    // Step 3.5.4 finishes, the failure-capture.sh FILE is already on disk
    // (Step 3.5.1 copies all five up front) but its hook-CONFIG-ENTRY is not
    // -- Step 3.6 writes that. This script cannot tell that transient state
    // apart from real drift, by design: a check that special-cased
    // "probably mid-enable" would also stay quiet on a run that genuinely
    // died between 3.5.4 and 3.6. This test pins the exact output the
    // ordering rule keeps from surfacing mid-run.
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir); // Step 3.5.1 copies all five files up front, before 3.6's entry write
    stubAccumulator(dir, { count: "0" });
    writeClaudeSettings(dir, { includeFailure: false });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = additionalContextOf(result.stdout);
    assert.ok(
      ctx.includes("(drift detected) -- failure-capture hook entry in .claude/settings.json. Capture may be"),
      `mid-enable drift must name exactly the one hook-config entry Step 3.6 writes; got: ${ctx}`,
    );
    assert.ok(!ctx.includes("correction-capture hook entry"), "Step 3.5.4 already wrote this entry -- must not read as drift");
    assert.ok(!ctx.includes("evo-analysis-nudge hook entry"), "Step 3.5.4 already wrote this entry -- must not read as drift");
  });

  it("fully wired, zero pending candidates -> silent, no false-positive nudge", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir);
    writeClaudeSettings(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("fully wired, N pending candidates -> ordinary count nudge, no drift language", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir);
    writeClaudeSettings(dir);
    stubAccumulator(dir, { count: "4" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("4 evolution candidate(s)"));
    assert.ok(!ctx.includes("drift detected"));
  });

  it("one hook entry missing from an otherwise-wired config -> combined drift + pending-count message", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeClaudeSettings(dir, { includeFailure: false });
    stubAccumulator(dir, { count: "2" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("failure-capture hook entry in .claude/settings.json"));
    assert.ok(ctx.includes("2 evolution candidate(s)"));
    assert.ok(!ctx.includes("correction-capture hook entry"), "only the actually-missing entry should be named");
  });

  // Regression coverage for the exact gap flagged on PR review after this
  // file-presence check was first (over-eagerly) deleted, then restored:
  // committing all five files only guarantees their presence on disk when
  // evo-auto-enable Step 3.5.1's gitignore reconciliation actually widened
  // the negation to all five filenames. That reconciliation is an
  // LLM-interpreted prose step, not compiled code -- a stale/partial
  // .gitignore (an old three-filename block never upgraded, a hand edit)
  // can leave scrub.mjs/evolution_candidates.mjs gitignored while the three
  // .sh files land committed, so capture silently dies on the next clone
  // with nothing surfacing it -- unless this check catches it.
  it("scrub.mjs missing on disk (the exact partial-gitignore-reconciliation scenario) -> drift naming it, entries otherwise wired", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir, { omit: ["scrub.mjs"] });
    writeClaudeSettings(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("drift detected"), "a missing dependency file must surface as drift, not silence");
    assert.ok(ctx.includes("scrub.mjs"), `expected scrub.mjs named as missing; got: ${ctx}`);
    assert.ok(!ctx.includes("hook entry"), "the hook-config entries ARE wired -- only the file itself is missing");
    assert.ok(ctx.includes("Re-run /ievo:evo-auto-enable to repair"));
  });

  it("correction-capture.sh missing on disk -> drift naming it (a corrupted/partial install, not just a gitignore gap)", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir, { omit: ["correction-capture.sh"] });
    writeClaudeSettings(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("correction-capture.sh"), `expected correction-capture.sh named as missing; got: ${ctx}`);
  });

  it("multiple files missing -> all named in one combined drift message", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir, { omit: ["scrub.mjs", "failure-capture.sh"] });
    writeClaudeSettings(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("scrub.mjs"));
    assert.ok(ctx.includes("failure-capture.sh"));
    assert.ok(!ctx.includes("correction-capture.sh"), "only the actually-missing files should be named");
    assert.ok(!ctx.includes("evo-analysis-nudge.sh"), "only the actually-missing files should be named");
  });

  it("no hook config file at all -> names the file itself as missing", () => {
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes(".claude/settings.json itself (no hook config file at all)"));
  });

  it("Codex platform ($CODEX_CLI set) checks .codex/hooks.json, never .claude/settings.json", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeClaudeSettings(dir); // fully wired on the WRONG (Claude Code) file
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CODEX_CLI: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(
      ctx.includes(".codex/hooks.json itself (no hook config file at all)"),
      "a Codex session must judge .codex/hooks.json, not treat an unrelated .claude/settings.json as proof of wiring",
    );
  });

  it("Codex platform, fully wired at .codex/hooks.json -> silent, no drift", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeHookFiles(dir);
    writeCodexHooks(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CODEX_CLI: "1" });
    assert.equal(result.stdout, "");
  });

  it("$CLAUDECODE set together with $CODEX_CLI set -> Codex wins (Step 1.5 ordering: Claude Code requires CODEX_CLI unset)", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeClaudeSettings(dir); // wired only on the Claude Code side
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1", CODEX_CLI: "1" });
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes(".codex/hooks.json itself (no hook config file at all)"));
  });

  it("a broken/non-numeric accumulator no longer silently swallows the drift check (the actual #551 regression)", () => {
    // Before skills#551, a `count` parse failure hit an early `exit 0` in the
    // same case statement, skipping the wiring check entirely. Full wiring
    // minus one hook entry + a garbage (non-numeric) count output must still
    // report the missing entry.
    const dir = freshProject();
    writeFlag(dir);
    writeClaudeSettings(dir, { includeFailure: false });
    stubAccumulator(dir, { broken: true });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "a broken accumulator must not mask a real wiring gap");
    const ctx = additionalContextOf(result.stdout);
    assert.ok(ctx.includes("failure-capture hook entry in .claude/settings.json"));
  });

  it("never exits non-zero, even on the drift path (SessionStart cannot block startup)", () => {
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
  });

  // Branch-aware auto-commit (skills#552): evo/SKILL.md Step 5.4 and
  // agents/evolution.md Step 4.4 park a `Scope: autocommit-failed` entry in
  // pending.md on a headless commit failure. This script's independent grep
  // check surfaces those entries even when the accumulator's own count (n) is
  // 0 and wiring is intact -- none of the cases above exercise that detector
  // at all. Nested in this same describe (not a sibling) so it shares this
  // block's freshProject/writeFlag/writeClaudeSettings/stubAccumulator/
  // runNudge helpers via closure, rather than redefining them.
  describe("autocommit-failed detection (skills#552)", () => {
    // Same "verbatim, not templated" extraction principle: the pending.md
    // scaffold in Step 3 isn't a `sh` block, and (unlike the three hook
    // scripts) it was never affected by #552's committed-files change, so
    // this extraction still applies unchanged.
    function extractPlainFencedBlock(src, afterHeading) {
      const headingAt = src.indexOf(afterHeading);
      assert.ok(headingAt > 0, `heading not found in SKILL.md: ${afterHeading}`);
      const fenceOpenAt = src.indexOf("```\n", headingAt);
      assert.ok(fenceOpenAt > 0, `no fenced block after heading: ${afterHeading}`);
      const bodyStart = fenceOpenAt + "```\n".length;
      const fenceCloseAt = src.indexOf("\n```", bodyStart);
      assert.ok(fenceCloseAt > 0, `unterminated fenced block after heading: ${afterHeading}`);
      return src.slice(bodyStart, fenceCloseAt + 1);
    }

    // The real Step 3 scaffold, extracted from SKILL.md verbatim -- this is
    // what /ievo:evo-auto-enable actually writes to a fresh pending.md.
    const PENDING_SCAFFOLD = extractPlainFencedBlock(
      ENABLE_SKILL_SRC,
      "create it with this scaffold",
    );

    function writePendingScaffold(dir) {
      mkdirSync(join(dir, ".ievo/evolution-candidates"), { recursive: true });
      writeFileSync(join(dir, ".ievo/evolution-candidates/pending.md"), PENDING_SCAFFOLD);
    }

    function writeAutocommitEntry(dir) {
      mkdirSync(join(dir, ".ievo/evolution-candidates"), { recursive: true });
      writeFileSync(
        join(dir, ".ievo/evolution-candidates/pending.md"),
        [
          "# Evolution candidates — pending review",
          "",
          "## 2026-08-07T12:00:00Z — session test-sess",
          "- Scope: autocommit-failed",
          "- Overlay file: .ievo/evolution/project.md",
          "- Branch: feature/test",
          "- Reason: pre-commit hook rejected (exit 1)",
          "",
        ].join("\n"),
      );
    }

    it("fresh scaffold (no real entry) -> silent, the exact skills#552 regression this test guards", () => {
      const dir = freshProject();
      writeFlag(dir);
      writeHookFiles(dir);
      writeClaudeSettings(dir);
      stubAccumulator(dir, { count: "0" });
      writePendingScaffold(dir);
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      assert.equal(
        result.stdout,
        "",
        "the scaffold's own doc example must never self-match the autocommit-failed detector",
      );
    });

    it("wired + 0 candidates + a real autocommit-failed entry -> fires (the bare else-branch case)", () => {
      const dir = freshProject();
      writeFlag(dir);
      writeClaudeSettings(dir);
      stubAccumulator(dir, { count: "0" });
      writeAutocommitEntry(dir);
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      assert.notEqual(result.stdout, "", "a real autocommit-failed entry must fire the nudge even with n=0 and no wiring drift");
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.startsWith("iEvo auto-evolution:"), "bare else-branch prefix must still be present");
      assert.ok(ctx.includes("Scope: autocommit-failed"));
      assert.ok(ctx.includes("do NOT re-run it through Step 0/1 classification"));
      assert.ok(ctx.includes("Delete the entry from pending.md once you have committed the file manually"));
      assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
    });

    it("autocommit note appended after the wiring-drift message (missing-only branch)", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubAccumulator(dir, { count: "0" }); // wiring left incomplete (no settings.json at all) -> drift
      writeAutocommitEntry(dir);
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes("drift detected"), "drift branch must still fire on its own");
      assert.ok(ctx.includes("Re-run /ievo:evo-auto-enable to repair"), "drift message body must be intact");
      assert.ok(ctx.includes("Scope: autocommit-failed"), "autocommit note must be appended after the drift message, not dropped");
      assert.ok(
        ctx.indexOf("drift detected") < ctx.indexOf("Scope: autocommit-failed"),
        "drift message must come before the appended autocommit note",
      );
    });

    it("autocommit note appended after the pending-candidate-count message (count-only branch)", () => {
      const dir = freshProject();
      writeFlag(dir);
      writeHookFiles(dir);
      writeClaudeSettings(dir);
      stubAccumulator(dir, { count: "3" });
      writeAutocommitEntry(dir);
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      const ctx = additionalContextOf(result.stdout);
      assert.ok(
        ctx.includes("3 evolution candidate(s) captured in earlier sessions are pending review"),
        "count branch must still fire on its own",
      );
      assert.ok(ctx.includes("Scope: autocommit-failed"), "autocommit note must be appended after the count message, not dropped");
      assert.ok(
        ctx.indexOf("3 evolution candidate(s)") < ctx.indexOf("Scope: autocommit-failed"),
        "count message must come before the appended autocommit note",
      );
    });

    it("autocommit note appended after the combined drift+count message (both-branch)", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubAccumulator(dir, { count: "2" }); // wiring left incomplete -> drift, plus n>0
      writeAutocommitEntry(dir);
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes("drift detected"));
      assert.ok(ctx.includes("Separately, 2 evolution candidate(s)"));
      assert.ok(ctx.includes("Scope: autocommit-failed"));
      assert.ok(
        ctx.indexOf("Separately, 2 evolution candidate(s)") < ctx.indexOf("Scope: autocommit-failed"),
        "combined message must come before the appended autocommit note",
      );
    });

    it("no pending.md at all -> autocommit branch stays silent, same as n=0/no-drift", () => {
      const dir = freshProject();
      writeFlag(dir);
      writeHookFiles(dir);
      writeClaudeSettings(dir);
      stubAccumulator(dir, { count: "0" });
      // Deliberately no writePendingScaffold()/writeAutocommitEntry() call --
      // exercises the `[ -f "$PENDING" ]` guard's false branch directly.
      const result = runNudge(dir, { CLAUDECODE: "1" });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
    });
  });
});

// NEW, post-#552 coverage: before this redesign, correction-capture.sh's
// real logic lived only in a gitignored `*.local.sh` companion this suite
// never generated (it used a generic realCompanion() stand-in to avoid
// re-testing logic that lived only in prose elsewhere). It is now real,
// committed, executable source at a fixed plugin path, so this describe
// executes it directly.
describe(
  "correction-capture.sh (real file, UserPromptSubmit, CWE-78 shell-quoting safety, skills#552)",
  { skip: JQ_SKIP },
  () => {
    const CC_ROOT = join(tmpdir(), `correction-capture-${process.pid}`);

    before(() => {
      rmSync(CC_ROOT, { recursive: true, force: true });
      mkdirSync(CC_ROOT, { recursive: true });
    });

    after(() => {
      rmSync(CC_ROOT, { recursive: true, force: true });
    });

    function freshProject() {
      const dir = join(CC_ROOT, `proj-${Math.floor(1e9 * Math.random())}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    }

    function writeFlag(dir) {
      mkdirSync(join(dir, ".ievo"), { recursive: true });
      writeFileSync(
        join(dir, ".ievo/evo-auto.flag"),
        "enabled: true\nenabled_at: 2026-08-05T00:00:00Z\nenabled_by: test\nsignal: corrections-only\nauto_write_scope: project-wide-only\n",
      );
    }

    function run(dir, stdin, env = {}) {
      return spawnSync("sh", [CORRECTION_CAPTURE_SCRIPT], {
        cwd: dir,
        input: stdin,
        encoding: "utf-8",
        env: baseEnv(env),
      });
    }

    it("flag absent -> silent, exit 0, no stdout", () => {
      const dir = freshProject();
      const result = run(dir, '{"session_id":"abc"}');
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
    });

    it("flag present -> emits UserPromptSubmit additionalContext instructing Write-tool + --text-file, never inline text embedding", () => {
      const dir = freshProject();
      writeFlag(dir);
      const result = run(dir, '{"session_id":"sess-123"}');
      assert.equal(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
      const ctx = parsed.hookSpecificOutput.additionalContext;
      assert.ok(ctx.includes("Write tool"), "must instruct the Write tool, not Bash, for recording the correction text");
      assert.ok(ctx.includes(".ievo/hooks/tmp/correction-pending.txt"));
      assert.ok(ctx.includes("--text-file"));
      assert.ok(
        ctx.includes("Never substitute the correction text itself into the command"),
        "must explicitly warn against embedding correction text into the fixed command",
      );
      assert.ok(
        ctx.includes(
          "node .ievo/hooks/scripts/evolution_candidates.mjs append --session sess-123 --text-file .ievo/hooks/tmp/correction-pending.txt",
        ),
        "the fixed command template must have no interpolation slot for arbitrary correction text -- only the accumulator path and session id vary",
      );
      assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
      assert.ok([...ctx].every((c) => c.charCodeAt(0) < 128), "additionalContext must stay ASCII-only");
    });

    it("emits exactly one line of hook JSON", () => {
      const dir = freshProject();
      writeFlag(dir);
      const result = run(dir, '{"session_id":"one-line"}');
      assert.equal(result.stdout.split("\n").filter(Boolean).length, 1);
      assert.ok(result.stdout.endsWith("\n"));
    });

    it("missing session_id -> falls back to 'unknown'", () => {
      const dir = freshProject();
      writeFlag(dir);
      const result = run(dir, "{}");
      assert.equal(result.status, 0);
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes("--session unknown"));
    });

    it("malformed (non-JSON) stdin -> jq failure falls back to 'unknown', script still succeeds", () => {
      const dir = freshProject();
      writeFlag(dir);
      const result = run(dir, "not json at all {{{");
      assert.equal(result.status, 0);
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes("--session unknown"));
    });

    it("resolves the accumulator to a live CLAUDE_PLUGIN_ROOT copy when one exists on disk", () => {
      const dir = freshProject();
      writeFlag(dir);
      const pluginRoot = join(dir, "fake-plugin-root");
      mkdirSync(join(pluginRoot, "scripts"), { recursive: true });
      writeFileSync(join(pluginRoot, "scripts/evolution_candidates.mjs"), "// stand-in\n");
      const result = run(dir, '{"session_id":"x"}', { CLAUDE_PLUGIN_ROOT: pluginRoot });
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes(`node ${pluginRoot}/scripts/evolution_candidates.mjs append`));
    });

    it("falls back to the project-local copy when CLAUDE_PLUGIN_ROOT is set but the file does not exist there", () => {
      const dir = freshProject();
      writeFlag(dir);
      const result = run(dir, '{"session_id":"x"}', {
        CLAUDE_PLUGIN_ROOT: join(dir, "nonexistent-plugin-root"),
      });
      const ctx = additionalContextOf(result.stdout);
      assert.ok(ctx.includes("node .ievo/hooks/scripts/evolution_candidates.mjs append"));
    });

    it("a session_id carrying shell metacharacters is embedded literally, never executed (CWE-78 regression class, #373)", () => {
      // correction-capture.sh never handles the CORRECTION TEXT itself (that
      // is the agent's job, via the Write tool + this fixed command) -- but
      // it does interpolate the harness-supplied session_id into the message
      // via plain parameter expansion (`${sid}`), never through eval or
      // command substitution of a re-parsed string. A metacharacter-bearing
      // session_id must pass straight through as inert text, never run
      // anything.
      const dir = freshProject();
      writeFlag(dir);
      const payloads = [
        "$(touch pwned-subshell)",
        "`touch pwned-backtick`",
        "; touch pwned-semicolon",
        "$(touch pwned-a) && $(touch pwned-b)",
      ];
      for (const sid of payloads) {
        const result = run(dir, JSON.stringify({ session_id: sid }));
        assert.equal(result.status, 0, sid);
        const ctx = additionalContextOf(result.stdout);
        assert.ok(ctx.includes(`--session ${sid}`), `expected the raw session id embedded verbatim, got: ${ctx}`);
      }
      for (const name of ["pwned-subshell", "pwned-backtick", "pwned-semicolon", "pwned-a", "pwned-b"]) {
        assert.ok(!existsSync(join(dir, name)), `${name} must not have been created -- session_id must never be executed`);
      }
    });

    // Note: a session_id containing a literal double quote is a known,
    // deliberately out-of-scope gap -- the script's ASCII/no-double-quote
    // CONTRACT covers only the text it constructs itself; session_id is
    // harness-supplied and passed through via plain `${sid}` substitution
    // with no escaping. That is a JSON-embedding robustness question, not
    // the CWE-78 shell-injection class this describe guards (there is no
    // eval/command-substitution anywhere in this script for session_id to
    // break out of). Deliberately not tested here.
  },
);

// NEW, post-#552 coverage: failure-capture.sh's scrub-before-persist /
// fail-closed / outcome-mapping contract, exercised for real for the first
// time by this suite (pre-#552, this logic lived only in a gitignored
// companion this suite never generated).
describe(
  "failure-capture.sh (real file, PostToolUseFailure/PermissionDenied/PermissionRequest, scrub-before-persist, skills#552)",
  { skip: JQ_SKIP },
  () => {
    const FC_ROOT = join(tmpdir(), `failure-capture-${process.pid}`);

    before(() => {
      rmSync(FC_ROOT, { recursive: true, force: true });
      mkdirSync(FC_ROOT, { recursive: true });
    });

    after(() => {
      rmSync(FC_ROOT, { recursive: true, force: true });
    });

    function freshProject() {
      const dir = join(FC_ROOT, `proj-${Math.floor(1e9 * Math.random())}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    }

    function writeFlag(dir, signal = "corrections+failures") {
      mkdirSync(join(dir, ".ievo"), { recursive: true });
      writeFileSync(
        join(dir, ".ievo/evo-auto.flag"),
        `enabled: true\nenabled_at: 2026-08-05T00:00:00Z\nenabled_by: test\nsignal: ${signal}\nauto_write_scope: project-wide-only\n`,
      );
    }

    // Identity-ish scrub stand-in that proves the pipeline (never re-tests
    // scrub.mjs's own redaction rules -- covered by scrub.test.mjs): reads
    // stdin whole, prefixes it so a test can tell "this went through scrub"
    // apart from "this is the raw record". `behavior: "empty"` models a
    // scrub failure (no stdout) regardless of exit code, since the real
    // failure-capture.sh only checks stdout emptiness (`[ -n "$scrubbed" ]`),
    // never scrub.mjs's exit status.
    function stubScrub(dir, { behavior = "passthrough" } = {}) {
      mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
      const p = join(dir, ".ievo/hooks/scripts/scrub.mjs");
      const body =
        behavior === "empty"
          ? `process.exit(0);\n`
          : `
import { readFileSync } from "node:fs";
const input = readFileSync(0, "utf8");
process.stdout.write("SCRUBBED:" + input);
`;
      writeFileSync(p, body);
    }

    // Records each invocation (full argv, plus the content of whatever
    // --text-file points at) to a JSONL log the test can read afterward --
    // proves both WHAT reached the accumulator and HOW (never a raw string
    // interpolated into an argument).
    function stubAccumulator(dir) {
      mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
      const p = join(dir, ".ievo/hooks/scripts/evolution_candidates.mjs");
      const body = `
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
const entry = { args };
const tfIdx = args.indexOf("--text-file");
if (tfIdx !== -1) {
  try { entry.textFileContent = readFileSync(args[tfIdx + 1], "utf8"); } catch (e) { entry.textFileContent = null; }
}
mkdirSync(".ievo/hooks/tmp", { recursive: true });
appendFileSync(".ievo/hooks/tmp/acc-invocations.jsonl", JSON.stringify(entry) + "\\n");
process.exit(0);
`;
      writeFileSync(p, body);
    }

    function readAccInvocations(dir) {
      const p = join(dir, ".ievo/hooks/tmp/acc-invocations.jsonl");
      if (!existsSync(p)) return [];
      return readFileSync(p, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    }

    function tmpPendingPath(dir) {
      return join(dir, ".ievo/hooks/tmp/failure-pending.txt");
    }

    function run(dir, stdin, env = {}) {
      return spawnSync("sh", [FAILURE_CAPTURE_SCRIPT], {
        cwd: dir,
        input: stdin,
        encoding: "utf-8",
        env: baseEnv(env),
      });
    }

    it("flag absent -> silent, exit 0, no side effects", () => {
      const dir = freshProject();
      const result = run(dir, JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1" }));
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
    });

    it("flag present, signal corrections-only (default) -> no capture even for a real failure event", () => {
      const dir = freshProject();
      writeFlag(dir, "corrections-only");
      stubScrub(dir);
      stubAccumulator(dir);
      const result = run(
        dir,
        JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash", tool_error: "boom" }),
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
      assert.deepEqual(readAccInvocations(dir), []);
    });

    it("scrub.mjs missing -> fail-closed, no accumulator call, no tmp file (contract: missing scrub.mjs drops the record)", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubAccumulator(dir); // ACC present
      // no stubScrub() call -- SCRUB path genuinely absent
      const result = run(
        dir,
        JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash", tool_error: "boom" }),
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
      assert.deepEqual(readAccInvocations(dir), []);
    });

    it("evolution_candidates.mjs missing -> also fail-closed (both ACC and SCRUB required up front)", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir); // SCRUB present
      // no stubAccumulator() -- ACC genuinely absent
      const result = run(
        dir,
        JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash", tool_error: "boom" }),
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
    });

    it("scrub.mjs produces no output (regardless of its own exit code) -> record dropped, never persisted even transiently (fail-closed for content)", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir, { behavior: "empty" });
      stubAccumulator(dir);
      const result = run(
        dir,
        JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash", tool_error: "boom" }),
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)), "no raw or partial record may reach disk, even transiently");
      assert.deepEqual(readAccInvocations(dir), []);
    });

    it("happy path -> the accumulator receives the SCRUBBED content via --text-file, never the raw record as a Bash argument", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      const rawSecretLike = "boom: token=super-secret-value-with-a-'quote-and-;-semicolon";
      const result = run(
        dir,
        JSON.stringify({
          hook_event_name: "PostToolUseFailure",
          session_id: "s1",
          tool_name: "Bash",
          tool_error: rawSecretLike,
        }),
      );
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      const tmpPath = tmpPendingPath(dir);
      assert.ok(existsSync(tmpPath));
      const tmpContent = readFileSync(tmpPath, "utf8");
      assert.ok(tmpContent.startsWith("SCRUBBED:"), "the persisted tmp file must hold scrub.mjs's OUTPUT, not the raw record");
      const invocations = readAccInvocations(dir);
      assert.equal(invocations.length, 1);
      const [invocation] = invocations;
      assert.ok(invocation.args.includes("append"));
      assert.ok(invocation.args.includes("--text-file"));
      assert.ok(invocation.args.includes("--scope"));
      assert.ok(invocation.args.includes("tool-failure"));
      assert.ok(invocation.args.includes("--session"));
      assert.ok(invocation.args.includes("s1"));
      // The strongest CWE-78-class assurance for this hook (same class
      // closed for correction-capture.sh in #373, cross-referenced in this
      // file's own header comment): none of the argv entries carry the raw
      // tool output text -- it only ever reaches the accumulator through the
      // file --text-file points at, never interpolated into a Bash argument.
      for (const arg of invocation.args) {
        assert.ok(!arg.includes(rawSecretLike), `raw tool output leaked into a CLI argument: ${arg}`);
      }
      assert.equal(invocation.textFileContent, tmpContent, "the accumulator must read exactly what was persisted to the tmp file");
    });

    for (const [event, outcome] of [
      ["PostToolUseFailure", "failed"],
      ["PermissionDenied", "denied"],
      ["PermissionRequest", "requested"],
    ]) {
      it(`${event} -> outcome: "${outcome}"`, () => {
        const dir = freshProject();
        writeFlag(dir);
        stubScrub(dir);
        stubAccumulator(dir);
        const result = run(dir, JSON.stringify({ hook_event_name: event, session_id: "s1", tool_name: "Bash", tool_error: "x" }));
        assert.equal(result.status, 0);
        const tmpContent = readFileSync(tmpPendingPath(dir), "utf8");
        const record = JSON.parse(tmpContent.slice("SCRUBBED:".length));
        assert.equal(record.outcome, outcome);
        assert.equal(record.event, event);
      });
    }

    it("an unrecognized event -> exits immediately, no capture", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      const result = run(dir, JSON.stringify({ hook_event_name: "SomeOtherEvent", session_id: "s1" }));
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
    });

    it("detail.error prefers tool_error over error/reason", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      run(
        dir,
        JSON.stringify({
          hook_event_name: "PostToolUseFailure",
          session_id: "s1",
          tool_name: "Bash",
          tool_error: "from-tool_error",
          error: "from-error",
          reason: "from-reason",
        }),
      );
      const record = JSON.parse(readFileSync(tmpPendingPath(dir), "utf8").slice("SCRUBBED:".length));
      assert.equal(record.detail.error, "from-tool_error");
    });

    it("detail.error falls back to error when tool_error is absent", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      run(
        dir,
        JSON.stringify({
          hook_event_name: "PostToolUseFailure",
          session_id: "s1",
          tool_name: "Bash",
          error: "from-error",
          reason: "from-reason",
        }),
      );
      const record = JSON.parse(readFileSync(tmpPendingPath(dir), "utf8").slice("SCRUBBED:".length));
      assert.equal(record.detail.error, "from-error");
    });

    it("detail.error falls back to reason when neither tool_error nor error is present", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      run(
        dir,
        JSON.stringify({
          hook_event_name: "PostToolUseFailure",
          session_id: "s1",
          tool_name: "Bash",
          reason: "from-reason",
        }),
      );
      const record = JSON.parse(readFileSync(tmpPendingPath(dir), "utf8").slice("SCRUBBED:".length));
      assert.equal(record.detail.error, "from-reason");
    });

    it("detail.error is null when none of tool_error/error/reason are present", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      run(dir, JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash" }));
      const record = JSON.parse(readFileSync(tmpPendingPath(dir), "utf8").slice("SCRUBBED:".length));
      assert.equal(record.detail.error, null);
    });

    it("malformed (non-JSON) stdin -> jq record-building fails, drops silently, no crash", () => {
      const dir = freshProject();
      writeFlag(dir);
      stubScrub(dir);
      stubAccumulator(dir);
      const result = run(dir, "not json {{{");
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.ok(!existsSync(tmpPendingPath(dir)));
    });

    it("prefers a live CLAUDE_PLUGIN_ROOT for both ACC and SCRUB when present", () => {
      const dir = freshProject();
      writeFlag(dir);
      const pluginRoot = join(dir, "fake-plugin-root");
      mkdirSync(join(pluginRoot, "scripts"), { recursive: true });
      writeFileSync(
        join(pluginRoot, "scripts/evolution_candidates.mjs"),
        `
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
mkdirSync(".ievo/hooks/tmp", { recursive: true });
appendFileSync(".ievo/hooks/tmp/acc-invocations.jsonl", JSON.stringify({ args, from: "plugin-root" }) + "\\n");
process.exit(0);
`,
      );
      writeFileSync(
        join(pluginRoot, "scripts/scrub.mjs"),
        `
import { readFileSync } from "node:fs";
process.stdout.write("SCRUBBED-FROM-PLUGIN-ROOT:" + readFileSync(0, "utf8"));
`,
      );
      // Deliberately do NOT stub the project-local copies -- proves the live
      // CLAUDE_PLUGIN_ROOT path wins over the (absent) project-local
      // fallback, not merely that it's tried first when both exist.
      const result = run(
        dir,
        JSON.stringify({ hook_event_name: "PostToolUseFailure", session_id: "s1", tool_name: "Bash", tool_error: "x" }),
        { CLAUDE_PLUGIN_ROOT: pluginRoot },
      );
      assert.equal(result.status, 0);
      const tmpContent = readFileSync(tmpPendingPath(dir), "utf8");
      assert.ok(tmpContent.startsWith("SCRUBBED-FROM-PLUGIN-ROOT:"));
      const invocations = readAccInvocations(dir);
      assert.equal(invocations.length, 1);
      assert.equal(invocations[0].from, "plugin-root");
    });
  },
);
