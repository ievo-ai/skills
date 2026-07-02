# iEvo — Skill Coverage Audit

This file maps the user-facing workflows iEvo supports to the skills, agents, scripts, and commands that implement them. Use it before adding a new skill to confirm the workflow isn't already covered, and to spot gaps as candidates for the next release.

Pattern adopted from [`DenisSergeevitch/agents-best-practices/references/coverage-audit.md`](https://github.com/DenisSergeevitch/agents-best-practices/blob/main/references/coverage-audit.md) — credit upstream.

## Required coverage map

| User intent | Skill / Command / Agent | Script | Status | Notes |
|---|---|---|---|---|
| Set up iEvo in a new project | `/ievo:init` | `discover.mjs`, `scan_repo.mjs` | covered | 6-stage pipeline: discover → index → categorical rank → interview → security-auditor → install. `validate_agents.mjs` is NOT invoked by init — it runs via CI gate + pre-commit only; see "Validate agent frontmatter" row below. |
| Discover relevant skills/agents from skills.sh | (used by `/ievo:init`) | `discover.mjs` | covered | Parallel API queries with reputation boost + install thresholds inherited from find-skills SKILL.md |
| Index a single GitHub repo for plugin/agent/skill enumeration | `/ievo:index-repos` | `scan_repo.mjs` | covered | Standalone; also dispatched in parallel by `/ievo:init` per discovered repo |
| Audit a specific skill/agent/plugin for safety | `/ievo:security-check` | — (LLM body in `security-check/SKILL.md` + `security-auditor` agent) | covered | Senior-security-engineer threat model; GREEN/YELLOW/RED verdict + cited evidence; Sonnet-tier reasoning required |
| Run security audits in parallel for selected items | (`security-auditor` agent, dispatched by `/ievo:init` Step 8) | — | covered | One agent instance per selected item; reads full content + dependencies |
| Vendor a skill/agent from a remote repo into the project | (`/ievo:init` install step) | — | covered | `gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>` → Write tool → `.claude/<type>/` + overlay marker + source SHA recorded in `.ievo/evolution/<scope>/<name>.md` |
| Configure lifecycle notification hooks (init-complete, security-red, evolution-captured) | `/ievo:hooks-setup` | — | covered | exec-form `args: string[]` `Write(...)` matcher hooks; `terminalSequence` for desktop notifications (v2.1.141+); project + global scope |
| Notify when all background agents are complete (parallel subagents from `/ievo:init`) | `/ievo:hooks-setup` (Step 5.5, optional) | `.ievo/hooks/scripts/on-stop.sh` | covered | Read-side Stop hook using `background_tasks` + `session_crons` (Claude Code v2.1.145+); non-blocking (exits 0); macOS/Linux/bell/custom notification commands; structurally distinct from the three write-side PostToolUse signal-file hooks |
| Capture a lesson / convention / mistake-prevention rule | `/ievo:evolution "<lesson>"` | — | covered | Appends to `.ievo/evolution/<scope>/<name>.md` overlay file; agent/skill body never modified |
| Submit feedback / bug report / skip-reason as a GitHub issue | `/ievo:feedback` | — | covered | Write tool → `.ievo/log/pending-reports/feedback-body-<ISO>.md` → `gh issue create --body-file <path>` (shell-safe, no inline interpolation surface) |
| Enable verbose / trace-level logging | `/ievo:debug-on` | — | covered | Writes `.ievo/debug.flag`, creates per-session log dir, future skill invocations log expanded payloads |
| Disable verbose logging + finalise debug session | `/ievo:debug-off` | — | covered | Removes the flag, archives the session log |
| Remove iEvo overlay markers from a project | `/ievo:uninstall` | — | covered | Glob + Edit + Bash (`grep -l` marker discovery); preserves `.ievo/` |
| Refresh vendored agent/skill files from upstream | `/ievo:update` | — | covered | Re-fetches by recorded source SHA; re-injects overlay markers; overlay files untouched |
| Validate agent frontmatter (vendor-neutral `model:`, required fields) | (CI gate + local pre-commit) | `validate_agents.mjs` | covered | 100% test coverage; blocks `claude-*` / `gpt-*` / `gemini-*` vendor-pinned IDs |
| Validate SKILL.md frontmatter (agentskills.io spec constraints) | (CI gate + local pre-commit) | `validate_skills.mjs` | covered | 100% test coverage; enforces name format/length, description ≤1024, compatibility ≤500, no vendor model IDs |
| Enforce 100% test coverage on all Node scripts | `coverage-gate.yml` workflow | `check-coverage.mjs` | covered | All three scripts (`discover.mjs`, `validate_agents.mjs`, `scan_repo.mjs`) at literal 100/100/100 as of v0.6.7; `CARVE_OUTS` map empty |
| Detect 5 markdown/text hygiene anti-patterns at commit time | `pre-commit-gate.yml` workflow + `.pre-commit-config.yaml` | `.github/scripts/validators/*.mjs` | covered | nested-fences, machine-local-paths, crlf-frontmatter, placeholder-leakage, validate-agents |
| Surface a code-review verdict on every PR | `notify-eva.yml` workflow (Eva-side review) | — | covered | Dispatches a review request to the private Eva repo once both product gates are green; Eva posts the review and auto-merges Eva-authored PRs (D-004 Phase 2, skills#274/#277) |
| Generate a domain-specific MVP harness blueprint for a new agent project | — | — | **gap** | iEvo discovers + audits + installs existing skills; doesn't generate new skill bodies from a domain prompt. Out of scope for v0.6.x; could be a future `/ievo:scaffold` skill. |
| Pin a release with auto-generated changelog from commits | `release-please.yml` workflow | — | covered | Automated via release-please (shipped v0.7.0+): conventional commit prefixes (`feat:` → minor, `fix:` → patch) drive a persistent Release PR that bumps all 4 version files atomically. |
| Cortex A/B validation gate for evolution proposals | — | — | **planned (v0.7.0)** | Per the AGENTS.md roadmap |
| GitHub search source in `discover.mjs` for agent-only / plugin-only repos | — | (`discover.mjs` extension) | **planned (v0.7.0)** | Per the AGENTS.md roadmap |
| Schedule periodic iEvo operations via Claude Code Routines | `/ievo:schedule` | — | covered | Guided wizard: operation type + frequency + routine creation. Falls back to CI cron when Routines unavailable. Claude Code only (Routines require Pro/Max/Team/Enterprise + v2.1.149+). |
| Standalone "list installed iEvo overlays" command | `/ievo:overlay-status` | — | covered | Reads `.ievo/evolution/`, groups by scope (Project / agents / skills) matching the actual layout written by `evolution/SKILL.md` (`project.md` flat file, plus `agents/<name>.md` and `skills/<name>.md` subdirs); extracts one-line summary per file with last-modified date; flags overlays untouched 180+ days as candidates for cleanup; pure Read + Glob + `stat` (Bash limited to `stat` for mtime; Windows-without-POSIX hosts gracefully omit dates) |
| Scan project source code for vulnerabilities (CWE-aware, exploit-chain validated) | `/ievo:vuln-scan` | — (`vuln-scan/SKILL.md` per-module worker + `vuln-scanner` agent dispatched in parallel) | covered | Glasswing-inspired: Step 1 reads all source files, Step 2 maps data flows, Step 3 detects via CWE taxonomy, Step 4 validates with exploit chains (no chain = no finding). Sonnet-tier reasoning required; parallel module dispatch via Task tool. |
| Inspect a specific skill/repo before running init | `/ievo:inspect` | — (pure SKILL.md, `gh api` for remote data) | covered | Fetches repo tree + key file frontmatter via GitHub API; renders structured capability summary (skills, agents, commands, scripts, hooks, permissions); read-only, no install, no security scan |
| Standalone "show next-step suggestions based on installed skills" | — | — | gap | Adjacent to evolution capture but discovery-oriented |

## Required language and scope checks

- iEvo skills are provider-neutral: agent `model:` fields use `sonnet`/`opus`/`haiku`/`inherit` aliases only (enforced by `validate_agents.mjs`).
- iEvo skills run on any agentskills.io-compatible platform; Claude Code / Codex-specific bits (Task tool sub-agent isolation, slash commands) are documented as such in each skill's `compatibility:` field.
- iEvo never modifies agent or skill bodies during evolution — lessons live in overlays.
- iEvo never auto-installs RED-verdict candidates; always explicit user choice.
- iEvo never falls back to owner-based trust shortcuts; reputation is not security.
- iEvo's CI gate enforces literal 100/100/100 coverage on every `.mjs` in `plugins/ievo/scripts/`; the `CARVE_OUTS` map is empty as of v0.6.7.

## Minimum file set

```text
ievo-ai/skills/
  AGENTS.md
  README.md
  coverage-audit.md            ← this file
  .github/
    workflows/
      notify-eva.yml
      coverage-gate.yml
      pre-commit-gate.yml
      release-please.yml
    scripts/
      check-coverage.mjs
      validators/
        nested-fences.mjs
        machine-local-paths.mjs
        crlf-frontmatter.mjs
        placeholder-leakage.mjs
  .pre-commit-config.yaml
  plugins/ievo/
    .claude-plugin/plugin.json
    agents/
      evolution.md
      repo-indexer.md
      security-auditor.md
      vuln-scanner.md
    commands/
      uninstall.md
      update.md
      vuln-scan.md
    scripts/
      discover.mjs
      scan_repo.mjs
      validate_agents.mjs
      validate_skills.mjs
      tests/                   ← 100/100/100 enforced by CI
    skills/
      init/SKILL.md
      evolution/SKILL.md
      feedback/SKILL.md
      debug-on/SKILL.md
      debug-off/SKILL.md
      hooks-setup/SKILL.md
      inspect/SKILL.md
      overlay-status/SKILL.md
      index-repos/SKILL.md
      schedule/SKILL.md
      security-check/SKILL.md
      vuln-scan/SKILL.md
```

## How to update this file

- New skill / agent / command lands → add a row, mark `covered`.
- New script lands → add its test status (must be 100/100/100 per AGENTS.md compliance ledger).
- New user-intent identified but not yet implemented → add a row, mark `gap` with one-line notes.
- New roadmap entry in AGENTS.md → add a row, mark `planned (vX.Y.Z)`.
- Anything removed → strike the row through (don't delete — record it).

This file is part of the PR review surface; updates ship with the same release that adds the covered/gapped item.
