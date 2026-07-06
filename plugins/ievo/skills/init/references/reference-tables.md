# Init reference tables

Static lookup tables for `/ievo:init`. Loaded on demand at the step that needs
them (Step 4 manifest parsing, Step 7b categorization). These are data, not
flow — the `SKILL.md` body links here at the relevant step.

---

## Manifest reference (Step 4 — detect stack + deps)

For each manifest found, extract direct (top-level) dependency names. Tag deps
with their source manifest for polyglot projects.

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

---

## Category assignment (Step 7b — categorize each candidate)

Assign each candidate to ONE primary category based on its name + description.
If it fits multiple, pick the **most specific** one.

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
| `agent-tooling` | code-reviewer, refactor-pro, test-writer, codebase-audit/planning-advisor tools like shadcn/improve (general-purpose dev agents — includes read-only auditors that produce plans/findings, not implementers) |
| `domain-specific` | stripe-pro, openai-pro, slack-bot (specific to a dep in step 4) |
| `other` | anything not fitting above |
