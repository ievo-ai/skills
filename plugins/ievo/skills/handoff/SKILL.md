---
name: handoff
description: Use this skill when the user says "hand off", "hand this off", "create a handoff", "branch this to another session", "pass context to next session", "start a new session for X", or invokes /ievo:handoff. Compacts the current conversation into a portable handoff document for a fresh agent session. Solves the context-window degradation problem — reasoning quality drops past ~120k tokens, so instead of /compact (lossy summarization), branch out-of-scope work into a focused parallel session with curated context. Produces a Markdown document with the next session's purpose, relevant context excerpts, suggested iEvo skills, artifact pointers (file paths, PR/issue links), and redacted secrets. Saved to OS temp dir for easy copy-paste into a new session.
argument-hint: "[purpose]"
license: MIT
effort: low
allowed-tools:
  - Read
  - Glob
  - Write
compatibility: Works on any agent platform that supports the agentskills.io standard. Uses Read + Glob for context gathering, Write for output. Output is a plain Markdown file readable by any agent on any platform. No external dependencies.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Handoff — portable context handoff between agent sessions

Produce a self-contained Markdown document that lets a fresh agent session continue work without re-deriving context. The handoff is a curated brief, not a transcript dump.

## When to use

- User identifies work that belongs in a separate session ("this is out of scope, let's hand it off")
- Current context window is deep (100k+ tokens) and a fresh start would be more effective
- User wants to parallelize — spin off a subtask to a sibling session while the current one continues
- User explicitly invokes `/ievo:handoff <purpose>`

## When not to use — lighter alternatives

Not every context problem needs a handoff. Reach for the lightest tool that fits — a handoff creates a NEW session capsule, so it can't recover context you lost in the CURRENT one.

| Situation | Better tool |
|-----------|-------------|
| You ran `/clear` accidentally and want the context back | `/rewind` (Claude Code v2.1.191+) — restores the conversation to its pre-`/clear` state in the **same session**; `/ievo:handoff` cannot help here (it would capsule the now-cleared state) |
| Context is deep but you want to keep going in the same session | `/compact` — lossy summarization; stays in the current session |
| You want to branch, parallelize, or carry curated context to a NEW session | `/ievo:handoff` — this skill |
| You're on Cursor v3.7+ and want `/in-cloud` sessions to start with iEvo already installed | `.cursor/environment.json` (captured after `/ievo:init`) — persists installed-plugin state across ephemeral cloud VMs; pair it with `/ievo:handoff` when the new session also needs your current context |

## Inputs

- **Required:** purpose of the next session (from user argument or conversation context)
- **Optional:** specific files, PRs, issues, or topics the user wants included

If the user invoked `/ievo:handoff` without arguments and the conversation doesn't make the purpose obvious, ask once via `AskUserQuestion`:

- **Question:** `What should the next session focus on?`
- **Header:** `Purpose`
- **Options:**
  - `Continue current task` — description: `Hand off everything needed to resume exactly where we left off.`
  - `Branch a subtask` — description: `Carve out a specific piece of work for a parallel session.`
  - `Start fresh exploration` — description: `New direction — carry over only background context, not in-progress work.`

The user's choice (or freeform "Other" response) becomes the stated purpose.

## Step 1: Determine output path

Use the OS temp directory and generate a unique filename. Resolve in priority order:

1. `TMPDIR` — set on POSIX systems (macOS, Linux)
2. `TEMP` — set on Windows
3. `TMP` — Windows legacy fallback
4. `/tmp` — last resort

Build the output path: `<temp-dir>/ievo-handoff-<YYYYMMDD-HHMMSS>.md`

Use ISO-8601 basic format for the timestamp (no colons — Windows-safe, sortable). No Bash invocation needed — the agent reads the relevant env var directly.

## Step 2: Gather context for the handoff document

Collect the following from the current session and project state. Each item is included ONLY if relevant to the stated purpose — do not dump everything.

### 2a — Project identity

- Project root path
- Primary language / framework (from manifest files if present: `package.json`, `pyproject.toml`, `Cargo.toml`, etc.)
- Git branch and recent commit (if in a git repo)

### 2b — In-progress work state

- Files modified in this session (from conversation context, not `git status` — the handoff captures what THIS session touched)
- Open questions or decisions pending
- Blockers encountered
- Key findings or conclusions reached

### 2c — Relevant artifacts (pointers, not content)

Reference by path or URL — never duplicate file content into the handoff:

- File paths central to the task
- PR or issue URLs discussed
- Documentation links referenced
- Test results or CI status if relevant

### 2d — Suggested skills

Auto-detect installed iEvo skills and suggest relevant ones for the next session:

1. Check for `.ievo/skills-installed.json` — if present, read and extract skill names.
2. If not present, scan the invoking client's own load paths for installed skills via Glob (`$CODEX_CLI` env var rule, same as `evo/SKILL.md` Step 1 — scanning the other client's dirs would suggest skills the next session can't actually load):
   - On Claude Code (`$CODEX_CLI` unset): `.claude/skills/*/SKILL.md`, `.claude/plugins/*/skills/*/SKILL.md`
   - On Codex (`$CODEX_CLI` set): `.agents/skills/*/SKILL.md`
3. From the installed skills list, select those relevant to the next session's purpose. Always include `/ievo:init` if the next session involves a new project, `/ievo:evo` if it involves capturing lessons, and `/ievo:security-check` if it involves auditing.
4. If no iEvo skills are detected, omit the suggested-skills section entirely rather than suggesting skills that may not be installed.

### 2e — Active evolution overlays (if relevant)

If `.ievo/evolution/` exists and the next session will work in the same project, note which overlays are active so the next agent inherits the same conventions:

- Check `.ievo/evolution/project.md` — if present, mention it
- Check `.ievo/evolution/agents/*.md` and `.ievo/evolution/skills/*.md` — list names

Reference the overlay paths; do not copy overlay content into the handoff.

## Step 3: Redact sensitive material

Before writing the handoff document, scan ALL text content for sensitive patterns and replace with `[REDACTED]`:

### Patterns to redact

| Pattern | Example | Replacement |
|---------|---------|-------------|
| `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY` env var values | `GITHUB_TOKEN=ghp_abc123...` | `GITHUB_TOKEN=[REDACTED]` |
| Bearer tokens | `Bearer eyJhbG...` | `Bearer [REDACTED]` |
| API key prefixes | `sk-ant-api03-...`, `sk-proj-...`, `sk-...` | `[REDACTED]` |
| AWS-style keys | `AKIA...` (20 char uppercase) | `[REDACTED]` |
| GitHub tokens | `ghp_...`, `gho_...`, `ghs_...`, `github_pat_...` | `[REDACTED]` |
| Private key blocks | `-----BEGIN.*PRIVATE KEY-----` | `[REDACTED PRIVATE KEY]` |
| Connection strings with credentials | `://user:pass@host` | `://[REDACTED]@host` |
| High-entropy strings (40+ hex chars, excluding exact 40-char git SHAs) | `a1b2c3d4e5f6...` (>40 chars) | `[REDACTED]` |

Redaction is best-effort — the denylist cannot catch every secret. The handoff document header includes a warning about this (see Step 4).

### What NOT to redact

- File paths (even if they contain usernames — paths are needed for navigation)
- Git commit SHAs (public information)
- Package names and versions
- URLs without embedded credentials

## Step 4: Write the handoff document

Use the Write tool to produce the document. Structure:

```markdown
# Handoff — <purpose summary, 5-10 words>

> Generated by /ievo:handoff on <YYYY-MM-DD HH:MM UTC>
> Source session project: <project root path>
> **Review for secrets before sharing** — redaction is best-effort.

## Purpose

<1-3 sentences describing what the next session should accomplish,
derived from the user's argument or conversation context>

## Context

<Curated excerpts from the current session — decisions made,
approaches tried, key findings. Written as a brief for a colleague
who just walked into the room. NOT a transcript dump.>

## Key files

- `<path>` — <one-line description of relevance>
- `<path>` — <one-line description>
- ...

## Open items

- [ ] <pending task or decision>
- [ ] <blocker or question>
- ...

## Suggested skills

<Only if iEvo skills were detected in Step 2d>

- `/ievo:<skill>` — <when to use it in the next session>
- ...

## Active overlays

<Only if overlays exist and are relevant per Step 2e>

- `.ievo/evolution/project.md` — project-wide conventions
- `.ievo/evolution/agents/<name>.md` — <name> agent rules
- ...

Review these overlays at the start of the next session to inherit
project conventions.

## References

- <PR/issue URL> — <context>
- <doc link> — <context>
- ...
```

Sections with no content are omitted entirely (not rendered as empty headers).

## Step 5: Report to user

Print the output path and a brief summary:

```
Handoff document saved to: <absolute path>

  Purpose: <short purpose>
  Context items: <N>
  Files referenced: <N>
  Open items: <N>
  Skills suggested: <N or "none detected">

To use: open a fresh session and paste the path, or run:
  cat <path> | pbcopy    # macOS
  cat <path> | xclip     # Linux
  clip < <path>          # Windows

The next agent will have curated context without the
accumulated weight of this session's history.
```

## Rules

- **Curated brief, not transcript.** The handoff is a focused document for a colleague, not a conversation dump. Include only what the next session needs to be productive. If in doubt, leave it out — the next agent can always read files directly.
- **Pointers, not copies.** Reference artifacts by path or URL. Never duplicate file content, PR bodies, issue text, commit messages, or documentation into the handoff. The next session has Read/Glob/Bash — it can fetch what it needs from the pointers.
- **Redact secrets before write.** Apply Step 3 patterns to all text before the Write tool call. Redaction is best-effort — the document header warns the user to review before sharing externally.
- **Temp dir, not workspace.** Save to the OS temporary directory, never to the project working tree. Handoff documents are ephemeral working documents, not project artifacts. The user can explicitly save to a permanent location if they want retention.
- **No session state dependency.** The handoff must be self-contained — a fresh agent with no conversation history should be able to read it and start working. Don't reference "what we discussed earlier" or "the approach from above."
- **Respect user scope.** If the user specified a narrow purpose, don't broaden the handoff to include unrelated session context. A handoff for "fix the login bug" shouldn't include the database migration discussion from earlier in the session.
- **Idempotent.** Running `/ievo:handoff` multiple times produces separate documents (unique timestamps). Previous handoffs are not modified or referenced.

## See also

- `/ievo:evo` — if the current session produced lessons worth persisting across ALL future sessions (not just the next one), capture them as evolution overlays before handing off.
- `/ievo:debug-on` — if the next session needs verbose logging for diagnosis.
- `/ievo:init` — if the next session targets a project that hasn't been set up with iEvo yet.
