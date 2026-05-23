---
name: overlay-status
description: Surface the current state of iEvo evolution overlays in this project. Lists every overlay under `.ievo/evolution/` grouped by scope (kernel, agents, skills, project), with a one-line summary + last-modified date per file. Use when the user asks "what evolutions have I captured", "show my iEvo overlays", "what rules are active in this project", "list installed overlays", "summarize .ievo/evolution", "какие правила iEvo активны", or "покажи мои overlay'и". Read-only — never modifies, deletes, or rewrites overlay content. Closes the legibility gap iEvo's own `coverage-audit.md` flagged as "Standalone 'list installed iEvo overlays' command".
license: MIT
compatibility: Works on any agent platform that supports the agentskills.io standard. Pure Read + Glob — no Bash, no Node script, no network. Cross-platform regardless of POSIX vs Windows host. Output is plain markdown so it renders correctly in every supported runner.
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

### 1. Check that `.ievo/evolution/` exists

Use the Read tool on `.ievo/evolution/` (try reading a known sentinel file, e.g. `.ievo/evolution/LOG.md`). If the directory or expected files are absent → no overlays. Print:

```
No iEvo overlays found in this project.

`.ievo/evolution/` does not exist (or contains no overlay files).

To capture your first lesson, run `/ievo:evolution "<lesson text>"` —
it will create the directory and write the overlay automatically.
```

Exit cleanly. Do NOT create the directory from this skill.

### 2. Enumerate overlay files

Use the Glob tool with pattern `.ievo/evolution/**/*.md`. Expected layout (from `iEVO.md` conventions):

```
.ievo/evolution/
├── LOG.md                  ← journal (skip from overlay listing — write-only history)
├── KERNEL.md               ← kernel overlay (pipeline-level rules; all agents read)
├── agents/
│   └── <name>.md           ← per-agent overlays
├── skills/
│   └── <name>.md           ← per-skill overlays
└── project/
    └── <name>.md           ← project-scope overlays (rare; usually all rules live in KERNEL)
```

`LOG.md` is the append-only findings journal — it grows with every `/ievo:evolution` capture but is not itself an overlay. **Skip it from the listing** (it would dominate the output and isn't an "active rule").

### 3. Read each overlay file and extract a one-line summary

For each enumerated `.md` file (except `LOG.md`), use the Read tool and pull the summary by this precedence:

1. **YAML frontmatter `description:` field** — if present and non-empty, use it.
2. **First Markdown heading** (`# ` or `## ` line) below the frontmatter — strip the `#`s, use the text.
3. **First non-blank, non-frontmatter, non-heading line** — use up to its first 120 characters.
4. **Fallback** — emit `(empty overlay)` if none of the above produces text.

Strip surrounding whitespace; collapse internal whitespace to single spaces; truncate at 120 chars with `…` if longer.

### 4. Capture last-modified dates

The Glob tool does not return mtime directly. To get last-modified per file, use the Bash tool with one batched `stat` call (POSIX hosts):

```sh
stat -f "%Sm|%N" -t "%Y-%m-%d" .ievo/evolution/KERNEL.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md .ievo/evolution/project/*.md 2>/dev/null
```

Or on GNU coreutils (Linux):

```sh
stat -c "%y|%n" .ievo/evolution/KERNEL.md .ievo/evolution/agents/*.md .ievo/evolution/skills/*.md .ievo/evolution/project/*.md 2>/dev/null | awk -F'|' '{split($1,t," "); print t[1] "|" $2}'
```

Parse the `YYYY-MM-DD|<path>` pairs. If `stat` is unavailable (Windows host without POSIX shell), omit the date column and emit a footer note: "Last-modified dates require POSIX `stat`; run via WSL / Git Bash to see them."

### 5. Render the summary

Group by scope. Suggested format:

```markdown
## iEvo Overlay Status (<total> overlays active)

### Kernel (1 overlay)
- `KERNEL.md` — "Pipeline-level rules: ..." (last modified: 2026-05-22)

### agents/ (<N> overlays)
- `coder.md` — "Never use var in JavaScript, prefer const/let" (last modified: 2026-05-20)
- `architect.md` — "Always check for existing patterns before proposing new abstractions" (last modified: 2026-05-19)

### skills/ (<N> overlays)
- `evolution.md` — "Marker injection must be idempotent" (last modified: 2026-05-21)

### project/ (<N> overlays)
- (none)

---

To add an overlay → `/ievo:evolution "<lesson>"`.
To remove an overlay → delete the file under `.ievo/evolution/`.
To inspect a specific overlay → `cat .ievo/evolution/<scope>/<name>.md`.
```

**Scope ordering:** Kernel first (most-impactful), then agents/, skills/, project/. Empty scopes get `(none)` instead of being hidden — explicit zero is more legible than absent.

**Total count:** sum of all overlay files actually enumerated (excludes `LOG.md`).

### 6. (Optional) Stale-overlay note

If any overlay's last-modified date is more than 180 days ago, add a footer line:

```
⚠ <N> overlay(s) untouched in 180+ days — consider running `/ievo:evolution`
  again to confirm they're still load-bearing, or delete if superseded.
```

180 days is a deliberate floor — overlays codify durable conventions, so monthly touch isn't expected. Anything fresher than 180 days isn't flagged.

This step is best-effort; skip it if mtime is unavailable (Step 4 fallback path).

## Rules

- **Read-only.** This skill NEVER writes, edits, or deletes overlay files. Even on encountering corrupted YAML frontmatter — emit `(unparsable frontmatter)` and move on.
- **Skip `LOG.md` from the listing.** It's append-only history, not an active rule. Counting it would inflate the total misleadingly.
- **`KERNEL.md` IS an overlay** for purposes of this listing — it carries pipeline-level rules read by all agents. List it under "Kernel" scope.
- **Empty scopes show `(none)`** — don't hide them. The point is legibility; explicit zero conveys "I checked, nothing's there".
- **No network, no sub-agent, no Bash beyond `stat`.** Skill body is the entire implementation; cross-platform compatibility depends on this.

## See also

- `evolution/SKILL.md` — writes overlays (the inverse of this skill).
- `init/SKILL.md` — creates `.ievo/evolution/` layout on first run.
- `iEVO.md` (project kernel symlink) — the authoritative source of overlay-scope conventions.

## References

- [Agents Best Practices — agent legibility feedback loops](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/agent-legibility-feedback-loops.md) — the principle this skill exists to honour.
- `coverage-audit.md` — closes the row "Standalone 'list installed iEvo overlays' command" (formerly `gap`, now `covered`).
