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
- Claude Code: <output of `claude --version`>
- OS: <output of `uname -srm`>
- Run started: <ISO-8601 timestamp>
```

(Plugin path + SHA help diagnose "which install dir Claude Code loaded the plugin from".)

---

## Section 3 — Installed inventory

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
- (future v0.7+: GitHub search for agent/plugin discovery)

### Queries generated
<comma-separated list>

### Candidates after dedup + ranking (top <N>)
| Rank | Name | Source repo | Installs | Quality | Matched queries | Score |
|------|------|-------------|----------|---------|-----------------|-------|

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
- Index path: `.ievo/cache/index/<owner>-<repo>.md`
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
