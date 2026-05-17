---
description: Uninstall iEvo — remove kernel injection from CLAUDE.md/AGENTS.md. Keeps .ievo/ directory (user evolution logs).
allowed-tools: Read, Edit, Glob
---

# Uninstall iEvo

Remove iEvo's kernel injection from the project. Evolution logs in `.ievo/` are preserved.

## Steps

1. **Find the marker block** in project root:
   - Check `CLAUDE.md` for `<!-- ievo:start -->`
   - Check `AGENTS.md` for `<!-- ievo:start -->`
   - If neither contains the marker → already uninstalled, report and exit.

2. **Remove the block** from the file with the marker. Delete everything between `<!-- ievo:start -->` and `<!-- ievo:end -->`, **inclusive** of both markers. Clean up any extra blank lines left behind.

3. **Preserve `.ievo/` directory.** Do NOT delete:
   - `.ievo/iEVO.md`
   - `.ievo/evolution/` and all contents
   These are user-owned evolution logs and a future-curator data source.

## Report

- Which file was modified, or "no marker found — already uninstalled"
- Reminder: `.ievo/` directory was preserved. To fully remove, the user should delete it manually.
