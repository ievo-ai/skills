# Init run-log format

The `/ievo:init` orchestrator writes an **incremental** diagnostic log to
`$LOG_PATH` (`.ievo/log/init-<timestamp>.md`) — one section appended after each
step completes, never deferred to the end. The body of `SKILL.md` carries a
terse **"Log section N NOW — do not defer"** cue at each step; this file holds
the exact markdown template for each section. Append the matching block to
`$LOG_PATH` as each step finishes.

> Write **complete lists** — never abbreviate/truncate. The diagnostic value
> depends on seeing everything (e.g. a 26-agent project logs all 26 names).

---

## Section 0 — Plugin metadata

Created with the log file in Step 2.5 (`cat > "$LOG_PATH"` heredoc):

```markdown
# Init run — <ISO-8601 timestamp>

## 0. Plugin metadata
- iEvo plugin version: <version-from-read (Step 0)>
- Plugin path: ${CLAUDE_PLUGIN_ROOT}
- Plugin commit SHA: <`git -C ${CLAUDE_PLUGIN_ROOT} rev-parse --short HEAD` or "marketplace-installed">
- Client: <"Codex ($CODEX_CLI set, or Codex Desktop signal — Step 1.5)" when the Step 1.5 detection fired, else "Claude Code" + output of `claude --version` — never run `claude --version` on Codex, it's a client-specific command (issue #432)>
- OS: <output of `uname -srm`>
- Run started: <ISO-8601 timestamp>
```

(Plugin path + SHA help diagnose "which install dir Claude Code loaded the plugin from".)

---

## Section 3 — Installed inventory

Platform-conditional (SKILL.md Step 3): use the invoking client's template.

**On Claude Code** (Step 1.5: no Codex signal):

```markdown
## 3. Installed inventory

### Skills (<N> total)
**Project-level** (`.claude/skills/`): <full comma-separated list>
**Project-level plugins** (`.claude/plugins/*/skills/`): <full list>
**User-level** (`~/.claude/skills/`): <full list>
**User-level plugins** (`~/.claude/plugins/*/skills/`): <full list>

### Agents (<N> total)
**Project-level** (`.claude/agents/`): <full comma-separated list — do not truncate>
**Project-level plugins** (`.claude/plugins/*/agents/`): <full list>
**User-level** (`~/.claude/agents/`): <full list>
**User-level plugins** (`~/.claude/plugins/*/agents/`): <full list>

### Plugins enabled (`.claude/settings.json`)
<comma-separated list of enabledPlugins keys, or "(none)">
```

**On Codex** (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal) — no plugins-enabled line (`.claude/settings.json`
is never parsed on Codex) and no agents scan (Codex has no project-level
custom-agent path); the migration note is included only when `.claude/skills/`
holds vendored items invisible to Codex (SKILL.md Step 3):

```markdown
## 3. Installed inventory (Codex)

### Skills (<N> total)
**Project-level** (`.agents/skills/`, CWD → repo root): <full comma-separated list>
**User-level** (`~/.agents/skills/`): <full list>

### Not visible to Codex (migration note)
<full list of vendored items found under `.claude/skills/`, or omit this
subsection when there are none — these are NOT counted as installed and may
re-surface as candidates (re-accepting re-vendors into `.agents/skills/`)>
```

---

> **Excerpt containment (Sections 5, 6, 6b, 7b).** Every list and table cell
> in these four sections that names a **candidate** — a skill, agent, or
> plugin discovered by `discover.mjs` (Section 5) or expanded via
> `scan_repo.mjs`/`repo-indexer` (Section 6) — renders that candidate's own
> `name` (and, where shown, its source `<owner>/<repo>`) verbatim: none of it
> is charset-validated until `install-protocol.md`'s slug check, which fires
> later, only on an item already picked to install (`init/SKILL.md` Step
> 7b's own "Excerpt containment" note covers the live interview; this note
> covers the persistent log file — a plain Markdown document that renders
> live in any Markdown viewer the moment it's opened, with no further user
> action needed). This covers:
> - **Section 5** — the "Candidates after dedup + ranking" table's `Name` and
>   `Source repo` columns, and every candidate name in the "Dropped —
>   already installed" list **plus that list's own `matches installed
>   <type>: <name>` reason text** (see the already-installed-reason
>   paragraph below).
> - **Section 6** — the "Repos considered" list's per-repo `name` (the same
>   `<owner>/<repo>` `init/SKILL.md` Step 6 extracts from `discover.mjs`'s
>   candidates), the `#### <owner>/<repo>` per-repo heading itself, every
>   name in that repo's "Skills found" / "Agents found" / "Plugins found"
>   lists (`scan_repo.mjs`'s own enumeration of the target repo's unvetted
>   frontmatter), **and every plugin name listed in the "Hooks present in
>   any plugin" line's `(which plugins)` parenthetical** — that line names a
>   subset of the very plugins the "Plugins found" list above it already
>   carries, re-rendered on a different line, and each name is the target
>   repo's own `plugins/<dir>/.claude-plugin/plugin.json` `name` (falling
>   back to the `plugins/<dir>` directory name) as `enumerateOnePlugin`
>   returns it, no more validated on this line than on that one.
> - **Section 6b** — every candidate name in all four "Dropped: ..." lists
>   and the "Demoted: capability-overlap" list, **plus that list's own O1
>   `reason` text** (see the demotion-reason paragraph below) **and the
>   `matches installed <agent|skill|plugin>: <name>` reason carried by the
>   "already-installed" one** (see the already-installed-reason paragraph
>   below); the `Name` and `Source repo` columns of every per-category
>   table; and every name in each category's "Dropped from `<category>`"
>   list and the "Final candidates" summary table's `Top item` column.
> - **Section 7b** — the `name`/`source repo` columns of the Vendor queue and
>   Skipped tables, the `name`/**`marketplace`**/`from plugin` columns of the
>   Plugin queue table, the `name` column of the Overlap tail and Filter
>   overrides tables (`triggering item` in Filter overrides names another
>   candidate — fence it too), and the Overlap tail table's **`demotion
>   reason`** column whenever its `rule` is O1 (the same assembled string
>   Section 6b's "Demoted" list carries — see the demotion-reason paragraph
>   below). **`marketplace` is not a system label**: on Codex candidates it is
>   the catalog's own `marketplaceSource.source` / `marketplaceName`, copied
>   verbatim out of `codex plugin list --json` by `discover.mjs`'s
>   `fetchCodexMarketplace` and carried through as `source_repo`; on Claude Code candidates it is the
>   marketplace name `install-protocol.md` § 9b takes "from index", i.e.
>   `scan_repo.mjs`'s enumeration of the target repo's own unvetted
>   `.claude-plugin/` metadata. Both are as unvalidated as the `name` beside
>   them — neither reaches `install-protocol.md`'s slug check before this row
>   is written.
>
> **The O1 demotion reason is not a system string.** `init/SKILL.md` Step 7a
> builds it as `overlap: <tool> already covered by <installed-item>`, and both
> halves inherit a candidate's taint: `<tool>` is read straight off the demoted
> candidate's own name/description (that is what makes the rule fire — `ruff`
> out of `ruff-recursive-fix`), and `<installed-item>` is untrusted on **both**
> branches that reach it: when Step 7b's live re-check is what demoted the
> candidate it is another candidate the user accepted earlier in the same run,
> no more validated than the demoted one (neither has reached
> `install-protocol.md`'s slug check); when Step 7a's original pass is what
> demoted it, it is an item out of Step 3's installed inventory, which is
> untrusted for the separate reason the already-installed-reason paragraph
> below sets out. Fence the **whole assembled reason string** end to end,
> measuring the backtick run over the complete string rather than over the
> embedded fragment. O2's reason (`overlap: N <domain> specialists already
> installed`) embeds only Step 4's locally-detected language/stack grouping
> and a count — no containment needed, and fencing it anyway is harmless.
>
> **The already-installed drop reason is not a system string either.**
> Sections 5 and 6b both record it as `matches installed <type>: <name>`,
> where `<name>` is the **installed** item's name exactly as `init/SKILL.md`
> Step 3 collected it: a `.claude/skills/<name>/` or `.claude/agents/<name>.md`
> basename (or the same under `~/.claude/` and `.claude/plugins/*/`), a Codex
> `.agents/skills/<name>/` basename, or a key of `.claude/settings.json`'s
> `enabledPlugins` object. Nothing in init charset-validates any of them —
> Step 3 reports whatever the working tree and settings file happen to hold,
> and a POSIX directory name may carry any byte but `/` and NUL, so anyone
> able to land an ordinary commit, PR or fork controls it. That is the same
> threat model `overlay-status/SKILL.md`'s own "Excerpt containment" note
> applies to its Glob-matched basenames, and this is also the same value this
> note already fences one paragraph up under a different label — the O1
> reason's `<installed-item>`, on its Step 7a branch, is drawn from this very
> inventory. Fence the **whole assembled reason string** end to end, on the
> same terms as the O1 reason. `<type>` itself is a fixed
> `skill|agent|plugin` enum and adds no taint of its own.
>
> Before writing any such cell, wrap the value in its own inline code span —
> a backtick run one character longer than the longest backtick run already
> inside the value, collapsing embedded CR/LF to a single space first, and
> padding with a literal space on both sides if the value begins or ends
> with a backtick (same rule as `overlay-status/SKILL.md`'s "Excerpt
> containment" note and `init/SKILL.md` Step 7b's and Step 8a's notes).
> Most of these sinks are GFM **table cells** — the exceptions are the
> plain-bullet lists (Section 5's "Dropped — already installed" including its
> `matches installed` reason, Section 6's per-repo lists including the "Hooks
> present in any plugin" line, and Section 6b's four "Dropped: ..." lists
> including the already-installed one's `matches installed` reason, its
> "Demoted: capability-overlap" list including that list's O1 `reason`, and
> its per-category "Dropped from `<category>`" lists). A code span alone does not
> contain a table cell, so **for the table cells only** apply
> `inspect/SKILL.md`'s pipe step too, before measuring the fence and
> wrapping: double every backslash in the run immediately preceding each
> `|`, then prefix the pipe with one more backslash (`\|` → `\\\|`), since
> GFM splits a row into cells on unescaped pipes before inline parsing runs.
> Do **not** apply the pipe step in the plain-bullet lists — outside a table
> a `\|` inside a code span renders its backslash literally.
> The `rule`/`score`/`count`/`type`/`origin`/`user-choice` values in these
> sections are system-generated or drawn from a fixed enum, and "Why kept"
> quotes the user's own locally-detected stack/deps (Step 4), not the
> candidate's own text — no containment needed for those columns. The
> `reason` strings are **not** one class and must not be dispositioned as
> one — a column named `reason` sitting beside `rule` and `score` reads as
> system-generated and several are not. Each is settled individually here;
> whenever a new reason string is added to these sections, add its own line:
> - Section 5's "Dropped — already installed" and Section 6b's "Dropped:
>   already-installed" `matches installed <type>: <name>` — **fence**
>   (already-installed-reason paragraph above).
> - Section 6b's "Demoted" O1 `overlap: <tool> already covered by
>   <installed-item>`, and its copy in Section 7b's Overlap tail
>   `demotion reason` column — **fence** (demotion-reason paragraph above).
> - Section 6b's "Demoted" O2 `overlap: N <domain> specialists already
>   installed` — no containment needed (Step 4's own stack grouping plus a
>   count); fencing it anyway is harmless.
> - Section 6b's out-of-stack, stack-irrelevant and not-installable-on-Codex
>   reasons — fixed sentences that interpolate nothing at all.
> - Section 7b's Skipped table `reason (if known from question)` — the fixed
>   option label the user picked in Step 7b/8a, a string init writes itself.
>
> **A backtick pair already shown in a template below is illustrative, not a
> fence** — it is one fixed backtick wrapped around a whole literal string,
> not a run sized to the value, so a value carrying a backtick breaks
> straight out of it. Size the run per value by the longest-run-plus-one rule
> above and wrap the *value*. Two such placeholders, resolved explicitly
> rather than left to inference: Section 6b's "Dropped from `<category>`"
> needs no containment (`<category>` is one of Step 6b's own category
> labels), while Section 6's "Index path:
> `.ievo/cache/index/<owner>-<repo>-<hash>.md`" renders the same candidate
> slug as the `#### <owner>/<repo>` heading above it — fence it on the same
> terms as that heading (the trailing `<hash>` is `scan_repo.mjs`'s SHA-256
> digest and adds no taint of its own).

## Section 5 — Candidate discovery (discover.mjs)

````markdown
## 5. Candidate discovery (discover.mjs)

### Stack input
```json
<the stack JSON sent to discover.mjs>
```

### Sources
- skills.sh API: <queries_executed> queries, <raw_results> results, <errors.length> errors
- codex-marketplace: available=<true|false>, <raw_results> plugins<, error: ... if any>
- (future: GitHub search for agent/plugin discovery)

### Queries generated
<comma-separated list>

### Candidates after dedup + ranking (top <N>)
| Rank | Name | Origin | Source repo | Installs | Quality | Matched queries | Score |
|------|------|--------|-------------|----------|---------|-----------------|-------|

### Dropped — already installed (<N>)
<list with reason "matches installed <type>: <name>">

### Final discover output: <N> candidates
````

(Containment: the "Dropped — already installed" list's `matches installed
<type>: <name>` reason carries the *installed* item's own unvalidated
Step 3 name, so fence the whole reason string alongside the candidate name —
see the "Excerpt containment (Sections 5, 6, 6b, 7b)" note above.)

---

## Section 6 — Repo indexing + candidate expansion

```markdown
## 6. Repo indexing + candidate expansion

### Repos considered (<N>)
<for each repo: name, source (discover.mjs | auto-available), cache hit/miss>

### Per-repo expansion
#### <owner>/<repo>
- Index path: `.ievo/cache/index/<owner>-<repo>-<hash>.md` (`<hash>` is the actual value resolved via Glob in Step 6, not a literal placeholder)
- Skills found: <count> — <full list>
- Agents found: <count> — <full list>
- Plugins found: <count> — <full list>
- Hooks present in any plugin: <yes/no> (which plugins)
[...repeat per repo...]

### Expanded candidate list (before stack matching)
- Skills: <count> from <N> repos
- Agents: <count> from <M> repos
- Plugins: <count> from <K> repos
```

(Containment: the "Hooks present in any plugin" line's `(which plugins)`
parenthetical names the same `scan_repo.mjs`-enumerated plugins as the
"Plugins found" list above it — fence each name there too, on identical
terms; see the "Excerpt containment (Sections 5, 6, 6b, 7b)" note above.)

---

## Section 6b — Stack-match filtering + categorical ranking

```markdown
## 6b. Stack-match filtering + categorical ranking

### Dropped: already-installed (<N>)
<list with name + reason "matches installed <agent|skill|plugin>: <name>">

### Dropped: out-of-stack (<N>)
<list with name + reason "no signal match for project's stack">

### Dropped: stack-irrelevant — packaging/publishing (<N>)
<list with name + reason "stack-irrelevant: no publish/registry signal detected">
(empty if no packaging-category candidates were discovered this run)

### Dropped: not installable on Codex — agent candidates (<N>)
<list with name + reason "not installable on Codex: Codex loads only skills
(.agents/skills); no documented project-level custom-agent path">
(Codex runs only — omit this subsection entirely on Claude Code, where the
Step 7a platform filter is a no-op)

### Demoted: capability-overlap, tail-pending (<N>)
<list with name + rule (O1 or O2) + reason, e.g.
 "ruff-recursive-fix — O1: overlap: ruff already covered by python-code-style"
 "python-pro — O2: overlap: 6 python specialists already installed">
(empty if O1/O2 found no overlap this run)
Carried forward to Step 7b's batched tail question — not yet a final outcome.

### Categorized candidates by category

#### testing (<N kept of M scored>)
| Name | Type | Score | Source repo | Why kept |
|------|------|-------|-------------|----------|
[top 5 ranked, dropped overflow listed separately]

Dropped from testing (<M-N>): <name (score), name (score), ...>

#### linting (<N kept of M scored>)
[same format]

... (one section per non-empty category)

### Final candidates: <total>
| Category | Top item | Count |
|----------|----------|-------|
[category summary]
```

(Containment: the "Demoted" list's O1 `reason` carries the candidate-derived
`<tool>`, and the "Dropped: already-installed" list's `matches installed
<agent|skill|plugin>: <name>` reason carries the *installed* item's own
unvalidated Step 3 name — fence each whole reason string alongside the name;
see the "Excerpt containment (Sections 5, 6, 6b, 7b)" note above. The other
three "Dropped: ..." lists' reasons interpolate nothing and need no fence.)

---

## Section 7b — Interview results

```markdown
## 7b. Interview results

### Vendor queue (<N>)
| name | type | source repo | user choice |
|------|------|-------------|-------------|
[...rows for skills + agents user picked "vendor"...]

### Plugin queue (<N>)
| name | marketplace | from plugin | user choice |
|------|-------------|-------------|-------------|
[...rows for plugins user picked "install whole plugin"...]

### Skipped (<N>)
| name | type | source repo | reason (if known from question) |
|------|------|-------------|----------------------------------|
[...all candidates user skipped or rejected via security in step 8...]

### Overlap tail — batched decision (<N>)
| name | rule (O1/O2) | demotion reason | user decision |
|------|--------------|------------------|---------------|
[...one row per `overlap_tail[]` item, decision = "installed anyway" or "stayed filtered"...]
(empty if `overlap_tail[]` was empty — no batched question was asked)

### Filter overrides (<N>)
| name | rule | triggering item | outcome |
|------|------|------------------|---------|
[...rows where user checked a tail item despite the demotion — feeds Step 13 feedback capture; empty if no overrides...]
```

(Containment: the Overlap tail table's `demotion reason` cell carries the same
candidate-derived O1 string as Section 6b's list, and the Plugin queue's
`marketplace` cell carries the catalog-/repo-supplied marketplace name — fence
both exactly like the `name` and `triggering item` cells, pipe step included,
per the "Excerpt containment (Sections 5, 6, 6b, 7b)" note above.)

---

> **Excerpt containment (Section 8).** All four of Section 8's tables render
> an audited candidate's own metadata: `Item` (the candidate name — same
> untrusted `discover.mjs`/`scan_repo.mjs` value `init/SKILL.md` Step 8a's
> own "Excerpt containment" note covers) — present in every one of the four
> tables, not GREEN alone — plus `Source repo` in GREEN; `Top flag
> (severity/category/file)` in YELLOW; `Top 2 flags` and `Alternative
> suggested` in RED; and `Repo` in Reports filed. `Top flag`/`Top 2
> flags` are built from the `security-auditor`'s `flags[].category`/
> `explanation`/`excerpt`, which quote the audited repo's own — attacker-
> controlled — file contents (including a repo-relative `file` path);
> `Auditor reasoning (first sentence)` synthesizes over that same untrusted
> content; `Alternative suggested` is another candidate's name, sourced from
> `alternative_suggestion`. None of it is charset-validated at this point —
> `security-auditor.md`'s own "Excerpt containment" note fences
> `report_template.body` only and explicitly excludes every other
> rendering surface. Wrap each such value in its own inline code span before
> writing the row — a backtick run one character longer than the longest
> backtick run already inside the value, collapsing embedded CR/LF to a
> single space first, and padding with a literal space on both sides if the
> value begins or ends with a backtick (same rule as
> `overlay-status/SKILL.md`'s "Excerpt containment" note and `init/SKILL.md`
> Step 8a's note). All four tables are GFM tables, so a code span alone does
> not contain a table cell — apply `inspect/SKILL.md`'s pipe step too,
> before measuring the fence and
> wrapping: double every backslash in the run immediately preceding each
> `|`, then prefix the pipe with one more backslash (`\|` → `\\\|`), since
> GFM splits a row into cells on unescaped pipes before inline parsing runs.
> `Issue URL` and `Filed at` are system-generated (a `gh issue create` result
> URL and an ISO timestamp) — no containment needed for those two columns.
>
> **Excerpt containment (Section 9, failure branch only).** The `ok` case is
> largely covered: `<name>` is slug-validated by `install-protocol.md`
> before any Write, and `<owner>`/`<repo>` are charset-validated before the
> clone in that same file's "How to fetch the tree" step 1. The `FAILED:
> reason` case is not — whichever of those checks rejects the item, this
> line logs precisely the value that just *failed* it: `<name>` (and any
> `<path>` built from it) on a slug-validation failure, or `<owner>`/`<repo>`
> themselves on a charset-validation failure — plus free-text `reason` in
> either case, the same shape as `inspect/SKILL.md` Step 1's own
> validation-failure message, which is fenced for exactly this reason.
> Whenever this line is written for a failure, wrap `<name>`, `<owner>`,
> `<repo>`, `<path>`, and `reason` each in their own inline code span per the
> rule above before writing the line — this is a single log line, not a
> table, so no pipe-escape step applies here.

## Section 8 — Antivirus security audit

```markdown
## 8. Antivirus security audit (security-auditor sub-agents)

Dispatched: <N> agents in parallel
Wall-clock: <T>s
Model: sonnet (alias — host platform resolves to current Sonnet family; declared in security-auditor frontmatter)
Total files scanned: <sum of files_scanned across agents>
Total bytes scanned: <sum of total_bytes_scanned>

### GREEN (<N>) — silent install
| Item | Source repo | Files scanned | Auditor reasoning (first sentence) |

### YELLOW (<M>) — install with awareness
| Item | Top flag (severity/category/file) | User decision |

### RED (<K>) — block-and-warn
| Item | Top 2 flags | Alternative suggested | User decision (alt/force/skip/report) |

### Reports filed (<P>)
| Item | Repo | Issue URL | Filed at (ISO timestamp) |
```

---

## Section 9 — Install (append after EACH install, not the batch)

```markdown
## 9. Install
- <type> <name> ← <owner>/<repo>@<sha>  [vendored to <path> | plugin enabled]  <ok|FAILED: reason>
[...one line per item, written as each completes...]
```

## Final — closing section (Step 11)

```markdown

## Final
- Run completed: <ISO-8601 timestamp>
- Total duration: <wall-clock>
- Status: COMPLETE
```
