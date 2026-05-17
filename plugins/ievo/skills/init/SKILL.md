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
- `.claude/` — required by `npx skills add` for project-local installs (without it, the Claude Code symlinks are silently skipped — see vercel-labs/skills bug reports)

Do not touch `CLAUDE.md` or `AGENTS.md` here. They are only modified on the first project-specific evolution.

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
2. Cover these categories (skip any that don't apply to this project):
   - Language/runtime fundamentals (e.g. python-pro for Python, typescript-pro for TS)
   - Testing framework (e.g. pytest, jest, junit, go test, cargo test)
   - Linting & typing (e.g. mypy, ruff, eslint, prettier, golangci-lint, clippy)
   - Build/package tools (uv, poetry, npm, yarn, pnpm, cargo, gradle)
   - Each LIBRARY in the dependencies list (search each one — e.g. SimpleITK,
     VTK, pydicom, fastapi, react — return skills covering them)
   - Domain-specific based on project content (e.g. medical imaging, finance,
     game dev) — but only if a signal supports it
   - Security & compliance if project handles sensitive data
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

## Step 6: Deduplicate the suggestion list (safety net)

find-skills should follow the instructions in step 5 — but it may not perfectly. Apply this defensive dedup:

**Pass 1 — Drop already-installed.** For each candidate, match against the installed inventory from step 3 (both skills and agents):
- exact skill-name match against installed skills
- exact name match against installed agents (a `code-review` skill is redundant if a `code-review` agent exists locally)

Drop candidates that match.

**Pass 2 — Dedup exact identifier.** Group remaining candidates by their full `<owner>/<repo>@<skill-name>`. Same identifier appearing twice → keep one (the entry with higher install count if metadata differs).

**Pass 3 — Dedup by skill-name across sources.** Group remaining candidates by just `<skill-name>`. Different `<owner>/<repo>` provide a skill with the same name → keep only the highest-install-count one. Drop the rest silently.

After all three passes, the candidate list should be clean. Use it for the interview.

## Step 7: Interview — one question per skill

For each candidate skill, ask the user using `AskUserQuestion`. **One question per skill**, batched in groups of 4 (AskUserQuestion supports up to 4 questions per call).

Per-skill question shape:
- **Question:** `Install <skill-name>?`
- **Header:** `<short-tag>` (max 12 chars — e.g. "pytest", "dicom", "pydantic")
- **Options** (single-select):
  - `Install (Recommended)` if install count > 10K, else just `Install` — description: `<one-line desc>. https://skills.sh/<owner>/<repo>/<skill>`
  - `Skip` — description: `Don't install this one.`

The user reads the description (which includes the skills.sh URL) before choosing. They can open the URL to learn more before answering.

## Step 8: Install selected skills

For each skill the user chose `Install` for:

```bash
npx skills add <owner/repo@skill-name> -y
```

Notes:
- **No `-g` flag** — install project-local into `.claude/skills/<name>/`.
- `-y` suppresses interactive confirmation from the `skills` CLI (we already got user consent in step 7).
- Run each install in its own Bash invocation. If one fails, report the error and continue with the next — do not abort the whole flow.

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

## Step 10: Invite feedback

Init is a complex flow with lots of moving parts (find-skills, interview, installs). Worth asking how it went so we can improve the next version. Use `AskUserQuestion`:

- **Question:** `How did the iEvo init flow go for you?`
- **Header:** `Feedback`
- **Options** (single-select):
  - `Share feedback` — description: `Open the feedback skill and post a public issue to github.com/ievo-ai/skills (bug, idea, or suggestion).`
  - `Skip` — description: `Maybe later.`

If the user picks **Share feedback**, activate the `feedback` skill via natural prompt:

```
Use the feedback skill to collect the user's feedback about /ievo:init
and submit it as a GitHub issue.
```

The `feedback` skill handles the rest — type classification, text collection, public-post confirmation, gh CLI submission.

If the user picks **Skip**, do nothing — init is done.

## Rules

- **Hard prereq, no auto-install of find-skills.** Reload requirement makes auto-install bad UX.
- **Always parse dependencies.** Don't delegate stack detection to find-skills's surface scan — explicit dep list is the strongest signal and catches libraries like SimpleITK, VTK, pytest, mypy that surface scans miss.
- **One consolidated list.** Tell find-skills to merge parallel queries before ranking. Our dedup is safety net, not primary defense.
- **One question per skill.** No multi-select batch — user makes informed per-skill decisions with URLs visible.
- **Project-local only.** Never use `-g`. iEvo is per-project by design.
- **Do not touch CLAUDE.md/AGENTS.md.** Those files only get a marker block when the first project-specific evolution is recorded — that is the `evolution` skill's job, not init's.
- **Idempotent re-runs.** If the user runs `/ievo:init` again, dirs already exist (fine), and the inventory check filters out already-installed candidates — only NEW relevant skills surface.
