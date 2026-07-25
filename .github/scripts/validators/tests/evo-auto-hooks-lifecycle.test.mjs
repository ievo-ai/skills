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
// the SKILL.md source drift away from what is actually exercised here.
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

describe("literals stay in sync with evo-auto-enable/SKILL.md", () => {
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
      const r = spawnSync("test", ["-e", join(CLONE, missingOnDisk)]);
      assert.notEqual(r.status, 0, `expected ${missingOnDisk} absent from clone`);
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
      spawnSync("cat", [join(CLONE, ".claude/settings.json")], {
        encoding: "utf-8",
      }).stdout,
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
      spawnSync("cat", [join(CLONE, ".codex/hooks.json")], {
        encoding: "utf-8",
      }).stdout,
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
