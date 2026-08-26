# Init run-log format

The `/ievo:init` orchestrator writes an **incremental** diagnostic log to
`$LOG_PATH` (`.ievo/log/init-<timestamp>.md`) — one section appended after each
step completes, never deferred to the end. The body of `SKILL.md` carries a
terse **"Log section N NOW — do not defer"** cue at each step; this file holds
the exact markdown template for each section. Append the matching block to
`$LOG_PATH` as each step finishes.

> Write **complete lists** — never abbreviate/truncate. The diagnostic value
> depends on seeing everything (e.g. a 26-agent project logs all 26 names).

> **Excerpt containment.** Every `Name`/description value **and every
> `Source repo`/`<owner>/<repo>` value** in Sections 5, 6, 6b, and 7b below
> (the "Candidates after dedup + ranking" table, Section 6's per-repo
> `#### <owner>/<repo>` headings and their "Skills found"/"Agents
> found"/"Plugins found" lists, the categorized-candidate tables and their
> "Dropped from `<category>`" lines, and the vendor queue/plugin
> queue/skipped/overlap-tail/filter-override tables — including the plugin
> queue's `marketplace`/`from plugin` columns) renders a discovered
> candidate's own `name`/`description`/`source_repo` — untrusted content
> sourced from `discover.mjs` (skills.sh API, no charset check on `name`,
> and `source_repo` is that API's `source` field copied through verbatim)
> and `index-repos`' `scan_repo.mjs` (frontmatter
> `description`, likewise unvalidated for Markdown-rendering safety here).
> `$LOG_PATH` is a plain Markdown file that renders live in any Markdown
> viewer it's later opened in — `feedback/SKILL.md`'s own "Fence containment"
> note already treats this exact table as untrusted when it's attached to a
> public issue, but that mitigation applies only at attach time, not when
> this file is first written. Wrap each such value in its own
> inline code span before writing the row — and before writing a
> `#### <owner>/<repo>` heading, which holds an inline code span perfectly
> well and still reads as a heading, so a repo slug carrying
> `![...](...)`/`[...](...)` can't render there either. Same rule as
> `init/SKILL.md`
> Step 7b's "Excerpt containment" note (backtick run one longer than the
> longest already inside the value, CR/LF collapsed to a single space,
> space-padded if the value starts/ends with a backtick), and the same
> `<owner>/<repo>` coverage that note already carries.
>
> **A code span alone does not contain a table cell.** Most of those render
> sites are GFM tables — Section 5's "Candidates after dedup + ranking"
> table, Section 6b's per-category candidate tables and its final-candidates
> summary table, and Section 7b's vendor-queue, plugin-queue, skipped,
> overlap-tail and filter-override tables — and GFM splits a row into cells
> on unescaped `|` **before** inline parsing, so a pipe inside backticks
> still ends the cell. The rule in the spec is "include a pipe in a cell's
> content by escaping it, **including inside other inline spans**"
> (GFM § Tables (extension), example 200), so a
> `name`/`description`/`source_repo` of `x | ![a](u)` wrapped in backticks
> still renders as two cells, the second one a live image — the exact
> beacon this note exists to stop. For every value written into a **table
> cell**, therefore, apply `inspect/SKILL.md`'s pipe step too, before
> measuring the fence and wrapping: **double every backslash in the run
> immediately preceding each `|`, then prefix the pipe with one more
> backslash** (`\|` → `\\\|`). Doubling first is what makes it hold —
> CommonMark's backslash-escape parity rule treats a run of backslashes in
> front of a special character as escaping it only when the run's length is
> odd, so a value already carrying `` a\|b `` would otherwise become
> `a\\|b`: an even run, an unescaped pipe, and a split cell again. That
> parity rule is spec-level rather than a renderer quirk, so cmark-gfm and
> micromark both split there. Backslashes anywhere else are left alone, so
> an ordinary `C:\Users\x` still displays verbatim; the one residual cost
> is cosmetic and unavoidable — a backslash immediately before a pipe
> displays doubled, because every renderer consumes one backslash off that
> run.
>
> Apply the pipe step **only** inside table cells. Section 5's "Dropped —
> already installed" list, Section 6's `#### <owner>/<repo>` headings and
> their "Skills found"/"Agents found"/"Plugins found" lists, and Section
> 6b's dropped/demoted lists and "Dropped from `<category>`" lines have no
> row to split, and a `\|` inside a code span there would render its
> backslash literally. The code-span wrap, the CR/LF collapse and the
> backtick padding above apply on every one of these surfaces, table or not.

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

---

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
