---
name: init
description: Initialize iEvo in the current project — discover relevant skills and agents from skills.sh and the broader GitHub ecosystem, audit them for safety, install through an interactive interview. Composes three lower-level skills (find-skills, index-repos, security-check) into a complete setup pipeline. Use when the user runs `/ievo:init`, opens a new project that does not yet have `.ievo/`, or asks "set up iEvo here" / "find skills for this project".
license: MIT
compatibility: Requires `find-skills` (vercel-labs/skills), `gh` CLI, `git` CLI, Node 18+, and network access. Orchestrator uses Task tool (parallel sub-agent dispatch) + AskUserQuestion (interactive prompts), so it runs on **Claude Code and Codex** (both support these). The skills inside the pipeline are cross-platform via agentskills.io; the init orchestrator itself is Claude Code/Codex-specific.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Init

## ⚠️ Critical execution directive — read first

**Execute the entire pipeline continuously, without pausing.** Do NOT wait for user input between steps. The ONLY user-facing pauses are:

1. **Step 1** (permission check) — `AskUserQuestion`
2. **Step 7a** (resolve ambiguous categories) — `AskUserQuestion`, only if any categories were marked `/ambiguous`
3. **Step 7b** (per-candidate interview) — `AskUserQuestion`
4. **Step 8** (RED security verdict) — `AskUserQuestion`, only for RED candidates
5. **Step 13** (final feedback prompt) — `AskUserQuestion`

Between every other step, **proceed immediately** to the next step. If you find yourself thinking "should I confirm with the user before doing X?" — the answer is NO. Just do it. Write to the log so the user can monitor via `tail -f`.

Especially: between Step 5 (find-skills result) and Step 6 (index-repos) → **no pause, no confirmation, no summary checkpoint**. Just chain straight through.

## Pipeline

Set up iEvo in the current project. Pipeline:

```
find-skills (skills.sh)
    ↓
index-repos (parallel sub-agents, local scan)
    ↓
match against stack + rank — top-N per category
    ↓
interview (per candidate)
    ↓
security-check (per selection — LLM agent)
    ↓
install (vendor or plugin)
```

**v0.5.0 — simplified architecture**: dropped community-index integration (was v0.4.0). All scanning happens on user's machine via parallel `repo-indexer` sub-agents (~30-60s for 8 cold-cache repos). Security audit happens per-install via LLM agent (security-check skill). No central pre-computed cache — each user's decision is independent and verifiable.

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

### Step 0c — Write to log

Create `$LOG_PATH` (see Step 2.5) and write section 0:

```markdown
# Init run — <ISO-8601 timestamp>

## 0. Plugin metadata
- iEvo plugin version: <version-from-read>
- Plugin path: ${CLAUDE_PLUGIN_ROOT}
- Plugin commit SHA: <run `git -C ${CLAUDE_PLUGIN_ROOT} rev-parse --short HEAD 2>/dev/null` or write "marketplace-installed">
- Claude Code: <output of `claude --version`>
- OS: <output of `uname -srm`>
- Run started: <ISO-8601 timestamp>
```

Plugin path in the log helps diagnose "which install dir is Claude Code loading the plugin from".

## Step 1: Verify prerequisites

Hard prereqs:
- `find-skills` skill installed — check `.claude/skills/find-skills/SKILL.md` or `~/.claude/skills/find-skills/SKILL.md` or in any plugin's `skills/`
- `git` CLI — `which git`. Used for checkout-based indexing.
- `gh` CLI — `which gh` and `gh auth status`. Used only by security-auditor (audit data from skills.sh) and uninstall (marker discovery).
- `node` (≥18) — `node --version`. Used by `scan_repo.mjs` for repo scanning. Node ships with Claude Code, so this is normally always available — but if user has a damaged install, hard-fail.
- **Bash permissions** for the commands init will run (see below)

If `find-skills` missing — **HARD STOP, do not auto-install**:

```
❌ find-skills is required but not installed.

iEvo cannot auto-install find-skills because Claude Code's auto-mode classifier blocks
`npx skills` as an untrusted network command. You must run it manually.

Please run NOW in your shell (not via Claude Code):

  npx skills add vercel-labs/skills --all --copy

Then in Claude Code:
  /reload-plugins

After that, re-invoke /ievo:init. We'll resume from Step 1.
```

**Init MUST exit at this point.** Do NOT proceed to Step 2 or any later step. Do NOT attempt the install via Bash tool — the auto-classifier will block it, friction blocks the entire pipeline, and partial-install state breaks downstream steps. Better to stop cleanly and ask user to handle the one network call manually.

Flag rationale:
- `--all` — install all skills + agents from the package (shorthand for `--skill '*' --agent '*' -y`). vercel-labs/skills is a curated agentskills.io reference repo — pulling whole package is appropriate and future-proof
- `--copy` — copy files instead of symlinking (robust against source repo moves; aligns with project-level scope convention)

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

Init will run network/CLI commands the auto-mode classifier may block: `npx skills`, `gh api`, `gh search`. Without pre-approval, each call hits a confirmation prompt — friction during the discovery phase.

Recommended: ensure `.claude/settings.local.json` (per-user, gitignored) OR `.claude/settings.json` (team-shared, committed) contains:

```json
{
  "permissions": {
    "allow": [
      "Bash(npx skills*)",
      "Bash(npx -y skills*)",
      "Bash(gh api*)",
      "Bash(gh search*)"
    ]
  }
}
```

**Check at init start:** read the project's settings files. If the four patterns above are NOT present, ask user via `AskUserQuestion`:

- **Question:** `Init needs Bash permissions for npx skills + gh CLI. Add them?`
- **Header:** `Permissions`
- **Options:**
  - `Add to .claude/settings.local.json (Recommended)` — description: `Per-user permission, gitignored. Only affects you on this machine.`
  - `Add to .claude/settings.json (team-shared)` — description: `Permission shared with team via git commit. Useful if everyone runs iEvo here.`
  - `Skip — I'll approve each command manually` — description: `Each blocked Bash call needs explicit Allow. Slower but no permission file changes.`

For `Add to ...` options: merge the four patterns into the existing `permissions.allow` array. Do not overwrite other permissions. If file doesn't exist, create with minimal `{"permissions": {"allow": [...]}}`.

For `Skip`: continue — but expect blocked commands during the run.

Stop only on missing find-skills or gh prereqs. Permission setup is opt-in but strongly recommended.

## Step 2: Prepare project directories

Create if missing:
- `.ievo/evolution/agents/`
- `.ievo/evolution/skills/`
- `.ievo/log/`
- `.ievo/cache/index/`
- `.claude/` — root for vendored items
- `.claude/agents/` — for vendored agents
- `.claude/skills/` — for vendored skills (init uses direct file writes via Write tool, NOT `npx skills add` — that tool is only used as prereq installer for find-skills itself)
- `.ievo/log/pending-reports/` — for security-issue reports that couldn't be filed live (gh auth missing, rate limit, repo issues disabled). User can file manually later from these saved bodies.

Do NOT touch `CLAUDE.md` or `AGENTS.md` here.

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

If a step takes a long time (e.g. `find-skills` or `index-repos` for big repos), the user can `tail -f $LOG_PATH` in another shell and see progress.

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

### MANDATORY log content — section 3

Write **complete lists**, do not abbreviate. The diagnostic value depends on seeing everything:

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

If a project has 26 agents, the log MUST list all 26 names. Do not collapse to "12 iEvo-managed plus N others" — that loses information needed for filtering decisions in step 5.

## Step 4: Detect stack and dependencies

Parse manifest files (see comprehensive table — Python, Node/TS, Rust, Go, Java/Kotlin, Ruby, PHP, Dart, Elixir, .NET, Swift/iOS, Haskell, Clojure, Crystal, OCaml, Nim, Lua, R, Julia, Zig, C/C++, Unreal, Godot, Unity).

For each found manifest, extract direct (top-level) dependency names.

Output stack + deps summary. Log to buffer (section 4).

### Manifest reference

| Stack | Manifest | What to extract |
|-------|----------|-----------------|
| Python | `pyproject.toml` | `[project].dependencies` + `[project.optional-dependencies].*` + `[tool.poetry.dependencies]` |
| Python | `requirements*.txt`, `Pipfile` | package names |
| Node / TS / Bun | `package.json` | `dependencies` + `devDependencies` |
| Deno | `deno.json`, `deno.jsonc` | `imports` keys |
| Rust | `Cargo.toml` | `[dependencies]` + `[dev-dependencies]` |
| Go | `go.mod` | `require` directives |
| Java | `pom.xml` | `<artifactId>` per `<dependency>` |
| Java / Kotlin | `build.gradle(.kts)` | `implementation`/`api`/`testImplementation` |
| Ruby | `Gemfile`, `*.gemspec` | `gem '<name>'` |
| PHP | `composer.json` | `require` + `require-dev` |
| Dart / Flutter | `pubspec.yaml` | `dependencies` + `dev_dependencies` |
| Elixir | `mix.exs` | `deps` function |
| .NET / C# / F# | `*.csproj`, `*.fsproj`, `Directory.Packages.props` | `<PackageReference Include="..."/>` |
| Swift / iOS | `Package.swift`, `Podfile`, `Cartfile` | dependencies / pods / github |
| Haskell | `*.cabal`, `package.yaml`, `stack.yaml` | `build-depends` / `dependencies` / `extra-deps` |
| Clojure | `deps.edn`, `project.clj` | `:deps` keys / `:dependencies` |
| Crystal | `shard.yml` | `dependencies` + `development_dependencies` |
| OCaml | `dune-project`, `*.opam` | `depends` |
| Nim | `*.nimble` | `requires` |
| Lua | `*.rockspec` | `dependencies` |
| R | `DESCRIPTION` | `Imports:` + `Depends:` |
| Julia | `Project.toml` | `[deps]` |
| Zig | `build.zig.zon` | `.dependencies` |
| C / C++ | `conanfile.txt/py`, `vcpkg.json`, `CMakeLists.txt` | requires / find_package |
| Unreal | `*.uproject` | Plugins block |
| Godot | `project.godot` | `[autoload]` + `addons/` |
| Unity | `Packages/manifest.json` | `dependencies` |

Tag deps with source manifest for polyglot projects.

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

If signals unclear → tag `<category>/ambiguous`, ask user in step 7a.

Log resolution outcomes (section 4.5).

## Step 5: Invoke find-skills

Activate the `find-skills` skill with full context:

```
Use the `find-skills` skill to discover skills relevant to this project.

PROJECT STACK
<stack summary from step 4>

DIRECT DEPENDENCIES
<deps list>

RESOLVED CATEGORIES
<list from step 4.5>

ALREADY INSTALLED — DO NOT suggest these:
Skills: <list from step 3>
Agents: <list from step 3>
Plugins: <list from step 3>

INSTRUCTIONS
1. Consolidate all queries into a SINGLE ranked list (no per-query top-N).
2. Cover language fundamentals, testing, linting, build tools,
   per-dep search (one entry per dep), domain-specific by signal,
   security/compliance if sensitive.
3. Dedup by <owner>/<repo>@<skill> and by skill name (highest install count wins).
4. Drop anything whose name overlaps installed inventory.
5. Return up to 12 candidates.

For each return:
- name in <owner>/<repo>@<skill> format
- one-line description
- install count
- source repo URL
- skills.sh URL
```

Log prompt + response (section 5, 5b).

## Step 6: Expand via index-repos (parallel local scan)

Extract the **unique set of `<owner>/<repo>` values** from find-skills' output. Also include this small list of auto-available repos (not on skills.sh but always relevant):

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

**Why parallel via sub-agents (not sequential):**
- Cold-cache 8 repos sequentially: ~4-8 minutes
- Parallel via sub-agents: ~30-60 sec (slowest repo's time)
- Each sub-agent has isolated context — terminal output and progress noise stays in its scope, doesn't pollute init's log buffer
- Each returns ONE clean summary line

**Performance expectation (v0.3.1+ — parallel checkout-based):** 8 repos in parallel = total wall-clock ~30-60 sec for cold cache (slowest repo wins). Per-repo: shallow clone (~5-30 sec) + filesystem scan (instant). Cache hits are sub-second per repo.

Surface progress to user via the incremental log file — they can `tail -f .ievo/log/init-*.md` to monitor.

Read each generated index and **expand the candidate list**:
- All standalone skills from index
- All standalone agents from index
- All plugins from index (each plugin = candidate with `type: plugin`)

Now your candidate list has three types: `skill` (install via vendor), `agent` (install via vendor), `plugin` (install via marketplace settings).

### Log: append section 6 to `$LOG_PATH` NOW (do not defer) — index-repos can take 5-15 minutes for big repos like wshobson/agents

### MANDATORY log content — section 6 (expansion)

```markdown
## 6. Repo indexing + candidate expansion

### Repos considered (<N>)
<for each repo: name, source (find-skills | auto-available), cache hit/miss>

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

## Step 7: Categorical ranking — top-N per category

Filter and rank **per category** (not overall):

### Step 7a — Filter

- **Drop candidates whose name conflicts with installed inventory** (already-installed check applies to expanded list, not just find-skills' direct returns).
- **Match name + description against stack/deps**:
  - Direct keyword match (skill named "pytest" for Python project with pytest) → high score
  - Description mentions deps from step 4 → medium
  - Generic universally-useful (e.g. "code-reviewer") → low but non-zero

### Step 7b — Categorize each surviving candidate

Assign each candidate to ONE primary category based on its name + description:

| Category | Examples |
|----------|----------|
| `testing` | pytest-runner, jest-config, vitest-setup, integration-tests |
| `linting` | ruff, eslint-config, prettier, black, mypy |
| `formatting` | code-formatter, prettier, biome |
| `build-tools` | vite-config, webpack, esbuild, bun-setup |
| `frameworks` | react-pro, fastapi-pro, django-pro, nextjs-expert |
| `databases` | postgres-pro, prisma-helper, sqlite-tuner |
| `security` | security-auditor, snyk-scan, owasp-check |
| `documentation` | mkdocs-helper, jsdoc-writer, api-doc-gen |
| `observability` | logger, opentelemetry, sentry-integration |
| `devops` | docker-helper, kubernetes-pro, github-actions |
| `agent-tooling` | code-reviewer, refactor-pro, test-writer (general-purpose dev agents) |
| `domain-specific` | stripe-pro, openai-pro, slack-bot (specific to a dep in step 4) |
| `other` | anything not fitting above |

If a candidate fits multiple categories, pick the **most specific** one.

### Step 7c — Rank within each category, keep top-5

Within each category bucket:
- **Rank by score** (descending), then by **install count** (where available), then by **stars**.
- **Keep top 5 per category**. Drop the rest from this category.

Final candidate list = union of top-5 from each category. Typically 15-40 total candidates depending on stack richness.

### Why categorical (vs flat top-12)

- Flat top-12 dominated by popular categories (testing always wins) → user never sees niche but useful skills
- Categorical top-5 gives breadth — every category present gets visibility
- User can see "I have 5 testing skills suggested, 5 linting, 3 security..." — clear coverage map

### Log: append section 6b to `$LOG_PATH` NOW (do not defer)

### MANDATORY log content — section 6b (filtering + categorical ranking)

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

## Step 7a: Resolve ambiguous categories first (if any)

For each category from step 4.5 tagged `/ambiguous`, ask user via `AskUserQuestion`:

- **Question:** `Which type of <category> are you working with?`
- **Header:** `<category>` (e.g. "i18n", "testing")
- **Options** (single-select):
  - `<sub-type-1>` — short description
  - `<sub-type-2>` — short description
  - `Both` — show both
  - `Skip category` — drop all candidates in this category

Filter candidates accordingly. Log resolutions (section 7a).

## Step 7b: Per-candidate interview

For each remaining candidate, ask via `AskUserQuestion`. **One question per candidate**, batched in groups of 4.

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
  - "Vendor agent" — description: "Copy <agent-name>.md to .claude/agents/, set up overlay for /ievo:evolution. Source: <owner>/<repo>."
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

Track selections:
- `vendor_queue[]` — skills + agents to vendor
- `plugin_queue[]` — plugins to install via settings.json

### Log: append section 7 + 7b to `$LOG_PATH` NOW (do not defer)

### MANDATORY log content — section 7b (interview results)

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

The `security-auditor` sub-agent returned a `report_template` field in its JSON with `available: true`, pre-filled `title` and `body`. Walk the user through filing:

#### 1. Preview

Show the pre-filled issue to the user via `AskUserQuestion`:

```
Question: "Preview of issue to file at <owner>/<repo>:

Title: <report_template.title>

<body preview — first 30 lines of report_template.body>

File this issue?"

Options:
  - "File it" — invokes `gh issue create` with the prefilled content
  - "Edit body first" — opens preview in tmp file for user to edit, then re-asks
  - "Cancel" — drops the report, candidate stays skipped
```

#### 2. File via `gh issue create`

**CRITICAL**: write the body via the **Write tool**, NOT via `echo "..." > file`. The body may contain `$(...)`, backticks, or `${VAR}` patterns from cited malicious code excerpts — shell interpolation during `echo` would execute these. Write tool writes literal bytes.

```
# Step A — Use Write tool (NOT Bash):
#   file_path: <project>/.ievo/log/pending-reports/issue-body-<ISO-timestamp>.md
#   content:   <report_template.body>   (literal string, no expansion)

# Step B — File the issue via gh, passing the body file:
gh issue create --repo <owner>/<repo> \
  --title <report_template.title> \
  --body-file <project>/.ievo/log/pending-reports/issue-body-<ISO-timestamp>.md
```

Quote the `--title` argument safely — single quotes or `--title="$TITLE"` with the title in an env var, never directly substituting via shell. If using gh's Bash flag, use single quotes: `--title 'literal title here'`.

Capture the returned issue URL (e.g., `https://github.com/owner/repo/issues/N`).

The pending-reports/ directory doubles as audit trail — even successful filings retain a local copy so user can re-read what was sent.

#### 3. Show result

```
✓ Filed: <issue-url>

Thanks for contributing to community security.
```

#### 4. Handle failures

- `gh` not authenticated → show error, fall back to copying body to clipboard with manual instructions
- API rate limit → save body to `<project>/.ievo/log/pending-reports/<owner>-<repo>-<timestamp>.md`, tell user to file manually later
- Repo doesn't accept issues (Issues disabled) → save body, show repo URL, tell user to find alternative reporting channel

In all failure modes: candidate stays removed from install queue (`skip` semantics).

### Why offer Report

- **Community defense**: maintainer notified within minutes of first user spotting the issue, not weeks later
- **Crowd-sourced audit**: N independent users × M findings = collective security signal
- **Accountability**: GitHub issues are public — pressure on maintainer to respond
- **Low effort for user**: security-auditor already prepared the issue text, user just confirms

### Why parallel via sub-agents

- N selected items × ~10s sequential audit = 60-90s wait
- Parallel via sub-agents = ~10-15s wall-clock (slowest item wins)
- Each sub-agent has isolated context — security-check's WebFetch + gh api calls don't pollute init's main log buffer
- Each returns ONE structured verdict JSON

**Log: append section 8 to `$LOG_PATH` NOW (do not defer)** — write verdicts as they arrive (in any order), then aggregate.

### MANDATORY log content — section 8 (security audit + reports)

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

## Step 9: Execute install

Two paths run in sequence:

### 9a — Vendor path (skills + agents)

For each item in `final_vendor_list`:

**Skill:**
1. Determine source path in upstream repo (from index-repos output).
2. Fetch the SKILL.md file + supporting dirs (scripts/, references/, assets/) via `gh api`. Write tree to `<project>/.claude/skills/<name>/`.
3. Inject overlay marker at top of SKILL.md (after frontmatter):
   ```markdown
   <!-- ievo:start -->
   **Before applying the instructions below**, read `.ievo/evolution/skills/<name>.md`
   if it exists and apply all rules from its sections.
   <!-- ievo:end -->
   ```
4. Create overlay file `.ievo/evolution/skills/<name>.md` with frontmatter:
   ```markdown
   ---
   source:
     repo: <owner>/<repo>
     path: <source-path-in-repo>
     commit_sha: <short-sha from gh api>
     fetched_at: <ISO-timestamp>
   ---

   # <name> — Evolution Overlay

   ## <date> — Vendored from <owner>/<repo>
   **Trigger:** /ievo:init step 9
   Initial copy. No customizations yet.
   ```

**Agent:**
Same as skill but:
- File path: `<project>/.claude/agents/<name>.md`
- Overlay marker inserted in agent body (after frontmatter)
- Overlay file path: `.ievo/evolution/agents/<name>.md`

### 9b — Plugin install path (whole plugins)

For each item in `final_plugin_list`:

1. Read or create `.claude/settings.json`.
2. Merge into `extraKnownMarketplaces` (key = marketplace name from index, source = `{source: "github", repo: "<owner>/<repo>"}`):
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

This file gets committed to git → teammates `git pull` → Claude Code prompts them to trust the folder → plugin auto-installs on their side too.

### Failure handling

Per existing convention: if any install step fails, report and continue with the next. Do NOT abort the whole flow.

**Log: append section 9 to `$LOG_PATH` NOW (do not defer) after EACH install** — not after the entire batch. Each install line written as it completes so the user sees progress live in `tail -f`.

## Step 10: Add `.ievo/` to .gitignore (selectively)

Project `.gitignore` should ignore:
- `.ievo/log/` — diagnostic logs (local-only)
- `.ievo/cache/` — repo indices (re-derivable)

But NOT ignore (must be committed for team portability):
- `.ievo/evolution/` — overlay files (project-owned evolution data)

Check project's `.gitignore`. If it doesn't already cover `.ievo/log/` and `.ievo/cache/`, append:
```
# iEvo local-only artifacts
.ievo/log/
.ievo/cache/
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

**Why incremental writes matter:** if init crashes / hangs / user cancels at any step, the partial log up to that point is on disk. `tail -f .ievo/log/init-*.md` works during long-running steps (find-skills, index-repos). Post-mortem diagnosis works even on failed runs.

## Step 12: Final summary and reload reminder

Print to user:

```
✓ iEvo init complete.

Skills vendored: <N>
Agents vendored: <M>
Plugins added: <K>
Skipped (security): <P>

Now run: /reload-plugins

To capture lessons going forward:
  /ievo:evolution "<rule>"

To update later:
  /ievo:update

Diagnostic log: .ievo/log/init-<timestamp>.md
Project settings updated: .claude/settings.json (commit to git for team sync)
```

## Step 13: Invite feedback (especially on skips)

If any candidates were skipped or rejected on security:

```
AskUserQuestion:
"You skipped <N> of <M> candidates. Share why?"
Options:
  - "Share rejection reasons" — invokes feedback skill flow B
  - "General feedback" — invokes feedback skill flow A
  - "Skip"
```

If no skips, simpler prompt: "Init complete — share feedback?" → Skip default.

## Rules

- **Hard prereqs.** find-skills + gh CLI + git CLI all required. Don't proceed without them.
- **Pipeline is sequential.** find-skills → index-repos (parallel) → match + categorical rank → interview → security-auditor (parallel) → install. Each step's output feeds the next.
- **Two install paths only.** Vendor (skills + agents) OR plugin (everything else). Never mix.
- **Security check is gate, not advisor.** RED requires explicit force-install. Default flow respects audit results.
- **Project-scope everything.** No `-g` flags. Settings.json edits are project-scope by file location. Team gets state via git.
- **Logs separate from evolution.** `.ievo/log/` is diagnostic (gitignore). `.ievo/evolution/` is project state (commit).
- **Idempotent re-runs.** Re-running `/ievo:init` shouldn't re-suggest installed items. Inventory check (step 3) handles this.
