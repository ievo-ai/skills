---
description: Uninstall iEvo from the current project. Asks the user before removing the project-rules marker block from CLAUDE.md/AGENTS.md. Preserves `.ievo/` evolution logs.
allowed-tools: Read, Edit, Glob, AskUserQuestion
---

# Uninstall iEvo

Remove iEvo's project-rules reference from the project. Evolution logs in `.ievo/` are preserved as user-owned data and a future-curator data source.

## Steps

### 1. Find the marker block

Look for `<!-- ievo:start -->` in project root files, in priority order:
- `CLAUDE.md`
- `AGENTS.md`

If **no file contains the marker** → report "no iEvo reference found (already uninstalled or never recorded a project-wide evolution)" and exit. Do not delete anything.

### 2. Warn the user, ask before removing

If the marker is found, use `AskUserQuestion` to confirm:

- **Question:** `Remove iEvo's project-rules reference from <file>?`
- **Header:** `Uninstall`
- **Options** (single-select):
  - `Remove reference (Recommended)` — description: `Removes the marker block from <file>. Your project rules in .ievo/evolution/project.md will be preserved but no longer loaded by Claude in this project.`
  - `Keep reference` — description: `Leave the marker block in <file>. Useful if you plan to keep using iEvo in this project.`

### 3. Act on the choice

- **Remove reference:** delete everything between `<!-- ievo:start -->` and `<!-- ievo:end -->` inclusive of both markers. Clean up any extra blank lines left behind so the file doesn't have a gap.
- **Keep reference:** do nothing, report "no changes made".

### 4. Preserve user data

**Never** delete:
- `.ievo/iEVO.md` (if it exists from older iEvo versions)
- `.ievo/evolution/project.md` — your project rules
- `.ievo/evolution/agents/*.md` — agent evolution logs
- `.ievo/evolution/skills/*.md` — skill evolution logs

These belong to the project and survive uninstall.

## Report

After completion:

- Which file was modified (or "none — kept reference" / "none — no marker found")
- Confirmation: `.ievo/evolution/` is preserved at `<path>`. Contains: N project rules, M agents, K skills.
- If user kept the reference: remind them they can run `/ievo:uninstall` again later.

## Rules

- **Never delete `.ievo/`.** Even if the user wants to fully remove iEvo, deleting their evolution log is their explicit action with `rm -rf .ievo/`. We don't do destructive cleanup.
- **Always confirm before editing.** No automatic removal of the marker block. The marker affects how Claude reads the project's context — modifying it without consent is a footgun.
- **Idempotent.** Running `/ievo:uninstall` twice is safe — second run finds no marker and reports "already uninstalled".
