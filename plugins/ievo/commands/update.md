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

**Resolve each target's local copy in the invoking client's own load path** (detect once via `/ievo:init` Step 1.5's canonical, **ordered** rule — `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code; never the bare `$CODEX_CLI` var in isolation, which misdetects Codex Desktop as Claude Code, issue #461 — and never skip the leading `$CLAUDECODE` check, since this command runs standalone and an inherited `__CFBundleIdentifier` without it would misdetect a genuine Claude Code session as Codex, issue #432) — Claude Code (Step 1.5: no Codex signal): agents at `.claude/agents/<name>.md`, skills at `.claude/skills/<name>/`; Codex (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal): skills at `.agents/skills/<name>/`. Every later step that reads or overwrites "the local copy" means this resolved path. Two Codex-only skips fall out of this:
- **Agent targets** — Codex documents no project-level custom-agent path, and refreshing `.claude/agents/<name>.md` from a Codex session would write config only the *other* client reads. Skip with a Step 6 line: `SKIPPED — agent target, Claude Code-only (run /ievo:update from Claude Code)`.
- **Stranded skills** — if a skill's local copy is absent from `.agents/skills/<name>/` but present under `.claude/skills/<name>/` (a pre-#432 Codex install), skip it here and point the user at `/ievo:init`, whose Step 3 re-vendor path owns that migration — refreshing the `.claude/skills/` copy would refresh content Codex never loads.

**Validate before any Bash use.** `<name>` comes from the overlay's own filename and `source.repo`/`source.path` come from its frontmatter — both are just as untrusted as any other content in the project's git tree (a malicious/compromised PR touching `.ievo/evolution/`, or content vendored via the separate gap tracked in #357, can control either). Steps 2, 2.5, and 3.5 below build `gh api`/`cp`/`sed`/`rm` command lines using these values, so validate them here, once, before any target proceeds past this step:

1. **Validate `<name>`** against `^[A-Za-z0-9_-]+$`. Refuse (skip this target) if it fails.
2. **Validate `source.repo`** against `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$` — this is `scan_repo.mjs`'s own `OWNER_REPO_RE`, applied directly since `source.repo` is already stored as a single `<owner>/<repo>` string — and additionally reject if it contains `..`. Refuse (skip this target) if it fails.
3. **Do NOT regex-validate `source.path` against a character allowlist.** A git tree path can legally contain almost any byte (only NUL is forbidden), so a character denylist/allowlist here would either miss bytes or reject legitimate files. Step 2 below never interpolates `source.path` into a Bash command — it is passed only as a direct Glob/Read tool parameter after a clone. That alone does not bound it to the clone directory, though: unlike a real git tree path (which git itself refuses to let contain a bare `..` component), `source.path` here is raw frontmatter text a crafted overlay can set to anything, including `../../../../etc/passwd` — Step 2's final sub-step adds an explicit containment check before Glob/Read ever touch it.

A target that fails check 1 or 2 is skipped for the rest of this run — report it in Step 6 as `SKIPPED — invalid source metadata` (matching the existing `UPSTREAM MISSING` handling style) and do not create a staging directory or run any Bash command for it.

### 2. Fetch fresh upstream content (staged, not yet applied)

For each target that passed Step 1's validation, fetch into a staging path — do NOT overwrite the local copy yet. Step 2.5 needs both the old and new content to decide whether a re-audit is required.

**Never build a `gh api repos/<source.repo>/contents/<source.path>` Bash command line from these values.** `source.path` is a git tree path and can legally contain shell metacharacters (backtick, `$()`, `;`, `|`, quotes) — interpolating it into a command string lets the shell resolve those before the intended command runs, even when quoted. Fetch this way instead — no untrusted byte ever crosses a shell:

1. **Resolve and validate the ref, then the commit.** `gh api "repos/<source.repo>" --jq '.default_branch'` — the returned branch name can legally contain shell metacharacters, so validate it against the same ref allowlist `inspect/SKILL.md` Step 1 uses (`^[A-Za-z0-9._/-]+$`, no leading `-`, no `..`/`@{`) before any further use. Refuse and report `UPSTREAM MISSING` for this target if it fails. Only then call `gh api "repos/<source.repo>/commits/<default-branch>" --jq '.sha'` and validate the result matches `^[0-9a-f]{7,40}$` — this becomes the new `commit_sha` recorded in Step 4.
2. **Shallow-clone into a fresh, per-target `mktemp -d` directory** — never a shared checkout path. Also create this target's staging directory now, alongside the checkout dir — sub-steps 5/6 below and Step 2.5's scratch copy write into it, and Step 3.5 removes it whole once the target's outcome is decided:
   ```bash
   CHECKOUT_DIR=$(mktemp -d)
   STAGE_DIR=$(mktemp -d)
   echo "staging dir for <name>: $STAGE_DIR"
   git clone --depth 1 "https://github.com/<source.repo>.git" "$CHECKOUT_DIR"
   git -C "$CHECKOUT_DIR" fetch --depth 1 origin <new-commit-sha>
   git -C "$CHECKOUT_DIR" checkout <new-commit-sha>
   ```
   **Record that echoed path against this target's `<name>` before moving on, and carry it forward as `<stage-dir>`.** Every later reference below — sub-steps 5/6 here, Step 2.5, Step 3.5 — means *that recorded literal path for the target being processed*, substituted in like any other `<...>` placeholder in this file. It is not a `$STAGE_DIR` shell variable read back from an earlier command: each Bash call gets its own shell, and targets are handled as a batch (Step 2.5 dispatches every changed target's audit in one parallel message), so a second target's `mktemp -d` would shadow the first's — leaving target 1's staging dir, possibly holding RED-flagged content, on disk forever and breaking Step 3.5's cleanup guarantee.
3. **Verify `source.path` stays inside the clone before Glob/Read ever touch it.** `source.path` is raw frontmatter text, not a path obtained by walking the cloned tree — a crafted overlay can set it to `../../../../etc/passwd` or similar. Resolve `$CHECKOUT_DIR/<source.path>` to its canonical form and confirm the result is `$CHECKOUT_DIR` itself or a descendant of it. Do this as a plain path check on the string already in hand from Step 1 — never by writing `<source.path>` into a Bash command line to test it, which would reopen the same CWE-78 this fix closes (it is still unvalidated for shell metacharacters). If containment fails, refuse the target — report `SKIPPED — invalid source metadata` in Step 6, same as a Step 1 validation failure.
4. **Check for a symlink at, under, or anywhere on the way to `source.path`
   before sub-steps 5-6 read or enumerate anything.** Git preserves a
   symlink as an ordinary tree entry (mode `120000`); if the checkout
   materializes it as a real OS-level symlink, the Read/Glob tools below
   follow it like any other file — so an already-vendored target's upstream
   repo, now attacker-controlled or compromised, can ship, say,
   `<source.path>/assets/logo.png` as a symlink to `~/.ssh/id_rsa` or
   `~/.aws/credentials`, and that secret's *contents* (not the upstream
   file) flow into context and get staged into `<stage-dir>` — sub-step 3's
   directory-level containment check runs once, before this enumeration,
   and never re-validates the individual entries Glob returns. Check this
   via the git index, not the filesystem — a no-follow filesystem check
   (e.g. `find -type l`) would need `source.path` interpolated into a Bash
   command line, which the Rules section's "never interpolate `source.path`"
   rule forbids, since it is exactly as untrusted as any other value drawn
   from this repo's tree:
   ```bash
   git -C "$CHECKOUT_DIR" -c core.quotePath=false ls-files -s | grep '^120000'
   ```
   Run it with **no path argument** — `$CHECKOUT_DIR` alone is
   `mktemp`-generated and safe to pass to `-C`, so no untrusted byte reaches
   the shell here either — with `-c core.quotePath=false` (see the quoting
   paragraphs below), and with the trailing `| grep '^120000'` exactly as
   shown: a fixed, literal pattern, not a value built from `source.path` or
   anything else untrusted, so it adds no injection surface. It exists to
   bound the size of what you have to read, not to filter out anything a
   plain `ls-files -s` wouldn't also show you: a large or padded upstream
   repo can carry thousands of tracked files, and reasoning over an
   unfiltered listing that size risks the Bash tool truncating its own
   output before a symlink entry buried in it ever reaches you — silently
   defeating this whole check. Piping through this fixed filter bounds the
   returned text to the symlink entries alone, so the check's completeness
   no longer depends on the repo's total file count. `grep` prints nothing
   and exits **1** when it matches no line, and that empty result IS the
   pass case — the index carries no symlink at all — not a command failure
   to retry, to re-run without the filter, or to work around.

   `-c core.quotePath=false` is load-bearing for the same reason the `grep`
   is: without it the check silently fails to match the very entries it
   exists to catch. `core.quotePath` **defaults to on**, and git then
   C-quotes any path holding a byte over 0x7F — wrapping the whole path in
   double quotes and octal-escaping the byte — so a symlink at
   `evil-plügin/assets/foo` prints as the literal
   `"evil-pl\303\274gin/assets/foo"`, which is equal to, under, and an
   ancestor of *nothing*: all three comparisons below miss it, and sub-steps
   5-6's Glob/Read then follow the link. Setting `core.quotePath=false`
   stops git treating high bytes as unusual, so those paths come back raw
   and comparable (verified on git 2.54.0; the same default is why
   `deep-review/SKILL.md` passes `-z` to its own `ls-files`).

   That flag narrows the quoting, it does not end it: **double quotes,
   backslash and control characters are escaped regardless of
   `core.quotePath`**, so a symlink at `q"dir/bar`, `back\slash/x`, or a
   path containing a TAB or newline still comes back quoted —
   `"q\"dir/bar"`, `"back\\slash/x"`, `"nl\nfile"` (all verified on git
   2.54.0). Those you cannot compare either, and an embedded newline would
   additionally split one entry across what look like two lines. So **fail
   closed**: if the path field of any returned line still begins with a `"`
   after the flag, do NOT try to unescape it and do NOT ignore it — refuse
   the target exactly as if it had matched, and report the same `SKIPPED —
   invalid source metadata` outcome in Step 6. This is deliberately
   conservative: it can refuse a target whose only quoted symlink lies
   outside `source.path` entirely, which is the correct trade when the
   alternative is reasoning about containment from a path you cannot
   reliably reconstruct. The `grep '^120000'` filter keeps that
   conservatism cheap — only symlink entries are ever considered, so an
   ordinary file with an awkward name never triggers a refusal.

   Then inspect the returned listing yourself (it is data you reason over,
   not a command you build): each line is `<mode> <sha> <stage>`, a TAB,
   then the entry's repo-relative path, so take the path after the TAB
   (having applied the still-quoted refusal above). Git tree paths never
   contain a `.` segment or a doubled `/` — the listed entry side of the
   comparison is always already clean. `source.path` is not: unlike
   `<source-path-in-repo>` in the sibling fetches (walked from a real
   cloned tree, so git itself keeps it clean), it is raw overlay
   frontmatter Step 1 deliberately leaves unvalidated for its exact
   characters (§ "Do NOT regex-validate `source.path`" above) — a crafted
   `skills//vendor-skill` or `skills/./vendor-skill` still resolves
   `$CHECKOUT_DIR/<source.path>` to the identical on-disk location sub-step
   3's canonicalization and sub-steps 5-6's Glob/Read would each reach, but
   would segment-split into a spurious empty or `.` component that no
   longer lines up against the listed entry's clean segments — silently
   defeating the comparison below on the exact target it exists to catch.
   So before splitting, also collapse every run of consecutive `/` in
   `source.path` to a single `/` and drop any `.` segment; then strip any
   trailing `/` from both `source.path` and the listed entry's path (the
   skill case writes `source.path` as a directory, the agent case as a
   single file — normalize both sides before comparing anything), and
   compare the two as `/`-separated **segment** lists. Refuse the whole
   target — do NOT run sub-steps 5-6 below — when a
   listed entry is **equal to** `source.path` (the target itself is a
   symlink), **under** `source.path` (its segments begin with
   `source.path`'s — the skill case's whole tree, e.g. a symlinked file
   inside the skill directory), **or an ancestor of** `source.path`
   (`source.path`'s segments begin with the listed entry's — the link sits
   on the path you are about to walk *through*). The slash normalization
   and the ancestor branch are not belt-and-braces: each closes a distinct
   instance of the very attack this sub-step blocks, because git indexes a
   symlinked *directory* as a **single** `120000` entry for the directory
   itself — no trailing slash, and nothing "inside" it tracked at all,
   since git never descends through a symlink. An upstream repo shipping
   the skill directory `source.path` as a link to `~/.ssh` therefore yields
   the one line `source.path` itself, already caught by the equals check
   above; shipping an ancestor of it instead — e.g. the repo root or a
   parent directory — yields a line SHORTER than `source.path`, which no
   equals-or-starts-with test can ever match — the ancestor branch is what
   catches those. In every one of those cases sub-steps 5-6's Glob/Read on
   `$CHECKOUT_DIR/<source.path>` would otherwise resolve straight through
   the link and enumerate or read its target. Compare by segment rather
   than by raw character prefix so that a sibling entry such as
   `<source.path>-notes`, which shares a character prefix with
   `source.path` but lies neither under it nor on the way to it, does not
   trip the check. A listing whose lines all fall outside every one of
   these relations means the checkout has symlinks elsewhere in the repo
   that this target doesn't touch — not a reason to refuse.
5. **Agent** (`source.path` is the single agent `.md` file, not a directory — Glob-enumerating a file path returns nothing): Read the now-verified `$CHECKOUT_DIR/<source.path>` directly with the **Read tool**, then Write its content to `<stage-dir>/<name>.md` with the **Write tool**.
6. **Skill** (`source.path` is the skill's directory): enumerate the now-verified `$CHECKOUT_DIR/<source.path>` with the **Glob tool** (`pattern: "**/*"`, `path: "$CHECKOUT_DIR/<source.path>"` — never a Bash `find`/`ls`), then Read each listed file and Write it to the matching relative location under `<stage-dir>/<name>/`.
7. Remove the checkout dir once staging is complete: `rm -rf "$CHECKOUT_DIR"` (safe — this path is `mktemp`-generated, never attacker-controlled).

Glob and Read/Write all take paths as direct parameters, never shell text, so neither a malicious `source.path` nor a malicious file name inside it can reach a shell — the sub-step 3 containment check keeps a `../`-laden `source.path` from resolving outside `$CHECKOUT_DIR` on the string level, and the sub-step 4 symlink check keeps a `source.path` that resolves *through* a symlink from being read or enumerated at all, regardless of what its string contents look like.

If the ref/commit resolution fails, the containment check in sub-step 3 fails, the symlink check in sub-step 4 finds a match, or the Read/Glob sub-step finds nothing at `source.path` in the cloned tree (upstream renamed/removed), stop for this target. A containment or symlink-check failure is a crafted/invalid target, not a missing upstream — report it as `SKIPPED — invalid source metadata` (Step 6), same as a Step 1 validation failure; the other case reports `UPSTREAM MISSING`. Either way: do not touch the local copy. Remove `$CHECKOUT_DIR` (if it was created) with `rm -rf "$CHECKOUT_DIR"` right here — Step 3.5 only covers this target's `<stage-dir>` (staged fetch + scratch copy), not this fetch's own checkout dir, so do not defer its cleanup. Clean up any partial staged content per Step 3.5 before moving to the next target. Do NOT fall back to per-file `gh api` fetching — that reintroduces the injection this replaces.

### 2.5. Re-audit content that changed since the last audit

Diff the staged fetch against the current local copy (Step 1's client-resolved path — `.claude/agents/<name>.md`, or the whole skills tree: `.claude/skills/<name>/` on Claude Code, `.agents/skills/<name>/` on Codex) — but never compare the raw local file directly. The local copy carries the `<!-- ievo:start -->...<!-- ievo:end -->` overlay marker block (injected by Step 3 below, or by `/ievo:init` Step 9 at first vendor); the staged upstream fetch never does. Diffing them raw would show a "difference" on effectively every run even when the underlying upstream content is byte-identical, defeating the point of this fast path.

The `cp`/`sed` commands below interpolate `<name>` into their command lines — this is safe only because Step 1 already validated `<name>` against `^[A-Za-z0-9_-]+$` for every target reaching this step; a target that failed that check never gets here. They also interpolate `<stage-dir>`, which is `mktemp`-generated in Step 2 and never attacker-controlled.

Instead:
1. Copy the local target to a scratch path inside this target's `<stage-dir>` — the path Step 2 recorded for *this* target, substituted literally, never a `$STAGE_DIR` variable (a sibling target's `mktemp -d` would shadow it) — and never mutate the actual local file just to run this comparison:
   ```bash
   cp .claude/agents/<name>.md "<stage-dir>/localcopy-<name>.md"   # agent (Claude Code only — Step 1 skips agents on Codex)
   # or, for a skill -- from the invoking client's skills dir (Step 1):
   cp -r .claude/skills/<name>/ "<stage-dir>/localcopy-<name>/"    # Claude Code
   cp -r .agents/skills/<name>/ "<stage-dir>/localcopy-<name>/"    # Codex
   ```
2. Strip the marker block (inclusive) from the scratch copy. For a skill, only `SKILL.md` ever carries the marker — `scripts/`, `references/`, `assets/` files never do, so strip it there and leave the rest of the scratch tree untouched:
   ```bash
   sed '/<!-- ievo:start -->/,/<!-- ievo:end -->/d' "<stage-dir>/localcopy-<name>.md" > "<stage-dir>/localcopy-<name>.md.tmp" && mv "<stage-dir>/localcopy-<name>.md.tmp" "<stage-dir>/localcopy-<name>.md"          # agent
   sed '/<!-- ievo:start -->/,/<!-- ievo:end -->/d' "<stage-dir>/localcopy-<name>/SKILL.md" > "<stage-dir>/localcopy-<name>/SKILL.md.tmp" && mv "<stage-dir>/localcopy-<name>/SKILL.md.tmp" "<stage-dir>/localcopy-<name>/SKILL.md"    # skill
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

Once a target's outcome is decided — applied (identical / GREEN / user override), declined (YELLOW/RED skip, including the no-interactive-session auto-skip), or 404 — remove its entire staging directory:

```bash
rm -rf "<stage-dir>"
```

`<stage-dir>` is the path Step 2 recorded for *this* target, substituted literally — not a `$STAGE_DIR` variable, which on a multi-target run would name whichever target ran `mktemp -d` last and would silently leave every earlier target's staging dir behind.

Do this per target, right after that target's outcome is settled — not deferred to the end of the whole run. This applies to every exit path, including declined and 404 targets: content the auditor just flagged as risky (or any raw upstream fetch that was never applied) should not linger on disk after the run.

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
- `<scope>/<name>: SKIPPED — invalid source metadata` if Step 1's `<name>`/`source.repo` validation failed, or Step 2's `source.path` containment or symlink check failed
- `<scope>/<name>: SKIPPED — agent target, Claude Code-only (run /ievo:update from Claude Code)` — Codex run; Codex has no project-level custom-agent path (Step 1)
- `<scope>/<name>: SKIPPED — stranded under .claude/skills/, not Codex-visible — re-vendor via /ievo:init` — Codex run; the migration path owns this (Step 1)

Final summary:
- Refreshed: N agents, M skills
- Re-audited (content changed since last audit): J targets
- Flagged for review: K targets (upstream missing, invalid source metadata, or refresh declined — explicitly or auto-skipped for lack of an interactive session — after a YELLOW/RED re-audit)

Remind user — **on Claude Code** (Step 1.5: no Codex signal):
```
Run /reload-skills to pick up refreshed skill definitions in this session (requires Claude Code v2.1.152+).
Run /reload-plugins to reload plugin manifests if any `.claude-plugin/plugin.json` files changed.
Confirm the refresh landed: every target reported `refreshed → <new_sha>` above now carries that same `source.commit_sha` in `.ievo/evolution/<scope>/<name>.md`. This run refreshes your vendored copies under `.claude/`, not the iEvo plugin itself — a plugin-version listing is unchanged by it.
Run git diff .claude/ .ievo/evolution/ to review changes before commit.
```

**On Codex** (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal) — `/reload-skills`/`/reload-plugins` are not Codex commands:
```
Codex picks up skill changes automatically — restart Codex if a refreshed skill doesn't appear.
Confirm the refresh landed: every target reported `refreshed → <new_sha>` above now carries that same `source.commit_sha` in `.ievo/evolution/<scope>/<name>.md`. This run refreshes your vendored copies under `.agents/skills/`, not the iEvo plugin itself — `codex plugin list` does not enumerate them.
Run git diff .agents/skills/ .ievo/evolution/ to review changes before commit.
```

## Rules

- **Refresh the invoking client's copies only:** detect per `/ievo:init` Step 1.5, **ordered**: `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code — Claude Code reads/overwrites `.claude/agents/`+`.claude/skills/`, Codex reads/overwrites `.agents/skills/` (skills only). Never write the other client's load path (issue #432): on Codex, agent targets and skills stranded under `.claude/skills/` are skipped with explicit Step 6 lines, not silently refreshed where the invoking client never looks.
- **Overlay files are sacred.** Never overwrite `.ievo/evolution/<scope>/<name>.md` content (except appending the "Upstream rebase" section). Frontmatter sha + fetched_at update; sections accumulate.
- **No Opus replay.** Under overlay model, the agent/skill body never contained evolution patches in the first place. Refresh-from-upstream is just file copy + marker re-injection, gated by a security re-audit when the content actually changed (Step 2.5).
- **Re-audit gates content changes, not every refresh.** Step 2.5 only dispatches `security-auditor` when the freshly-fetched content differs from what's on disk — an unchanged upstream (the common case) never pays the audit cost. A GREEN verdict applies silently; YELLOW/RED requires explicit `AskUserQuestion` confirmation before the local copy is touched — a simplified two-option gate compared to `/ievo:init` Step 8a, which also offers a report-to-source option; that option is out of scope here (single-file router, not the full install pipeline). Declining leaves the local copy and the overlay's `source.commit_sha` untouched so the next `/ievo:update` re-attempts.
- **Diff after stripping the marker, not before.** The local copy always carries the `<!-- ievo:start -->...<!-- ievo:end -->` overlay marker; the staged upstream fetch never does. Step 2.5 compares a marker-stripped scratch copy of the local file against the staged fetch — comparing raw would make the "identical" fast path never trigger.
- **No blocking on unattended runs.** If `AskUserQuestion` has no interactive session to answer it (e.g. an `/ievo:schedule` Routine), Step 2.5 auto-skips the target instead of hanging — never blocks a scheduled run indefinitely.
- **Clean up staged content for every outcome.** Step 3.5 removes each target's own staging dir (staged fetch + scratch copy, created per-target via `mktemp -d` in Step 2, same pattern as `CHECKOUT_DIR`, and recorded per target so a sibling's `mktemp -d` can't shadow it) once its outcome is decided — applied, declined, or 404. Flagged-risky content should not linger under a predictable `/tmp` path.
- **Flag missing upstream loudly.** If repo/branch/commit resolution 404s, or `source.path` isn't found in the cloned tree (upstream renamed/removed), don't silently drop the target. Surface for user decision.
- **No automatic commit.** Update only writes files. User reviews + commits.
- **Order matters for symlinked content.** If a skill has `scripts/` with executable files, restore permissions after fetch (`chmod +x` on `.sh`/`.py` known patterns).
- **Validate `<name>` and `source.repo` before any Bash use; never interpolate `source.path` into a Bash/`gh api` command at all.** Step 1 validates `<name>` (from the overlay filename) against `^[A-Za-z0-9_-]+$` and `source.repo` against `scan_repo.mjs`'s `OWNER_REPO_RE` before a target is allowed to reach Step 2/2.5/3.5 — every `cp`/`sed`/`rm` command line built later in those steps depends on that gate having already run. `source.path` is different: a git tree path can legally contain shell metacharacters, so no regex is safe to interpolate it through — Step 2 fetches it exclusively via clone + the Glob/Read tools (direct parameters, never a command string), same pattern as `evo/SKILL.md`, `evolution.md`, and `install-protocol.md`'s own vendor fetches.
- **`source.path` containment, not just shell-safety.** Unlike `<source-path-in-repo>` in the sibling fetches (derived by walking a real cloned tree, which git itself never lets contain a bare `..` component), `update.md`'s `source.path` is raw overlay frontmatter an attacker can set to anything. Step 2 sub-step 3 resolves `$CHECKOUT_DIR/<source.path>` and confirms it stays inside `$CHECKOUT_DIR` before Glob/Read ever use it — a `../`-laden value must be refused, not merely passed through as "safe because it's a tool parameter".
- **Symlink containment gates reading, not just the directory-level check.** Sub-step 3's containment check runs once, on `source.path` itself, before sub-steps 5-6 enumerate or read anything under it — it never re-validates the individual entries Glob returns. Step 2 sub-step 4 closes that gap: it checks the git index for a `120000`-mode entry at, under, **or on any ancestor path of** `source.path` before sub-steps 5-6 ever Read/Glob it — an already-vendored target's upstream can carry a symlink to a local secret outside `$CHECKOUT_DIR`, and the Read tool follows it like any other file. The ancestor half of that match is load-bearing, not belt-and-braces: git indexes a symlinked *directory* as one `120000` entry for the directory itself (no trailing slash, nothing beneath it tracked), so `source.path` shipped as a link to `~/.ssh` is an entry that neither equals nor starts with a trailing-slash-normalized `source.path` — which is why the comparison normalizes trailing slashes on both sides and matches by `/`-separated segment in both directions. The check's own `git -c core.quotePath=false ls-files -s | grep '^120000'` form matters as much as its placement: the fixed `grep` filter bounds what you read to symlink entries alone so a large upstream repo can't push the one line that matters past the Bash tool's own output-truncation limit, and `-c core.quotePath=false` stops git C-quoting any path holding a byte over 0x7F (which would otherwise make that entry equal, sit under, and be an ancestor of nothing). Because double quotes, backslash and control characters stay escaped even with the flag set, the rule also **fails closed on any still-quoted path** (leading `"`): refuse rather than unescape, since a path you cannot reliably reconstruct is one you cannot reliably contain. A match refuses the whole target before any content is read into `<stage-dir>` — Step 2.5's re-audit never gets a chance to catch it, because the read/staging this check blocks would already have happened before that gate runs. Same pattern as `evolution.md`'s Step 2 sub-step 4 and `install-protocol.md`'s "How to fetch the tree" sub-step 4, adapted for this file's `source.path` naming.
