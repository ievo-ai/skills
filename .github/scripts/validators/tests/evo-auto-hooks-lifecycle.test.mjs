// Regression test for skills#446: `/ievo:evo-auto-enable` wired committed
// `.claude/settings.json` hook entries at paths that lived entirely under
// gitignored `.ievo/hooks/` — a clean clone had the entries but not the
// scripts they pointed at, so `sh .ievo/hooks/scripts/correction-capture.sh`
// exited 127 (and `UserPromptSubmit` fires on every message, so the failure
// was not a one-time cosmetic error).
//
// `evo-auto-enable`/`evo-auto-disable` are prose-protocol SKILL.md files, not
// executable modules — there is no `.mjs` to import and unit-test. This
// mechanically re-derives the documented fix instead: the three wired paths
// are TRACKED, STATIC dispatcher shims (`evo-auto-enable/SKILL.md` Step
// 3.5.1b) that `exec` a gitignored `*.local.sh` companion when present, else
// no-op. The shim bodies and the gitignore block below are byte-identical to
// that SKILL.md section, and the first describe below ASSERTS that against
// the real file — an edit to either side fails the suite instead of letting
// the SKILL.md source drift away from what is actually exercised here. The
// same describe pins `init/SKILL.md` Step 10 AND `hooks-setup/SKILL.md` Step 8
// — the other two skills that write this gitignore block — to the identical
// literal, since a re-run of either that reverted to a blanket `.ievo/hooks/`
// line would silently re-ignore the shims this suite proves must stay tracked.
//
// This actually shells the flow through a real, scratch git repo (init →
// commit → clone) so the gitignore negation pattern is verified against
// git's real behavior, not just reasoned about — a directory-form `dir/`
// ignore cannot be selectively un-ignored later, which is the exact trap the
// fix has to avoid.

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

// The SKILL.md this whole file re-derives. Read once, asserted against every
// literal below so a SKILL.md-side edit can never ship with this suite green.
const ENABLE_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/evo-auto-enable/SKILL.md",
);
const ENABLE_SKILL_SRC = readFileSync(ENABLE_SKILL, "utf-8");

// `/ievo:init` Step 10 writes the SAME gitignore block (skills#446): an init
// re-run must never re-add a blanket `.ievo/hooks/` line over the negations,
// so the two skills have to agree byte-for-byte on the pattern.
const INIT_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/init/SKILL.md",
);
const INIT_SKILL_SRC = readFileSync(INIT_SKILL, "utf-8");

// `/ievo:hooks-setup` Step 8 is the third writer of this block: it may run
// standalone in a project that never ran init, and it writes its own scripts
// under `.ievo/hooks/scripts/`. A blanket line appended there re-ignores the
// shims just as effectively as one appended by init, so it is pinned the same
// way.
const HOOKS_SETUP_SKILL = resolve(
  __dirname,
  "../../../../plugins/ievo/skills/hooks-setup/SKILL.md",
);
const HOOKS_SETUP_SKILL_SRC = readFileSync(HOOKS_SETUP_SKILL, "utf-8");

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

function sh(cwd, relPath, stdin = "{}") {
  return spawnSync("sh", [relPath], { cwd, input: stdin, encoding: "utf-8" });
}

// Byte-identical to the three fenced code blocks in
// evo-auto-enable/SKILL.md Step 3.5.1b -- literal, not templated, so a
// change to either place is visible as a diff instead of silently drifting.
// Enforced by the "literals stay in sync" describe below, not by convention.
const SHIMS = {
  "correction-capture.sh": `#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (UserPromptSubmit), skills#446.
# Committed so a clean clone of \`.claude/settings.json\` + this file never
# 127s. Delegates to the per-clone companion when present; otherwise a
# silent no-op (correction-capture.sh's stdout is parsed as hook JSON, so
# this never prints anything of its own). Static and identical across every
# project -- safe to overwrite unconditionally on every enable/re-enable.
# CONTRACT: fail-silent, non-blocking. NO \`set -e\`.
# \`sh "$REAL"\` needs no exec bit on the companion, so there is deliberately
# no \`[ -x ]\` guard -- one would silently no-op if the chmod never stuck.

REAL=.ievo/hooks/scripts/correction-capture.local.sh
[ -f "$REAL" ] && exec sh "$REAL"
exit 0
`,

  "evo-analysis-nudge.sh": `#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (SessionStart), skills#446.
# Same contract as correction-capture.sh's shim above -- see that file for
# the full rationale. Static and identical across every project.
# CONTRACT: fail-silent, non-blocking. NO \`set -e\`.
#
# Unlike the other two shims this one does NOT no-op silently when its
# companion is absent (skills#551). The companion is gitignored, so "flag
# committed, per-clone regeneration never run" -- the exact drift the
# companion's own wiring check exists to report -- is precisely the case in
# which that check cannot run at all: a fresh clone would stay silent for a
# whole session, which IS the reported bug. This shim is the only tracked,
# always-present file on that path, so it owns the one check the companion
# structurally cannot make about itself: flag ON, companion missing. Every
# richer check (vendored copies, sibling companions, wired hook entries,
# pending-candidate count) stays in the companion, which runs whenever it
# exists. SessionStart stdout is parsed as hook JSON, so the warning rides
# the same additionalContext channel the companion already uses, and the
# ASCII / no-double-quotes contract applies here too.

REAL=.ievo/hooks/scripts/evo-analysis-nudge.local.sh
[ -f "$REAL" ] && exec sh "$REAL"

[ -f .ievo/evo-auto.flag ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\\n' 'iEvo auto-evolution: .ievo/evo-auto.flag is ON but this clone has no generated hook logic (drift detected) -- .ievo/hooks/scripts/evo-analysis-nudge.local.sh is missing, so capture may be partly or entirely inactive. The generated companions are gitignored and must be regenerated once per clone: run /ievo:evo-auto-enable to repair -- it is idempotent and safe to re-run on top of a partial install.'
exit 0
`,

  "failure-capture.sh": `#!/bin/sh
# iEvo auto-evolution -- tracked dispatcher shim (PostToolUseFailure /
# PermissionDenied / Codex PermissionRequest), skills#446. Same contract as
# correction-capture.sh's shim above. Static and identical across every
# project.
# CONTRACT: fail-silent, non-blocking. NO \`set -e\`.

REAL=.ievo/hooks/scripts/failure-capture.local.sh
[ -f "$REAL" ] && exec sh "$REAL"
exit 0
`,
};

// Byte-identical to evo-auto-enable/SKILL.md Step 3.5.1's gitignore block.
const GITIGNORE_BLOCK = `.ievo/hooks/*
!.ievo/hooks/scripts/
.ievo/hooks/scripts/*
!.ievo/hooks/scripts/correction-capture.sh
!.ievo/hooks/scripts/evo-analysis-nudge.sh
!.ievo/hooks/scripts/failure-capture.sh
`;

// Same JSON shape evo-auto-enable/SKILL.md Step 3.5.4/3.6 writes into
// .claude/settings.json — the wired paths never change under this fix.
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
// entries above, but it wires the SAME shim paths.
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

// A minimal stand-in for the real, accumulator-calling companion Steps
// 3.5.2/3.5.3/3.6 generate -- not byte-identical to those (much larger)
// scripts. Exercises the dispatch mechanism end-to-end without re-testing
// evolution_candidates.mjs, which is covered by its own test suite.
function realCompanion(eventName) {
  return `#!/bin/sh
[ -f .ievo/evo-auto.flag ] || exit 0
printf '{"hookSpecificOutput":{"hookEventName":"${eventName}","additionalContext":"real"}}\\n'
exit 0
`;
}

const ROOT = join(tmpdir(), `evo-auto-hooks-lifecycle-${process.pid}`);
const ORIGIN = join(ROOT, "origin");
const CLONE = join(ROOT, "clone");

function writeShimsAndFlag(dir) {
  mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), GITIGNORE_BLOCK);
  writeFileSync(
    join(dir, ".claude/settings.json"),
    JSON.stringify(SETTINGS_JSON, null, 2),
  );
  mkdirSync(join(dir, ".codex"), { recursive: true });
  writeFileSync(
    join(dir, ".codex/hooks.json"),
    JSON.stringify(CODEX_HOOKS_JSON, null, 2),
  );
  writeFileSync(
    join(dir, ".ievo/evo-auto.flag"),
    "enabled: true\nenabled_at: 2026-07-25T00:00:00Z\nenabled_by: test\nsignal: corrections-only\nauto_write_scope: project-wide-only\n",
  );
  for (const [name, body] of Object.entries(SHIMS)) {
    const p = join(dir, ".ievo/hooks/scripts", name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
}

before(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ORIGIN, { recursive: true });

  git(ORIGIN, "init", "-q");
  writeShimsAndFlag(ORIGIN);

  // Untracked/ignored siblings that a machine which already ran the skill
  // once would have on disk -- must NOT survive a clone.
  mkdirSync(join(ORIGIN, ".ievo/hooks/scripts/vendor"), { recursive: true });
  writeFileSync(
    join(ORIGIN, ".ievo/hooks/scripts/vendor/evolution_candidates.mjs"),
    "// vendored copy stand-in\n",
  );
  writeFileSync(
    join(ORIGIN, ".ievo/hooks/scripts/correction-capture.local.sh"),
    realCompanion("UserPromptSubmit"),
  );
  mkdirSync(join(ORIGIN, ".ievo/hooks/tmp"), { recursive: true });
  writeFileSync(join(ORIGIN, ".ievo/hooks/tmp/correction-pending.txt"), "x");
  writeFileSync(join(ORIGIN, ".ievo/hooks/init-complete"), "2026-07-25\n");

  git(ORIGIN, "add", "-A");
  git(ORIGIN, "commit", "-q", "-m", "seed");

  git(ROOT, "clone", "-q", ORIGIN, CLONE);
});

after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("literals stay in sync with their SKILL.md sources", () => {
  // Without these, every assertion below tests only this file's own copy of
  // the shims: a SKILL.md-side edit (the source of truth users actually get)
  // would ship broken with the suite green. It drifted once already.
  it("each shim body appears verbatim in Step 3.5.1b", () => {
    for (const [name, body] of Object.entries(SHIMS)) {
      assert.ok(
        ENABLE_SKILL_SRC.includes(body),
        `${name}: this file's shim literal is not present verbatim in ${ENABLE_SKILL} — one side drifted; re-sync both`,
      );
    }
  });

  it("the gitignore block appears verbatim in Step 3.5.1", () => {
    assert.ok(
      ENABLE_SKILL_SRC.includes(GITIGNORE_BLOCK),
      `this file's gitignore block is not present verbatim in ${ENABLE_SKILL} — one side drifted; re-sync both`,
    );
  });

  it("init/SKILL.md Step 10 writes the same block, never a blanket line", () => {
    assert.ok(
      INIT_SKILL_SRC.includes(GITIGNORE_BLOCK),
      `${INIT_SKILL} Step 10 no longer emits the negation-capable block verbatim — an init re-run would re-ignore the tracked shims; re-sync both`,
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
      `${HOOKS_SETUP_SKILL} Step 8 no longer emits the negation-capable block verbatim — a standalone hooks-setup run would re-ignore the tracked shims; re-sync both`,
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

  it("the companion-on-disk check is ordered after the step that writes the last companion", () => {
    // The check loops over all three companions, but `failure-capture.local.sh`
    // is only written by Step 3.6. Placed in Step 3.5.4 (where it originally
    // shipped) a linear enable run prints `MISSING: failure-capture.local.sh`
    // and the step's own rule says "do NOT claim success" — a false failure on
    // the happy path. Pin the ordering rather than the prose.
    const checkAt = ENABLE_SKILL_SRC.indexOf(
      'for f in correction-capture evo-analysis-nudge failure-capture; do',
    );
    const step36At = ENABLE_SKILL_SRC.indexOf(
      "### 3.6 Write + wire the failure-capture hook",
    );
    const companionWriteAt = ENABLE_SKILL_SRC.indexOf(
      "chmod +x .ievo/hooks/scripts/failure-capture.local.sh",
    );
    assert.ok(checkAt > 0, "companion-on-disk check missing from " + ENABLE_SKILL);
    assert.ok(step36At > 0 && companionWriteAt > step36At);
    assert.ok(
      checkAt > companionWriteAt,
      `the companion-on-disk check precedes the step that writes failure-capture.local.sh in ${ENABLE_SKILL} — a linear enable run would report a spurious MISSING: line`,
    );
  });

  it("the wired-command dry-run is ordered after the step that writes the last companion", () => {
    // Same ordering trap as the check above, reached by a different route.
    // Once `evo-analysis-nudge.local.sh` grew a wiring-integrity check
    // (skills#551), dry-running `evo-analysis-nudge.sh` became a probe of the
    // whole install — so run from Step 3.5.4 it reports `failure-capture.
    // local.sh` and the failure-capture hook entry as drift, neither of which
    // Step 3.6 has written yet. Exit stays 0 (SessionStart cannot block), but
    // the enabling agent reads that stdout and may report a broken install on
    // a perfectly healthy linear enable. The behavioural half of this is the
    // "mid-enable state" test in the wiring-integrity describe below.
    const dryRunAt = ENABLE_SKILL_SRC.indexOf(
      'sh ".ievo/hooks/scripts/$f.sh" < /dev/null',
    );
    const companionWriteAt = ENABLE_SKILL_SRC.indexOf(
      "chmod +x .ievo/hooks/scripts/failure-capture.local.sh",
    );
    const wiringCheckAt = ENABLE_SKILL_SRC.indexOf(
      "# Wiring-integrity check -- same platform-detection rule as /ievo:init",
    );
    assert.ok(dryRunAt > 0, "wired-command dry-run missing from " + ENABLE_SKILL);
    assert.ok(
      wiringCheckAt > 0,
      `the nudge's wiring-integrity check is gone from ${ENABLE_SKILL} — re-check whether this ordering still matters`,
    );
    assert.ok(
      dryRunAt > companionWriteAt,
      `the wired-command dry-run precedes the step that writes failure-capture.local.sh in ${ENABLE_SKILL} — a linear enable run would print a spurious drift warning`,
    );
  });

  it("SKILL.md wires exactly the three shim paths this file exercises", () => {
    for (const name of Object.keys(SHIMS)) {
      assert.ok(
        ENABLE_SKILL_SRC.includes(`.ievo/hooks/scripts/${name}`),
        `${name}: wired path missing from ${ENABLE_SKILL}`,
      );
    }
  });
});

describe("gitignore negation pattern (real git, skills#446)", () => {
  it("tracks exactly the three dispatcher shims, nothing else under .ievo/hooks/", () => {
    const tracked = git(ORIGIN, "ls-files", ".ievo/hooks/")
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
    assert.deepEqual(tracked, [
      ".ievo/hooks/scripts/correction-capture.sh",
      ".ievo/hooks/scripts/evo-analysis-nudge.sh",
      ".ievo/hooks/scripts/failure-capture.sh",
    ]);
  });

  it("still ignores the vendor/, tmp/, *.local.sh, and signal-file paths", () => {
    for (const p of [
      ".ievo/hooks/scripts/vendor",
      ".ievo/hooks/scripts/vendor/evolution_candidates.mjs",
      ".ievo/hooks/scripts/correction-capture.local.sh",
      ".ievo/hooks/tmp/correction-pending.txt",
      ".ievo/hooks/init-complete",
    ]) {
      const r = spawnSync("git", ["check-ignore", "-q", p], {
        cwd: ORIGIN,
      });
      assert.equal(r.status, 0, `expected ${p} to be ignored`);
    }
  });

  it("does NOT ignore the three dispatcher shim paths", () => {
    for (const name of Object.keys(SHIMS)) {
      const p = `.ievo/hooks/scripts/${name}`;
      const r = spawnSync("git", ["check-ignore", "-q", p], { cwd: ORIGIN });
      assert.equal(r.status, 1, `expected ${p} to NOT be ignored`);
    }
  });
});

describe("clean clone (before any per-clone regeneration)", () => {
  it("has the tracked shims and .claude/settings.json, but no companions/vendor", () => {
    const tracked = git(CLONE, "ls-files").trim().split("\n").sort();
    assert.ok(tracked.includes(".claude/settings.json"));
    assert.ok(tracked.includes(".ievo/evo-auto.flag"));
    for (const name of Object.keys(SHIMS)) {
      assert.ok(tracked.includes(`.ievo/hooks/scripts/${name}`));
    }
    for (const missing of [
      ".ievo/hooks/scripts/vendor/evolution_candidates.mjs",
      ".ievo/hooks/scripts/correction-capture.local.sh",
      ".ievo/hooks/init-complete",
    ]) {
      assert.ok(!tracked.includes(missing));
    }
    // Ignored/untracked siblings must not merely be untracked in git's
    // index -- a clean `git clone` never materializes them on disk at all.
    for (const missingOnDisk of [
      ".ievo/hooks/scripts/vendor",
      ".ievo/hooks/scripts/correction-capture.local.sh",
      ".ievo/hooks/init-complete",
    ]) {
      assert.ok(
        !existsSync(join(CLONE, missingOnDisk)),
        `expected ${missingOnDisk} absent from clone`,
      );
    }
  });

  it("never exits 127 on the reported repro command (sh <shim>)", () => {
    for (const name of Object.keys(SHIMS)) {
      const result = sh(
        CLONE,
        `.ievo/hooks/scripts/${name}`,
        '{"session_id":"repro"}',
      );
      assert.notEqual(
        result.status,
        127,
        `${name}: expected no "command not found", got ${JSON.stringify(result)}`,
      );
      assert.equal(result.status, 0, `${name}: expected exit 0`);
    }
  });

  it("the two capture shims stay silent with no companion present", () => {
    // UserPromptSubmit fires on every message and PostToolUseFailure on every
    // failed tool call, so neither may say anything of its own -- their stdout
    // is parsed as hook JSON and a per-message warning would be unusable noise.
    for (const name of ["correction-capture.sh", "failure-capture.sh"]) {
      const result = sh(CLONE, `.ievo/hooks/scripts/${name}`, '{"session_id":"repro"}');
      assert.equal(result.status, 0, name);
      assert.equal(
        result.stdout,
        "",
        `${name}: expected silent no-op with no companion present`,
      );
    }
  });

  it("the SessionStart shim warns instead of staying silent (skills#551)", () => {
    // This clone is the exact skills#551 repro: `.ievo/evo-auto.flag` is
    // tracked (Step 5 tells users to commit it) and so is the shim, but the
    // companion holding the wiring-integrity check is gitignored and was
    // never regenerated here. Before the fix the shim no-opped, so the
    // companion's own check could not run and the whole session passed with
    // zero capture and zero warning. The check has to live in the tracked
    // file to fire at all.
    const result = sh(
      CLONE,
      ".ievo/hooks/scripts/evo-analysis-nudge.sh",
      '{"session_id":"repro"}',
    );
    assert.equal(result.status, 0);
    assert.notEqual(
      result.stdout,
      "",
      "expected a drift nudge on a fresh clone, got silence -- the exact skills#551 bug",
    );
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("evo-analysis-nudge.local.sh"));
    assert.ok(ctx.includes("/ievo:evo-auto-enable"));
    assert.ok(
      !ctx.includes('"'),
      "additionalContext must stay double-quote-free (JSON-embedding contract)",
    );
    assert.ok(
      [...ctx].every((c) => c.charCodeAt(0) < 128),
      "additionalContext must stay ASCII-only",
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
      });
      assert.notEqual(result.status, 127, JSON.stringify(hook));
      assert.equal(result.status, 0, JSON.stringify(hook));
    }
  });
});

describe("per-clone step (companions regenerated locally)", () => {
  before(() => {
    for (const [companion, eventName] of [
      ["correction-capture.local.sh", "UserPromptSubmit"],
      ["evo-analysis-nudge.local.sh", "SessionStart"],
      ["failure-capture.local.sh", "PostToolUseFailure"],
    ]) {
      const p = join(CLONE, ".ievo/hooks/scripts", companion);
      writeFileSync(p, realCompanion(eventName));
      chmodSync(p, 0o755);
    }
  });

  it("each shim delegates to its own companion once one exists", () => {
    for (const [shimName, eventName] of [
      ["correction-capture.sh", "UserPromptSubmit"],
      ["evo-analysis-nudge.sh", "SessionStart"],
      ["failure-capture.sh", "PostToolUseFailure"],
    ]) {
      const result = sh(CLONE, `.ievo/hooks/scripts/${shimName}`);
      assert.equal(result.status, 0, shimName);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.hookSpecificOutput.hookEventName, eventName, shimName);
    }
  });

  it("delegates to a companion that lacks the exec bit (no `[ -x ]` guard)", () => {
    // `sh "$REAL"` never needs the exec bit, so the shim must not gate on
    // one -- an `[ -x ]` guard would turn a chmod that didn't stick into a
    // silent, permanent no-op instead of a working hook.
    const companion = join(
      CLONE,
      ".ievo/hooks/scripts/correction-capture.local.sh",
    );
    chmodSync(companion, 0o644);
    try {
      const result = sh(CLONE, ".ievo/hooks/scripts/correction-capture.sh");
      assert.equal(result.status, 0);
      assert.equal(
        JSON.parse(result.stdout).hookSpecificOutput.hookEventName,
        "UserPromptSubmit",
      );
    } finally {
      chmodSync(companion, 0o755);
    }
  });

  it("the tracked shim file itself is unmodified (clean git status)", () => {
    const status = git(
      CLONE,
      "status",
      "--porcelain",
      ".ievo/hooks/scripts/correction-capture.sh",
    );
    assert.equal(status.trim(), "");
  });

  it("the *.local.sh companion stays gitignored (never accidentally committed)", () => {
    const r = spawnSync(
      "git",
      ["check-ignore", "-q", ".ievo/hooks/scripts/correction-capture.local.sh"],
      { cwd: CLONE },
    );
    assert.equal(r.status, 0);
    const tracked = git(CLONE, "ls-files", ".ievo/hooks/scripts/")
      .trim()
      .split("\n");
    assert.ok(
      !tracked.includes(".ievo/hooks/scripts/correction-capture.local.sh"),
    );
  });
});

describe("disable (companions removed, shims left in place)", () => {
  before(() => {
    for (const companion of [
      "correction-capture.local.sh",
      "evo-analysis-nudge.local.sh",
      "failure-capture.local.sh",
    ]) {
      rmSync(join(CLONE, ".ievo/hooks/scripts", companion), { force: true });
    }
    // A real `/ievo:evo-auto-disable` removes the flag as well as the
    // companions (see evo-auto-disable/SKILL.md) -- model that faithfully.
    // Without this the state below would be flag-ON-companion-missing, i.e.
    // drift, and the SessionStart shim would correctly warn rather than go
    // quiet (that state is covered by the clean-clone repro above and by the
    // tracked-shim describe at the end of this file).
    rmSync(join(CLONE, ".ievo/evo-auto.flag"), { force: true });
  });

  it("every shim returns to a safe silent no-op once auto-mode is off", () => {
    for (const name of Object.keys(SHIMS)) {
      const result = sh(CLONE, `.ievo/hooks/scripts/${name}`);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
    }
  });

  it("the tracked shims remain present and unmodified", () => {
    const tracked = git(CLONE, "ls-files", ".ievo/hooks/")
      .trim()
      .split("\n")
      .sort();
    assert.deepEqual(tracked, [
      ".ievo/hooks/scripts/correction-capture.sh",
      ".ievo/hooks/scripts/evo-analysis-nudge.sh",
      ".ievo/hooks/scripts/failure-capture.sh",
    ]);
    const status = git(CLONE, "status", "--porcelain", ".ievo/hooks/");
    assert.equal(status.trim(), "");
  });
});

// Regression test for skills#551: `.ievo/evo-auto.flag` could exist (claiming
// auto-evolution ENABLED) with none of the vendored fallback copies, `.local.sh`
// companions, or wired hook-config entries actually on disk -- e.g. a
// hand-written flag file, or a `/ievo:evo-auto-enable` run that died partway
// through Step 3/3.5 -- and nothing surfaced the mismatch, not a nudge, not an
// error, for the length of an entire session. `evo-auto-enable/SKILL.md` Step
// 3.5.3 now extends the SessionStart nudge script to also check for this drift
// every session and warn when found.
//
// Unlike the `realCompanion()` stand-in above (used only to exercise the
// tracked-shim -> `.local.sh` dispatch mechanism generically), this describe
// extracts the REAL, full `evo-analysis-nudge.local.sh` body from SKILL.md
// verbatim and executes it -- the wiring-integrity check is real, testable
// logic now, and a stand-in would let it drift from what actually ships with
// every test here still green.
describe("evo-analysis-nudge.local.sh wiring-integrity check (skills#551)", () => {
  // Pulls the fenced ```sh block that immediately follows Step 3.5.3's heading
  // out of the already-loaded SKILL.md source -- same "verbatim, not templated"
  // principle as the SHIMS/GITIGNORE_BLOCK literals above, just extracted
  // instead of duplicated (this script is much larger than the four-line shims).
  function extractFencedScript(src, afterHeading) {
    const headingAt = src.indexOf(afterHeading);
    assert.ok(headingAt > 0, `heading not found in SKILL.md: ${afterHeading}`);
    const fenceOpenAt = src.indexOf("```sh\n", headingAt);
    assert.ok(fenceOpenAt > 0, `no fenced sh block after heading: ${afterHeading}`);
    const bodyStart = fenceOpenAt + "```sh\n".length;
    const fenceCloseAt = src.indexOf("\n```", bodyStart);
    assert.ok(fenceCloseAt > 0, `unterminated fenced block after heading: ${afterHeading}`);
    return src.slice(bodyStart, fenceCloseAt + 1);
  }

  const NUDGE_SCRIPT = extractFencedScript(
    ENABLE_SKILL_SRC,
    "### 3.5.3 Write the SessionStart analysis nudge",
  );

  it("the extracted script matches the documented contract (sanity check on the extraction itself)", () => {
    assert.ok(NUDGE_SCRIPT.startsWith("#!/bin/sh\n"));
    assert.ok(NUDGE_SCRIPT.includes("evo-auto.flag"));
    assert.ok(NUDGE_SCRIPT.includes("HOOKS_FILE"));
  });

  const ROOT = join(tmpdir(), `evo-analysis-nudge-wiring-${process.pid}`);
  const SCRIPT_PATH = join(ROOT, "evo-analysis-nudge.local.sh");

  before(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(SCRIPT_PATH, NUDGE_SCRIPT);
    chmodSync(SCRIPT_PATH, 0o755);
  });

  after(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  // Fresh, isolated project dir per test (no git needed -- this check is pure
  // filesystem + hook-config presence, unlike the gitignore describes above).
  function freshProject() {
    const dir = join(ROOT, `proj-${Math.floor(1e9 * Math.random())}`);
    mkdirSync(join(dir, ".ievo/hooks/scripts/vendor"), { recursive: true });
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
  // evolution_candidates.mjs itself (covered by its own suite).
  function stubAccumulator(dir, { count = "0", broken = false } = {}) {
    const p = join(dir, ".ievo/hooks/scripts/vendor/evolution_candidates.mjs");
    const body = broken
      ? `process.stdout.write("not-a-number");\nprocess.exit(0);\n`
      : `const cmd = process.argv[2];\nif (cmd === "count") process.stdout.write(${JSON.stringify(String(count))});\nprocess.exit(0);\n`;
    writeFileSync(p, body);
  }

  function writeVendorScrub(dir) {
    writeFileSync(join(dir, ".ievo/hooks/scripts/vendor/scrub.mjs"), "process.exit(0);\n");
  }

  function writeCompanions(dir, names) {
    for (const name of names) {
      writeFileSync(join(dir, ".ievo/hooks/scripts", name), "#!/bin/sh\nexit 0\n");
    }
  }

  const ALL_COMPANIONS = [
    "correction-capture.local.sh",
    "evo-analysis-nudge.local.sh",
    "failure-capture.local.sh",
  ];

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

  function writeFullWiring(dir) {
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeClaudeSettings(dir);
  }

  function runNudge(dir, env = {}) {
    // Strip (not just override-to-undefined -- unreliable across Node
    // versions in spawnSync's env option) any platform-detection signal this
    // test process itself might carry, so each test's env fully controls
    // platform detection instead of partially inheriting the CI runner's own.
    const baseEnv = { ...process.env };
    delete baseEnv.CLAUDECODE;
    delete baseEnv.CODEX_CLI;
    delete baseEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    delete baseEnv.__CFBundleIdentifier;
    return spawnSync("sh", [SCRIPT_PATH], {
      cwd: dir,
      input: "{}",
      encoding: "utf-8",
      env: { ...baseEnv, ...env },
    });
  }

  function parseAdditionalContext(stdout) {
    const parsed = JSON.parse(stdout);
    return parsed.hookSpecificOutput.additionalContext;
  }

  it("flag absent -> completely silent, wiring check never runs", () => {
    const dir = freshProject();
    // No flag written at all.
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("flag present, nothing else installed -> drift warning naming every missing piece (skills#551 repro)", () => {
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "expected a drift nudge, got silence -- the exact skills#551 bug");
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("vendored scrub.mjs"));
    assert.ok(ctx.includes("correction-capture.local.sh"));
    assert.ok(ctx.includes("failure-capture.local.sh"));
    // Never names ITSELF: this script is `evo-analysis-nudge.local.sh`, so a
    // self-check could only report a state in which it does not run. The
    // tracked shim owns that one (see the describe below). `.local.sh` is
    // matched deliberately -- "evo-analysis-nudge hook entry in ..." names the
    // wired SHIM path and is a different, legitimate finding.
    assert.ok(
      !ctx.includes("evo-analysis-nudge.local.sh"),
      "the companion must not claim to detect its own absence",
    );
    assert.ok(ctx.includes(".claude/settings.json"));
    assert.ok(ctx.includes("/ievo:evo-auto-enable"));
    assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
  });

  it("mid-enable state (Step 3.5 done, Step 3.6 not yet) -> drift naming exactly the two artifacts 3.6 writes", () => {
    // Why SKILL.md defers the wired-command dry-run to the END of Step 3.6
    // (pinned structurally by the ordering test in the first describe): at the
    // point Step 3.5.4 finishes, everything Step 3.5 installs is on disk but
    // `failure-capture.local.sh` and its hook entries are not — Step 3.6 writes
    // them. This script cannot tell that transient state apart from real drift,
    // and by design it should not try: a check that special-cased "we are
    // probably mid-enable" would also stay quiet on a run that genuinely died
    // between 3.5.4 and 3.6, which is one of the failure modes skills#551 is
    // about. So the state is fixed by ordering the dry-run, not by teaching the
    // script to guess. This test pins the exact output that ordering avoids.
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" });
    writeVendorScrub(dir);
    writeCompanions(dir, [
      "correction-capture.local.sh",
      "evo-analysis-nudge.local.sh",
    ]);
    writeClaudeSettings(dir, { includeFailure: false });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(
      ctx.includes(
        "(drift detected) -- failure-capture.local.sh, failure-capture hook entry in .claude/settings.json. Capture may be",
      ),
      `mid-enable drift must name exactly the two artifacts Step 3.6 writes, in order; got: ${ctx}`,
    );
    // Nothing Step 3.5 already wrote may appear in the missing list.
    for (const notMissing of [
      "vendored evolution_candidates.mjs",
      "vendored scrub.mjs",
      "correction-capture.local.sh",
      "correction-capture hook entry",
      "evo-analysis-nudge hook entry",
    ]) {
      assert.ok(
        !ctx.includes(notMissing),
        `${notMissing} was written by Step 3.5 and must not read as drift`,
      );
    }
  });

  it("vendored evolution_candidates.mjs itself absent -> reported, via the real (non-stubbed) node ENOENT fallback", () => {
    // Every other test calls stubAccumulator(), which always writes this
    // exact file -- so the "vendored evolution_candidates.mjs" branch of the
    // wiring check (SKILL.md's `[ -f .../vendor/evolution_candidates.mjs ] ||
    // note_missing ...`) is never driven false anywhere else in this suite.
    // Deliberately skip stubAccumulator() here: `node "$ACC" count` then hits
    // a real ENOENT, and the script's own `2>/dev/null || echo 0` fallback
    // (not a test stub) supplies n=0, while the wiring check independently
    // reports the file as missing.
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeClaudeSettings(dir);
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("vendored evolution_candidates.mjs"));
  });

  it("fully wired, zero pending candidates -> silent, no false-positive nudge", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeFullWiring(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("fully wired, N pending candidates -> ordinary count nudge, no drift language", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeFullWiring(dir);
    stubAccumulator(dir, { count: "4" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("4 evolution candidate(s)"));
    assert.ok(!ctx.includes("drift detected"));
  });

  it("one hook entry missing from an otherwise-wired config -> combined drift + pending-count message", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeClaudeSettings(dir, { includeFailure: false });
    stubAccumulator(dir, { count: "2" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes("failure-capture hook entry in .claude/settings.json"));
    assert.ok(ctx.includes("2 evolution candidate(s)"));
    assert.ok(!ctx.includes("correction-capture hook entry"), "only the actually-missing entry should be named");
  });

  it("no hook config file at all -> names the file itself as missing", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    // Deliberately no .claude/settings.json and no .codex/hooks.json.
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes(".claude/settings.json itself (no hook config file at all)"));
  });

  it("Codex platform ($CODEX_CLI set) checks .codex/hooks.json, never .claude/settings.json", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeClaudeSettings(dir); // fully wired on the WRONG (Claude Code) file
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CODEX_CLI: "1" });
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(
      ctx.includes(".codex/hooks.json itself (no hook config file at all)"),
      "a Codex session must judge .codex/hooks.json, not treat an unrelated .claude/settings.json as proof of wiring",
    );
  });

  it("Codex platform, fully wired at .codex/hooks.json -> silent, no drift", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeCodexHooks(dir);
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CODEX_CLI: "1" });
    assert.equal(result.stdout, "");
  });

  it("$CLAUDECODE set together with $CODEX_CLI set -> Codex wins (Step 1.5 ordering: Claude Code requires CODEX_CLI unset)", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ALL_COMPANIONS);
    writeClaudeSettings(dir); // wired only on the Claude Code side
    stubAccumulator(dir, { count: "0" });
    const result = runNudge(dir, { CLAUDECODE: "1", CODEX_CLI: "1" });
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes(".codex/hooks.json itself (no hook config file at all)"));
  });

  it("a broken/non-numeric accumulator no longer silently swallows the drift check (the actual regression)", () => {
    // Before skills#551, a `count` parse failure hit an early `exit 0` in the
    // same case statement, skipping the wiring check entirely -- so a broken
    // accumulator masked its own drift instead of surfacing it. Full wiring
    // minus one companion + a garbage (non-numeric) count output must still
    // report the missing companion.
    const dir = freshProject();
    writeFlag(dir);
    writeVendorScrub(dir);
    writeCompanions(dir, ["correction-capture.local.sh", "evo-analysis-nudge.local.sh"]); // failure-capture missing
    writeClaudeSettings(dir);
    stubAccumulator(dir, { broken: true });
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "a broken accumulator must not mask a real wiring gap");
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("failure-capture.local.sh"));
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
  // block's freshProject/writeFlag/writeVendorScrub/writeCompanions/
  // writeClaudeSettings/writeFullWiring/stubAccumulator/runNudge/
  // parseAdditionalContext helpers via closure, rather than redefining them.
  describe("autocommit-failed detection (skills#552)", () => {
    // Same "verbatim, not templated" extraction principle as extractFencedScript
  // above, generalized to a plain (unlabeled) fence -- the pending.md scaffold
  // in Step 3 isn't a `sh` block.
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
  // what /ievo:evo-auto-enable actually writes to a fresh pending.md. Pulling
  // it from source (not a hand-copied duplicate) means a future edit to the
  // scaffold that reintroduces a self-matching line breaks this test instead
  // of shipping silently, the same regression skills#552's own fix (a
  // standalone `- Scope: autocommit-failed` line self-matching this script's
  // detector) went undetected by until a manual dry-run caught it.
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
    writeFullWiring(dir);
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
    writeFullWiring(dir);
    stubAccumulator(dir, { count: "0" });
    writeAutocommitEntry(dir);
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "a real autocommit-failed entry must fire the nudge even with n=0 and no wiring drift");
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.startsWith("iEvo auto-evolution:"), "bare else-branch prefix must still be present");
    assert.ok(ctx.includes("Scope: autocommit-failed"));
    assert.ok(ctx.includes("do NOT re-run it through Step 0/1 classification"));
    assert.ok(ctx.includes("Delete the entry from pending.md once you have committed the file manually"));
    assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
  });

  it("autocommit note appended after the wiring-drift message (missing-only branch)", () => {
    const dir = freshProject();
    writeFlag(dir);
    stubAccumulator(dir, { count: "0" }); // wiring left incomplete -> drift
    writeAutocommitEntry(dir);
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(ctx.includes("drift detected"), "drift branch must still fire on its own");
    assert.ok(
      ctx.includes("Re-run /ievo:evo-auto-enable to repair"),
      "drift message body must be intact",
    );
    assert.ok(
      ctx.includes("Scope: autocommit-failed"),
      "autocommit note must be appended after the drift message, not dropped",
    );
    assert.ok(
      ctx.indexOf("drift detected") < ctx.indexOf("Scope: autocommit-failed"),
      "drift message must come before the appended autocommit note",
    );
  });

  it("autocommit note appended after the pending-candidate-count message (count-only branch)", () => {
    const dir = freshProject();
    writeFlag(dir);
    writeFullWiring(dir);
    stubAccumulator(dir, { count: "3" });
    writeAutocommitEntry(dir);
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    const ctx = parseAdditionalContext(result.stdout);
    assert.ok(
      ctx.includes("3 evolution candidate(s) captured in earlier sessions are pending review"),
      "count branch must still fire on its own",
    );
    assert.ok(
      ctx.includes("Scope: autocommit-failed"),
      "autocommit note must be appended after the count message, not dropped",
    );
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
    const ctx = parseAdditionalContext(result.stdout);
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
    writeFullWiring(dir);
    stubAccumulator(dir, { count: "0" });
    // Deliberately no writePendingScaffold()/writeAutocommitEntry() call --
    // exercises the `[ -f "$PENDING" ]` guard's false branch directly.
    const result = runNudge(dir, { CLAUDECODE: "1" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });
  });
});

// The other half of the skills#551 check, and the half that actually reaches a
// fresh clone. Everything the describe above exercises lives in the GITIGNORED
// `evo-analysis-nudge.local.sh`, which by definition cannot run when it was
// never regenerated on this clone -- so the flag-committed / companion-absent
// state (the reported repro) needed its check in the TRACKED shim, where it is
// present on every clone. The clean-clone describe near the top of this file
// covers the same behavior through a real git clone; these tests isolate the
// shim's own decision table in scratch dirs, including the states a clone
// cannot easily reproduce (flag absent, companion present).
describe("evo-analysis-nudge.sh tracked shim: flag-vs-companion check (skills#551)", () => {
  const ROOT = join(tmpdir(), `evo-analysis-nudge-shim-${process.pid}`);
  const SHIM_REL = ".ievo/hooks/scripts/evo-analysis-nudge.sh";

  before(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
  });

  after(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  // Each case gets its own project dir holding a real copy of the shim at the
  // exact wired path, so `cwd`-relative lookups behave as they do in a project.
  function project({ flag = false, companion = null } = {}) {
    const dir = join(ROOT, `proj-${Math.floor(1e9 * Math.random())}`);
    mkdirSync(join(dir, ".ievo/hooks/scripts"), { recursive: true });
    const shimPath = join(dir, SHIM_REL);
    writeFileSync(shimPath, SHIMS["evo-analysis-nudge.sh"]);
    chmodSync(shimPath, 0o755);
    if (flag) {
      writeFileSync(
        join(dir, ".ievo/evo-auto.flag"),
        "enabled: true\nenabled_at: 2026-08-05T00:00:00Z\nenabled_by: test\nsignal: corrections-only\nauto_write_scope: project-wide-only\n",
      );
    }
    if (companion !== null) {
      writeFileSync(
        join(dir, ".ievo/hooks/scripts/evo-analysis-nudge.local.sh"),
        companion,
      );
    }
    return dir;
  }

  it("flag ON, companion never regenerated -> drift warning (the reported repro)", () => {
    const dir = project({ flag: true });
    const result = sh(dir, SHIM_REL);
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, "", "expected a drift nudge, got silence");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes("drift detected"));
    assert.ok(ctx.includes(".ievo/evo-auto.flag is ON"));
    assert.ok(ctx.includes("evo-analysis-nudge.local.sh"));
    assert.ok(ctx.includes("/ievo:evo-auto-enable"));
    assert.ok(
      !ctx.includes('"'),
      "additionalContext must stay double-quote-free (JSON-embedding contract)",
    );
    assert.ok(
      [...ctx].every((c) => c.charCodeAt(0) < 128),
      "additionalContext must stay ASCII-only",
    );
  });

  it("emits exactly one line of hook JSON (SessionStart stdout is parsed, not logged)", () => {
    const dir = project({ flag: true });
    const { stdout } = sh(dir, SHIM_REL);
    assert.equal(stdout.split("\n").filter(Boolean).length, 1);
    assert.ok(stdout.endsWith("\n"));
  });

  it("flag absent -> completely silent (auto-mode is off; nothing has drifted)", () => {
    const dir = project({ flag: false });
    const result = sh(dir, SHIM_REL);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("companion present -> delegates, and adds nothing of its own", () => {
    // The shim must not double-report: once the companion exists it owns the
    // whole message (drift list + pending count), and `exec` replaces the
    // shim's process, so the companion's output is the only output.
    const dir = project({
      flag: true,
      companion: `#!/bin/sh\nprintf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"companion ran"}}\\n'\nexit 0\n`,
    });
    const result = sh(dir, SHIM_REL);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(
      payload.hookSpecificOutput.additionalContext,
      "companion ran",
      "the shim must delegate wholesale, never prepend its own warning",
    );
  });

  it("companion present but silent -> stays silent (a healthy, fully-wired project)", () => {
    const dir = project({ flag: true, companion: "#!/bin/sh\nexit 0\n" });
    const result = sh(dir, SHIM_REL);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });

  it("a companion that fails still leaves the session unblocked", () => {
    // `exec` hands the exit status to the caller, so a broken companion can
    // surface a non-zero status -- but SessionStart is non-blocking on both
    // platforms and the shim itself must never turn that into a crash or a
    // partial-JSON write of its own.
    const dir = project({ flag: true, companion: "#!/bin/sh\nexit 3\n" });
    const result = sh(dir, SHIM_REL);
    assert.equal(result.stdout, "");
    assert.notEqual(result.status, 127);
  });

  it("delegates to a companion that lacks the exec bit (no `[ -x ]` guard)", () => {
    const dir = project({
      flag: true,
      companion: `#!/bin/sh\nprintf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"companion ran"}}\\n'\nexit 0\n`,
    });
    chmodSync(join(dir, ".ievo/hooks/scripts/evo-analysis-nudge.local.sh"), 0o644);
    const result = sh(dir, SHIM_REL);
    assert.equal(result.status, 0);
    assert.equal(
      JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
      "companion ran",
    );
  });
});
