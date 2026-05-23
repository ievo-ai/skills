---
name: overlay-status
description: Surface the current state of iEvo evolution overlays in this project. Lists every overlay under `.ievo/evolution/` grouped by scope (project, agents, skills), with a one-line summary + last-modified date per file. Use when the user asks "what evolutions have I captured", "show my iEvo overlays", "what rules are active in this project", "list installed overlays", "summarize .ievo/evolution", "какие правила iEvo активны", or "покажи мои overlay'и". Read-only — never modifies, deletes, or rewrites overlay content. Closes the legibility gap iEvo's own `coverage-audit.md` flagged as "Standalone 'list installed iEvo overlays' command".
license: MIT
allowed-tools:
  - Read
  - Glob
  - Bash(stat*)
compatibility: Works on any agent platform that supports the agentskills.io standard. Pure Read + Glob for enumeration; Bash (`stat`) for last-modified dates on POSIX hosts. Gracefully degraded on Windows hosts without POSIX shell — dates are omitted with an explicit footer note. Output is plain markdown so it renders correctly in every supported runner.
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
- Before a `/ievo:evolution` call — confirm the new lesson isn't already covered by an existing overlay

## Steps

### 1. Enumerate overlay files

Use the Glob tool with pattern `.ievo/evolution/**/*.md`. Glob returns an empty array if the directory doesn't exist or contains no `.md` files — no need for a separate existence check. Glob is the only existence-detection path; do NOT use a sentinel file (no skill in iEvo guarantees any specific file's presence — `evolution/SKILL.md` only writes per-scope overlay files as needed).

Expected layout (defined by `evolution/SKILL.md` Step 4):

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

To capture your first lesson, run `/ievo:evolution "<lesson text>"` —
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
2. **First Markdown heading** (`# ` or `## ` line) below the frontmatter — strip the `#`s, use the text.
3. **First non-blank, non-frontmatter, non-heading line** — use up to its first 120 characters.
4. **Fallback** — emit `(empty overlay)` if none of the above produces text.

Strip surrounding whitespace; collapse internal whitespace to single spaces; truncate at 120 chars with `…` if longer. On corrupted frontmatter (YAML parse error) emit `(unparsable frontmatter)` and continue with the next file — never modify the file in response.

### 4. Capture last-modified dates

The Glob tool does not return mtime directly. To get last-modified per file, use Bash with a single `stat` call covering all overlay paths.

**BSD `stat` (macOS):**

```sh
stat -f "%Sm|%N" -t "%Y-%m-%d" .ievo/evolution/project.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md 2>/dev/null
```

**GNU coreutils `stat` (Linux):**

```sh
stat -c "%y|%n" .ievo/evolution/project.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md 2>/dev/null | awk -F'|' '{split($1,t," "); print t[1] "|" $2}'
```

Glob expansion of `.ievo/evolution/agents/*.md` returns the literal pattern if the directory is missing or empty; `2>/dev/null` suppresses the resulting "No such file" errors. Parse the surviving `YYYY-MM-DD|<path>` pairs.

**Windows host without POSIX shell:** `stat` is unavailable. Omit the date column and emit a footer note: *"Last-modified dates require POSIX `stat`; run via WSL / Git Bash to see them."* Steps 1–3 and Step 5 still produce a useful listing.

### 5. Render the summary

Group by scope. Suggested format:

```markdown
## iEvo Overlay Status (<total> overlays active)

### Project (<0 or 1> overlay)
- `project.md` — "We use Python 3.12+ and async-first patterns" (last modified: 2026-05-20)

### agents/ (<N> overlays)
- `coder.md` — "Never use var in JavaScript, prefer const/let" (last modified: 2026-05-20)
- `architect.md` — "Always check for existing patterns before proposing new abstractions" (last modified: 2026-05-19)

### skills/ (<N> overlays)
- `evolution.md` — "Marker injection must be idempotent" (last modified: 2026-05-21)

### Other (<N> file(s) — unexpected paths)
- `notes.md` — "Project context notes" *(unexpected location; mtime not captured)*
  _(unexpected location — not a standard iEvo overlay scope; iEvo never dispatches off these. Listed so the operator can decide whether to move it under a recognised scope or remove it.)_

---

To add an overlay → `/ievo:evolution "<lesson>"`.
To remove an overlay → delete the file under `.ievo/evolution/`.
To inspect a specific overlay → `cat .ievo/evolution/<scope>/<name>.md` (or `.ievo/evolution/project.md` for project scope).
```

**Omit the "Other" section entirely when empty.** Empty Project / agents / skills scopes still render with `(none)` (explicit zero conveys "I checked, nothing's there"), but a fully-empty Other category should be hidden rather than printed as "0 unexpected paths" — its absence is the legible signal.

**"Other" scope has no mtime column.** Step 4's `stat` invocation only covers the three canonical paths (`project.md`, `agents/*.md`, `skills/*.md`). Files classified as Other won't appear in stat's output, so their "last modified" date is unavailable from a single batched call. Don't pad with a fake date — omit the date for those rows (use the `*(unexpected location; mtime not captured)*` annotation as shown above) and keep Step 4's stat call simple. If the operator needs mtime for an Other file they can `stat <path>` it manually.

**Scope ordering:** Project first (broadest blast radius), then agents/, then skills/. Empty scopes still appear with `(none)` instead of being hidden — explicit zero is more legible than absent, and conveys "I checked, nothing's there".

**Total count:** sum of all overlay files actually enumerated. There is no `LOG.md` exclusion to apply (no such file exists in user projects).

### 6. (Optional) Stale-overlay note

If any overlay's last-modified date is more than 180 days ago, add a footer line:

```
⚠ <N> overlay(s) untouched in 180+ days — consider running `/ievo:evolution`
  again to confirm they're still load-bearing, or delete if superseded.
```

180 days is a deliberate floor — overlays codify durable conventions, so monthly touch isn't expected. Anything fresher than 180 days isn't flagged.

This step is best-effort; skip it if mtime is unavailable (Step 4 Windows-fallback path).

## Rules

- **Read-only.** This skill NEVER writes, edits, or deletes overlay files. Even on encountering corrupted YAML frontmatter — emit `(unparsable frontmatter)` and move on.
- **Project scope is a FLAT file**, not a directory. The path is `.ievo/evolution/project.md` — do NOT glob `.ievo/evolution/project/*.md` (no such subdirectory exists).
- **Use Glob for existence detection**, not a sentinel file. No iEvo skill guarantees the presence of any specific file under `.ievo/evolution/` — only that overlays are written there when `/ievo:evolution` is invoked.
- **Empty scopes show `(none)`** — don't hide them. The point is legibility; explicit zero conveys "I checked, nothing's there".
- **Bash is used only for `stat`**, never for reading file contents or modifying anything. The `allowed-tools` frontmatter declares `Bash(stat*)` for exactly this — no broader Bash surface.

## See also

- `evolution/SKILL.md` — writes overlays (the inverse of this skill). Defines the layout convention `.ievo/evolution/{project.md,agents/<name>.md,skills/<name>.md}`.
- `init/SKILL.md` — creates the `.ievo/evolution/` directory at install time (Step 9 + Step 10's gitignore configuration).

## References

- [Agents Best Practices — agent legibility feedback loops](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/agent-legibility-feedback-loops.md) — the principle this skill exists to honour.
- `coverage-audit.md` — closes the row "Standalone 'list installed iEvo overlays' command" (formerly `gap`, now `covered`).
