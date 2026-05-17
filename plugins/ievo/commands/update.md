---
description: Replay all evolution logs against fresh upstream agents/skills. Run after the iEvo plugin or any of its dependencies have been updated.
allowed-tools: Read, Write, Edit, Glob, Bash, Task
---

# Update iEvo

Bring evolved local agents and skills back in sync with their updated upstream versions. Run this after the iEvo plugin (or any plugin whose agents/skills you've evolved) has been updated.

The project-wide rules in `.ievo/evolution/project.md` are **not replayed** — they live in the project and have no upstream. They keep working through the marker block in `CLAUDE.md`/`AGENTS.md`.

## Steps

### 1. Replay agent evolutions

For each file matching `.ievo/evolution/agents/<name>.md`:

1. Find the fresh upstream agent file. Search in this order:
   - `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` (this plugin)
   - `.claude/plugins/*/agents/<name>.md` (other installed plugins)
   - Or whichever plugin the agent originally came from (check existing `.claude/agents/<name>.md` git history or ask user)

2. If the upstream agent **no longer exists** (renamed/removed in upstream), **flag this clearly** in the final report — do NOT silently drop the evolution. The user must decide whether to delete the log or apply it to a different target.

3. Read all `## section` blocks from the evolution log.

4. For each section, integrate its body into the agent text. Use this prompt with Claude:
   ```
   Integrate this evolution into the agent document below.

   ## Evolution to integrate
   <section body>

   ## Current document
   <agent markdown>

   ## Instructions
   - Find the best section for this evolution
   - Match existing formatting, style, and tone
   - Do NOT duplicate existing rules
   - Do NOT remove or change existing content
   - Output ONLY the complete updated document, no code fences, no explanations
   ```

5. After all sections are applied (loop the prompt over each section), write the final result to `<project-root>/.claude/agents/<name>.md`.

### 2. Replay skill evolutions

Same logic as step 1, but with paths:
- Log: `.ievo/evolution/skills/<name>.md`
- Upstream search order:
  - `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`
  - `.claude/plugins/*/skills/<name>/SKILL.md`
- Local target: `.claude/skills/<name>/SKILL.md`

If `.claude/skills/<name>/` contains additional files (scripts, references, assets) from the upstream skill, copy/sync those too — but only `SKILL.md` is replayed through Claude. The other files come from upstream as-is.

### 3. Project-wide rules

**Not replayed.** `.ievo/evolution/project.md` is project-owned, not upstream-derived. It continues to be loaded via the marker block in `CLAUDE.md`/`AGENTS.md` (injected by `/ievo:evolution` on the first project-wide lesson).

If you want to refresh anything project-wide, edit `.ievo/evolution/project.md` directly or use `/ievo:evolution` with a new lesson.

## Report

For each agent/skill, output one line:
- `<name>: <N> evolutions replayed → <target path>` on success
- `<name>: UPSTREAM MISSING — log preserved, please review` on missing upstream
- `<name>: SKIPPED — empty log` for empty logs

Final summary:
- Total agents replayed: N
- Total skills replayed: M
- Any flagged for review: list them with paths to their logs

Suggest: `git diff` to review changes before committing.

## Rules

- **Project rules are sacred.** Never touch `.ievo/evolution/project.md` in this command — it has no upstream.
- **Flag, don't drop.** A missing upstream is a user-visible event, not a silent failure.
- **Order matters.** Replay sections in the order they appear in the log (chronological). Later evolutions may refine earlier ones — Claude handles this naturally by integrating each in sequence.
- **No automatic commit.** Update only writes files. The user reviews + commits.
