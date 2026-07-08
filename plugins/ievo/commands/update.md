---
description: Refresh vendored agents and skills against fresh upstream content, re-auditing changed content via security-auditor before it overwrites the local copy (mirrors the /ievo:init install-time gate). Re-injects overlay markers if missing. Does NOT modify overlay files — under the v0.2.0 overlay model, accumulated lessons live separately and are not replayed.
allowed-tools: Read, Write, Edit, Glob, Bash, Task, AskUserQuestion
---

# Update iEvo

Refresh vendored agents and skills in this project against their upstream sources. Useful after upstream plugin/repo gets new content and you want to keep your local copies current.

**Important — overlay model:** under v0.2.0, evolutions live in separate overlay files (`.ievo/evolution/<scope>/<name>.md`) that are read live at dispatch time. They are NOT replayed onto the agent/skill body. So `/ievo:update` is:

1. Re-fetch upstream agent/skill content (staged, not yet applied)
2. If the staged content differs from what's on disk, re-audit it via `security-auditor` before it touches anything (Step 2.5) — unchanged content skips straight through, no audit cost on the common no-op refresh
3. Overwrite local file
4. Re-inject the overlay marker block
5. Leave the overlay file untouched

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

### 2. Fetch fresh upstream content (staged, not yet applied)

For each target with `source:` metadata, fetch into a staging path — do NOT overwrite the local copy yet. Step 2.5 needs both the old and new content to decide whether a re-audit is required.

**Agent:**
```bash
gh api repos/<source.repo>/contents/<source.path> --jq '.content' | base64 -d > /tmp/ievo-update-staged-<name>.md
```

**Skill:**
Fetch the SKILL.md + supporting files (scripts/, references/, assets/) under the skill's source directory into a staging tree, e.g. `/tmp/ievo-update-staged-<name>/`.

If `gh api` returns 404 (upstream renamed/removed), stop for this target — see Step 6's `UPSTREAM MISSING` report line. Do not touch the local copy.

### 2.5. Re-audit content that changed since the last audit

Diff the staged fetch against the current local copy (`.claude/agents/<name>.md`, or the whole `.claude/skills/<name>/` tree for a skill).

- **Identical** → nothing changed upstream since the content was last audited (at install, or at a prior `/ievo:update` re-audit). Proceed straight to Step 3 with the staged content — no re-audit, no user friction. This is the common case: most refreshes pick up unrelated upstream churn (typo fixes, unrelated files) or none at all.
- **Different** → the bytes that would land on disk have changed since the last audit. Dispatch a fresh `security-auditor` sub-agent (Task tool) against the current upstream state, mirroring `/ievo:init` Step 8's install-time gate — same candidate spec format, so the auditor re-fetches and scans it independently rather than trusting the staged copy:
  ```
  Task(subagent_type="security-auditor",
       prompt="Audit <source.repo>@<name> with type=<skill|agent>")
  ```
  Send all dispatches for targets that changed in this run in a **single message** so they audit in parallel, same as init Step 8.

  Collect the verdict:
  - **GREEN** → proceed to Step 3. No user friction — matches the install-time GREEN path (Step 8a).
  - **YELLOW or RED** → do NOT proceed to Step 3 yet. Surface it via `AskUserQuestion` before anything touches disk:
    - **Question:** `<scope>/<name> changed upstream and was flagged <verdict> on re-audit: <top 1-2 flags — category + one-line explanation>. Apply the refresh?`
    - **Header:** `Re-audit`
    - **Options** (single-select):
      - `Apply anyway (I've reviewed the flags)` — proceed to Step 3; Step 6 reports `applied despite <verdict>`.
      - `Skip — keep current local copy` — this target drops out of the run (skip Steps 3-4 for it); Step 6 reports `SKIPPED — flagged <verdict>, refresh declined`. The overlay's `source.commit_sha` is left untouched so the next `/ievo:update` re-attempts and re-audits again.

This closes the gap `/ievo:init` already closes at install time: upstream content that changed after the original audit can no longer silently overwrite a previously-trusted local copy. Unchanged content is never re-scanned, so a no-op refresh stays as cheap as before.

### 3. Apply the staged content, then re-inject overlay marker

For each target cleared by Step 2.5 (identical content, GREEN verdict, or the user chose "Apply anyway"):

1. Move the staged fetch over the local copy — agent: `.claude/agents/<name>.md`; skill: replace the `.claude/skills/<name>/` tree.
2. The applied file does NOT have our overlay marker yet — it was upstream content. Re-inject:

After the file's YAML frontmatter `---` closing line, insert:

```markdown
<!-- ievo:start -->
**Before applying the instructions below**, read `.ievo/evolution/<scope>/<name>.md` if it exists, and apply ALL rules from its sections IN ADDITION to the instructions below.
<!-- ievo:end -->
```

Where `<scope>` = `agents` or `skills` and `<name>` = the target name.

The marker block is the SAME format as used by `/ievo:evo` step 3.

Targets the user skipped in Step 2.5 are not touched here — their local copy and overlay stay exactly as they were before this run.

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
- `<scope>/<name>: refreshed → <new_sha> (was <old_sha>)` — content unchanged since last audit, applied with no re-audit needed
- `<scope>/<name>: refreshed → <new_sha> (was <old_sha>) [re-audited: GREEN]` — content changed, security-auditor cleared it
- `<scope>/<name>: refreshed → <new_sha> (was <old_sha>) [re-audited: <YELLOW|RED>, applied despite flags]` — user chose "Apply anyway" in Step 2.5
- `<scope>/<name>: SKIPPED — flagged <YELLOW|RED> on re-audit, refresh declined` — local copy and `source.commit_sha` left untouched
- `<scope>/<name>: UPSTREAM MISSING — overlay preserved, please review` if `gh api` returned 404
- `<scope>/<name>: SKIPPED — no source metadata (local-only)` for local targets

Final summary:
- Refreshed: N agents, M skills
- Re-audited (content changed since last audit): J targets
- Flagged for review: K targets (upstream missing, or refresh declined after a YELLOW/RED re-audit)

Remind user:
```
Run /reload-plugins to pick up refreshed agent/skill definitions.
Run git diff .claude/ .ievo/evolution/ to review changes before commit.
```

## Rules

- **Overlay files are sacred.** Never overwrite `.ievo/evolution/<scope>/<name>.md` content (except appending the "Upstream rebase" section). Frontmatter sha + fetched_at update; sections accumulate.
- **No Opus replay.** Under overlay model, the agent/skill body never contained evolution patches in the first place. Refresh-from-upstream is just file copy + marker re-injection, gated by a security re-audit when the content actually changed (Step 2.5).
- **Re-audit gates content changes, not every refresh.** Step 2.5 only dispatches `security-auditor` when the freshly-fetched content differs from what's on disk — an unchanged upstream (the common case) never pays the audit cost. A GREEN verdict applies silently; YELLOW/RED requires explicit `AskUserQuestion` confirmation before the local copy is touched, mirroring `/ievo:init` Step 8. Declining leaves the local copy and the overlay's `source.commit_sha` untouched so the next `/ievo:update` re-attempts.
- **Flag missing upstream loudly.** If `gh api` returns 404 (upstream renamed/removed), don't silently drop the target. Surface for user decision.
- **No automatic commit.** Update only writes files. User reviews + commits.
- **Order matters for symlinked content.** If a skill has `scripts/` with executable files, restore permissions after fetch (`chmod +x` on `.sh`/`.py` known patterns).
