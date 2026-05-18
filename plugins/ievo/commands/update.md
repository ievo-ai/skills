---
description: Refresh vendored agents and skills against fresh upstream content. Re-injects overlay markers if missing. Does NOT modify overlay files — under the v0.2.0 overlay model, accumulated lessons live separately and are not replayed.
allowed-tools: Read, Write, Edit, Glob, Bash
---

# Update iEvo

Refresh vendored agents and skills in this project against their upstream sources. Useful after upstream plugin/repo gets new content and you want to keep your local copies current.

**Important — overlay model:** under v0.2.0, evolutions live in separate overlay files (`.ievo/evolution/<scope>/<name>.md`) that are read live at dispatch time. They are NOT replayed onto the agent/skill body. So `/ievo:update` is simple:

1. Re-fetch upstream agent/skill content
2. Overwrite local file
3. Re-inject the overlay marker block
4. Leave the overlay file untouched

Overlay file content keeps applying via the marker injection. No drift, no Opus replay loop.

## Steps

### 1. Inventory vendored agents and skills

Find all local agents/skills that have a corresponding overlay file (= vendored or evolved):

```bash
ls .ievo/evolution/agents/*.md 2>/dev/null
ls .ievo/evolution/skills/*.md 2>/dev/null
```

For each overlay file:
- Read its YAML frontmatter `source:` block to find the upstream `repo` + `path` + `commit_sha`.
- If `source:` block is missing (overlay was created from a local-only agent/skill, never vendored) → skip in this update. Local-only targets have no upstream to refresh.

### 2. Refresh each vendored file from upstream

For each target with `source:` metadata:

**Agent:**
```bash
gh api repos/<source.repo>/contents/<source.path> --jq '.content' | base64 -d > .claude/agents/<name>.md
```

**Skill:**
Fetch the SKILL.md + supporting files (scripts/, references/, assets/) under the skill's source directory. Write tree to `.claude/skills/<name>/`.

This **overwrites** the local copy with fresh upstream.

### 3. Re-inject overlay marker

After overwriting, the freshly-pulled file does NOT have our overlay marker — it was upstream content. Re-inject:

After the file's YAML frontmatter `---` closing line, insert:

```markdown
<!-- ievo:start -->
**Before applying the instructions below**, read `.ievo/evolution/<scope>/<name>.md` if it exists, and apply ALL rules from its sections IN ADDITION to the instructions below.
<!-- ievo:end -->
```

Where `<scope>` = `agents` or `skills` and `<name>` = the target name.

The marker block is the SAME format as used by `/ievo:evolution` step 3.

### 4. Update overlay frontmatter

Update the overlay file's `source:` metadata with the new commit_sha:

```yaml
source:
  repo: <unchanged>
  path: <unchanged>
  commit_sha: <new short sha from gh api>
  fetched_at: <new ISO timestamp>
```

Append a section to the overlay marking the refresh:

```markdown

## <YYYY-MM-DD HH:MM UTC> — Upstream rebase
**Trigger:** /ievo:update — upstream commit changed
**Old SHA:** <previous commit_sha>
**New SHA:** <current commit_sha>

No rule change. Local copy refreshed from upstream; overlay rules continue to apply via the read-on-dispatch marker.
```

This keeps the audit trail of when refreshes happened.

### 5. Project-wide rules — no action

`.ievo/evolution/project.md` and the `<!-- ievo:start -->` marker in CLAUDE.md/AGENTS.md are project-owned (no upstream). Skip entirely.

### 6. Report

For each target, output one line:
- `<scope>/<name>: refreshed → <new_sha> (was <old_sha>)` on success
- `<scope>/<name>: UPSTREAM MISSING — overlay preserved, please review` if `gh api` returned 404
- `<scope>/<name>: SKIPPED — no source metadata (local-only)` for local targets

Final summary:
- Refreshed: N agents, M skills
- Flagged for review: K targets

Remind user:
```
Run /reload-plugins to pick up refreshed agent/skill definitions.
Run git diff .claude/ .ievo/evolution/ to review changes before commit.
```

## Rules

- **Overlay files are sacred.** Never overwrite `.ievo/evolution/<scope>/<name>.md` content (except appending the "Upstream rebase" section). Frontmatter sha + fetched_at update; sections accumulate.
- **No Opus replay.** Under overlay model, the agent/skill body never contained evolution patches in the first place. Refresh-from-upstream is just file copy + marker re-injection.
- **Flag missing upstream loudly.** If `gh api` returns 404 (upstream renamed/removed), don't silently drop the target. Surface for user decision.
- **No automatic commit.** Update only writes files. User reviews + commits.
- **Order matters for symlinked content.** If a skill has `scripts/` with executable files, restore permissions after fetch (`chmod +x` on `.sh`/`.py` known patterns).
