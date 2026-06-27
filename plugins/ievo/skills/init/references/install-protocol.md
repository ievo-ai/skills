# Step 9 — Install protocol

Two paths run in sequence (vendor first, then plugin). Per-item failure handling:
if any install step fails, report and continue with the next — do NOT abort the
flow. **Log section 9 after EACH install** (not after the batch) so the user sees
progress live in `tail -f`.

## 9a — Vendor path (skills + agents)

For each item in `final_vendor_list`:

**Skill:**
1. Determine source path in the upstream repo (from index-repos output).
2. Fetch the SKILL.md + supporting dirs (`scripts/`, `references/`, `assets/`)
   via `gh api`. Write the tree to `<project>/.claude/skills/<name>/`.
3. Inject the overlay marker at the top of SKILL.md (after frontmatter):
   ```markdown
   <!-- ievo:start -->
   **Before applying the instructions below**, read `.ievo/evolution/skills/<name>.md`
   if it exists and apply all rules from its sections.
   <!-- ievo:end -->
   ```
4. Create the overlay file `.ievo/evolution/skills/<name>.md`:
   ```markdown
   ---
   source:
     repo: <owner>/<repo>
     path: <source-path-in-repo>
     commit_sha: <short-sha from gh api>
     fetched_at: <ISO-timestamp>
   ---

   # <name> — Evolution Overlay

   ## <date> — Vendored from <owner>/<repo>
   **Trigger:** /ievo:init step 9
   Initial copy. No customizations yet.
   ```

**Agent:** same as skill, but:
- File path: `<project>/.claude/agents/<name>.md`
- Overlay marker inserted in the agent body (after frontmatter)
- Overlay file path: `.ievo/evolution/agents/<name>.md`

## 9b — Plugin install path (whole plugins)

For each item in `final_plugin_list`:

1. Read or create `.claude/settings.json`.
2. Merge into `extraKnownMarketplaces` (key = marketplace name from index):
   ```json
   "extraKnownMarketplaces": {
     "<marketplace-name>": {
       "source": { "source": "github", "repo": "<owner>/<repo>" }
     }
   }
   ```
3. Merge into `enabledPlugins`:
   ```json
   "enabledPlugins": {
     "<plugin-name>@<marketplace-name>": true
   }
   ```
4. Write the merged JSON back, preserving formatting and other keys.

This file is committed to git → teammates `git pull` → Claude Code prompts them
to trust the folder → the plugin auto-installs on their side too.
