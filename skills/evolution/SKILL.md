---
name: evolution
description: Capture a lesson learned and integrate it into the right place — a local agent file, a local skill file, or the project's CLAUDE.md/AGENTS.md (for project-wide rules). Use when the user identifies a behavior to improve, a mistake to prevent, a project convention, a team role, a tech-stack constraint, or any pattern worth persisting beyond the current session. Patches the target and appends a section to the appropriate `.ievo/evolution/` log.
license: MIT
compatibility: Designed for Claude Code with the iEvo plugin; usable on any agentskills.io-compatible platform with reduced functionality (no sub-agent isolation).
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evolution

Apply natural-language lessons to the right place: agent files, skill files, or the project's instruction file (`CLAUDE.md` / `AGENTS.md`). Always record the lesson in a markdown log under `.ievo/evolution/` so it survives upstream plugin updates via replay.

## Inputs

- **Required:** lesson text (free-form natural language)
- **Optional:** explicit target (e.g., "apply this to the spec-writer agent" or "this is project-wide")

If the lesson is too vague to apply (e.g., "be better"), ask the user for clarification before doing anything. A useful lesson states a rule, a context where it applies, and ideally why.

## On Claude Code with the iEvo plugin

If the `evolution` sub-agent is available (Claude Code with `ievo-ai/skills` plugin installed), **delegate to it via the Task tool** with `subagent_type: "evolution"`. The sub-agent runs in isolated context, doesn't pollute the main conversation. Pass the lesson verbatim and let it report back.

If the Task tool is not available, OR the `evolution` sub-agent is not present, execute the steps below directly.

## Step 1: Classify the target

Three possible targets:

1. **Project-wide** — applies to *this whole project*, not to a specific agent or skill. Signals:
   - Tech stack: "we use Unity", "this is a Rust project", "FastAPI with Pydantic v2"
   - Team conventions: "our team uses trunk-based development", "PR titles start with the task ID"
   - Project context: "this app talks to a legacy XML API", "deployments happen on Tuesdays"
   - Roles: "Alice owns the auth module"
   - **Phrasing hint:** "in this project always X", "we / our team / our codebase", broad statements not tied to a single agent
2. **Agent-specific** — applies to *one sub-agent*. Signals:
   - Names an agent: "the spec-writer should X", "code-reviewer must Y"
   - Describes sub-agent behavior in isolated dispatch (`subagent_type:`)
3. **Skill-specific** — applies to *one skill / procedural knowledge*. Signals:
   - Names a skill: "the changelog skill should X"
   - Describes how to perform a task: "when writing PDFs, use the iText library"

Decide the **target name** if agent- or skill-specific:
- If the user named the target explicitly → use that.
- Else scan available targets:
  - Local agents: `.claude/agents/*.md`
  - Local skills: `.claude/skills/*/SKILL.md`
  - Plugin agents: `<plugin>/agents/*.md`
  - Plugin skills: `<plugin>/skills/*/SKILL.md`
- Match the lesson to the most relevant target by name and description.
- If nothing matches well, ask the user. Do not guess.

For project-wide lessons no "target name" is needed — they go to `CLAUDE.md`/`AGENTS.md` and `.ievo/evolution/project.md`.

## Step 2 (agent/skill targets only): Localize if needed

Skip this step for project-wide lessons.

If the target file lives in a plugin (not already in `.claude/<type>/`):

1. Find the plugin source path.
2. Copy the upstream file into the project:
   - Agent: `<plugin-source>` → `<project>/.claude/agents/<name>.md`
   - Skill: `<plugin-source-dir>` → `<project>/.claude/skills/<name>/` (the whole directory)

This local copy now overrides the plugin's version when Claude resolves the agent/skill by name.

## Step 3: Apply the lesson

### For agent/skill targets

Read the current local file. Integrate the lesson:

- Find the most appropriate section. If none fits cleanly, add a new section with a descriptive header.
- Match the file's existing formatting, style, and tone.
- Do NOT duplicate existing rules. If a similar rule already exists, refine it instead.
- Do NOT remove or change unrelated existing content.
- Do NOT add HTML comment markers like `<!-- evolution:NNN -->`. Traceability lives in the evolution log.

Write the updated file back.

### For project-wide lessons

The lesson is stored in `.ievo/evolution/project.md` and referenced from `CLAUDE.md` / `AGENTS.md`.

1. **Ensure the reference exists in the project's instruction file.**

   Pick the right file by priority:
   - If `CLAUDE.md` exists in project root → use it
   - Else if `AGENTS.md` exists → use it
   - Else → create `CLAUDE.md` (empty if needed)

   Check if it already contains the iEvo marker block:
   ```markdown
   <!-- ievo:start -->
   @.ievo/evolution/project.md
   <!-- ievo:end -->
   ```

   - **If yes** → do nothing here, move to step 2.
   - **If no** → append the marker block at the end of the file (with a leading blank line for separation). This is a one-time injection that happens on the very first project-wide evolution.

2. **Append the rule to `.ievo/evolution/project.md`.**

   If the file does not exist, create it with the header:
   ```markdown
   # Project — Evolution Log
   ```

   Append a new section at the bottom:
   ```markdown

   ## YYYY-MM-DD — <short title derived from lesson>
   <full lesson text>
   ```

   Use today's date in `YYYY-MM-DD` format. The title should be 5-10 words summarizing the rule.

## Step 4 (agent/skill targets only): Append to the per-target log

Skip for project-wide (that was handled in step 3).

The log path is:
- Agents: `.ievo/evolution/agents/<name>.md`
- Skills: `.ievo/evolution/skills/<name>.md`

If the log file doesn't exist, create it with the header:
```markdown
# <Name> — Evolution Log
```

Append:
```markdown

## YYYY-MM-DD — <short title derived from lesson>
<full lesson text>
```

## Step 5: Report

Output a short summary to the user:

- **For agent/skill targets:** which target was patched (path), whether it was already local or copied from plugin, the section title added to the log.
- **For project-wide:** which instruction file (CLAUDE.md or AGENTS.md), whether the marker block was newly added (first project-wide evolution) or already existed, the section title added to `project.md`.
- Suggested next step: "Review the diff with `git diff` and commit if satisfied."

## Rules

- **No validation runs.** This MVP version does not run A/B tests, benchmarks, or external judges. Trust the lesson.
- **Idempotent failures.** If anything goes wrong mid-flow (e.g., write fails), report what was done and what was not. Do not silently leave inconsistent state.
- **Conflict surfacing.** If the lesson contradicts an existing rule, do NOT silently override. Quote the conflicting rule and ask the user how to resolve.
- **Log is source of truth.** Patched `.claude/<type>/<name>.md` files (and the marker block in CLAUDE.md/AGENTS.md) are derived artifacts. The evolution log is what survives. The marker block can be re-injected at any time by recording another project-wide evolution.
- **Project-wide marker is one-time.** Inject only on first project-wide evolution. Subsequent project-wide rules just append to `project.md`. The marker stays where it is.
