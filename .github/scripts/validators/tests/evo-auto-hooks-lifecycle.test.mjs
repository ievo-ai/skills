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

REAL=.ievo/hooks/scripts/evo-analysis-nudge.local.sh
[ -f "$REAL" ] && exec sh "$REAL"
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
      assert.equal(
        result.stdout,
        "",
        `${name}: expected silent no-op with no companion present`,
      );
    }
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
  });

  it("the shim returns to a safe silent no-op, same as a clean clone", () => {
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
    assert.ok(ctx.includes("evo-analysis-nudge.local.sh"));
    assert.ok(ctx.includes("failure-capture.local.sh"));
    assert.ok(ctx.includes(".claude/settings.json"));
    assert.ok(ctx.includes("/ievo:evo-auto-enable"));
    assert.ok(!ctx.includes('"'), "additionalContext must stay double-quote-free (JSON-embedding contract)");
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
});
