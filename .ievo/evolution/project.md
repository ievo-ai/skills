# Project — Evolution Overlay

(project-wide rules accumulated here; loaded into context via marker block in CLAUDE.md/AGENTS.md)

## 2026-08-08 07:33 UTC — Run the actual version-bump gate script, don't eyeball its trigger scope
**Trigger:** agent self-observed mistake during autonomous PR build (ievo-ai/skills#599)

When reproducing this repo's CI gates locally before opening a PR, `check-version-bump.mjs` (wired into `pre-commit-gate.yml`) triggers on ANY changed path under `plugins/ievo/**` OR `.claude-plugin/**` — not just direct edits to `.claude-plugin/plugin.json` itself. I initially checked only `git diff --name-only main -- 'plugins/ievo/**/.claude-plugin/**'` (a narrow glob for `.claude-plugin` subdirectories) and concluded no version bump was needed, because my diff only touched `plugins/ievo/scripts/scan_repo.mjs` and its test file — but that path IS under `plugins/ievo/**`, which is exactly the trigger prefix. Root cause: I conflated "does this diff touch a `.claude-plugin/` manifest file" with "does this diff touch anything under `plugins/ievo/**`" — the gate's actual condition is the latter (broader), and I substituted a narrower informal check instead of reading `.github/scripts/check-version-bump.mjs`'s own `PLUGIN_PATH_PREFIXES` / actually running the script with `GITHUB_EVENT_NAME=pull_request BASE_SHA=<merge-base> node .github/scripts/check-version-bump.mjs`. This was caught by an `/ievo:deep-review` pass on the diff before the PR opened, not by my own gate reproduction.

Apply next time: for any repo with a version-bump/path-scoped CI gate, always run the ACTUAL gate script locally (simulating its real trigger env vars if it self-skips outside CI, e.g. `GITHUB_EVENT_NAME=pull_request`) rather than approximating its trigger condition by eye, especially when the condition is a path-prefix check broader than the specific file changed.
