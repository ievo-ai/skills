---
name: init
description: Initialize iEvo in the current project — detect stack and dependencies, discover relevant agent skills from skills.sh through an interview, and prepare the project's evolution log structure. Use when the user runs `/ievo:init`, opens a new project that does not yet have `.ievo/`, or asks "set up iEvo here", "initialize iEvo", or "find skills for this project".
license: MIT
compatibility: Requires the `find-skills` skill from vercel-labs/skills to be installed and reloaded. Requires `npx` and network access for skill installation.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Init

Set up iEvo in the current project by discovering and installing relevant skills from [skills.sh](https://www.skills.sh/) through a per-skill interview. iEvo does not inject anything into `CLAUDE.md` / `AGENTS.md` at init time — those files are only modified later, on the first project-specific evolution.

## Step 1: Verify find-skills is installed

The `find-skills` skill from `vercel-labs/skills` is a hard prerequisite. Without it, the rest of this skill cannot work.

Check if find-skills is available:
- Look for `.claude/skills/find-skills/SKILL.md` (project-local install)
- Or `~/.claude/skills/find-skills/SKILL.md` (user-level install)
- Or a plugin-bundled `find-skills` skill in `.claude/plugins/*/skills/find-skills/SKILL.md`

If **not** installed, stop and instruct the user:

```
The `find-skills` skill is required. Please run:

  npx skills add vercel-labs/skills --skill find-skills
  /reload-plugins

Then run /ievo:init again.
```

Do not proceed. Do not auto-install find-skills — the user needs to reload plugins manually after install, and asking them to reload twice in one flow is bad UX.

## Step 2: Prepare project directories

Create (if missing):
- `.ievo/evolution/agents/` — per-agent evolution logs
- `.ievo/evolution/skills/` — per-skill evolution logs
- `.ievo/log/` — per-run diagnostic logs (this run will write to it in step 11)
- `.claude/` — required by `npx skills add` for project-local installs (without it, the Claude Code symlinks are silently skipped — see vercel-labs/skills bug reports)

Do not touch `CLAUDE.md` or `AGENTS.md` here. They are only modified on the first project-specific evolution.

## Step 2.5: Open run log buffer

Start a buffer (a markdown string in memory) for this init run. Add sections as you progress through steps; write the full buffer to `.ievo/log/init-<YYYYMMDD-HHMMSS>.md` at step 11. This log is the **single most useful artifact** for diagnosing why init suggested what it suggested.

Initialize the buffer with:

```markdown
# Init run — <ISO-8601 timestamp>

## 0. Plugin metadata
- iEvo plugin version: <read from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json>
- Plugin commit SHA: <git -C ${CLAUDE_PLUGIN_ROOT} rev-parse --short HEAD>
- Claude Code: <claude --version>
- OS: <uname -srm>
```

Append a new `## N. <step name>` section after each major step below.

## Step 3: Build the "already-installed" inventory

Collect names of everything already installed in the project. This serves two purposes:
- (a) Pass to find-skills upfront so it doesn't suggest redundant skills.
- (b) Use for the dedup safety net in step 6.

**Installed skills** — scan and list names from:
- `.claude/skills/<name>/SKILL.md`
- `.claude/plugins/*/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md`
- `~/.claude/plugins/*/skills/<name>/SKILL.md`

**Installed agents** — scan and list names from:
- `.claude/agents/<name>.md`
- `.claude/plugins/*/agents/<name>.md`
- `~/.claude/agents/<name>.md`
- `~/.claude/plugins/*/agents/<name>.md`

Hold both lists for use in steps 5 and 6.

**Log:** append to buffer:
```markdown
## 3. Installed inventory
- Skills: <count> — names: <comma-separated>
- Agents: <count> — names: <comma-separated>
```

## Step 4: Detect stack and dependencies

This is the **signal that matters most** for discovering relevant skills. find-skills cannot guess "this project uses SimpleITK" from a quick scan of file extensions — but if you parse the manifest and pass the dependency list explicitly, the search becomes precise.

Parse the project's manifest files **at the project root**. For each found manifest, extract the **direct (top-level) dependency names** — not transitive deps, not version constraints, just library names.

| Stack | Manifest | What to extract |
|-------|----------|-----------------|
| Python | `pyproject.toml` | `[project].dependencies` + `[project.optional-dependencies].*` + `[tool.poetry.dependencies]` |
| Python | `requirements.txt`, `requirements*.txt` | Package names (left of `==`, `>=`, etc.) |
| Python | `Pipfile` | `[packages]` and `[dev-packages]` sections |
| Node / TypeScript / Bun | `package.json` | `dependencies` + `devDependencies` |
| Deno | `deno.json`, `deno.jsonc` | `imports` map (bare specifiers) |
| Rust | `Cargo.toml` | `[dependencies]` + `[dev-dependencies]` |
| Go | `go.mod` | `require` directives |
| Java | `pom.xml` | `<artifactId>` from each `<dependency>` |
| Java / Kotlin | `build.gradle`, `build.gradle.kts` | `implementation` / `api` / `testImplementation` lines |
| Ruby | `Gemfile`, `*.gemspec` | `gem '<name>'` |
| PHP | `composer.json` | `require` + `require-dev` |
| Dart / Flutter | `pubspec.yaml` | `dependencies` + `dev_dependencies` |
| Elixir | `mix.exs` | `deps` function return list |
| .NET / C# / F# | `*.csproj`, `*.fsproj`, `Directory.Packages.props` | `<PackageReference Include="..."/>` |
| Swift / iOS | `Package.swift` | `dependencies:` array in `Package(...)` |
| Swift / iOS | `Podfile` | `pod '<name>'` |
| Swift / iOS | `Cartfile` | `github "<owner>/<repo>"` |
| Haskell | `*.cabal` | `build-depends:` field |
| Haskell | `package.yaml` (hpack) | `dependencies:` array |
| Haskell | `stack.yaml` | `extra-deps:` |
| Clojure | `deps.edn` | `:deps` map keys |
| Clojure | `project.clj` (Leiningen) | `:dependencies` vector |
| Crystal | `shard.yml` | `dependencies:` + `development_dependencies:` |
| OCaml | `dune-project`, `*.opam` | `depends` field |
| Nim | `*.nimble` | `requires` strings |
| Lua | `*.rockspec` | `dependencies` table |
| R | `DESCRIPTION` | `Imports:` + `Depends:` |
| Julia | `Project.toml` | `[deps]` table |
| Zig | `build.zig.zon` | `.dependencies` struct |
| C / C++ | `conanfile.txt`, `conanfile.py`, `vcpkg.json` | `[requires]` / `requires` / `dependencies` |
| C / C++ | `CMakeLists.txt` | `find_package(...)` calls (best-effort) |
| Unreal Engine | `*.uproject` | `Plugins` block |
| Godot | `project.godot` | `[autoload]` and plugin entries in `addons/` |
| Unity | `Packages/manifest.json` | `dependencies` map |

Also note **stack-level signals** from file presence and secondary indicators:
- `pyproject.toml` → Python (check for `[tool.uv]` / `[tool.poetry]` / `[tool.hatch]` for tool family)
- `package.json` → Node.js / JS / TS / Bun (check `"type": "module"`, look for `tsconfig.json` to confirm TS, framework deps for React / Vue / Next.js / Svelte / etc.)
- `deno.json` → Deno
- `Cargo.toml` → Rust
- `go.mod` → Go
- `pom.xml` / `build.gradle*` → Java / Kotlin / Android (check `android` block in gradle for Android)
- `Package.swift` → Swift (likely macOS/iOS native or SwiftUI)
- `*.csproj` / `*.fsproj` → .NET / C# / F#
- `*.cabal` / `stack.yaml` → Haskell
- `deps.edn` / `project.clj` → Clojure / ClojureScript
- `*.uproject` → Unreal Engine
- `project.godot` → Godot
- `Packages/manifest.json` → Unity
- `Dockerfile` / `docker-compose.yml` → Docker (secondary signal, not stack)
- `.github/workflows/*.yml` → GitHub Actions CI (secondary, useful for testing/deploy skills)
- `terraform/*.tf` → Terraform/IaC (secondary)
- `.tool-versions` / `mise.toml` → asdf/mise version manager (gives stack hints)

If multiple manifests are found (monorepo / polyglot project), parse ALL of them and produce a combined stack list. Tag each dep with its source manifest in case it matters for the search ("this lib is from the frontend package.json, not the Python backend").

Output a compact stack + deps summary like:
```
Stack: Python (pyproject.toml)
Deps: numpy, scipy, pydantic, SimpleITK, vtk, pydicom, fastapi, pytest, mypy, ruff
```

**Log:** append to buffer:
```markdown
## 4. Stack & dependencies
- Manifests found: <list>
- Detected stack: <Python / Node / Rust / ...>
- Tool family hints: <uv / poetry / npm / yarn / cargo / ...>
- Direct deps (<N> total): <comma-separated list>
- Secondary signals: <Dockerfile / .github/workflows / etc.>
```

## Step 4.5: Disambiguate broad categories

Many "broad categories" (i18n, testing, security, docs, ...) have multiple sub-types that solve completely different problems. Suggesting `mkdocs-i18n` for a project that translates UI code strings (gettext-style) is wrong: same word, different category. Resolve this **before** calling find-skills.

### Ambiguous category registry

For each broad category in the table below: if the project shows signals for it, examine file-level signals to pick the right sub-type. If signals point to one sub-type → tag the category with that sub-type. If signals point to multiple or none → mark as `ambiguous`.

| Broad category | Sub-types | Signal hints |
|----------------|-----------|--------------|
| `i18n` / translation | `code-strings`, `documentation` | `.po`/`.mo` files, `locale/` dir → `code-strings`; `mkdocs.yml` with `i18n` plugin, `docs/locales/` → `documentation` |
| `testing` | `unit`, `integration`, `e2e` | `vitest.config`/`jest.config`/`pytest.ini` → `unit`; `playwright.config`/`cypress.config`/`detox` → `e2e`; `tox.ini`/separate `integration_tests/` → `integration` |
| `security` | `app-sec`, `supply-chain`, `static-analysis` | runtime deps (Helmet, JWT, CSRF middleware) → `app-sec`; lockfile + `npm audit`/`Snyk`/`Dependabot` → `supply-chain`; `bandit`/`semgrep`/`CodeQL` → `static-analysis` |
| `documentation` | `user`, `api`, `internal` | `mkdocs.yml`/`docusaurus`/`sphinx-conf.py` (high-level project docs) → `user`; `openapi.yaml`/`swagger.json`/`apispec` → `api` |
| `linting` | `style`, `types`, `security` | `prettier`/`black`/`rustfmt` → `style`; `mypy`/`tsc`/`pyright` → `types`; `bandit`/`semgrep`/`gosec` → `security` |
| `observability` | `logging`, `tracing`, `metrics` | structured logger configs (`structlog`, `pino`, `winston`) → `logging`; `opentelemetry-*` deps → `tracing`; `prometheus-client`/`statsd` → `metrics` |
| `state-management` (frontend) | `redux`, `zustand`, `mobx`, `recoil`, `context-only` | match dep name in `package.json` directly |
| `build-tools` | `bundler`, `package-manager`, `task-runner` | `webpack.config`/`vite.config`/`rollup.config` → `bundler`; `npm`/`yarn`/`pnpm`/`uv` → `package-manager`; `Makefile`/`taskfile.yml`/`just` → `task-runner` |
| `database` | `orm`, `query-builder`, `migrations`, `driver` | `sqlalchemy`/`prisma`/`typeorm` → `orm`; `kysely`/`knex` → `query-builder`; `alembic`/`flyway` → `migrations`; raw drivers → `driver` |

### Algorithm

For each candidate category, in order:

1. If the category is **not in the registry** → leave as is. Pass to find-skills with the broad name only.
2. If in registry:
   - Run the signal checks for each sub-type.
   - **One sub-type matched** → tag the category as `<category>/<sub-type>` (auto-resolved). Output one line for transparency: `Detected i18n/code-strings (found ./locale/ + *.po files)`.
   - **Multiple sub-types matched** → tag as `<category>/<sub-A>+<sub-B>+...` (multi-resolved — pass all). User likely needs help in both areas.
   - **No sub-types matched but the broad category fires** → tag as `<category>/ambiguous`. We will ask the user in Step 7.
3. Add new entries to the registry only when the same ambiguity pattern is observed in multiple projects — premature registry growth is worse than missing entries.

### What this prevents

The bug behind issue #11: init suggested `mkdocs-i18n` for a project that only translates UI code strings. With this step, signals (`.po` files / no `mkdocs.yml`) would have resolved `i18n` → `code-strings`, find-skills would have been asked for gettext / Babel / react-intl class skills, and `mkdocs-i18n` would never have been a candidate.

**Log:** append to buffer:
```markdown
## 4.5. Disambiguation outcomes
- <category> → <sub-type> (signals: <which files/deps triggered>)
- <category> → ambiguous (no matching signals — will ask user)
- ... (one line per category considered)
```

## Step 5: Invoke find-skills (with full context)

Trigger the `find-skills` skill, passing the detected stack, dependency list, and installed inventory. Use this prompt:

```
Use the `find-skills` skill to discover skills relevant to this project.

PROJECT STACK
<stack summary from step 4>

DIRECT DEPENDENCIES (from manifest)
<dep list from step 4, comma-separated>

ALREADY INSTALLED — do NOT suggest these
Skills: <list from step 3>
Agents: <list from step 3>

INSTRUCTIONS
1. Run all relevant searches and CONSOLIDATE into a SINGLE ranked list.
   Do not return parallel per-query top-Ns — merge everything and rank once.
2. Cover these categories (skip any that don't apply to this project) — use
   the resolved category/sub-type from step 4.5 where available:
   - Language/runtime fundamentals (e.g. python-pro for Python, typescript-pro for TS)
   - Testing framework — sub-type resolved (e.g. testing/unit → pytest;
     testing/e2e → playwright)
   - Linting & typing — sub-type resolved (e.g. linting/style vs linting/types)
   - Build/package tools (uv, poetry, npm, yarn, pnpm, cargo, gradle)
   - Each LIBRARY in the dependencies list (search each one — e.g. SimpleITK,
     VTK, pydicom, fastapi, react — return skills covering them)
   - Domain-specific based on project content (e.g. medical imaging, finance,
     game dev) — but only if a signal supports it
   - Security & compliance — sub-type resolved (app-sec / supply-chain /
     static-analysis)
   - For any category tagged `<name>/ambiguous` in step 4.5: return suggestions
     for ALL sub-types. The user will pick which sub-type they need during the
     interview (step 7).
3. Deduplicate by `<owner>/<repo>@<skill>` identifier and by skill name —
   keep highest-install-count winner per name.
4. Drop any skill whose name overlaps with the ALREADY INSTALLED lists.

Return a ranked list of up to 12 candidate skills, each with:
- name (in `<owner>/<repo>@<skill>` format)
- one-line description
- install count
- source repo URL on github.com
- skills.sh URL

DO NOT install anything. Just return the consolidated list.
```

Wait for find-skills to return the list.

**Log:** append to buffer:
````markdown
## 5. Prompt sent to find-skills
<full prompt verbatim, wrapped in ``` for readability>

## 5b. find-skills raw response
<the list returned, with name + install count per entry — keep it terse, one line per>
````

## Step 6: Deduplicate and validate the suggestion list (safety net)

find-skills should follow the instructions in step 5 — but it may not perfectly, and skills.sh registry data can be stale (listed skills that no longer exist in their source repos). Apply these defensive passes:

**Pass 1 — Drop already-installed.** For each candidate, match against the installed inventory from step 3 (both skills and agents):
- exact skill-name match against installed skills
- exact name match against installed agents (a `code-review` skill is redundant if a `code-review` agent exists locally)

Drop candidates that match.

**Pass 2 — Dedup exact identifier.** Group remaining candidates by their full `<owner>/<repo>@<skill-name>`. Same identifier appearing twice → keep one (the entry with higher install count if metadata differs).

**Pass 3 — Dedup by skill-name across sources.** Group remaining candidates by just `<skill-name>`. Different `<owner>/<repo>` provide a skill with the same name → keep only the highest-install-count one. Drop the rest silently.

**Pass 4 — Verify source exists upstream (soft-fail).** skills.sh caches listings; the source repo may have removed/renamed the skill since indexing. For each remaining candidate, probe **multiple common layouts** in the source repo via `gh` API. Real-world skill repos use varied directory structures — narrow probes cause false-negatives that throw out valid skills.

Try these paths in order (stop at first 2xx):

```bash
# Standard layouts
gh api repos/<owner>/<repo>/contents/skills/<skill>/SKILL.md --silent
gh api repos/<owner>/<repo>/contents/<skill>/SKILL.md --silent

# Plugin-style (e.g. trailofbits/skills)
gh api repos/<owner>/<repo>/contents/plugins/<skill>/SKILL.md --silent
gh api repos/<owner>/<repo>/contents/plugins/<skill>/skills/<skill>/SKILL.md --silent

# Categorized layouts (e.g. mattpocock/skills uses skills/<category>/<name>/)
# Probe one level of category nesting:
gh api repos/<owner>/<repo>/contents/skills --jq '.[].name' --silent | xargs -I{} \
  gh api repos/<owner>/<repo>/contents/skills/{}/<skill>/SKILL.md --silent

# Custom-deep layouts (e.g. davila7/claude-code-templates) — single-shot search
gh search code "filename:SKILL.md path:<skill>" --repo <owner>/<repo> --limit 1 --json path
```

**Soft-fail rule.** If ALL probes return non-200 / empty:
- **DO NOT drop the candidate.** False-negative is worse than letting a stale entry try-and-fail at install.
- Mark it as `possibly-stale` in the log section 6.
- Keep it in the candidate list so it appears in the interview.
- The user may still want to try it. If genuinely stale, `npx skills add` at step 8 will fail, and our install rule "report and continue" handles that gracefully.

Only DROP from candidates if you positively confirm the listing is stale via authoritative signal — for example, the skills.sh page returns 404 entirely (the listing itself was removed). Layout-based probes are too noisy to drop on alone.

If `gh` is not installed or not authenticated, **skip Pass 4 silently** — don't block on this defensive check.

After all four passes, the candidate list should be clean (Pass 1-3) and source-checked (Pass 4 soft). Use it for the interview.

**Log:** append to buffer:
```markdown
## 6. Dedup outcomes
- Pass 1 (already-installed): dropped <N> — <names>
- Pass 2 (exact id): dropped <N>
- Pass 3 (skill-name dedup): dropped <N>
- Pass 4 (source-validate soft): kept all <N>; marked possibly-stale: <N> — <names with probed paths>
- Final candidates: <N>
```

Pass 4 only drops on authoritative stale signal (skills.sh listing 404). Layout probe misses are logged as `possibly-stale` but kept.

## Step 7: Interview — one question per skill

### 7a — Resolve ambiguous categories first (if any)

Before per-skill questions, if step 4.5 marked any categories as `<name>/ambiguous`, ask the user to pick a sub-type via `AskUserQuestion`. Up to 4 ambiguous categories per call.

For each ambiguous category:
- **Question:** `Which type of <category> are you working with?`
- **Header:** `<category>` (e.g. `i18n`, `testing`)
- **Options** (single-select, sub-types from the registry):
  - `<sub-type-1>` — description: short explanation, e.g. for `i18n`: "Translate UI code strings (gettext-style)"
  - `<sub-type-2>` — description: e.g. "Translate documentation pages (mkdocs-i18n, sphinx-intl)"
  - `Both` — description: "Show me suggestions for both."
  - `Skip category` — description: "Don't suggest anything in this area."

Filter the candidate list: keep only skills whose primary sub-type matches the user's pick. Drop the rest.

### 7b — Per-skill questions

For each remaining candidate skill, ask the user using `AskUserQuestion`. **One question per skill**, batched in groups of 4 (AskUserQuestion supports up to 4 questions per call).

Per-skill question shape:
- **Question:** `Install <skill-name>?`
- **Header:** `<short-tag>` (max 12 chars — e.g. "pytest", "dicom", "pydantic")
- **Options** (single-select):
  - `Install (Recommended)` if install count > 10K, else just `Install` — description: `<one-line desc>. https://skills.sh/<owner>/<repo>/<skill>`
  - `Skip` — description: `Don't install this one.`

The user reads the description (which includes the skills.sh URL) before choosing. They can open the URL to learn more before answering.

**Track outcomes.** Keep two lists for use in step 10:
- `installed[]` — skills the user chose `Install` for
- `skipped[]` — skills the user chose `Skip` for, with full identifier (`<owner>/<repo>@<skill>`)

**Log:** append to buffer:
```markdown
## 7. Interview results
- Installed: <list of <owner/repo@skill>>
- Skipped: <list of <owner/repo@skill>>
```

If step 7a ran (ambiguous categories resolved by user), include those answers too:
```markdown
## 7a. Ambiguity resolutions
- <category> → user picked <sub-type>
```

## Step 8: Install selected skills

For each skill the user chose `Install` for:

```bash
npx skills add <owner/repo@skill-name> -y
```

Notes:
- **No `-g` flag** — install project-local into `.claude/skills/<name>/`.
- `-y` suppresses interactive confirmation from the `skills` CLI (we already got user consent in step 7).
- Run each install in its own Bash invocation. If one fails, report the error and continue with the next — do not abort the whole flow.

**Log:** append to buffer:
```markdown
## 8. Install outcomes
- <owner/repo@skill>: OK (<install duration if available>)
- <owner/repo@skill>: FAILED — <error one-liner>
```

## Step 9: Final reminder

After all installs complete, report a summary and remind about reload:

```
✓ Installed N skills.

Run `/reload-plugins` to activate them. The skills will appear under
their plugin namespaces (e.g. /skill-name).

iEvo is set up. From here:
- Use the skills you just installed
- Record lessons with /ievo:evolution "<your lesson>"
- Update later with /ievo:update
```

## Step 10: Invite feedback (especially on rejections)

Init is a complex flow. Worth asking how it went — and especially **why** the user skipped specific suggestions, since that's the best signal for improving find-skills recommendations and the skills.sh registry quality.

The prompt adapts based on how the interview went:

### If the user skipped at least one skill

Use `AskUserQuestion`:

- **Question:** `You skipped <M> of <N> suggested skills. Share why?`
- **Header:** `Feedback`
- **Options** (single-select):
  - `Share rejection reasons` — description: `For each skipped skill, pick a reason (Not relevant / Already using alt / Low quality / Don't need now). Submitted as public issue to github.com/ievo-ai/skills with registry-quality label so vercel-labs can improve their recommendations too.`
  - `General feedback` — description: `Skip the per-skill breakdown, just share a general note.`
  - `Skip` — description: `Maybe later.`

If `Share rejection reasons` → activate the `feedback` skill with this prompt:

```
Use the feedback skill in REJECTIONS flow (flow B).

Skipped skills (with metadata):
<list of <owner>/<repo>@<skill> with one-line description each>

Installed skills:
<list of <owner>/<repo>@<skill>>

Collect a structured rejection reason for each skipped skill and submit
to ievo-ai/skills with labels `feedback` + `registry-quality`.
```

If `General feedback` → activate the `feedback` skill with the default flow A prompt (no rejections context).

### If the user installed everything (no skips)

Use `AskUserQuestion`:

- **Question:** `Init completed cleanly — anything to add?`
- **Header:** `Feedback`
- **Options** (single-select):
  - `Share feedback` — description: `Bug, idea, or suggestion. Submitted as public issue to github.com/ievo-ai/skills.`
  - `Skip` — description: `Maybe later.`

If `Share feedback` → activate the `feedback` skill (flow A).

### In both cases

If the user picks `Skip`, do nothing — init is done.

## Step 11: Write the run log

Write the buffer accumulated through this run to `.ievo/log/init-<YYYYMMDD-HHMMSS>.md`.

In the final user-facing summary, mention the log path so the user knows where to look:

```
Init log written to .ievo/log/init-20260517-143200.md

If you hit a bug or want to share specific feedback about why /ievo:init
made certain suggestions, attach this log when filing — it captures the
exact prompt, find-skills response, dedup outcomes, and your choices.
You can attach it automatically via /ievo:feedback.
```

### Logs gitignore note (one-time, idempotent)

Check the project's root `.gitignore` for `.ievo/log/` (or similar covering pattern like `.ievo/`). If neither matches, add a line:

```
# iEvo diagnostic logs (local-only; do not commit)
.ievo/log/
```

If the project has no `.gitignore` at all, do **not** create one — the user may not be using git, or may want their own structure. Just mention in the summary: "Consider adding `.ievo/log/` to your .gitignore — these logs contain run metadata only, but are intended for local debugging, not version control."

## Rules

- **Hard prereq, no auto-install of find-skills.** Reload requirement makes auto-install bad UX.
- **Always parse dependencies.** Don't delegate stack detection to find-skills's surface scan — explicit dep list is the strongest signal and catches libraries like SimpleITK, VTK, pytest, mypy that surface scans miss.
- **One consolidated list.** Tell find-skills to merge parallel queries before ranking. Our dedup is safety net, not primary defense.
- **One question per skill.** No multi-select batch — user makes informed per-skill decisions with URLs visible.
- **Project-local only.** Never use `-g`. iEvo is per-project by design.
- **Do not touch CLAUDE.md/AGENTS.md.** Those files only get a marker block when the first project-specific evolution is recorded — that is the `evolution` skill's job, not init's.
- **Idempotent re-runs.** If the user runs `/ievo:init` again, dirs already exist (fine), and the inventory check filters out already-installed candidates — only NEW relevant skills surface.
