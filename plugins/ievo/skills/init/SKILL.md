---
name: init
description: "Initialize iEvo in the current project — discover relevant skills and agents from skills.sh and the broader GitHub ecosystem (via own discover.mjs script, no prereq install), audit them for safety via senior-security-engineer review, install through an interactive interview. Composes two lower-level skills (index-repos, security-check) plus discover.mjs + repo-indexer + security-auditor sub-agents into a complete setup pipeline. Use when the user runs `/ievo:init`, opens a new project that does not yet have `.ievo/`, or asks \"set up iEvo here\" / \"find skills for this project\"."
license: MIT
effort: max
# Heavyweight skill — 6-stage install pipeline that dispatches sub-agents and
# makes external calls, so it is user-invoke only. Prevents costly auto-activation
# on description match, and (Claude Code v2.1.196+) blocks scheduled tasks from
# firing it. Explicit `/ievo:init` still works.
disable-model-invocation: true
compatibility: "Requires `gh` CLI, `git` CLI, Node 18+, network access. Orchestrator uses Task tool + AskUserQuestion, runs on **Claude Code and Codex**. Skills inside the pipeline are cross-platform via agentskills.io. v0.6.0+: no longer requires find-skills prereq — uses own discover.mjs script. v2.1.193+: Auto Mode's `classifyAllShell: true` routes every bash call through the classifier (Step 1). v2.1.195+: dual-gate plugin install consent (AskUserQuestion + CC dialog) — see AGENTS.md Security model."
hooks:
  Stop:
    - hooks:
        - type: command
          command: "echo \"iEvo init complete. Run /reload-plugins to activate installed skills.\""
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Init

## ⚠️ Critical execution directive — read first

**Execute the entire pipeline continuously, without pausing.** Do NOT wait for user input between steps. The ONLY user-facing pauses are:

1. **Step 1** (permission check) — `AskUserQuestion`
2. **Step 7a** (resolve ambiguous categories) — `AskUserQuestion`, only if any categories were marked `/ambiguous`
3. **Step 7b** (per-candidate interview) — `AskUserQuestion`, including the single batched tail question for `overlap_tail[]` items, if any
4. **Step 8** (RED security verdict) — `AskUserQuestion`, only for RED candidates
5. **Step 13** (final feedback prompt) — `AskUserQuestion`

Between every other step, **proceed immediately** to the next step. If you find yourself thinking "should I confirm with the user before doing X?" — the answer is NO. Just do it. Write to the log so the user can monitor via `tail -f`.

Especially: between Step 5 (discover.mjs result) and Step 6 (index-repos) → **no pause, no confirmation, no summary checkpoint**. Just chain straight through.

## Pipeline

Set up iEvo in the current project. Pipeline (v0.6.0+):

```
discover.mjs (Node, parallel skills.sh API queries)
    ↓
index-repos (parallel repo-indexer sub-agents, local scan)
    ↓
categorical rank — top-N per category
    ↓
interview (per candidate, AskUserQuestion)
    ↓
security-auditor (parallel sub-agents, antivirus deep scan)
    ↓
install (vendor or plugin, project-scope, copy + source SHA metadata)
```

**v0.6.0 — zero-prereq architecture**: dropped `find-skills` manual install. Discovery happens via own `discover.mjs` script (skills.sh API direct). All scanning, ranking, audit, and install decisions happen on user's machine. Independent and verifiable per-user, no central trust gates.

**Install model** (Step 9): project-scope (`.claude/agents/`, `.claude/skills/`), **copy** files via Write tool (NOT symlink — robust against source moves). Source repo + commit SHA recorded in `.ievo/evolution/<scope>/<name>.md` frontmatter for upstream-update tracking via `/ievo:update`.

## Step 0: Print version banner (read from disk — never infer)

**MANDATORY first action.** The version MUST come from actual disk read of the plugin.json file. If you "know" the version from prior conversation turns, from being trained, or from SKILL.md text — **IGNORE that knowledge**. The diagnostic value depends on showing what's actually loaded, not what you expect.

### Step 0a — Read plugin.json from disk (Read tool, not Bash)

Use the **Read tool** on:
```
${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json
```

The Read tool returns the file contents verbatim in the tool result — no chance of substitution or inference. Extract the `version` field from the JSON.

If Read fails (file missing, permission denied, etc.), print error and stop:
```
❌ Cannot read plugin.json from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json
   <error message>
   Reinstall plugin: /plugin reinstall ievo@ievo-skills
```

Do NOT fall back to "I think it's v0.2.x" — that defeats the diagnostic.

### Step 0b — Print banner

Output exactly (substitute only `<version-from-read>` with the value extracted in 0a):

```
🧬 iEvo init v<version-from-read>
   from: ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json
```

The **`from:` line is part of the banner** — shows the user the exact path the version came from. They can manually inspect that file to verify if suspicious.

### Why Read instead of Bash

`jq` via Bash works, but Bash tool invocations can be skipped by some inference paths — the model can complete the next line as if Bash had returned the expected value. **Read tool is deterministic**: its result is a file content snapshot in the tool response. The version IS what Read returned, by construction.

### Step 0c — Record version in the run-log

The banner version becomes **section 0** of the run-log, written when the log
file is created in Step 2.5 (format: [log-format.md §0](references/log-format.md)).
The plugin path + commit SHA recorded there help diagnose which install dir
Claude Code loaded the plugin from.

## Step 1: Verify prerequisites

Hard prereqs (v0.6.0+ — no more find-skills install):
- `git` CLI — `which git`. Used for checkout-based indexing.
- `gh` CLI — `which gh` and `gh auth status`. Used by security-auditor (audit data from skills.sh) and uninstall (marker discovery).
- `node` (≥18) — `node --version`. Used by `discover.mjs`, `scan_repo.mjs`, `validate_agents.mjs`. Node ships with Claude Code and Codex, so this is normally always available — but if user has a damaged install, hard-fail.
- **Bash permissions** for the commands init will run (see below)

**v0.6.0 change**: dropped `find-skills` prereq. Discovery now happens via own Node script (`discover.mjs`) hitting `https://skills.sh/api/search` directly — no manual prereq install required.

If `gh` missing or unauthenticated:
```
This skill needs the `gh` CLI for indexing and security checks. Install:
  brew install gh         # macOS
  # or see https://cli.github.com
  gh auth login
```

If `node` missing OR version < 18:
```
This skill needs Node.js 18+ for repo scanning. Normally Node ships with Claude Code —
if it's missing your install may be damaged. Try reinstalling Claude Code, or install Node directly:
  brew install node       # macOS
  apt install nodejs      # Debian/Ubuntu
  # or see https://nodejs.org

Verify: node --version  → must be v18.0.0 or higher
```

Stop init on missing node. No graceful fallback — scan_repo.mjs is core to Step 6.

### Permission check (auto-mode classifier)

Init will run network/CLI commands the auto-mode classifier may block: `gh api`, `gh search`. Without pre-approval, each call hits a confirmation prompt — friction during the discovery phase.

(v0.6.0 dropped `npx skills` permissions — discovery now happens via local `discover.mjs` script which is a normal `node` invocation, not blocked by the auto-classifier.)

Recommended: ensure `.claude/settings.local.json` (per-user, gitignored) OR `.claude/settings.json` (team-shared, committed) contains:

```json
{
  "permissions": {
    "allow": [
      "Bash(gh api*)",
      "Bash(gh search*)"
    ]
  }
}
```

**Check at init start:** read the project's settings files. If the two patterns above are NOT present, ask user via `AskUserQuestion`:

- **Question:** `Init needs Bash permissions for gh CLI. Add them?`
- **Header:** `Permissions`
- **Options:**
  - `Add to .claude/settings.local.json (Recommended)` — description: `Per-user permission, gitignored. Only affects you on this machine.`
  - `Add to .claude/settings.json (team-shared)` — description: `Permission shared with team via git commit. Useful if everyone runs iEvo here.`
  - `Skip — I'll approve each command manually` — description: `Each blocked Bash call needs explicit Allow. Slower but no permission file changes.`

For `Add to ...` options: merge the two patterns into the existing `permissions.allow` array. Do not overwrite other permissions. If file doesn't exist, create with minimal `{"permissions": {"allow": [...]}}`.

For `Skip`: continue — but expect blocked commands during the run.

Stop only on missing gh / git / node prereqs. Permission setup is opt-in but strongly recommended.

**Auto Mode + `classifyAllShell` interaction (CC v2.1.193+).** The `permissions.allow` entries above bypass the classifier only under Auto Mode's *default* behavior, where narrow Bash allow rules (like `Bash(gh api*)`) resolve before the classifier runs — and only Auto Mode is affected at all; other permission modes are untouched either way. If the user has `autoMode.classifyAllShell: true` set, that default is suspended: **every** bash call in this pipeline — 20+ across discovery, indexing, and scanning — is routed through the classifier individually, regardless of `permissions.allow`. This trades latency for coverage (a classifier round-trip per call instead of an instant allow-rule match) and any call the classifier doesn't recognize as safe may still be blocked, which can interrupt this skill's "execute continuously, without pausing" directive. There's no code-level workaround for this skill: tell the user to disable `autoMode.classifyAllShell` for the init session, or proceed knowing the whole pipeline now pays the per-call classifier cost.

## Step 1.5: Codex environment pre-flight (Codex platform only)

If the host platform is Codex (detect via `$CODEX_CLI` env var ONLY — do NOT key off `command -v codex` because a Claude Code user may have the Codex CLI installed alongside, which would false-trigger this step on a non-Codex run), run `codex doctor` and check the exit code. `codex doctor` shipped in Codex `rust-v0.131.0` (May 18 2026) as a first-class diagnostic across runtime, auth, terminal, network, config, and local state.

```bash
codex doctor
```

- **Exit 0** → environment healthy, continue to Step 2.
- **Non-zero exit** → surface the doctor output to the user and halt. Show this message:

  ```
  Codex environment is unhealthy (see `codex doctor` output above).
  Fix the reported issues and re-run `/ievo:init`.
  ```

  Common fixes: re-login to Codex (`codex login`), regenerate auth (`codex auth refresh`), update Codex CLI to the latest release.

On Claude Code: skip this step entirely (no equivalent built-in diagnostic command yet — May 2026). The Step 1 prereq checks above cover the same surface (git / gh / node). Update this skill when Claude Code ships an equivalent.

## Step 2: Prepare project directories

Create if missing:
- `.ievo/evolution/agents/`
- `.ievo/evolution/skills/`
- `.ievo/log/`
- `.ievo/log/hooks/` — append-only audit log for lifecycle hook fires (events.log appended by every hook configured via `/ievo:hooks-setup`)
- `.ievo/cache/index/`
- `.ievo/hooks/` — signal-file directory for lifecycle hooks; Step 11.5 writes `init-complete` here, evo/SKILL.md Step 5.5 writes `evolution-captured`, security-auditor.md Step 6 writes `security-red` (RED-only). Created defensively even if `/ievo:hooks-setup` hasn't been run yet
- `.claude/` — root for vendored items
- `.claude/agents/` — for vendored agents
- `.claude/skills/` — for vendored skills (init uses direct file writes via Write tool, NOT `npx skills add`)
- `.ievo/log/pending-reports/` — for security-issue reports that couldn't be filed live (gh auth missing, rate limit, repo issues disabled). User can file manually later from these saved bodies.

Do NOT touch `CLAUDE.md` or `AGENTS.md` here.

**Migration check (Claude Code ↔ Codex).** Before creating the dirs, check whether
`.ievo/evolution/` already holds overlay files (`.ievo/evolution/skills/*.md` or
`.ievo/evolution/agents/*.md`). If so, existing iEvo state is present — likely
migrated from another platform on the shared filesystem (e.g. via Codex `/import`).
**Preserve it** (create only missing dirs; never overwrite existing overlays) and
tell the user: "Existing iEvo evolution state detected — kept as-is. Init continues
for discovery; your overlays stay active." The idempotent inventory (Step 3)
already prevents re-suggesting installed items.

## Step 2.5: Create run-log file (incremental writes — do not defer!)

**Critical:** the log is written **incrementally**, after each major step — not as a single flush at the end. If init hangs, crashes, or the user cancels mid-run, the diagnostic log up to the point of failure must be on disk.

Create the file NOW with timestamp and section 0:

```bash
LOG_PATH=".ievo/log/init-$(date -u +%Y%m%d-%H%M%S).md"
mkdir -p .ievo/log
cat > "$LOG_PATH" <<EOF
# Init run — $(date -u +%Y-%m-%dT%H:%M:%SZ)

## 0. Plugin metadata
- iEvo plugin: <version from Step 0 banner>
- Plugin commit SHA: <or "marketplace-installed">
- Claude Code: <claude --version>
- OS: <uname -srm>
- Run started: <ISO-8601 timestamp>
EOF
```

Remember `LOG_PATH` for all subsequent steps. Each step below has a **`Log:` instruction** — it means **append that section to `$LOG_PATH` immediately**, before proceeding to the next step.

If a step takes a long time (e.g. `discover.mjs` or `index-repos` for big repos), the user can `tail -f $LOG_PATH` in another shell and see progress.

## Step 3: Build installed inventory

Collect names from:

**Skills installed:**
- `.claude/skills/<name>/SKILL.md`
- `.claude/plugins/*/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `~/.claude/plugins/*/skills/<name>/SKILL.md`

**Agents installed:**
- `.claude/agents/<name>.md`
- `.claude/plugins/*/agents/<name>.md`
- `~/.claude/agents/<name>.md`
- `~/.claude/plugins/*/agents/<name>.md`

**Plugins enabled:**
- Parse `.claude/settings.json` field `enabledPlugins` keys

**Log section 3 NOW — do not defer.** Write the full inventory with **complete
lists, never truncated** — if a project has 26 agents, log all 26 names;
"12 iEvo-managed plus N others" loses information needed for step-5 filtering.
Format: [log-format.md §3](references/log-format.md).

## Step 4: Detect stack and dependencies

Parse manifest files (full per-stack table in the **Manifest reference** below — covers Python, Node/TS, Rust, Go, Java/Kotlin, Ruby, PHP, Dart, Elixir, .NET, Swift/iOS, Haskell, Clojure, Crystal, OCaml, Nim, Lua, R, Julia, Zig, C/C++, Unreal, Godot, Unity).

For each found manifest, extract direct (top-level) dependency names.

Output stack + deps summary. Log to buffer (section 4).

### Manifest reference

Parse the manifest(s) found, extracting direct (top-level) dependency names, per
the **[manifest reference table](references/reference-tables.md)** — covers Python,
Node/TS/Bun, Deno, Rust, Go, Java/Kotlin, Ruby, PHP, Dart, Elixir, .NET, Swift/iOS,
Haskell, Clojure, Crystal, OCaml, Nim, Lua, R, Julia, Zig, C/C++, Unreal, Godot,
Unity. Tag deps with their source manifest for polyglot projects.

## Step 4.5: Disambiguate broad categories

For each category present in the project, resolve to sub-types using the ambiguous-category registry (kept inline for stability):

| Broad | Sub-types | Signal hints |
|-------|-----------|--------------|
| `i18n` | `code-strings`, `documentation` | `.po`/`.mo`/`locale/` → code-strings; `mkdocs.yml` with `i18n` plugin / `docs/locales/` → documentation |
| `testing` | `unit`, `integration`, `e2e` | `vitest.config`/`jest.config`/`pytest.ini` → unit; `playwright`/`cypress` → e2e; `tox`/separate `integration_tests/` → integration |
| `security` | `app-sec`, `supply-chain`, `static-analysis` | Helmet/JWT → app-sec; `npm audit`/Snyk/Dependabot → supply-chain; bandit/semgrep/CodeQL → static-analysis |
| `documentation` | `user`, `api`, `internal` | mkdocs/docusaurus/sphinx → user; openapi/swagger → api |
| `linting` | `style`, `types`, `security` | prettier/black/rustfmt → style; mypy/tsc/pyright → types; bandit/semgrep → security |
| `observability` | `logging`, `tracing`, `metrics` | structlog/pino → logging; opentelemetry → tracing; prometheus → metrics |
| `state-mgmt` (frontend) | redux/zustand/mobx/recoil | match dep name in package.json |
| `build-tools` | bundler/package-manager/task-runner | vite/webpack/rollup vs npm/yarn vs Makefile/just |
| `database` | orm/query-builder/migrations/driver | sqlalchemy/prisma vs kysely/knex vs alembic/flyway |
| `packaging` | `published`, `internal-only` | Publish/release CI present (`.github/workflows/*` invoking `pypa/gh-action-pypi-publish`, `npm publish`, `cargo publish`, `twine upload`, or equivalent) OR manifest carries non-private registry metadata (`package.json` without `"private": true`; `pyproject.toml` `[project.urls]` set) → `published`. Explicit private marker (`"private": true`; `Private :: Do Not Upload` classifier) **or no registry/publish signal at all** → `internal-only` (resolved directly, no ask — issue #427: `python-packaging` was declined for a project never published to PyPI). Registry-shaped metadata present but conflicting/incomplete (e.g. `[project.urls]` set with no publish workflow and no private marker either) → genuinely unresolved, tag `packaging/ambiguous` |

If signals unclear → tag `<category>/ambiguous`, ask user in step 7a. For `packaging` specifically, `internal-only`/`published` are terminal resolutions (feed Step 7a's stack-relevance filter directly, no ask needed) — only the true `packaging/ambiguous` case reaches the step 7a question, phrased as "Is this project published anywhere (PyPI/npm/crates.io/etc.)?" with the usual "Skip category" option dropping all packaging candidates.

Log resolution outcomes (section 4.5).

## Step 5: Invoke `discover.mjs` for candidate discovery (v0.6.0+)

Run our own discovery script (replaces `find-skills` prereq). It hits skills.sh API directly (`https://skills.sh/api/search`) — no manual prereq install, no `npx skills`, no auto-classifier friction.

### Step 5a — Build stack input JSON

From Steps 3 + 4 + 4.5 build:

```json
{
  "languages": ["python"],
  "deps": ["pytest", "fastapi", "sqlalchemy"],
  "categories": ["testing", "linting", "security", "frameworks", "databases"],
  "frameworks": ["fastapi"]
}
```

Inputs come from:
- `languages` — detected stack types (Step 4)
- `deps` — direct top-level deps from manifests (Step 4)
- `categories` — resolved category list (Step 4.5)
- `frameworks` — major frameworks present (Step 4)

### Step 5b — Invoke discover.mjs via Bash

```bash
echo '<stack-input-json>' | node "${CLAUDE_PLUGIN_ROOT}/scripts/discover.mjs" --limit 50 --concurrency 8
```

The script:
1. Builds 15-30 queries from the stack (language fundamentals + per-dep + per-category + stack-specific compound + a fixed stack-independent group for general-purpose codebase-audit/planning-advisor meta-tools — not gated behind any detected category, since that class of skill isn't tied to a language/framework/dep)
2. Parallel-fetches `https://skills.sh/api/search?q=<q>&limit=10` for each
3. **If the `codex` CLI is present**, also reads its marketplace catalog (`codex plugin list --json` → `available[]`) and merges those uninstalled plugins as extra candidates. Absent codex / non-zero exit / unparseable output → silently skipped (no behaviour change for Claude Code-only users).
4. Deduplicates by skill `id`, computes `rank_score` (log10(installs) × reputation_boost × match_breadth_bonus). Codex plugins carry no install count → get a visibility floor (≈ a 10-install skill) so they surface mid-pack instead of being sliced off by `--limit`, and are tagged `source_origin: codex-marketplace`.
5. Returns JSON: `{sources, queries, candidates: [{id, name, source_repo, source_origin, installs, quality_tier, matched_queries, rank_score}]}`. (Codex candidates always have `matched_queries: []` — they're grouped via an internal source sentinel that's stripped from the public output; use `source_origin: codex-marketplace` to identify them, not `matched_queries`.) `sources[]` carries one entry per origin — `skills.sh` and `codex-marketplace` (with `available` / `raw_results` / `error`). The `codex-marketplace` entry is emitted on every run that **reaches discovery** (transparent about what was attempted) — when codex is absent it reads `available: false, raw_results: 0`. (The empty-stack early-return, exit code 5, produces `sources: []` before any source is queried — don't read the codex entry unconditionally.) Note: `available` means "codex produced non-empty stdout" (it can be `true` alongside `error: "unparseable codex output"`), **not** "plugins were found" (`raw_results` is the plugin count). Codex candidates carry `quality_tier: "unranked"` — they have no install count, so the install-based tiers don't apply.

Typical wall-clock: 3-6 seconds for a rich stack. The codex source runs concurrently with the skills.sh queries (`Promise.all`), so it usually overlaps — but a hung codex binary is capped at its 5 s timeout, which becomes the wall-clock ceiling in that worst case.

### Step 5b1 — Handle discover.mjs exit codes

The script exits with distinct codes — branch on them:

| Code | Meaning | What init must do |
|------|---------|-------------------|
| `0` | Success — all queries returned data | Proceed to Step 5c |
| `0` + WARN on stderr | **Partial failure** — some queries failed, candidates still usable | Log the warning in section 5d, proceed but tell the user "discovery was partial (N/M queries failed)" in the summary |
| `1` | No stack input on stdin AND no `--stack-file` | Should not happen — init always provides stack JSON. If it does, log and abort. |
| `3` | Bad input — malformed JSON, missing file, invalid CLI args | Log and abort init (stack input is broken) |
| `4` | **Total failure** — ALL queries failed (skills.sh down, network outage). `candidates: []` | Log + tell user "discovery failed — skills.sh unreachable". Ask via `AskUserQuestion`: continue with auto-available repos only OR abort? |
| `5` | No queries derived from stack (empty input) | Log + abort init — stack detection (Step 4) produced nothing useful |

Capture stderr separately from stdout: `node discover.mjs ... 2>discover.err >discover.out`. The structured JSON is on stdout; the WARN/FATAL messages are on stderr.

### Step 5c — Filter against installed inventory

From the discover.mjs output `candidates[]`, drop any candidate whose name matches the inventory from Step 3 (already-installed skills/agents/plugins). The script doesn't know the user's installed state; init applies that filter post-hoc.

### Step 5d — Log section 5

**Log section 5 NOW — do not defer.** Format: [log-format.md §5](references/log-format.md)
(stack input, sources, queries, ranked-candidates table, dropped-already-installed).
Then pass `final_candidates[]` to Step 6.

## Step 6: Expand via index-repos (parallel local scan)

Extract the **unique set of `<owner>/<repo>` values** from discover.mjs' candidates (Step 5). Also include this small list of auto-available repos (not on skills.sh but always relevant):

```
- anthropics/claude-plugins-official   (official, built-in to Claude Code)
- anthropics/claude-code               (demo plugins)
```

For each unique repo, dispatch a **`repo-indexer` sub-agent** via Task tool. **Send ALL dispatches in a SINGLE message** so they run in parallel.

```
SINGLE MESSAGE with N Task tool calls (one per unique repo):

Task(subagent_type="repo-indexer", prompt="Index <repo-1>. project_root=<abs-path>. force_refresh=false")
Task(subagent_type="repo-indexer", prompt="Index <repo-2>. project_root=<abs-path>. force_refresh=false")
...
Task(subagent_type="repo-indexer", prompt="Index <repo-N>. project_root=<abs-path>. force_refresh=false")
```

Each sub-agent invokes `scan_repo.mjs` which does ONE shallow clone + filesystem scan + writes its own index file. They are isolated — no shared state, no contention. The slowest repo determines total wall-clock time (~30-60 sec for big repos like wshobson/agents).

Wait for all to complete. Collect their one-line summaries.

Each `repo-indexer` writes to `<project>/.ievo/cache/index/<owner>-<repo>.md` (no conflicts — different paths per repo).

(Parallel via sub-agents: ~30-60s cold-cache wall-clock for 8 repos vs ~4-8 min
sequential — slowest repo wins, each has isolated context + returns one summary
line; cache hits sub-second. Surface progress via `tail -f .ievo/log/init-*.md`.)

Read each generated index and **expand the candidate list**:
- All standalone skills from index
- All standalone agents from index
- All plugins from index (each plugin = candidate with `type: plugin`)

Now your candidate list has three types: `skill` (vendor), `agent` (vendor),
`plugin` (marketplace settings).

**Log section 6 NOW — do not defer** (index-repos can take 5-15 min for big repos
like wshobson/agents). Format: [log-format.md §6](references/log-format.md).

## Step 7: Categorical ranking — top-N per category

Filter and rank **per category** (not overall):

### Step 7a — Filter

- **Drop candidates whose name conflicts with installed inventory** (already-installed check applies to expanded list, not just discover.mjs' direct returns).
- **Match name + description against stack/deps**:
  - Direct keyword match (skill named "pytest" for Python project with pytest) → high score
  - Description mentions deps from step 4 → medium
  - Generic universally-useful (e.g. "code-reviewer") → low but non-zero
- **Capability-overlap filter** (issue #427 — real `/ievo:init` telemetry: 3 of 4 declines in one run were pure overlap against something already covered, not quality complaints about the candidate itself). Check each candidate against the **installed inventory** (Step 3) here; Step 7b *(per-candidate interview, below)* re-runs both rules **live** against candidates the user has already *accepted this run* — that state doesn't exist yet at this static pass, so the check happens twice by design, not redundantly:
  - **O1 — tool-specific vs already-covered**: the candidate's name/description ties it to one specific tool/library (e.g. `ruff-recursive-fix`) AND an installed item's description already covers that same tool (e.g. `python-code-style` already covers ruff) → **demote**, don't drop outright (see tail list below). Reason: `"overlap: <tool> already covered by <installed-item>"`.
  - **O2 — generalist vs ≥3 covered specialists**: the candidate reads as a domain generalist (broad description, no narrow tool-tie — e.g. `python-pro`) AND ≥3 same-domain specialist items are already installed (e.g. 3+ installed `python-*` specialists) → **demote**. Reason: `"overlap: N <domain> specialists already installed"`. "Domain" here means the **language/stack grouping from Step 4** (e.g. all items tied to the detected `python` language) — NOT the functional category table below (that groups by testing/linting/frameworks/etc., which cuts across languages and has no per-language rows).
  - Demoted candidates are **not** dropped from the run and **not** silently hidden — they move to an `overlap_tail[]` list surfaced as one batched question after Step 7b's individual interview (acceptance criterion: drops must be visible with a one-line reason). They're pulled out of the category's ranking pool for Step 7c — they don't occupy or count against that category's top-5 cut.
- **Stack-relevance filter (lifecycle-dependent categories)** — for a candidate categorized (or keyword-matched, pre-categorization) as `packaging`/publish/release lifecycle tooling, use the `packaging` sub-type resolved in Step 4.5:
  - `internal-only` → **drop** entirely, reason `"stack-irrelevant: no publish/registry signal detected"`. If this candidate was already added to `overlap_tail[]` by O1/O2 above, remove it from there too — a hard drop always wins over a demotion, so it never surfaces in the tail question either.
  - `published` → keep, score normally.
  - Still tagged `packaging/ambiguous` (Step 4.5 couldn't resolve it) → the Step 7a *(ambiguous-category resolution, below)* question gates the **whole category** with one ask instead of one decline per packaging candidate.

### Step 7b — Categorize each surviving candidate

Assign each candidate to ONE primary category (by name + description) from the
**[category assignment table](references/reference-tables.md)** — testing, linting,
formatting, build-tools, frameworks, databases, security, documentation,
observability, devops, agent-tooling, domain-specific, packaging, other. If a
candidate fits multiple, pick the **most specific** one.

### Step 7c — Rank within each category, keep top-5

Within each category bucket:
- **Rank by score** (descending), then by **install count** (where available), then by **stars**.
- **Keep top 5 per category**. Drop the rest from this category.

Final candidate list = union of top-5 from each category. Typically 15-40 total candidates depending on stack richness.

(Categorical top-5 over flat top-12: a flat list is dominated by popular
categories — testing always wins — so niche-but-useful skills never surface;
categorical gives breadth and a clear per-category coverage map.)

**Log section 6b NOW — do not defer.** Format: [log-format.md §6b](references/log-format.md)
(dropped-already-installed, dropped-out-of-stack, dropped-capability-overlap,
dropped-stack-irrelevant, demoted-to-tail, categorized candidates, final summary).

## Step 7a: Resolve ambiguous categories first (if any)

For each category from step 4.5 tagged `/ambiguous`, ask user via `AskUserQuestion`:

- **Question:** `Which type of <category> are you working with?`
- **Header:** `<category>` (e.g. "i18n", "testing")
- **Options** (single-select):
  - `<sub-type-1>` — short description
  - `<sub-type-2>` — short description
  - `Both` — show both (omit this option for `packaging`: its sub-types `published`/`internal-only` are mutually exclusive, so the question is yes/no-shaped — 3 options, no "Both")
  - `Skip category` — drop all candidates in this category, including any already demoted to `overlap_tail[]` by Step 7a *(the Filter subsection above)* — a skipped category never reaches the tail question either

Filter candidates accordingly. Log resolutions (section 7a).

## Step 7b: Per-candidate interview

For each remaining candidate (i.e. not already demoted to `overlap_tail[]` in Step 7a *(the Filter subsection above, not the ambiguous-category step immediately above this one)*), ask via `AskUserQuestion`. **One question per candidate**, batched in groups of 4.

### Live overlap re-check (before each question)

Immediately before asking about a candidate, re-run rules **O1**/**O2** from Step 7a *(the Filter subsection)* — this time against `vendor_queue` + `plugin_queue` as accumulated **so far this run** (in addition to the static Step 7a pass against the installed inventory). This is a between-batches check at minimum: a specialist accepted in an earlier batch of 4 can trigger O2 for a generalist reached in a later batch — that's the whole point of checking "candidates already accepted this run," which doesn't exist as data until the interview is underway. If the harness resolves a batch's `AskUserQuestion` calls one answer at a time (rather than all 4 at once), apply the re-check within the batch too; if answers only become available once the whole batch resolves, the re-check still applies at the next batch boundary. If either rule now matches:
- Skip the individual question for this candidate.
- Move it to `overlap_tail[]` instead, with the live reason (which just-accepted item triggered it) — same demotion semantics as Step 7a, not a silent drop.

The question shape depends on the candidate's **type**:

### type=skill

```
Question: `Install <skill-name>?`
Header: <short tag, max 12 chars>
Options:
  - "Install (Recommended)" if install count > 10K, else "Install"
    description: "<one-line desc>. skills.sh: <url>"
  - "Skip"
```

### type=agent

```
Question: `Vendor <agent-name>?`
Header: <short tag>
Options:
  - "Vendor agent" — description: "Copy <agent-name>.md to .claude/agents/, set up overlay for /ievo:evo. Source: <owner>/<repo>."
  - "Skip"
```

### type=plugin

```
Question: `Install plugin <plugin-name>?`
Header: <short tag>
Options:
  - "Install whole plugin (Recommended for hooks/MCP)" — description: "Marketplace install. Includes N agents + M skills + K hooks + L commands. Settings.json updated for team sync."
  - "Vendor specific items only" — description: "Pick individual agents/skills from this plugin to copy. Hooks/MCP/commands NOT included."
  - "Skip"
```

If user picks "Vendor specific items" for a plugin → enter sub-interview listing that plugin's agents and skills, one question per item.

### Tail question — demoted candidates (`overlap_tail[]`)

After all individual candidate questions are done, if `overlap_tail[]` is non-empty, ask ONE batched `AskUserQuestion` (multiSelect — mirrors Step 8a's YELLOW security batch, same "one question instead of N" reasoning):

```
Question: "<N> candidates look redundant with what you already have or picked — install anyway?"
Options (one per tail item, unchecked by default):
  - "<candidate-name>" — description: "<one-line demotion reason from O1/O2>"
```

Any item the user checks → add to `vendor_queue`/`plugin_queue` as normal AND record in `filter_override[]` (which rule — O1 or O2 — and which installed/accepted item triggered it). This is the signal acceptance criterion 3 asks for: an override means the filter's assumption was wrong for this case, distinct from an ordinary skip. Unchecked items stay demoted — counted as filtered, not as a user "skip" (they never got their own question).

Track selections:
- `vendor_queue[]` — skills + agents to vendor
- `plugin_queue[]` — plugins to install via settings.json
- `overlap_tail[]` — candidates demoted by O1/O2 (Step 7a static pass or Step 7b live re-check), pending the batched tail question above
- `filter_override[]` — tail items the user installed anyway despite the demotion

**Log section 7b NOW — do not defer.** Format: [log-format.md §7b](references/log-format.md)
(vendor queue, plugin queue, skipped, overlap tail + batched decision, filter overrides — source repo + user choice per row).

## Step 8: Parallel security audit via `security-auditor` sub-agents

For each item in `vendor_queue` and `plugin_queue`, dispatch a `security-auditor` sub-agent via Task tool. **Send ALL dispatches in a SINGLE message** so they run in parallel:

```
SINGLE MESSAGE with N Task tool calls (one per selected item):

Task(subagent_type="security-auditor",
     prompt="Audit <owner>/<repo>@<name> with type=<skill|agent|plugin>")
...
```

Each sub-agent internally applies the `security-check` skill (loaded from the ievo plugin's skills system) and returns a structured verdict + flags. Parallel dispatch means total wall-clock = slowest audit (~5-15s per item with Sonnet), not sum.

### Step 8a — Collect verdicts

After all sub-agents return, group items by verdict:

- **GREEN** → add to final install list. No user friction.
- **YELLOW** → batch through one `AskUserQuestion` (multiSelect) showing top flag for each. User unchecks any they want to skip; checked items proceed to install.
- **RED** → per-item `AskUserQuestion` with 4 options:
  ```
  Question: "<name> flagged HIGH RISK: <top 2 flags>. Decision?"
  Options:
    - "Try alternative: <next-ranked-same-category>" (if available)
    - "Force install anyway (I've reviewed the flags)"
    - "Skip this candidate"
    - "Report to <owner>/<repo> (file security issue)"   ← v0.5.2
  ```
  - If user picks **alternative** → recursively run Step 8 (single dispatch) on the alternative.
  - If user picks **force-install** → add to final list with `force=true` flag.
  - If user picks **skip** → remove from queue.
  - If user picks **report** → go to Step 8b (report flow), then remove candidate from queue.

### Step 8b — Report-to-source flow (when user picks "Report")

Only reached on a RED verdict when the user picks "Report". The `security-auditor`
returned a pre-filled `report_template` (`available: true`). Walk the user through
preview → file via `gh issue create` (body written with the **Write tool**, never
`echo`, since it may contain `$(...)`/backticks) → show result → handle failures.
Full protocol: **[security-report-flow.md](references/security-report-flow.md)**.
Candidate stays removed from the install queue (`skip` semantics) in all cases.

(Parallel via sub-agents because N items × ~10s sequential = 60-90s vs ~10-15s
wall-clock; isolated context keeps each audit's WebFetch/gh noise out of init's log.)

**Log section 8 NOW — do not defer.** Write verdicts as they arrive (any order),
then aggregate. Format: [log-format.md §8](references/log-format.md).

## Step 9: Execute install

Two paths run in sequence — **vendor** (skills + agents) then **plugin** (whole
plugins). Vendor = clone once + enumerate with Glob + fetch via Read/Write
(never a Bash/`gh api` command built from the item's path — see
install-protocol.md § "How to fetch the tree"), write to `.claude/skills/<name>/`
or `.claude/agents/<name>.md`, inject the `<!-- ievo:start -->` overlay marker,
and create the `.ievo/evolution/<scope>/<name>.md` overlay (with source repo +
commit SHA frontmatter). Plugin = merge `extraKnownMarketplaces` + `enabledPlugins`
into `.claude/settings.json` (committed → teammates auto-install on pull). Full
protocol incl. exact marker/frontmatter/JSON shapes:
**[install-protocol.md](references/install-protocol.md)**.

Per-item failure handling: if any step fails, report and continue with the next —
do NOT abort the flow.

**Log section 9 NOW — after EACH install (not the batch)** — each line written as
it completes so progress shows live in `tail -f`. Format: [log-format.md §9](references/log-format.md).

## Step 10: Add `.ievo/` to .gitignore (selectively)

Project `.gitignore` should ignore:
- `.ievo/log/` — diagnostic logs (local-only)
- `.ievo/cache/` — repo indices (re-derivable)
- `.ievo/hooks/` — ephemeral one-line signal-file timestamps written by Step 11.5 / evo Step 5.5 / security-auditor Step 6 (re-created on every pipeline run; only useful as `Write(...)` hook triggers, never as committed state)

But NOT ignore (must be committed for team portability):
- `.ievo/evolution/` — overlay files (project-owned evolution data)

Check project's `.gitignore`. If it doesn't already cover `.ievo/log/`, `.ievo/cache/`, and `.ievo/hooks/`, append:
```
# iEvo local-only artifacts
.ievo/log/
.ievo/cache/
.ievo/hooks/
```

If no `.gitignore` exists, do not create one — note in summary.

## Step 11: Finalize log

The log file at `$LOG_PATH` already contains sections 0-9 — each was appended as the corresponding step completed.

Append a final closing section so post-mortem readers know the run ended cleanly:

```markdown

## Final
- Run completed: <ISO-8601 timestamp>
- Total duration: <wall-clock>
- Status: COMPLETE
```

**Why incremental writes matter:** if init crashes / hangs / user cancels at any step, the partial log up to that point is on disk. `tail -f .ievo/log/init-*.md` works during long-running steps (discover.mjs, index-repos). Post-mortem diagnosis works even on failed runs.

## Step 11.5: Signal file for lifecycle hooks

Write `.ievo/hooks/init-complete` (create the directory if absent). The body of the file is a single line: the ISO-8601 timestamp of pipeline completion. The file is the trigger for any `PostToolUse` hook configured via `/ievo:hooks-setup` matching `Write(.ievo/hooks/init-complete)` — without this step, the configured hook never fires.

Use the Write tool (NOT Bash) so the matcher in the user's settings.json fires:
- `file_path`: `.ievo/hooks/init-complete` (relative — the `PostToolUse` matcher `Write(.ievo/hooks/init-complete)` only fires on this exact form; never prefix `<project>/` or use an absolute path)
- `content`: `<ISO-8601 UTC timestamp of this run>`

If the user hasn't run `/ievo:hooks-setup`, the file is still written — it's a one-line marker, costs nothing, and unblocks the hook configuration if added later. Don't gate this step on whether hooks are configured.

## Step 12: Final summary and reload reminder

This skill's own `hooks:` frontmatter (above) already prints a one-line "init complete" message via a `Stop` hook when the pipeline's turn ends, zero setup required — the print below is the full interactive summary, not a duplicate of the hook message.

Print to user:

```
✓ iEvo init complete.

Skills vendored: <N>
Agents vendored: <M>
Plugins added: <K>
Skipped (security): <P>

Now run: /reload-plugins

To keep iEvo itself current (recommended):
  Enable native plugin auto-update — /plugin → Marketplaces → ievo-skills → Enable auto-update.
  Third-party marketplaces have auto-update OFF by default; once on, Claude Code updates
  iEvo at startup and prompts /reload-plugins. (Managed installs: set "autoUpdate": true on
  the ievo-skills entry in extraKnownMarketplaces.) Prefer to keep it off? /ievo:hooks-setup
  can add a fail-silent, once-a-day SessionStart nudge when your version is behind.

To capture lessons going forward:
  /ievo:evo "<rule>"

To update vendored skills/agents later:
  /ievo:update

Diagnostic log: .ievo/log/init-<timestamp>.md
Project settings updated: .claude/settings.json (commit to git for team sync)
```

## Step 13: Invite feedback (especially on skips)

If any candidates were skipped, rejected on security, dropped/demoted by the Step 7a filters (O1/O2 overlap, stack-relevance), or had a filter decision overridden via the `overlap_tail[]` batch question (`filter_override[]` non-empty):

```
AskUserQuestion:
"You skipped <N> of <M> candidates (<K> filtered by overlap/relevance rules<, O installed despite a filter warning> if filter_override[] is non-empty). Share why?"
Options:
  - "Share rejection reasons" — invokes feedback skill flow B. In the context passed to flow B, call out `filter_override[]` entries explicitly (which rule — O1/O2/relevance — and which item triggered it), separate from the ordinary skip list. Flow B already offers to attach the init log, which now carries the filter's drop/demote/override rows (section 6b/7b) as corroborating detail. A user overriding a filter's drop (installing a demoted candidate anyway) is distinguishable signal from an ordinary skip: it means that rule fired a false positive for this case, not that the user didn't want the candidate.
  - "General feedback" — invokes feedback skill flow A
  - "Skip"
```

The `<, O installed despite a filter warning>` clause is conditional text — include it (with the actual override count) only when `filter_override[]` is non-empty; omit it entirely otherwise. This also covers the override-only case: if `filter_override[]` is the sole non-empty list (N=0, K=0 — nothing was skipped or left filtered), the question still renders sensibly as "You skipped 0 of <M> candidates (0 filtered by overlap/relevance rules, O installed despite a filter warning). Share why?" rather than a bare, contextless "0 skipped" prompt.

If no skips, no filter drops/demotions, and no overrides, simpler prompt: "Init complete — share feedback?" → Skip default.

## Rules

- **Hard prereqs.** gh CLI + git CLI + Node 18+ all required. Don't proceed without them.
- **Pipeline is sequential.** discover.mjs → index-repos (parallel) → match + categorical rank → interview → security-auditor (parallel) → install. Each step's output feeds the next.
- **Two install paths only.** Vendor (skills + agents) OR plugin (everything else). Never mix.
- **Security check is gate, not advisor.** RED requires explicit force-install. Default flow respects audit results.
- **Project-scope everything.** No `-g` flags. Settings.json edits are project-scope by file location. Team gets state via git.
- **Logs separate from evolution.** `.ievo/log/` is diagnostic (gitignore). `.ievo/evolution/` is project state (commit).
- **Idempotent re-runs.** Re-running `/ievo:init` shouldn't re-suggest installed items. Inventory check (step 3) handles this.
