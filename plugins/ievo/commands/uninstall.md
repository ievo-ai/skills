---
description: Uninstall iEvo from the current project. Removes injected overlay markers (project-wide and per-agent/skill) after explicit user confirmation. Always preserves `.ievo/` directory.
allowed-tools: Read, Edit, Glob, Bash, AskUserQuestion
---

# Uninstall iEvo

Remove iEvo's injected markers from the project. Evolution overlays in `.ievo/evolution/` and diagnostic logs in `.ievo/log/` are preserved as user-owned data — fully removable by user manually if desired.

## Steps

### 1. Discover all injected markers

Scan project for `<!-- ievo:start -->` markers in three locations:

**Project-wide markers** (in CLAUDE.md / AGENTS.md):
```bash
grep -l '<!-- ievo:start -->' CLAUDE.md AGENTS.md 2>/dev/null
```

**Agent overlay markers** (in `.claude/agents/*.md`):
```bash
grep -l '<!-- ievo:start -->' .claude/agents/*.md 2>/dev/null
```

**Skill overlay markers** (in `.claude/skills/*/SKILL.md`):
```bash
grep -l '<!-- ievo:start -->' .claude/skills/*/SKILL.md 2>/dev/null
```

Collect three lists. If **all three are empty** → report "no iEvo markers found (already uninstalled or never used)" and exit. Do not delete anything.

### 2. Show the user what was found

Print a structured summary before asking:

```
Found iEvo markers in:
- Project-wide: <CLAUDE.md or AGENTS.md or "none">
- Agent overlays: <list, e.g. "python-pro, code-reviewer" or "none">
- Skill overlays: <list, e.g. "pydicom, changelog" or "none">

Preserved (will NOT be deleted):
- .ievo/evolution/ — your evolution overlays (rules accumulated by /ievo:evo)
- .ievo/log/ — diagnostic logs
- .ievo/cache/ — repo indices (re-derivable)
```

### 3. Ask for removal scope

Use `AskUserQuestion`:

- **Question:** `Remove iEvo markers?`
- **Header:** `Uninstall`
- **Options** (single-select):
  - `Remove all markers (Recommended)` — description: `Removes <!-- ievo:start -->...<!-- ievo:end --> blocks from CLAUDE.md/AGENTS.md, and from every .claude/agents/*.md and .claude/skills/*/SKILL.md that has them. Overlay files in .ievo/evolution/ remain — they just stop being read by Claude.`
  - `Remove only project-wide marker` — description: `Keep agent/skill overlay markers (vendored content stays evolution-aware). Useful if you only want to detach project-level rules.`
  - `Cancel — keep everything` — description: `No changes. Run /ievo:uninstall again later if you change your mind.`

### 4. Act on the choice

For each file that gets a marker removed:

1. Read file content.
2. Find the marker block: `<!-- ievo:start -->` ... `<!-- ievo:end -->` (inclusive).
3. Delete the block plus any extra blank lines left dangling.
4. Write back.

**Scope of action by choice:**

| Choice | Affects |
|--------|---------|
| Remove all markers | Project-wide marker + ALL agent/skill overlay markers |
| Remove only project-wide | ONLY CLAUDE.md/AGENTS.md marker |
| Cancel | Nothing |

### 5. Preserve `.ievo/` directory

**Never** delete:
- `.ievo/evolution/project.md` — your project rules
- `.ievo/evolution/agents/*.md` — agent evolution overlays
- `.ievo/evolution/skills/*.md` — skill evolution overlays
- `.ievo/log/*.md` — diagnostic logs
- `.ievo/cache/` — repo indices

If user wants total cleanup, instruct them: "Run `rm -rf .ievo/` manually to also remove evolution data."

### 6. Vendored content (`.claude/agents/`, `.claude/skills/`)

When agents/skills were vendored via `/ievo:init`, they live in `.claude/`. With markers removed, they continue working but without overlay-aware loading.

Do **not** delete the vendored content — it's the user's project's local files now. If they want to fully remove, they can `rm .claude/agents/<name>.md` and `rm -rf .claude/skills/<name>/`.

Mention in the final report:
```
Vendored agents/skills (in .claude/) are preserved. They will continue to
work without overlay-aware behavior. Run `rm` manually to fully remove.
```

### 7. Plugin installs in `.claude/settings.json`

If init added plugins via `extraKnownMarketplaces`/`enabledPlugins`, those entries remain in `.claude/settings.json`. Removing them is a separate concern (could be a future `/ievo:disable-plugin` command, or user edits settings.json directly).

For this MVP, do not auto-remove settings entries. Just mention them in the report:

```
Plugins added by /ievo:init (in .claude/settings.json):
- <plugin@marketplace>: <state>

To disable a plugin: /plugin disable <plugin@marketplace> --scope project
Or edit .claude/settings.json's enabledPlugins manually.
```

## Report

After completion:
- Files modified: list with counts of markers removed per file
- Files preserved: brief note about `.ievo/` and `.claude/`
- Optional follow-up actions: full cleanup commands

## Rules

- **Never auto-delete `.ievo/` content.** Evolution overlays are user data. The user knows what they want — surface the manual commands, don't run them.
- **Marker pattern is unified.** All marker blocks use `<!-- ievo:start -->`/`<!-- ievo:end -->`. Same find logic works everywhere.
- **Per-file confirm not required.** Once user picks scope in step 3, apply to all matching files. Batch by intent, not per-file.
- **Idempotent.** Re-running `/ievo:uninstall` after all markers removed reports "already uninstalled" cleanly.
