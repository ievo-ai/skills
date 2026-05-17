---
description: Install iEvo into the current project — copy iEVO.md kernel, inject reference into CLAUDE.md/AGENTS.md, set up evolution log directories.
allowed-tools: Read, Write, Edit, Bash, Glob
---

# Install iEvo

Install the iEvo plugin into the current project.

## Steps

1. **Find the project's instruction file** in project root, in this priority order:
   - If `CLAUDE.md` exists → use it
   - Else if `AGENTS.md` exists → use it
   - Otherwise → create `CLAUDE.md` with empty content

2. **Copy the kernel** — copy `${CLAUDE_PLUGIN_ROOT}/iEVO.md` → `<project-root>/.ievo/iEVO.md`. Create `.ievo/` directory if it doesn't exist.

3. **Inject marker block** at the end of the chosen instruction file:
   ```markdown

   <!-- ievo:start -->
   @.ievo/iEVO.md
   <!-- ievo:end -->
   ```
   **Idempotent:** if the marker block already exists (search for `<!-- ievo:start -->`), do nothing — do not duplicate.

4. **Create evolution log directories**:
   - `.ievo/evolution/agents/` (with `.gitkeep`)
   - `.ievo/evolution/skills/` (with `.gitkeep`)

## Report

After completion, output:
- Which instruction file was used or created
- Whether `iEVO.md` was newly copied or already existed
- Confirmation that evolution directories are ready
- A one-line next-step suggestion: "Run `/ievo:evolution <lesson>` to record your first learning."
