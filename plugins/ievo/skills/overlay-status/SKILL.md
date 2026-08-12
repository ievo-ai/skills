---
name: overlay-status
description: "Use this skill when the user asks \"what evolutions have I captured\", \"show my iEvo overlays\", \"what rules are active in this project\", \"list installed overlays\", \"summarize .ievo/evolution\" — not for previewing a remote repo's contents before install (use /ievo:inspect for that). Surfaces the current state of iEvo evolution overlays in this project. Lists every overlay under `.ievo/evolution/` grouped by scope (project, agents, skills), with a one-line summary + last-modified date per file. Read-only — never modifies, deletes, or rewrites overlay content. Closes the legibility gap iEvo's own `coverage-audit.md` flagged as \"Standalone 'list installed iEvo overlays' command\"."
license: MIT
effort: low
allowed-tools:
  - Read
  - Glob
  - Bash(stat*)
  - Bash(awk*)
  - Bash(uname*)
  - Bash(date*)
compatibility: "Any agentskills.io platform. Read + Glob for enumeration, Bash (`stat` piped into `awk`, plus `uname`, `date`) for timestamps on POSIX. Windows: dates omitted gracefully, listing renders from Read + Glob alone."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Overlay Status — list active iEvo evolution overlays

Reads `.ievo/evolution/` and returns a structured per-scope summary so the operator (and the next session) can answer "what rules has this project captured?" without `cat`-ing N files by hand.

The legibility principle: *what the agent cannot inspect through approved tools is operationally absent from the agent's world* ([reference](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/agent-legibility-feedback-loops.md)). Overlays are load-bearing for iEvo behaviour but invisible until something surfaces them — this skill is that surface.

## When to use

- User asks "what evolutions have I captured", "show my iEvo overlays", "what rules are active", "list installed overlays", "summarize .ievo/evolution"
- Onboarding a collaborator — they need to see what iEvo state already lives in the project
- Periodic review — operator wants to spot stale or superseded overlays for cleanup
- Before a `/ievo:evo` call — confirm the new lesson isn't already covered by an existing overlay

## Steps

### 1. Enumerate overlay files

Use TWO Glob calls so the flat `project.md` is enumerated reliably across glob implementations:

1. `.ievo/evolution/*.md` — matches files at the evolution root (notably `project.md`).
2. `.ievo/evolution/**/*.md` — matches everything recursively.

Union the two result sets and dedupe by path. Why two calls: on Claude Code (npm `glob` v10) the `**` matches zero or more path segments, so `**/*.md` alone matches `project.md`. But on other agentskills.io-compatible hosts (older minimatch / shell-glob / Python `pathlib`) `**` typically requires at least one intervening directory segment, and `project.md` would be silently excluded. The Project scope would then render `(none)` even when a real project overlay exists. The two-call union is the simplest portable form.

Glob returns an empty array if the directory doesn't exist or contains no `.md` files — no need for a separate existence check. Glob is the only existence-detection path; do NOT use a sentinel file (no skill in iEvo guarantees any specific file's presence — `evo/SKILL.md` only writes per-scope overlay files as needed).

Expected layout (defined by `evo/SKILL.md` Step 4):

```
.ievo/evolution/
├── project.md              ← project-wide overlay (FLAT file, not a directory)
├── agents/
│   └── <name>.md           ← per-agent overlays
└── skills/
    └── <name>.md           ← per-skill overlays
```

There is no `KERNEL.md`, no `LOG.md`, no `project/` subdirectory in user projects — those are godfather-internal conventions, not iEvo plugin conventions. The user-facing iEvo plugin (this repo's skills) only produces the three forms above.

If Glob returns an empty list → no overlays yet. Print:

```
No iEvo overlays found in this project.

`.ievo/evolution/` is empty (or doesn't exist).

To capture your first lesson, run `/ievo:evo "<lesson text>"` —
it will create the directory and write the appropriate overlay file
automatically.
```

Exit cleanly. Do NOT create the directory from this skill.

### 2. Classify each enumerated file

For each path returned by Glob, classify by location relative to `.ievo/evolution/`:

| Path pattern | Scope | Display name |
|---|---|---|
| `.ievo/evolution/project.md` | Project | `project.md` |
| `.ievo/evolution/agents/<name>.md` | Agents | `<name>.md` |
| `.ievo/evolution/skills/<name>.md` | Skills | `<name>.md` |
| anything else | Other | full relative path |

Unexpected paths (e.g. a user-authored file at `.ievo/evolution/notes.md`) fall into "Other" — list them but flag with a note rather than silently dropping. The skill stays read-only and surfaces what's actually there.

### 3. Read each overlay file and extract a one-line summary

For each enumerated file, use the Read tool and pull the summary by this precedence:

1. **YAML frontmatter `description:` field** — if present and non-empty, use it.
2. **First `##`-level subsection title** when the file's first `# ` heading matches the boilerplate pattern `# <name> — Evolution Overlay` — strip the `##`, use the title. `/ievo:evo` (defined in `evo/SKILL.md` Step 4) writes overlays whose first heading is always this boilerplate (e.g. `# coder — Evolution Overlay`); the meaningful content lives in `## YYYY-MM-DD — <short title>` subsections immediately below. Falling through to "first heading" would render every evolution overlay as `"coder — Evolution Overlay"` regardless of content, defeating this skill's purpose. So when boilerplate is detected, skip it and report the most recent (typically the first) `## ` subsection's text — that's the actual lesson title.
3. **First Markdown heading** (`# ` or `## ` line) below the frontmatter — strip the `#`s, use the text. (For non-evolution-overlay user files that don't match the boilerplate pattern.)
4. **First non-blank, non-frontmatter, non-heading line** — use up to its first 120 characters.
5. **Fallback** — emit `(empty overlay)` if none of the above produces text.

Strip surrounding whitespace; collapse internal whitespace to single spaces; truncate at 120 chars with `…` if longer. On corrupted frontmatter (YAML parse error) emit `(unparsable frontmatter)` and continue with the next file — never modify the file in response.

### 4. Capture last-modified dates

The Glob tool does not return mtime directly. To get last-modified per file, use Bash with a single `stat` call covering all overlay paths.

**Detect OS first** so the right `stat` branch is chosen:

```sh
uname -s
```

`Darwin` → use the BSD branch below. `Linux` → use the GNU branch. Any other value → attempt the GNU branch first (most POSIX-like systems ship GNU coreutils); on failure, fall to the Windows-no-POSIX-shell path described at the end of this step.

**BSD `stat` (macOS):**

```sh
stat -f "%Sm%t%N" -t "%Y-%m-%d" .ievo/evolution/project.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md 2>/dev/null | awk -F'\t' 'NF==2'
```

**GNU coreutils `stat` (Linux):**

```sh
stat --printf "%y\t%n\n" .ievo/evolution/project.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md 2>/dev/null | awk -F'\t' 'NF==2 {split($1,t," "); print t[1] "\t" $2}'
```

**Why `--printf` and not `-c` on Linux:** GNU `stat`'s format specifiers DIFFER from BSD `stat`'s. In BSD `stat -f` the `%t` specifier is a literal tab (used in the macOS command above) — but in GNU `stat -c` `%t` is the **major device type in hex** (outputs `0` for regular files; nothing like a tab). To get a real tab on GNU, use `--printf` (which interprets `\t` and `\n` as their C-escape characters per the coreutils manual) combined with the literal `\t` escape in the format string. `--printf` is GNU-only — it stays inside this branch, with the macOS / BSD branch above using `-f "%Sm%t%N"` correctly.

Glob expansion of `.ievo/evolution/agents/*.md` returns the literal pattern if the directory is missing or empty; `2>/dev/null` suppresses the resulting "No such file" errors. Both commands above already discard any physical line that doesn't split into exactly two tab-separated fields (`awk -F'\t' 'NF==2 ...'`) before you go on to parse the surviving `date<TAB>path` pairs — split those on `\t`, not `|`; pipe is a valid character in POSIX filenames, so a path like `agents/foo|bar.md` would silently truncate under `|` splitting.

**Validate every surviving parsed record before trusting it — a filename can forge one, on either branch.** A POSIX filename may legally contain any byte except `/` and NUL, including a literal tab or newline (see Step 5's "Excerpt containment" note, which makes the same point about rendering the name). `%n`/`%N` print the filename verbatim, so **either** byte forges a second record that collides with a genuine file's own path while carrying the attacker's file's real mtime. The two shapes differ only in which check discards which line.

A name embedding a **tab with no newline** inserts an extra tab-separated field into what otherwise reads as a clean 2-field record, so the attacker's file emits a single 3-field line that collapses onto the real file's own path, byte-for-byte, the moment a parser naively takes only its first two fields. The `NF==2` filter on both commands above closes this, by discarding the 3-field line outright instead of truncating it.

A name embedding a **newline** is the one `NF==2` does *not* close, and its dangerous half is the *leading* physical line, not the extra one. `stat` emits `<the attacker file's real mtime><TAB><everything in the name up to the break>`, so for a file named `agents/legit.md` + a raw newline + `x.md` that leading line already reads `<date><TAB>.ievo/evolution/agents/legit.md` — exactly 2 tab-fields, a genuine well-formed date, and a path byte-identical to the real `agents/legit.md` beside it. It therefore clears the field-count filter, the date-shape check and the path-membership check alike. Only the *trailing* fragment (`x.md`) is dropped, and by `NF==2` (it carries one field), not by date shape. Verified on both shapes: planted next to a real `agents/legit.md`, each makes one `stat` call yield two records claiming `agents/legit.md` — one genuine, one forged. `NF==2` closes the tab shape; the path-uniqueness requirement below is what closes the newline shape.

**Normalize both sides before comparing paths — Glob's form and `stat`'s form are not the same form.** `stat` is invoked above with the three *relative* patterns, so every path it prints is relative to the directory the command ran in (`.ievo/evolution/…`). Step 1's Glob is under no such constraint, and its output form is **host-dependent**: it may hand back absolute paths (`/home/u/proj/.ievo/evolution/agents/coder.md`) or working-directory-relative ones, and nothing in this skill can pin which — a Claude Code build was observed returning relative paths even for an absolute `path` argument, so neither form may be assumed. Against a host that returns the absolute form, comparing the two sides as raw bytes matches nothing at all, and because a record failing the membership check is discarded, *every* date would drop and the column would vanish with nothing anywhere reporting an error. Derive a comparison key for each side first:

- **`stat` side** — strip one leading `./` if the host's shell emitted one; the remainder is already the working-directory-relative form.
- **Glob side** — if the path is absolute, remove the leading working-directory prefix (`<cwd>/`), where `<cwd>` is the directory this step's `stat` ran in, i.e. the session's own working directory (take it from session context — do not shell out for it; `allowed-tools` grants no command that would report it). If the path is already relative, strip one leading `./` and use it as-is.
- **Lexically only** — no symlink resolution, no `.`/`..` segment collapsing, no case folding. The two sides name the same directory entry by construction, so there is nothing legitimate to resolve, and resolving would let a symlink planted under the committed `.ievo/evolution/` tree rewrite the very key these checks compare — a planted symlink is in the same threat class as a planted file here.
- **Fail closed** — an absolute Glob path that does not begin with `<cwd>/` yields no key and therefore matches nothing `stat` printed under a relative pattern; that file simply keeps its listing row without a date.

Keep a surviving parsed line only if BOTH (a) the date field matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` exactly, and (b) the path field's normalized key is byte-identical to the normalized key of one of the paths Step 1 already enumerated via Glob. Then, across the whole surviving set, require uniqueness on that same normalized key too: if two or more validated records claim the same key, discard all of them for that path rather than picking one. This check is load-bearing, not a cost-free backstop: it is the only one of the three that rejects the newline shape above, whose forged record is indistinguishable from a genuine one on field count, date shape and path membership alike. Discarding both sides of a collision is the fail-closed choice — nothing in this pipeline can tell which of two identical-path records came from the real file — and Step 5's "mtime not captured" annotation already exists for exactly this outcome. Discard any line/record failing any check and treat that file's mtime as unavailable — the same `*(unexpected location; mtime not captured)*`-style annotation Step 5 already uses when a date genuinely isn't available — rather than rendering the unmatched or ambiguous value. A discarded line never removes the file from the listing: Step 1's Glob enumeration decides which files appear at all, `stat` only supplies an optional date column for the ones it already found.

One legibility guard on top of that, because a wholesale failure of the normalization above looks exactly like the ordinary "no overlay happened to have a usable mtime" outcome: if **every** parsed record was discarded while Step 1 did enumerate at least one file under the three canonical paths, do not render the dateless listing as if that were the normal result — add the footer *"Last-modified dates unavailable — no `stat` record matched an enumerated overlay path."* under the rows. That is the one case the annotation distinguishes: an operator seeing it knows the date pipeline produced nothing, not that these files carry no dates.

**Windows host without POSIX shell:** `stat` is unavailable. Omit the date column and emit a footer note: *"Last-modified dates require POSIX `stat`; run via WSL / Git Bash to see them."* Steps 1–3 and Step 5 still produce a useful listing.

### 5. Render the summary

Group by scope. Suggested format:

```markdown
## iEvo Overlay Status (<total> overlays active)

### Project (<0 or 1> overlay)
- `project.md` — `"We use Python 3.12+ and async-first patterns"` (last modified: 2026-05-20)

### agents/ (<N> overlays)
- `coder.md` — `"Never use var in JavaScript, prefer const/let"` (last modified: 2026-05-20)
- `architect.md` — `"Always check for existing patterns before proposing new abstractions"` (last modified: 2026-05-19)

### skills/ (<N> overlays)
- `evo.md` — `"Marker injection must be idempotent"` (last modified: 2026-05-21)

### Other (<N> file(s) — unexpected paths)
- `notes.md` — `"Project context notes"` *(unexpected location; mtime not captured)*
  _(unexpected location — not a standard iEvo overlay scope; iEvo never dispatches off these. Listed so the operator can decide whether to move it under a recognised scope or remove it.)_

---

To add an overlay → `/ievo:evo "<lesson>"`.
To remove an overlay → delete the file under `.ievo/evolution/`.
To inspect a specific overlay → `cat .ievo/evolution/<scope>/<name>.md` (or `.ievo/evolution/project.md` for project scope).
```

**Excerpt containment.** Every rendered row above interpolates two independent sources of untrusted bytes: the display name/path (Step 2's classify table — a fixed literal only for `project.md`; everywhere else it's the Glob-matched `<name>.md` basename, or, for Other scope, the full relative path, none of it validated by anything in this skill) and the one-line summary (Step 3's extraction, all five precedence paths: frontmatter `description:`, the boilerplate `## ` subsection title, the first Markdown heading, the first non-blank line, and the Other-scope display text). `.ievo/evolution/` is committed, not gitignored (`init/SKILL.md` Step 10), so any actor able to land an ordinary commit, PR, or fork controls both the filename and the file's bytes — this skill's own Step 1/Step 2 explicitly do not check that a file under this tree was actually produced by `/ievo:evo`'s write path; an unrecognised one is classified "Other" and still listed, not rejected. This report renders in the chat UI, which renders Markdown/HTML live: `![...](...)`, `[...](...)`, a raw `<img src="...">` (or any other tag), and a bare autolink (`https://…`, `www.…`) all fire the instant the report displays, with no further user action.

Before writing either value into a row, wrap it in its own inline code span — using a backtick run one character longer than the longest backtick run already inside that value, so it can't break out of its own span — rather than embedding it raw. Pad with a single literal space on BOTH sides when the value begins or ends with a backtick (CommonMark strips the pad only when both ends carry one), and collapse every CR/LF run inside the value to a single space before measuring and wrapping (a blank line would end the enclosing list item before inline parsing runs). Size each value's fence independently, against that value's own content only — the fixed template text between them (` — `, the quotes, `(last modified: …)`) carries no backtick, so two correctly-sized, independently-measured spans on the same line never interfere with each other. Apply this to all five of Step 3's extraction paths, and to the display name/path from every scope — `project.md` needs no wrapping (it's a fixed literal string this skill writes itself, never read off the file system), but every other scope's name/path is Glob-derived and unvalidated. (Same pattern as `evo/SKILL.md` Step 4's "Excerpt containment" note, `feedback/SKILL.md`'s "Identifier containment" note, and `deep-review/SKILL.md` Step 5's "Excerpt containment" note.)

**Omit the "Other" section entirely when empty.** Empty Project / agents / skills scopes still render with `(none)` (explicit zero conveys "I checked, nothing's there"), but a fully-empty Other category should be hidden rather than printed as "0 unexpected paths" — its absence is the legible signal.

**"Other" scope has no mtime column.** Step 4's `stat` invocation only covers the three canonical paths (`project.md`, `agents/*.md`, `skills/*.md`). Files classified as Other won't appear in stat's output, so their "last modified" date is unavailable from a single batched call. Don't pad with a fake date — omit the date for those rows (use the `*(unexpected location; mtime not captured)*` annotation as shown above) and keep Step 4's stat call simple. If the operator needs mtime for an Other file they can `stat <path>` it manually.

**Scope ordering:** Project first (broadest blast radius), then agents/, then skills/. Empty scopes still appear with `(none)` instead of being hidden — explicit zero is more legible than absent, and conveys "I checked, nothing's there".

**Total count:** sum of all overlay files actually enumerated. There is no `LOG.md` exclusion to apply (no such file exists in user projects).

### 6. (Optional) Stale-overlay note

Compare against today's date — if not already known in session context, obtain it via:

```sh
date -u +%Y-%m-%d
```

If any overlay's last-modified date is more than 180 days before today, add a footer line:

```
⚠ <N> overlay(s) untouched in 180+ days — consider running `/ievo:evo`
  again to confirm they're still load-bearing, or delete if superseded.
```

180 days is a deliberate floor — overlays codify durable conventions, so monthly touch isn't expected. Anything fresher than 180 days isn't flagged.

This step is best-effort; skip it if mtime is unavailable (Step 4 Windows-fallback path).

## Rules

- **Read-only.** This skill NEVER writes, edits, or deletes overlay files. Even on encountering corrupted YAML frontmatter — emit `(unparsable frontmatter)` and move on.
- **Project scope is a FLAT file**, not a directory. The path is `.ievo/evolution/project.md` — do NOT glob `.ievo/evolution/project/*.md` (no such subdirectory exists).
- **Use Glob for existence detection**, not a sentinel file. No iEvo skill guarantees the presence of any specific file under `.ievo/evolution/` — only that overlays are written there when `/ievo:evo` is invoked.
- **Empty scopes show `(none)`** — don't hide them. The point is legibility; explicit zero conveys "I checked, nothing's there".
- **Bash is used only for mtime lookup, its record filter, and OS/date detection** (`stat` for last-modified per file, `awk -F'\t'` to drop `stat` output lines that aren't exactly two tab-separated fields — on **both** branches, Step 4 — `uname -s` for OS-branch routing in Step 4, `date -u +%Y-%m-%d` for the today-date comparison in Step 6 if not already in session context). Never for reading file contents or modifying anything. The `allowed-tools` frontmatter declares `Bash(stat*)`, `Bash(awk*)`, `Bash(uname*)`, and `Bash(date*)` for exactly these four uses — no broader Bash surface. `awk` is declared because it is the second stage of Step 4's pipeline on both branches, and a host that matches each stage of a pipeline against the allowlist separately would otherwise refuse the whole call — costing the date column silently, since Step 4 already treats an unavailable `stat` result as "no mtime" rather than an error.
- **Names and excerpts are code-fenced before display; `stat` records are shape-validated before being trusted.** Every display name/path and extracted summary is untrusted (any actor who can commit to `.ievo/evolution/` controls both) — wrap each independently per Step 5's "Excerpt containment" note before rendering. A parsed `stat` line is untrusted too, since a tab **or a newline** embedded in a filename forges a record that collides with a genuine file's own path — keep only a 2-field line whose date matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, whose path matches Step 1's own Glob enumeration — after normalizing both sides to the working-directory-relative form, lexically, since Glob may hand back absolute paths while `stat` prints the relative argv form — and whose path isn't claimed by any other surviving line. That last check is not redundant: it is the only one that rejects the newline shape, which clears the other two (Step 4).

## See also

- `evo/SKILL.md` — writes overlays (the inverse of this skill). Defines the layout convention `.ievo/evolution/{project.md,agents/<name>.md,skills/<name>.md}`.
- `init/SKILL.md` — creates the `.ievo/evolution/` directory at install time (Step 9 + Step 10's gitignore configuration).

## References

- [Agents Best Practices — agent legibility feedback loops](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/agent-legibility-feedback-loops.md) — the principle this skill exists to honour.
- `coverage-audit.md` — closes the row "Standalone 'list installed iEvo overlays' command" (formerly `gap`, now `covered`).
