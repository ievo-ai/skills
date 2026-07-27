---
description: Refresh vendored agents and skills against fresh upstream content, re-auditing changed content via security-auditor before it overwrites the local copy (a simplified two-option version of the /ievo:init install-time gate). Re-injects overlay markers if missing. Does NOT modify overlay files — under the v0.2.0 overlay model, accumulated lessons live separately and are not replayed.
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
- `<name>` is the filename with the `.md` extension stripped (e.g. `spec-writer` from `.ievo/evolution/agents/spec-writer.md`).
- Read its YAML frontmatter `source:` block to find the upstream `repo` + `path` + `commit_sha`.
- If `source:` block is missing (overlay was created from a local-only agent/skill, never vendored) → skip in this update. Local-only targets have no upstream to refresh.

**Resolve each target's local copy in the invoking client's own load path** (detect once via the `$CODEX_CLI` env var ONLY, same rule as `/ievo:init` Step 1.5) — Claude Code (`$CODEX_CLI` unset): agents at `.claude/agents/<name>.md`, skills at `.claude/skills/<name>/`; Codex (`$CODEX_CLI` set): skills at `.agents/skills/<name>/`. Every later step that reads or overwrites "the local copy" means this resolved path. Two Codex-only skips fall out of this:
- **Agent targets** — Codex documents no project-level custom-agent path, and refreshing `.claude/agents/<name>.md` from a Codex session would write config only the *other* client reads. Skip with a Step 6 line: `SKIPPED — agent target, Claude Code-only (run /ievo:update from Claude Code)`.
- **Stranded skills** — if a skill's local copy is absent from `.agents/skills/<name>/` but present under `.claude/skills/<name>/` (a pre-#432 Codex install), skip it here and point the user at `/ievo:init`, whose Step 3 re-vendor path owns that migration — refreshing the `.claude/skills/` copy would refresh content Codex never loads.

**Validate before any Bash use.** `<name>` comes from the overlay's own filename and `source.repo`/`source.path` come from its frontmatter — both are just as untrusted as any other content in the project's git tree (a malicious/compromised PR touching `.ievo/evolution/`, or content vendored via the separate gap tracked in #357, can control either). Steps 2, 2.5, and 3.5 below build `gh api`/`cp`/`sed`/`rm` command lines using these values, so validate them here, once, before any target proceeds past this step:

1. **Validate `<name>`** against `^[A-Za-z0-9_-]+$`. Refuse (skip this target) if it fails.
2. **Validate `source.repo`** against `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$` — this is `scan_repo.mjs`'s own `OWNER_REPO_RE`, applied directly since `source.repo` is already stored as a single `<owner>/<repo>` string — and additionally reject if it contains `..`. Refuse (skip this target) if it fails.
3. **Do NOT regex-validate `source.path` against a character allowlist.** A git tree path can legally contain almost any byte (only NUL is forbidden), so a character denylist/allowlist here would either miss bytes or reject legitimate files. Step 2 below never interpolates `source.path` into a Bash command — it is passed only as a direct Glob/Read tool parameter after a clone. That alone does not bound it to the clone directory, though: unlike a real git tree path (which git itself refuses to let contain a bare `..` component), `source.path` here is raw frontmatter text a crafted overlay can set to anything, including `../../../../etc/passwd` — Step 2's final sub-step adds an explicit containment check before Glob/Read ever touch it.

A target that fails check 1 or 2 is skipped for the rest of this run — report it in Step 6 as `SKIPPED — invalid source metadata` (matching the existing `UPSTREAM MISSING` handling style) and do not construct any `/tmp/ievo-update-*-<name>*` path or Bash command for it.

### 2. Fetch fresh upstream content (staged, not yet applied)

For each target that passed Step 1's validation, fetch into a staging path — do NOT overwrite the local copy yet. Step 2.5 needs both the old and new content to decide whether a re-audit is required.

**Never build a `gh api repos/<source.repo>/contents/<source.path>` Bash command line from these values.** `source.path` is a git tree path and can legally contain shell metacharacters (backtick, `$()`, `;`, `|`, quotes) — interpolating it into a command string lets the shell resolve those before the intended command runs, even when quoted. Fetch this way instead — no untrusted byte ever crosses a shell:

1. **Resolve and validate the ref, then the commit.** `gh api "repos/<source.repo>" --jq '.default_branch'` — the returned branch name can legally contain shell metacharacters, so validate it against the same ref allowlist `inspect/SKILL.md` Step 1 uses (`^[A-Za-z0-9._/-]+$`, no leading `-`, no `..`/`@{`) before any further use. Refuse and report `UPSTREAM MISSING` for this target if it fails. Only then call `gh api "repos/<source.repo>/commits/<default-branch>" --jq '.sha'` and validate the result matches `^[0-9a-f]{7,40}$` — this becomes the new `commit_sha` recorded in Step 4.
2. **Shallow-clone into a fresh, per-target `mktemp -d` directory** — never a shared checkout path:
   ```bash
   CHECKOUT_DIR=$(mktemp -d)
   git clone --depth 1 "https://github.com/<source.repo>.git" "$CHECKOUT_DIR"
   git -C "$CHECKOUT_DIR" fetch --depth 1 origin <new-commit-sha>
   git -C "$CHECKOUT_DIR" checkout <new-commit-sha>
   ```
3. **Verify `source.path` stays inside the clone before Glob/Read ever touch it.** `source.path` is raw frontmatter text, not a path obtained by walking the cloned tree — a crafted overlay can set it to `../../../../etc/passwd` or similar. Resolve `$CHECKOUT_DIR/<source.path>` to its canonical form and confirm the result is `$CHECKOUT_DIR` itself or a descendant of it. Do this as a plain path check on the string already in hand from Step 1 — never by writing `<source.path>` into a Bash command line to test it, which would reopen the same CWE-78 this fix closes (it is still unvalidated for shell metacharacters). If containment fails, refuse the target — report `SKIPPED — invalid source metadata` in Step 6, same as a Step 1 validation failure.
4. **Agent** (`source.path` is the single agent `.md` file, not a directory — Glob-enumerating a file path returns nothing): Read the now-verified `$CHECKOUT_DIR/<source.path>` directly with the **Read tool**, then Write its content to `/tmp/ievo-update-staged-<name>.md` with the **Write tool**.
5. **Skill** (`source.path` is the skill's directory): enumerate the now-verified `$CHECKOUT_DIR/<source.path>` with the **Glob tool** (`pattern: "**/*"`, `path: "$CHECKOUT_DIR/<source.path>"` — never a Bash `find`/`ls`), then Read each listed file and Write it to the matching relative location under `/tmp/ievo-update-staged-<name>/`.
6. Remove the checkout dir once staging is complete: `rm -rf "$CHECKOUT_DIR"` (safe — this path is `mktemp`-generated, never attacker-controlled).

Glob and Read/Write all take paths as direct parameters, never shell text, so neither a malicious `source.path` nor a malicious file name inside it can reach a shell — and the containment check in sub-step 3 keeps a `../`-laden `source.path` from resolving outside `$CHECKOUT_DIR` in the first place.

If the ref/commit resolution fails, the containment check in sub-step 3 fails, or the Read/Glob sub-step finds nothing at `source.path` in the cloned tree (upstream renamed/removed), stop for this target. A containment failure is a crafted/invalid target, not a missing upstream — report it as `SKIPPED — invalid source metadata` (Step 6), same as a Step 1 validation failure; the other two cases report `UPSTREAM MISSING`. Either way: do not touch the local copy. Remove `$CHECKOUT_DIR` (if it was created) with `rm -rf "$CHECKOUT_DIR"` right here — Step 3.5 only covers the `/tmp/ievo-update-staged-<name>*`/`localcopy` paths, not this fetch's own checkout dir, so do not defer its cleanup. Clean up any partial staged content per Step 3.5 before moving to the next target. Do NOT fall back to per-file `gh api` fetching — that reintroduces the injection this replaces.

### 2.5. Re-audit content that changed since the last audit

Diff the staged fetch against the current local copy (Step 1's client-resolved path — `.claude/agents/<name>.md`, or the whole skills tree: `.claude/skills/<name>/` on Claude Code, `.agents/skills/<name>/` on Codex) — but never compare the raw local file directly. The local copy carries the `<!-- ievo:start -->...<!-- ievo:end -->` overlay marker block (injected by Step 3 below, or by `/ievo:init` Step 9 at first vendor); the staged upstream fetch never does. Diffing them raw would show a "difference" on effectively every run even when the underlying upstream content is byte-identical, defeating the point of this fast path.

The `cp`/`sed` commands below interpolate `<name>` into their command lines — this is safe only because Step 1 already validated `<name>` against `^[A-Za-z0-9_-]+$` for every target reaching this step; a target that failed that check never gets here.

Instead:
1. Copy the local target to a scratch path — never mutate the actual local file just to run this comparison:
   ```bash
   cp .claude/agents/<name>.md /tmp/ievo-update-localcopy-<name>.md   # agent (Claude Code only — Step 1 skips agents on Codex)
   # or, for a skill -- from the invoking client's skills dir (Step 1):
   cp -r .claude/skills/<name>/ /tmp/ievo-update-localcopy-<name>/    # Claude Code
   cp -r .agents/skills/<name>/ /tmp/ievo-update-localcopy-<name>/    # Codex
   ```
2. Strip the marker block (inclusive) from the scratch copy. For a skill, only `SKILL.md` ever carries the marker — `scripts/`, `references/`, `assets/` files never do, so strip it there and leave the rest of the scratch tree untouched:
   ```bash
   sed '/<!-- ievo:start -->/,/<!-- ievo:end -->/d' /tmp/ievo-update-localcopy-<name>.md > /tmp/ievo-update-localcopy-<name>.md.tmp && mv /tmp/ievo-update-localcopy-<name>.md.tmp /tmp/ievo-update-localcopy-<name>.md          # agent
   sed '/<!-- ievo:start -->/,/<!-- ievo:end -->/d' /tmp/ievo-update-localcopy-<name>/SKILL.md > /tmp/ievo-update-localcopy-<name>/SKILL.md.tmp && mv /tmp/ievo-update-localcopy-<name>/SKILL.md.tmp /tmp/ievo-update-localcopy-<name>/SKILL.md    # skill
   ```
3. Diff the stripped scratch copy against the staged fetch from Step 2.

- **Identical** (after stripping) → nothing changed upstream since the content was last audited (at install, or at a prior `/ievo:update` re-audit). Proceed straight to Step 3 with the staged content — no re-audit, no user friction. This is the common case: most refreshes pick up unrelated upstream churn (typo fixes, unrelated files) or none at all.
- **Different** → the bytes that would land on disk have changed since the last audit. Dispatch a fresh `security-auditor` sub-agent (Task tool) against the current upstream state — a simplified two-option version of `/ievo:init` Step 8's install-time gate (no report-to-source option; see the Rules section) — same candidate spec format, so the auditor re-fetches and scans it independently rather than trusting the staged copy:
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
      - `Skip — keep current local copy` — this target drops out of the run (skip Steps 3-4 for it, but still run Step 3.5 cleanup); Step 6 reports `SKIPPED — flagged <verdict>, refresh declined`. The overlay's `source.commit_sha` is left untouched so the next `/ievo:update` re-attempts and re-audits again.

    **No interactive session available** (e.g. this run was launched from an `/ievo:schedule` Routine — recognizable by a self-contained invocation prompt like "You are running a scheduled iEvo skill refresh", per `schedule/SKILL.md`'s Skill refresh prompt — or any other headless/CI invocation where `AskUserQuestion` cannot be answered): do not block waiting for input. Auto-select the `Skip — keep current local copy` outcome for that target, same as an explicit decline, and call it out in Step 6 as `SKIPPED — flagged <verdict>, no interactive session to confirm` so the summary makes the auto-skip visible on review. This matches `schedule/SKILL.md`'s own instruction to "flag YELLOW/RED items for manual review" rather than block a scheduled run indefinitely.

This closes the gap `/ievo:init` already closes at install time: upstream content that changed after the original audit can no longer silently overwrite a previously-trusted local copy. Unchanged content is never re-scanned, so a no-op refresh stays as cheap as before.

### 3. Apply the staged content, then re-inject overlay marker

For each target cleared by Step 2.5 (identical content, GREEN verdict, or the user chose "Apply anyway"):

1. Move the staged fetch over the local copy (Step 1's client-resolved path) — agent: `.claude/agents/<name>.md`; skill: replace the `.claude/skills/<name>/` tree on Claude Code, the `.agents/skills/<name>/` tree on Codex.
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

### 3.5. Clean up staged fetch

Once a target's outcome is decided — applied (identical / GREEN / user override), declined (YELLOW/RED skip, including the no-interactive-session auto-skip), or 404 — remove its staged and scratch paths:

```bash
rm -rf /tmp/ievo-update-staged-<name>* /tmp/ievo-update-localcopy-<name>*
```

Do this per target, right after that target's outcome is settled — not deferred to the end of the whole run. This applies to every exit path, including declined and 404 targets: content the auditor just flagged as risky (or any raw upstream fetch that was never applied) should not linger under `/tmp` after the run.

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
- `<scope>/<name>: SKIPPED — flagged <YELLOW|RED>, no interactive session to confirm` — auto-skipped because `AskUserQuestion` had no one to answer it (e.g. an unattended `/ievo:schedule` run); local copy and `source.commit_sha` left untouched, same as an explicit decline
- `<scope>/<name>: UPSTREAM MISSING — overlay preserved, please review` if the repo/branch/commit resolution 404'd, or `source.path` was not found in the cloned tree
- `<scope>/<name>: SKIPPED — no source metadata (local-only)` for local targets
- `<scope>/<name>: SKIPPED — invalid source metadata` if Step 1's `<name>`/`source.repo` validation failed, or Step 2's `source.path` containment check failed
- `<scope>/<name>: SKIPPED — agent target, Claude Code-only (run /ievo:update from Claude Code)` — Codex run; Codex has no project-level custom-agent path (Step 1)
- `<scope>/<name>: SKIPPED — stranded under .claude/skills/, not Codex-visible — re-vendor via /ievo:init` — Codex run; the migration path owns this (Step 1)

Final summary:
- Refreshed: N agents, M skills
- Re-audited (content changed since last audit): J targets
- Flagged for review: K targets (upstream missing, invalid source metadata, or refresh declined — explicitly or auto-skipped for lack of an interactive session — after a YELLOW/RED re-audit)

Remind user — **on Claude Code** (`$CODEX_CLI` unset):
```
Run /reload-skills to pick up refreshed skill definitions in this session (requires Claude Code v2.1.152+).
Run /reload-plugins to reload plugin manifests if any `.claude-plugin/plugin.json` files changed.
Run /plugin list --enabled to confirm iEvo shows the refreshed version (requires Claude Code v2.1.163+).
Run git diff .claude/ .ievo/evolution/ to review changes before commit.
```

**On Codex** (`$CODEX_CLI` set) — `/reload-skills`/`/reload-plugins` are not Codex commands:
```
Codex picks up skill changes automatically — restart Codex if a refreshed skill doesn't appear.
Run codex plugin list --json | grep -i ievo to confirm the refreshed version (requires Codex rust-v0.137.0+).
Run git diff .agents/skills/ .ievo/evolution/ to review changes before commit.
```

## Rules

- **Refresh the invoking client's copies only:** detect via `$CODEX_CLI` (same rule as `/ievo:init` Step 1.5) — Claude Code reads/overwrites `.claude/agents/`+`.claude/skills/`, Codex reads/overwrites `.agents/skills/` (skills only). Never write the other client's load path (issue #432): on Codex, agent targets and skills stranded under `.claude/skills/` are skipped with explicit Step 6 lines, not silently refreshed where the invoking client never looks.
- **Overlay files are sacred.** Never overwrite `.ievo/evolution/<scope>/<name>.md` content (except appending the "Upstream rebase" section). Frontmatter sha + fetched_at update; sections accumulate.
- **No Opus replay.** Under overlay model, the agent/skill body never contained evolution patches in the first place. Refresh-from-upstream is just file copy + marker re-injection, gated by a security re-audit when the content actually changed (Step 2.5).
- **Re-audit gates content changes, not every refresh.** Step 2.5 only dispatches `security-auditor` when the freshly-fetched content differs from what's on disk — an unchanged upstream (the common case) never pays the audit cost. A GREEN verdict applies silently; YELLOW/RED requires explicit `AskUserQuestion` confirmation before the local copy is touched — a simplified two-option gate compared to `/ievo:init` Step 8a, which also offers a report-to-source option; that option is out of scope here (single-file router, not the full install pipeline). Declining leaves the local copy and the overlay's `source.commit_sha` untouched so the next `/ievo:update` re-attempts.
- **Diff after stripping the marker, not before.** The local copy always carries the `<!-- ievo:start -->...<!-- ievo:end -->` overlay marker; the staged upstream fetch never does. Step 2.5 compares a marker-stripped scratch copy of the local file against the staged fetch — comparing raw would make the "identical" fast path never trigger.
- **No blocking on unattended runs.** If `AskUserQuestion` has no interactive session to answer it (e.g. an `/ievo:schedule` Routine), Step 2.5 auto-skips the target instead of hanging — never blocks a scheduled run indefinitely.
- **Clean up staged content for every outcome.** Step 3.5 removes each target's `/tmp/ievo-update-staged-<name>*` and scratch-copy paths once its outcome is decided — applied, declined, or 404. Flagged-risky content should not linger under `/tmp`.
- **Flag missing upstream loudly.** If repo/branch/commit resolution 404s, or `source.path` isn't found in the cloned tree (upstream renamed/removed), don't silently drop the target. Surface for user decision.
- **No automatic commit.** Update only writes files. User reviews + commits.
- **Order matters for symlinked content.** If a skill has `scripts/` with executable files, restore permissions after fetch (`chmod +x` on `.sh`/`.py` known patterns).
- **Validate `<name>` and `source.repo` before any Bash use; never interpolate `source.path` into a Bash/`gh api` command at all.** Step 1 validates `<name>` (from the overlay filename) against `^[A-Za-z0-9_-]+$` and `source.repo` against `scan_repo.mjs`'s `OWNER_REPO_RE` before a target is allowed to reach Step 2/2.5/3.5 — every `cp`/`sed`/`rm` command line built later in those steps depends on that gate having already run. `source.path` is different: a git tree path can legally contain shell metacharacters, so no regex is safe to interpolate it through — Step 2 fetches it exclusively via clone + the Glob/Read tools (direct parameters, never a command string), same pattern as `evo/SKILL.md`, `evolution.md`, and `install-protocol.md`'s own vendor fetches.
- **`source.path` containment, not just shell-safety.** Unlike `<source-path-in-repo>` in the sibling fetches (derived by walking a real cloned tree, which git itself never lets contain a bare `..` component), `update.md`'s `source.path` is raw overlay frontmatter an attacker can set to anything. Step 2 sub-step 3 resolves `$CHECKOUT_DIR/<source.path>` and confirms it stays inside `$CHECKOUT_DIR` before Glob/Read ever use it — a `../`-laden value must be refused, not merely passed through as "safe because it's a tool parameter".
