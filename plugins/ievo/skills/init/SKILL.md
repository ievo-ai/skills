---
name: init
description: Initialize iEvo in the current project — discover relevant skills and agents from skills.sh and the broader GitHub ecosystem, audit them for safety, install through an interactive interview. Composes three lower-level skills (find-skills, index-repos, security-check) into a complete setup pipeline. Use when the user runs `/ievo:init`, opens a new project that does not yet have `.ievo/`, or asks "set up iEvo here" / "find skills for this project".
license: MIT
compatibility: Requires `find-skills` (vercel-labs/skills), `gh` CLI, and network access.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Init

Set up iEvo in the current project. Pipeline:

```
find-skills (skills.sh)
    ↓
index-repos (full repo content per unique repo)
    ↓
match against stack + rank
    ↓
interview (per candidate)
    ↓
security-check (per selection)
    ↓
install (vendor or plugin)
```

## Step 0: Print version banner

**Before any other work**, read the plugin version and print a banner so the user immediately knows what's running. This is the primary diagnostic for "is the new init body loaded after marketplace update?" — if the user sees an old version here, they know to `/reload-plugins`.

```bash
VERSION=$(jq -r '.version' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json")
```

Output:
```
🧬 iEvo init v<version>
   github.com/ievo-ai/skills
```

If the version reads as expected by the user (matches recently-merged release), proceed. If not, the user can interrupt and reload.

Append to log buffer:
```markdown
## 0. Plugin metadata
- iEvo plugin version: <version>
- Plugin commit SHA: <gh -C ${CLAUDE_PLUGIN_ROOT} rev-parse --short HEAD or "marketplace-installed">
- Claude Code: <claude --version>
- OS: <uname -srm>
- Run started: <ISO-8601 timestamp>
```

## Step 1: Verify prerequisites

Hard prereqs:
- `find-skills` skill installed — check `.claude/skills/find-skills/SKILL.md` or `~/.claude/skills/find-skills/SKILL.md` or in any plugin's `skills/`
- `gh` CLI — `which gh` and `gh auth status`

If `find-skills` missing:
```
Please run first:
  npx skills add vercel-labs/skills --skill find-skills
  /reload-plugins
Then re-run /ievo:init.
```

If `gh` missing or unauthenticated:
```
This skill needs the `gh` CLI for indexing and security checks. Install:
  brew install gh         # macOS
  # or see https://cli.github.com
  gh auth login
```

Stop on either failure.

## Step 2: Prepare project directories

Create if missing:
- `.ievo/evolution/agents/`
- `.ievo/evolution/skills/`
- `.ievo/log/`
- `.ievo/cache/index/`
- `.claude/` — required for `npx skills add` symlink behavior
- `.claude/agents/` — for vendored agents
- `.claude/skills/` — for vendored skills

Do NOT touch `CLAUDE.md` or `AGENTS.md` here.

## Step 2.5: Open run-log buffer

Start buffer (in memory). Write to `.ievo/log/init-<YYYYMMDD-HHMMSS>.md` at Step 11. Initialize:

```markdown
# Init run — <ISO-8601 timestamp>

## 0. Plugin metadata
- iEvo plugin: <version> (<sha>)
- Claude Code: <claude --version>
- OS: <uname -srm>
```

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

## Step 6: Expand via index-repos

Extract the **unique set of `<owner>/<repo>` values** from find-skills' output. Also include this small list of auto-available repos (not on skills.sh but always relevant):

```
- anthropics/claude-plugins-official   (official, built-in to Claude Code)
- anthropics/claude-code               (demo plugins)
```

For each unique repo, invoke the `index-repos` skill:

```
Use index-repos to enumerate <owner>/<repo>.
```

`index-repos` writes (or hits cache for) `.ievo/cache/index/<owner>-<repo>.md` per repo.

Read each generated index and **expand the candidate list**:
- All standalone skills from index
- All standalone agents from index
- All plugins from index (each plugin = candidate with `type: plugin`)

Now your candidate list has three types: `skill` (install via vendor), `agent` (install via vendor), `plugin` (install via marketplace settings).

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

## Step 7: Match expanded candidates against stack and rank

Filter and rank:

- **Drop candidates whose name conflicts with installed inventory** (already-installed check applies to expanded list, not just find-skills' direct returns).
- **Match name + description against stack/deps**:
  - Direct keyword match (skill named "pytest" for Python project with pytest) → high score
  - Description mentions deps from step 4 → medium
  - Generic universally-useful (e.g. "code-reviewer") → low but non-zero
- **Rank by score then by install count** (where available) then by stars.

Keep top 12-15 candidates total.

### MANDATORY log content — section 6b (filtering outcome)

```markdown
## 6b. Stack-match filtering

### Dropped: already-installed (<N>)
<list with name + reason "matches installed <agent|skill|plugin>: <name>">

### Dropped: out-of-stack (<N>)
<list with name + reason "no signal match for project's stack">

### Dropped: low score (<N>)
<list with name + score>

### Final candidates (<N>)
| name | type | source repo | install_count/stars | score | category |
|------|------|-------------|---------------------|-------|----------|
[...one row per candidate, ranked]
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

## Step 8: Per-selection security check

For each item in `vendor_queue` and `plugin_queue`, invoke `security-check`:

```
Use security-check on <owner>/<repo>@<name> with type=<skill|agent|plugin>.
```

`security-check` returns risk + flags + (for RED) alternative suggestions.

### Decision per item

- **GREEN** → add to final install list. No user friction.
- **YELLOW** → show flags as a brief note. Default to install. Add to final list unless user explicitly skips.
  ```
  AskUserQuestion:
  "<name> has security note: <top flag>. Install?"
  Options: "Install" / "Skip"
  ```
- **RED** → strict review.
  ```
  AskUserQuestion:
  "<name> flagged HIGH RISK: <top 2 flags>. Decision?"
  Options:
    - "Try alternative: <next-ranked-of-same-purpose>" (if alternative suggested)
    - "Force install anyway (I've reviewed the flags)"
    - "Skip this candidate"
  ```
  - If user picks alternative → recursively run step 8 on the alternative.
  - If force-install → add to final list with `force=true` flag.
  - If skip → remove from queue.

Log per-item audit outcomes (section 8).

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

Log install outcomes per-item (section 9).

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

## Step 11: Write diagnostic log

Flush the buffer (sections 0-9) to `.ievo/log/init-<YYYYMMDD-HHMMSS>.md`.

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

- **Hard prereqs.** find-skills + gh CLI both required. Don't proceed without them.
- **Pipeline is sequential.** find-skills → index-repos → match → interview → security-check → install. Each step's output feeds the next.
- **Two install paths only.** Vendor (skills + agents) OR plugin (everything else). Never mix.
- **Security check is gate, not advisor.** RED requires explicit force-install. Default flow respects audit results.
- **Project-scope everything.** No `-g` flags. Settings.json edits are project-scope by file location. Team gets state via git.
- **Logs separate from evolution.** `.ievo/log/` is diagnostic (gitignore). `.ievo/evolution/` is project state (commit).
- **Idempotent re-runs.** Re-running `/ievo:init` shouldn't re-suggest installed items. Inventory check (step 3) handles this.
