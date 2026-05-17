---
description: Refresh kernel from the plugin upstream and replay all evolution logs against fresh upstream agents/skills.
allowed-tools: Read, Write, Edit, Glob, Bash, Task
---

# Update iEvo

Refresh the project's iEvo state from the plugin upstream. Use this after the iEvo plugin itself has been updated (`/plugin update ievo-ai/skills`) to pull new kernel rules and bring evolved agents/skills back in sync with their new upstream versions.

## Steps

### 1. Refresh the kernel

Copy `${CLAUDE_PLUGIN_ROOT}/iEVO.md` → `<project-root>/.ievo/iEVO.md`, overwriting the existing file. The kernel is not project-evolved in v0.1, so no replay is needed for it.

### 2. Replay agent evolutions

For each file matching `.ievo/evolution/agents/<name>.md`:

1. Read the fresh upstream agent from `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`.
2. If the upstream agent no longer exists (renamed/removed), **flag this clearly** in the final report — do NOT silently drop the evolution.
3. Read all `## section` blocks from the evolution log.
4. For each section, integrate its body into the agent text using Claude. Use the prompt:
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
5. After all sections are applied, write the result to `<project-root>/.claude/agents/<name>.md`.

### 3. Replay skill evolutions

Same logic as step 2, but with paths:
- Log: `.ievo/evolution/skills/<name>.md`
- Upstream: `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md`
- Local target: `.claude/skills/<name>/SKILL.md`

## Report

For each agent/skill, output one line:
- `<name>: <N> evolutions replayed → <target path>` on success
- `<name>: UPSTREAM MISSING — log preserved, please review` on missing upstream
- `<name>: SKIPPED — no evolutions in log` for empty logs

Final summary: total agents replayed, total skills replayed, any flagged for review.
