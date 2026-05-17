---
name: evolution
description: Capture a lesson learned and integrate it into a local agent or skill file. Use when the user identifies a behavior to improve, a mistake to prevent, or a pattern to remember — anything worth persisting beyond the current session. Patches the target file in `.claude/` and appends a section to the evolution log at `.ievo/evolution/<type>/<name>.md`. The log is the source of truth and survives upstream plugin updates via replay.
license: MIT
compatibility: Designed for Claude Code with the iEvo plugin; usable on any agentskills.io-compatible platform with reduced functionality (no sub-agent isolation).
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Evolution

You apply natural-language lessons to local agent and skill files. You do not analyze code, fix bugs, or run validation. Take the lesson, integrate it into the right target file, and record it in the evolution log for future replay.

## Inputs

- **Required:** lesson text (free-form natural language)
- **Optional:** explicit target (e.g., "apply this to the spec-writer agent")

If the lesson is too vague to apply (e.g., "be better"), ask the user for clarification before doing anything. A useful lesson states a rule, a context where it applies, and ideally why.

## On Claude Code with the iEvo plugin

If the `evolution` sub-agent is available (Claude Code with `ievo-ai/skills` plugin installed), **delegate to it via the Task tool** with `subagent_type: "evolution"`. The sub-agent runs in isolated context, doesn't pollute the main conversation. Pass the lesson verbatim and let it report back.

If the Task tool is not available, OR the `evolution` sub-agent is not present, execute the steps below directly.

## Steps (when executing directly)

### 1. Classify the target

Decide whether the lesson belongs to an **agent** or a **skill**:

- **Agent** if it describes behavior of a sub-agent (when invoked, isolated context, has its own model). Example: "the spec-writer should always include acceptance criteria."
- **Skill** if it describes procedural knowledge that any agent can use. Example: "when writing PDFs, prefer the iText library."

Then decide the **target name**:

- If the user named the target explicitly → use that.
- Else scan available targets:
  - Local agents: `.claude/agents/*.md`
  - Local skills: `.claude/skills/*/SKILL.md`
  - Plugin agents: `${CLAUDE_PLUGIN_ROOT}/agents/*.md` (or other plugins in `.claude/plugins/`)
  - Plugin skills: `${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md`
- Match the lesson to the most relevant target by name and description.
- If nothing matches well, ask the user. Do not guess.

### 2. Localize the target if needed

If the target file lives in a plugin (not already in `.claude/<type>/`):

1. Find the plugin source path.
2. Copy the upstream file into the project:
   - Agent: `<plugin-source>` → `<project>/.claude/agents/<name>.md`
   - Skill: `<plugin-source-dir>` → `<project>/.claude/skills/<name>/` (the whole directory, including SKILL.md and any optional subdirectories)

This local copy now overrides the plugin's version when Claude resolves the agent/skill by name.

### 3. Patch the file

Read the current local file. Integrate the lesson:

- Find the most appropriate section in the file. If none fits cleanly, add a new section with a descriptive header.
- Add the rule in a way that matches the file's existing formatting, style, and tone.
- Do NOT duplicate existing rules. If a similar rule already exists, refine it instead of adding a parallel one.
- Do NOT remove or change unrelated existing content.
- Do NOT add HTML comment markers like `<!-- evolution:NNN -->`. Traceability lives in the evolution log, not inline annotations.

Write the updated file back.

### 4. Append to the evolution log

The log path is:
- Agents: `.ievo/evolution/agents/<name>.md`
- Skills: `.ievo/evolution/skills/<name>.md`

If the log file doesn't exist, create it with the header:
```markdown
# <Name> — Evolution Log
```

Append a new section at the bottom:
```markdown

## YYYY-MM-DD — <short title derived from lesson>
<full lesson text>
```

Use today's date in `YYYY-MM-DD` format. The title should be 5-10 words summarizing the rule.

### 5. Report

Output a short summary to the user:
- Target patched: `<type>/<name>` at `.claude/<type>/<name>.md` (or skill path)
- Whether it was already local or copied from plugin source
- Title of the section appended to the log
- Suggested next step: "Review the diff with `git diff` and commit if satisfied."

## Rules

- **No validation runs.** This MVP version does not run A/B tests, benchmarks, or external judges. Trust the lesson.
- **Idempotent failures.** If anything goes wrong mid-flow (e.g., write fails), do NOT silently leave inconsistent state — report what was done and what was not. The user can re-run with a fix.
- **Conflict surfacing.** If the lesson contradicts an existing rule in the target file, do NOT silently override. Quote the conflicting rule and ask the user how to resolve.
- **Log is source of truth.** Patched `.claude/<type>/<name>.md` files are derived artifacts — re-creatable from `upstream + log` via `/ievo:update`. The evolution log is what survives upstream changes.
