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
  - Bash(mktemp*)
  - Bash(chmod*)
  - Bash(codex plugin list*)
  - Bash(claude plugin list*)
compatibility: Works on any agent platform that supports the agentskills.io standard. Uses Read + Glob for context gathering, Write for output. Optionally runs Bash (`mktemp` for an atomically-created, unpredictable output path + `chmod 600` to harden it, and `codex plugin list --json` / `claude plugin list` for plugin state) — degrades gracefully to a timestamp-only path with no hardening where Bash or `mktemp` is unavailable. Output is a plain Markdown file readable by any agent on any platform.
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
| You're on Codex CLI (rust-v0.138.0+, macOS or native Windows) and want to switch to Codex Desktop in the same work session | `/app` — native one-step handoff, no document created; use `/ievo:handoff` instead for cross-platform transfer, archiving, a curated brief, or async handoff to a colleague |
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

A timestamp-only filename is guessable to second granularity by anyone else who can list or poll the same temp directory — on a shared devbox, CI runner, or multi-tenant container that directory is not guaranteed private to the invoking user (CWE-377). Add a random component and create the file atomically so the path can't be pre-planted or guessed ahead of time.

**When Bash is available (Claude Code, Codex):** create the output file by running `mktemp` directly, with no `VAR=` assignment wrapped around it — this skill's `allowed-tools` only pre-authorizes `Bash(mktemp*)` for a command whose text literally starts with `mktemp`, and a leading assignment turns it into a different command the matcher won't recognize, falling through to a manual prompt instead. Resolve the temp dir via the same priority order as below, using mktemp's own `TMPDIR` handling:

```bash
mktemp "${TMPDIR:-${TEMP:-${TMP:-/tmp}}}/ievo-handoff-XXXXXXXXXXXX"
```

The `X` run must be the **last** thing in the template — do not append `.md` (or any other suffix) after it. GNU `mktemp` tolerates a trailing suffix (its `--suffix` option "is implied if TEMPLATE does not end in X"), but BSD/macOS `mktemp` passes the template to `mkstemp(3)`, which requires the name to end in `X`s — a template with a suffix after the `X` run is rejected outright and no file is created. The resulting file therefore has no extension; the content written in Step 4 is still Markdown, and Step 5 reports the exact path either way.

`mktemp`'s trailing `X` run becomes a random alphanumeric suffix (12 chars — comfortably past the 6 both GNU and BSD `mktemp` require), and its exclusive-creation semantics guarantee the path did not already exist as a file, symlink, or directory the instant before creation — closing both the guessable-name disclosure risk and the symlink pre-plant/overwrite risk in one step, without needing to separately check-then-write (a check followed by a later Write call would itself be a race). `mktemp` prints the created path to stdout — read it from the command's own output and carry that exact string forward as the output path for Step 4. Note that this leaves an empty file already sitting at that path, so Step 4's Write is an overwrite — see Step 4's read-first requirement.

**If `mktemp` fails** — a non-zero exit status, or an empty/whitespace-only stdout (no `mktemp` on `PATH`, an unset-and-missing temp directory, a temp directory that isn't writable, or a platform that rejects the template): treat the `mktemp` path as unavailable — do not retry, do not switch templates, and do not block the handoff. Fall through to the fallback below and continue. Best-effort only, same spirit as Step 2f's plugin-state capture and Step 3's redaction.

**When Bash is unavailable (another agentskills.io platform), or `mktemp` failed:** fall back to resolving the temp directory from an env var directly, in priority order:

1. `TMPDIR` — set on POSIX systems (macOS, Linux)
2. `TEMP` — set on Windows
3. `TMP` — Windows legacy fallback
4. `/tmp` — last resort

Build the output path: `<temp-dir>/ievo-handoff-<YYYYMMDD-HHMMSS>.md`, using ISO-8601 basic format for the timestamp (no colons — Windows-safe, sortable). This fallback lacks the random component and creation-atomicity of the `mktemp` path above — best-effort only, same spirit as Step 2f/Step 3's degrade-gracefully posture elsewhere in this skill.

## Step 2: Gather context for the handoff document

Collect the following from the current session and project state. Each item is included ONLY if relevant to the stated purpose — do not dump everything.

### 2a — Project identity

- Project root path
- Primary language / framework (from manifest files if present: `package.json`, `pyproject.toml`, `Cargo.toml`, etc.)
- Git branch and recent commit (if in a git repo)

### 2b — In-progress work state

- Current plan state — which phase/step the work is in, what's decided, what's next (from the session's in-progress plan or task list; if no explicit plan exists, the work stage in 2-3 sentences)
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
2. If not present, scan the invoking client's own load paths for installed skills via Glob (detect per `/ievo:init` Step 1.5, **ordered**: `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code; same rule as `evo/SKILL.md` Step 1 — scanning the other client's dirs would suggest skills the next session can't actually load):
   - On Claude Code (Step 1.5: no Codex signal): `.claude/skills/*/SKILL.md`, `.claude/plugins/*/skills/*/SKILL.md`
   - On Codex (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal): `.agents/skills/*/SKILL.md`
3. From the installed skills list, select those relevant to the next session's purpose. Always include `/ievo:init` if the next session involves a new project, `/ievo:evo` if it involves capturing lessons, and `/ievo:security-check` if it involves auditing.
4. If no iEvo skills are detected, omit the suggested-skills section entirely rather than suggesting skills that may not be installed.

### 2e — Active evolution overlays (if relevant)

If `.ievo/evolution/` exists and the next session will work in the same project, note which overlays are active so the next agent inherits the same conventions:

- Check `.ievo/evolution/project.md` — if present, mention it
- Check `.ievo/evolution/agents/*.md` and `.ievo/evolution/skills/*.md` — list names

Reference the overlay paths; do not copy overlay content into the handoff.

### 2f — Plugin state (source session)

Capture which plugins are installed in the source session, so the receiving session can verify its own environment before acting on any skill or command this handoff references — a receiving session on a different machine, or a different platform (Codex vs Claude Code), may not have the same plugins installed.

Detect the active platform via env-var signals ONLY — `/ievo:init` Step 1.5's canonical rule, the same one Step 2d uses, never `codex --version`/`claude --version` (those only prove a CLI is installed alongside the current one, not which platform is actually driving this session). Step 1.5 is an **ordered** rule — `$CLAUDECODE` set with `$CODEX_CLI` unset → Claude Code, else `$CODEX_CLI` set → Codex, else a Codex Desktop signal (`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`, or macOS `__CFBundleIdentifier=com.openai.codex`) → Codex, else Claude Code. Keying off the bare `$CODEX_CLI` var alone would run `claude plugin list` in a Codex Desktop session, and dropping the leading `$CLAUDECODE` check would run `codex plugin list --json` in a Claude Code session that merely inherited a Desktop marker from a parent process (both issue #461):

1. **Codex (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal):** run `codex plugin list --json` (Codex rust-v0.137.0+; rust-v0.138.0+ additionally reports each plugin's marketplace source in the JSON).
2. **Claude Code (Step 1.5: no Codex signal):** run `claude plugin list`.
3. **Command fails, returns empty output, or (Codex only) returns output that isn't valid JSON:** treat plugin state as unavailable — do not retry, do not block the handoff.
4. **Neither Codex nor Claude Code (another agentskills.io platform):** skip capture entirely — there is no known plugin-list command to run.

Report only the fields the command's own output actually contains (name, source, version) — the exact shape varies by CLI version. Never fabricate a plugin or host-CLI version number the output didn't report; omit it rather than guess.

Best-effort only, same spirit as Step 3's redaction — a failed or unavailable plugin listing never blocks handoff document creation.

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

Use the Write tool to produce the document at the exact path determined in Step 1 (the path `mktemp` printed, or the fallback path).

**Read the file first whenever Step 1 already created it.** On the `mktemp` path the output file exists (empty, zero bytes) before Step 4 starts, so the Write is an *overwrite*, not a create — and Claude Code's Write tool refuses to overwrite a path the session hasn't Read, failing with `File has not been read yet. Read it first before writing to it.` Call the Read tool once on that exact path before the Write: on an empty file it returns only an "exists but the contents are empty" notice (a warning, not an error) and registers the file as read, after which the Write succeeds normally. Skip it on the fallback path, where no file exists yet and Write creates it. On a platform whose write tool carries no such read-first requirement the extra Read is simply a harmless no-op, so this ordering is safe everywhere.

Structure:

```markdown
# Handoff — <purpose summary, 5-10 words>

> Generated by /ievo:handoff on <YYYY-MM-DD HH:MM UTC>
> Source session project: <project root path>
> **Review for secrets before sharing** — redaction is best-effort.
> <Only if Step 2f's platform was undetectable (neither Codex nor Claude Code):> Plugin state not captured — unsupported platform — verify iEvo (and any other referenced plugin) is installed in the receiving session before running suggested skills.

## Purpose

<1-3 sentences describing what the next session should accomplish,
derived from the user's argument or conversation context>

## Context

<Curated excerpts from the current session — decisions made,
approaches tried, key findings. Written as a brief for a colleague
who just walked into the room. NOT a transcript dump.>

## Active plan state

<1-paragraph summary of where the work is: which phase, which step, what's decided, what's next.
Derived from the current session's in-progress plan or task list.
If no explicit plan exists, describe the work stage in 2-3 sentences.>

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

Run `/ievo:overlay-status` at the start of the next session to see
what's active, then read the listed overlays to inherit project
conventions.

## Plugin state (source session)

<Only if Step 2f ran on Codex or Claude Code — omitted entirely when the platform was undetectable (see the header blockquote note instead)>

<If the plugin-list command succeeded:>

Platform: <Codex / Claude Code — append a host CLI version only if the command output itself reports one>
Installed plugins:
  - <name> (source: <marketplace>)<append a version only if the command output reports one — never fabricate one>
  - ...

Note: verify these are installed in the receiving session before executing handoff tasks that reference them.

<If the plugin-list command failed or returned empty, replace the whole section above with:>

## Plugin state: unavailable

Could not list installed plugins for this session. If this handoff references iEvo skills or other plugin commands, verify they're installed in the receiving session first:
`claude plugin list | grep ievo` (Claude Code) or `codex plugin list --json | grep ievo` (Codex).

## References

- <PR/issue URL> — <context>
- <doc link> — <context>
- ...
```

Sections with no content are omitted entirely (not rendered as empty headers).

**Harden permissions after writing (when Bash is available):** the Write tool's own permission bits on a freshly created file are platform/implementation-dependent — don't rely on them to keep the document private. Immediately after the Write tool call succeeds, restrict it to the invoking user only, substituting the literal path from Step 1 (this matches `Bash(chmod*)` since the command text itself starts with `chmod`):

```bash
chmod 600 "<output path from Step 1>"
```

Keep the double quotes: `TMPDIR`/`TEMP`/`TMP` routinely resolve under a home directory, and a user account or folder name containing a space (`Jane Doe`, ordinary on both macOS and Windows) puts a space in the resulting path. Unquoted, that path word-splits into several arguments — `chmod` then fails on names that don't exist and the real file is left unhardened.

Best-effort, same spirit as Step 2f/Step 3 — on a platform without Bash this step is simply unavailable; the document is still written via the fallback path in Step 1.

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
- **Idempotent.** Running `/ievo:handoff` multiple times produces separate documents (unique timestamps, plus a random suffix where `mktemp` is available). Previous handoffs are not modified or referenced.

## See also

- `/ievo:evo` — if the current session produced lessons worth persisting across ALL future sessions (not just the next one), capture them as evolution overlays before handing off.
- `/ievo:debug-on` — if the next session needs verbose logging for diagnosis.
- `/ievo:init` — if the next session targets a project that hasn't been set up with iEvo yet.
