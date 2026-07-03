---
name: evolution
description: Capture a lesson and add it to the appropriate evolution overlay — a per-agent file, per-skill file, or project-wide rules file. Use when the user identifies a behavior to improve, a mistake to prevent, a project convention, a team role, a tech-stack constraint, or any pattern worth persisting beyond the current session. Appends to `.ievo/evolution/<scope>/<name>.md` (overlay file). The agent/skill body is never modified — overlays are read at dispatch time via a one-time marker injection.
license: MIT
effort: low
compatibility: Works on any agentskills.io-compatible platform. Sub-agent isolation (Task tool dispatch) is available on Claude Code and Codex with the iEvo plugin; other platforms execute steps inline.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evolution

Apply natural-language lessons to evolution overlays. **Overlay model:** agent/skill files are never modified after vendoring (only a one-time marker injection points to the overlay). Lessons accumulate in `.ievo/evolution/<scope>/<name>.md` and are read live at every dispatch.

This is fundamentally different from "patch the file inline" — see the rationale at the bottom.

## Inputs

- **Required:** lesson text (free-form natural language)
- **Optional:** explicit target ("apply this to spec-writer agent" / "this is project-wide")

If the lesson is too vague (e.g. "be better"), ask for clarification first.

## On Claude Code with the iEvo plugin

If the `evolution` sub-agent is available, delegate via Task tool with `subagent_type: "evolution"`. Pass the lesson verbatim. Otherwise execute the steps below directly.

## Step 1: Classify scope

Three possible scopes:

1. **Project-wide** — applies to the whole project (tech stack, team conventions, project context). Signals: "we use X", "our team Y", "this codebase Z". → goes to `.ievo/evolution/project.md`
2. **Agent-specific** — names an agent or describes sub-agent behavior. Signals: "the spec-writer should X". → goes to `.ievo/evolution/agents/<name>.md`
3. **Skill-specific** — names a skill or describes procedural knowledge. Signals: "when working with PDFs, prefer X". → goes to `.ievo/evolution/skills/<name>.md`

For agent/skill scope, determine the **target name** explicitly (from user) or by matching the lesson against available targets:

**Project-level (preferred):**
- `.claude/agents/*.md`
- `.claude/skills/*/SKILL.md`
- `.claude/plugins/*/agents/*.md`
- `.claude/plugins/*/skills/*/SKILL.md`

**User-level (fallback — see Step 1.5):**
- `~/.claude/agents/*.md`
- `~/.claude/skills/*/SKILL.md`
- `~/.claude/plugins/*/agents/*.md`
- `~/.claude/plugins/*/skills/*/SKILL.md`

Match priority: project-level wins if same name appears in both. If no clear match anywhere, ask the user. Do not guess.

## Step 1.5: Handle user-level-only targets (downgrade to project)

If the target was matched **only at user-level** (no project-level instance), evolution can't directly apply to it — overlay files live in `<project>/.ievo/evolution/`, so they only affect this project. The user-level installation is shared across all projects on this machine.

Ask the user via `AskUserQuestion`:

- **Question:** `<target-name> is installed at user-level (~/.claude/). Copy to project to enable per-project evolution?`
- **Header:** `User-level`
- **Options** (single-select):
  - `Copy to project (Recommended)` — description: `Copies <target> into .claude/<type>/<name>/ in this project. Future evolutions apply to this project only. User-level original unchanged.`
  - `Skip` — description: `Don't evolve user-level installs. The lesson will not be recorded.`

If user picks **Copy to project**:
1. Copy the entire file/directory from user-level location → project location.
2. Treat as locally vendored. Proceed with Step 2-4 below (vendor step will see file exists locally and skip its own vendoring).
3. Record this in the overlay's first section: `**Trigger:** copied-from-user-level`.

If user picks **Skip**: exit without writing anything. Inform the user that the lesson was not captured.

**Note:** Once copied, the project-level version takes precedence (Claude Code name resolution). The user-level version still exists in other projects unchanged.

## Step 2: Ensure target file exists locally (vendor if needed)

Only for agent/skill scope. Skip for project-wide.

If the target lives in a plugin (not already in `.claude/<type>/`):

**Vendor the file:**
- For agent: copy `<plugin>/agents/<name>.md` → `<project>/.claude/agents/<name>.md`
- For skill: copy `<plugin>/skills/<name>/` directory → `<project>/.claude/skills/<name>/` (whole tree)

Use `gh api repos/<owner>/<repo>/contents/<path>` for fetching source.

**This is one-time.** Subsequent evolutions on the same target reuse the local copy.

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

### Skill (`.claude/skills/<name>/SKILL.md`)

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

Find project root instruction file. Priority:
- `CLAUDE.md` if exists
- Else `AGENTS.md` if exists
- Else create `CLAUDE.md` (empty if needed)

If the file already contains `<!-- ievo:start -->` marker → skip.
If no marker → append to end of file:

```markdown

<!-- ievo:start -->
@.ievo/evolution/project.md
<!-- ievo:end -->
```

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
- `agent self-correction` (future)
- `curator pattern (from N projects)` (future)

If unclear from the conversation, default to `user-observed mistake` or `user-defined convention` based on lesson tone.

## Step 5.5: Signal file for lifecycle hooks

After the overlay append in Step 4 succeeds, write `.ievo/hooks/evolution-captured` (create the directory if absent). The body is a single line: the ISO-8601 UTC timestamp of the capture. This file is the trigger for any `PostToolUse` hook configured via `/ievo:hooks-setup` matching `Write(.ievo/hooks/evolution-captured)`.

Use the Write tool (NOT Bash) so the matcher fires:
- `file_path`: `.ievo/hooks/evolution-captured` (relative — the `PostToolUse` matcher `Write(.ievo/hooks/evolution-captured)` only fires on this exact form; never prefix `<project>/` or use an absolute path)
- `content`: `<ISO-8601 UTC timestamp of this capture>`

Always write — costs nothing, unblocks hook configuration added later. Skip if Step 4 failed.

## Step 5.6: Offer to escalate the lesson upstream (optional)

After the overlay append (Step 4) and signal file (Step 5.5) succeed, decide — with a cheap, signal-word heuristic (no sub-agent dispatch, same lightweight style as Step 1) — whether this lesson is worth sharing upstream as feedback to the iEvo plugin repo. This keeps the capture fast: the default is silent, and you only ever prompt once.

**Classify upstream relevance. Default: local — and when local, do NOT prompt.**

The lesson is **upstream-relevant** only when it describes a gap, bug, or missing capability in the **iEvo plugin itself** — its skills, agents, commands, or overlay/marker mechanics — that would help *any* iEvo user, not just this project. Signals (need at least one, and it must be about iEvo's *own* behavior):

- It names an iEvo capability — a `/ievo:*` command, a bundled skill or agent (`evolution`, `feedback`, `deep-review`, `deep-reviewer`, `init`, `overlay-status`, …), the overlay/marker mechanics, or a `.ievo/` path — **and** frames a shortcoming or wish about *its* behavior ("didn't", "doesn't", "should", "missing", "can't", "no option to", "bug").
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

If the user picks **Share as feedback:** hand off to the `feedback` skill (`/ievo:feedback`) with the lesson **pre-filled** — this is flow **(C) Evolution handoff** in `feedback/SKILL.md` Step 0:

- Pass the **verbatim lesson text** (the same text appended to the overlay, in the user's original language) as the feedback body, so `feedback` **skips its Step 2** (collect feedback text — already known).
- Do **not** translate here. If the lesson is non-English, `feedback`'s Step 3.75 translates it **once**, at the feedback stage — never duplicate translation in this skill.
- `feedback` still runs its Step 1 (classify type), Step 3 (environment context), Step 3.5 (clarify — usually skipped, the lesson is already specific), Step 4 (build body), and — critically — **Step 5 (public-posting confirmation gate) unchanged**. Public posting stays behind that explicit `Submit` / `Cancel` gate; this skill never posts anything itself.

Then continue to Step 6. The overlay capture is already complete and stands regardless of the feedback outcome (share, skip, or cancel at the gate).

> When the capture was delegated to the `evolution` sub-agent (see "On Claude Code with the iEvo plugin" above), the sub-agent performs Steps 1–5.5 and reports its upstream-relevance verdict + the verbatim lesson back to you; a dispatched sub-agent has no way to prompt or launch another skill, so you (the caller) run this Step 5.6 — the offer and the `/ievo:feedback` handoff — in the main session.

## Step 6: Report

Output a short summary to the user:

- **Scope + target:** project | agents/<name> | skills/<name>
- **Overlay file:** path
- **Marker injected:** yes (first evolution for this target) | no (already present)
- **Section title added:** "<title>"
- **Upstream escalation:** not applicable (local lesson) | offered → handed off to `/ievo:feedback` | offered → skipped
- **Next:** "Review with `git diff .ievo/evolution/<scope>/<name>.md` and commit if satisfied."

## Rules

- **NEVER modify the agent/skill body.** Only inject the marker block ONCE per target. All rules accumulate in the overlay file. The agent file stays close to upstream forever.
- **Idempotent marker injection.** Re-running evolution on the same target adds to the overlay only — marker is already there from first run.
- **Verbatim lesson text.** No paraphrasing, no sanitization, no "improvement". The user's voice is the rule.
- **Conflict surfacing.** If the new lesson contradicts an existing section in the overlay, do NOT silently override. Quote the conflicting section and ask the user how to resolve.
- **Temporal anchoring.** A lesson that asserts *how the system currently works* (e.g. "workflow X runs only on non-draft PRs", "the /foo comment triggers nothing") rots silently: overlays are read live as instructions at every dispatch, so the claim keeps being applied after the system moves and the entry becomes false. When a lesson makes such a claim, surface it and steer it one of two ways before appending — do NOT silently rewrite the verbatim text (that would violate "Verbatim lesson text"): (a) if it is a point-in-time observation, anchor it in time — past tense, scoped to its moment, with a date/PR anchor where available ("at the time, before <PR/date>, X only ran on Y") so the entry stays true under ANY later change to the system it mentions; or (b) if it is meant as durable current behavior, it belongs in the owning agent/skill body or an overlay *rule*, not a dated snapshot entry. This complements Conflict surfacing: that rule catches a new lesson contradicting an old one; this one catches the system moving out from under an old, unchallenged lesson.
- **Idempotent failures.** If any step fails (write fails, gh api error), report what was done and what was not. Don't leave inconsistent state.
- **Project-wide overlay is shared.** All project-wide rules accumulate in one `project.md`. No splitting by topic — chronological with `## Trigger` field for context.

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

- `overlay-status/SKILL.md` — `/ievo:overlay-status` lists every overlay this skill has built up in the current project, grouped by scope (Project / agents / skills) with last-modified dates and one-line summaries. Use it after a `/ievo:evolution` capture to confirm the new lesson landed where you expected, or at session start to see what rules are already active.
- `hooks-setup/SKILL.md` — `/ievo:hooks-setup` configures a Claude Code hook that fires when the signal file `.ievo/hooks/evolution-captured` is written by Step 5.5 above (lets you get a desktop notification on every capture).
- `feedback/SKILL.md` — `/ievo:feedback` files a lesson upstream as a public GitHub issue in `ievo-ai/skills`. Step 5.6 above hands off to it (flow C, lesson pre-filled) when a captured lesson looks like it's about the iEvo plugin itself; public posting stays behind that skill's explicit confirmation gate (its Step 5).
