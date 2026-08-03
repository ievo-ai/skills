# iEvo — Self-Evolving Plugin for AI Coding Agents

> ⚠️ **Alpha** — iEvo is in active early development (see [`marketplace.json`](.claude-plugin/marketplace.json) for the current version — this file is not the source of truth and goes stale between releases). The pipeline works end-to-end and individual skills are tested, but APIs, file layouts, and behaviour can change between minor versions. Pin to a specific `marketplace.json` version if you need stability. v1.0 will be the first stable release.

> Discover relevant skills + agents for your project, audit them via senior-security-engineer review (deep content scan + threat modeling, no owner-based trust shortcuts), install with project-scope portability. Capture lessons as overlays that survive upstream updates. Works on Claude Code, Codex, and any platform that supports the [agentskills.io](https://agentskills.io) standard.

iEvo is a **universal discovery + safety + evolution layer** on top of [skills.sh](https://www.skills.sh) and the multi-platform agent skills ecosystem.

**Currently distributed via:**
- Claude Code marketplace (`.claude-plugin/marketplace.json`)
- Codex marketplace (`.codex-plugin/marketplace.json`)
- skills.sh registry (planned for v1.0)

**Cross-platform skills** inside the plugin are portable via the [agentskills.io specification](https://agentskills.io/specification) — adopted by Claude Code, Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms. Platform-specific bits (slash commands, sub-agents via Task tool) work on Claude Code and Codex.

> **Always type the full `ievo:` prefix** (e.g. `/ievo:feedback`, not a bare `feedback`). Some non-CLI Claude surfaces don't autocomplete-suggest this prefix, and a bare name can silently resolve to an unrelated built-in command instead — e.g. Claude Code's own `/feedback` (aliases `/bug`, `/share`). The qualified name always resolves correctly; a bare name may not.

## Contents

- [Quick start](#quick-start)
- [The pipeline](#the-pipeline)
- [Commands & Skills](#commands--skills)
- [The overlay model](#the-overlay-model)
- [Project-side layout](#project-side-layout)
- [Security model](#security-model-v052--senior-security-engineer-vulnerability-assessment)
- [Install paths](#install-paths)
- [Repository structure](#repository-structure)
- [Standards compliance](#standards-compliance)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## Quick start

### Claude Code

```bash
# 1. Install iEvo plugin (zero prereqs — v0.6.0 dropped the find-skills install step)
/plugin marketplace add ievo-ai/skills
/plugin install ievo@ievo-skills
/reload-plugins

# 2. Initialize in your project
cd <your-project>
/ievo:init
```

**v0.6.0**: discovery now happens via our own `discover.mjs` script hitting `https://skills.sh/api/search` directly — no more manual `npx skills add` step required.

### Choosing an install scope

The Quick Start above uses the interactive `/plugin install`, which prompts you to pick a scope. **User** scope makes iEvo available to you across every project; two other scopes cover different situations:

| Scope | Settings file | Use when |
|-------|----------------|----------|
| `user` (CLI default) | `~/.claude/settings.json` | Personal use across all your projects. |
| `project` | `.claude/settings.json` | You want the whole team to get iEvo automatically — committed to git, so collaborators are prompted to trust + install it on `git pull` (see *iEvo bootstraps itself for teammates* below). |
| `local` | `.claude/settings.local.json` | Just you, just this repo — e.g. trying iEvo on a shared/team project without affecting collaborators. Gitignored by default. |

Interactively, `/plugin install ievo@ievo-skills` (or `/plugin` → **Discover**) prompts you to pick a scope. Non-interactively (CI, scripting), use the `claude plugin install` shell form instead — it installs to `user` scope unless you pass `--scope`:

```bash
claude plugin install ievo@ievo-skills --scope project   # shared with the team
claude plugin install ievo@ievo-skills --scope local     # this machine, this repo only
```

See [Plugin installation scopes](https://code.claude.com/docs/en/plugins-reference#plugin-installation-scopes) for the full explanation, including the read-only `managed` scope set by organization admins.

### Developer install (git clone, no marketplace)

Prefer a live git checkout over the marketplace? Claude Code v2.1.157+ auto-loads plugins placed under `.claude/skills/` without any marketplace registration. This repo's plugin root is `plugins/ievo/` (the repo root itself only holds the marketplace manifest), so clone to a scratch location and symlink the plugin directory in — cloning straight to `~/.claude/skills/ievo` would nest the plugin one level too deep and silently fail to load:

```bash
git clone https://github.com/ievo-ai/skills.git ~/ievo-skills-src
ln -s ~/ievo-skills-src/plugins/ievo ~/.claude/skills/ievo
# Requires Claude Code v2.1.157+ — auto-loads, no /plugin marketplace add needed

cd <your-project>
/ievo:init
```

To update: `cd ~/ievo-skills-src && git pull` (the symlink stays valid). This is the recommended path for contributors tracking `main` directly; most users should use the marketplace install above instead, which brings routine version pinning and update prompts.

**Monorepo note (Claude Code v2.1.178+).** In a monorepo where a subdirectory also has its own nested `.claude/skills/`, Claude Code auto-loads those nested skills while you're working in that subtree. A name clash between the nested skill set and another already-loaded one is disambiguated with CC's own `<dir>:<skill-name>` qualified form — iEvo's skills stay plain `/ievo:<skill-name>` whenever no clash applies, which is the common case. Non-interactive runs (CI, Routines) on v2.1.178+ no longer hit extra permission prompts for directory-qualified nested skills, a bug present in earlier versions.

### Codex (CLI / app / VS Code extension)

```bash
# 1. Add the iEvo marketplace
/plugins add ievo-ai/skills

# 2. Install
/plugins install ievo@ievo-skills

# 3. Initialize in your project
cd <your-project>
/ievo:init
```

Codex support added in v0.3.3 — same plugin content, separate marketplace manifests (`.claude-plugin/marketplace.json` vs `.codex-plugin/marketplace.json`).

**Cursor (v3.9+):** install iEvo from Cursor's unified Customize page by adding this repo's URL — iEvo has no `.cursor-plugin/` manifest yet, so it is added by URL rather than surfaced in Cursor's own marketplace search ([Cursor changelog, 2026-06-22](https://cursor.com/changelog/customize)).

### Keep iEvo up to date

iEvo ships as a Claude Code / Codex **plugin**, so let the host keep it current instead of manually re-installing.

**Claude Code — enable native auto-update (recommended).** Third-party marketplaces like iEvo have plugin auto-update **disabled by default** — only Anthropic's official marketplace auto-updates out of the box ([plugins docs](https://code.claude.com/docs/en/discover-plugins#configure-auto-updates)). Turn it on once and Claude Code refreshes the marketplace and updates the iEvo plugin at startup, then prompts you to run `/reload-plugins`:

1. Run `/plugin`
2. Open the **Marketplaces** tab
3. Select the `ievo-skills` marketplace
4. Choose **Enable auto-update**

For **team / managed installs**, an administrator can set `"autoUpdate": true` on the iEvo entry in `extraKnownMarketplaces` (managed settings) so everyone gets updates without toggling:

```json
{
  "extraKnownMarketplaces": {
    "ievo-skills": {
      "source": { "source": "github", "repo": "ievo-ai/skills" },
      "autoUpdate": true
    }
  }
}
```

With auto-update off you can still update manually by re-running `/plugin install ievo@ievo-skills` (then `/reload-plugins`). To keep plugin auto-updates while disabling Claude Code's own updater, set `FORCE_AUTOUPDATE_PLUGINS=1` alongside `DISABLE_AUTOUPDATER`.

> **Optional nudge.** If you prefer to keep auto-update off, `/ievo:hooks-setup` can install a fail-silent `SessionStart` hook that checks the marketplace at most once per day and — only when your installed version is behind — reminds you to update. See [hooks-setup](plugins/ievo/skills/hooks-setup/SKILL.md).

**Codex** tracks plugin versions via git refs/tags in the marketplace `source` block — re-run the marketplace add/install to pick up a newer ref immediately. Codex *also* upgrades configured git marketplaces (iEvo's included) on a best-effort basis at session startup, so a newer iEvo release can land with no manual action: the startup task activates the new marketplace revision and reinstalls the plugin cache ([openai/codex#17425](https://github.com/openai/codex/pull/17425), merged 2026-04-16; observed with no manual upgrade on codex-cli 0.142.5 in [openai/codex#31383](https://github.com/openai/codex/issues/31383)). That reinstall prunes the superseded versioned cache directory — read § *Known configuration gotcha — Codex plugin auto-upgrade and an already-open task* below before invoking an `ievo:*` skill in a task that was already open when it happened.

### iEvo bootstraps itself for teammates (Claude Code, plugin-mode)

Once one teammate has run `/ievo:init` in a project, it self-registers iEvo's own `ievo-skills` marketplace + `ievo@ievo-skills` plugin entry into the committed `.claude/settings.json` — the same team-portable mechanism `/ievo:init` already uses for discovered candidates. Everyone else who `git pull`s the project gets prompted by Claude Code to trust and install iEvo automatically; no more manual `/plugin install` on every machine. `autoUpdate` is left off by default (see above for the manual opt-in). This only applies when iEvo is running as an installed plugin — a vendored copy has no marketplace entry to register. **Codex:** not yet possible — project-level plugin config isn't persisted upstream today ([openai/codex#18115](https://github.com/openai/codex/issues/18115)).

**Cross-platform skills inside the plugin** are fully portable via [agentskills.io](https://agentskills.io) spec. Slash commands and sub-agents work on Claude Code; Codex's own command/agent semantics may differ — refer to your platform's docs for exact behavior of the commands.

> **Always type the full `ievo:` prefix** (e.g. `/ievo:feedback`) in non-CLI Claude surfaces — autocomplete there doesn't reliably suggest the prefix, and a bare skill name can silently resolve to an unrelated built-in command instead.

`/ievo:init` will ask you to add Bash permissions for `gh` commands on first run — say yes (`Add to .claude/settings.local.json` recommended) to avoid each network call needing manual approval.

That's it. Interactive interview, security checks, install. Then `/reload-plugins` to activate.

### Migrating from Claude Code → Codex (or back)

Already running iEvo on one platform and switching to the other? Your iEvo state is **already portable** — `.ievo/evolution/` overlays, the repo index, and config are plain files on the shared filesystem, platform-agnostic by design. You do **not** need a fresh `/ievo:init`:

1. On Codex, run `codex /import` (Codex `v0.140.0+`) to bring over your Claude Code project configuration (plugin state, recent context).
2. Install the iEvo plugin on the new platform if it isn't already (marketplace add + install above).
3. Your `.ievo/evolution/` overlays and `.ievo/cache/index/` transfer automatically — **skip `/ievo:init`**; run `/ievo:evo`, `/ievo:security-check`, or `/ievo:index-repos` directly when you want to refresh.

`/ievo:init` also detects pre-existing `.ievo/evolution/` state on startup and tells you it's already active, so re-running it after a migration won't clobber your overlays.

### Permission pre-setup (optional, skips the prompt)

If you want to set permissions before running `/ievo:init`, add to `.claude/settings.local.json` (per-user, gitignored — recommended) or `.claude/settings.json` (team-shared, committed):

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

Without these, Claude Code's auto-mode classifier blocks each `gh api` call as "untrusted network command" — works but with manual Allow prompts. (v0.6.0 dropped the previously-required `npx skills` permission since discovery now happens via local Node script.) CC v2.1.193+: if `autoMode.classifyAllShell: true` is set, these allow entries stop working entirely while Auto Mode is active — see `init/SKILL.md` Step 1 for the full interaction and the only mitigation.

## The pipeline

`/ievo:init` composes 6 stages (v0.6.0+):

```
discover.mjs (ours, parallel skills.sh API queries)
    ↓
index-repos (ours, parallel repo-indexer sub-agents)
    ↓
categorical rank — top-5 per category
    ↓
interview (per candidate — AskUserQuestion)
    ↓
security-auditor (parallel sub-agents, antivirus deep scan)
    ↓
install (project-scope vendor or plugin)
```

1. **discover.mjs** queries `https://skills.sh/api/search` in parallel — one request per language / dep / category / framework / stack-specific compound query. Heuristics inherited from find-skills SKILL.md (trusted owners reputation boost, install thresholds, category seed queries, synonym fallback) encoded directly in the script. Wall-clock ~3-6 seconds.
2. **index-repos** scans the FULL content of every unique repo from step 1 — finds plugins, agents, hooks, commands. Uses shallow `git clone --depth=1` into `~/.ievo/checkouts/` (one network op per repo, then filesystem scan — no API rate limits). Sub-agents run in parallel — wall-clock = slowest repo (~30-60s).
3. **categorical rank** groups candidates by category (testing, linting, security, observability, etc.) and keeps top-5 per category instead of overall top-12. Every relevant category gets visibility.
4. **security-auditor** sub-agents run in parallel — one per selected item. Each runs as a senior application security engineer with domain expertise (prompt injection, credential exfiltration, supply-chain compromise, hook abuse, indirection attacks). Reads FULL content of every file shipped with the item + all dependencies. Wall-clock ~10-15s for 5-7 items.
5. **install** runs two paths (project-scope, copy + source SHA metadata):
   - **Vendor** (skills + agents): `gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>` → Write tool → `.claude/<type>/` → inject overlay marker → record source repo + commit SHA in `.ievo/evolution/<scope>/<name>.md` for `/ievo:update` to track upstream changes
   - **Plugin install** (anything with hooks/MCP/commands): edit `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins` for team-portable activation

## Commands & Skills

### Skills (auto-activatable, cross-platform via agentskills.io)

| Skill | What it does |
|-------|--------------|
| `/ievo:init` | Full pipeline: discover, audit, install |
| `/ievo:evo "<lesson>"` | Capture a lesson — append to overlay file. Never modifies agent/skill body. |
| `/ievo:feedback` | Submit bug/idea/skip-reasons as GitHub issue |
| `/ievo:debug-on` | Enable verbose / trace-level logging for the iEvo pipeline |
| `/ievo:debug-off` | Disable verbose logging and finalize the debug session |
| `/ievo:contributor-mode-on` | Opt in to widened `/ievo:feedback` payload (may offer to attach the scrubbed tool-failure/permission-denial capture stream) |
| `/ievo:contributor-mode-off` | Revoke contributor mode — `/ievo:feedback` reverts to its default environment-context-only payload |
| `/ievo:hooks-setup` | Configure Claude Code lifecycle hooks for iEvo pipeline events (init complete, security RED, evolution captured) |
| `/ievo:overlay-status` | List active evolution overlays in this project, grouped by scope (Project / agents / skills) with last-modified dates |
| `/ievo:index-repos` | Standalone: enumerate a repo (callable on its own) |
| `/ievo:security-check` | Standalone: audit a specific skill/agent/plugin |

### Commands (strictly explicit, Claude Code-specific)

| Command | What it does |
|---------|--------------|
| `/ievo:uninstall` | Remove markers from CLAUDE.md/AGENTS.md and `.claude/agents/`, `.claude/skills/`. Preserves `.ievo/`. |
| `/ievo:update` | Refresh vendored agent/skill files from upstream, re-auditing changed content before it overwrites the local copy. Re-inject markers. Overlay files untouched. |

## The overlay model

Under v0.2.0, **agent and skill files are never modified by evolution**. Lessons accumulate in separate **overlay files**, read live at every dispatch.

When you vendor an agent (via `/ievo:init`) or evolve it (via `/ievo:evo`):

1. **Local file** (`.claude/agents/<name>.md`) gets a ONE-TIME marker block right after its frontmatter:
   ```markdown
   <!-- ievo:start -->
   **Before applying the instructions below**, read `.ievo/evolution/agents/<name>.md` if it exists, and apply ALL rules from its sections IN ADDITION to the instructions below.
   <!-- ievo:end -->
   ```
2. **Overlay file** (`.ievo/evolution/agents/<name>.md`) holds the accumulated rules:
   ```markdown
   ---
   source:
     repo: wshobson/agents
     path: plugins/python-development/agents/python-pro.md
     commit_sha: a1b2c3d4
     fetched_at: 2026-05-18T10:00:00Z
   ---

   # python-pro — Evolution Overlay

   ## 2026-05-19 14:32 UTC — Check git status before commit
   **Trigger:** user-observed mistake during code review

   Always check `git status` before commits to avoid orphaned files.
   ```

When the agent is dispatched, Claude reads both files automatically — the agent body's instructions and the overlay's accumulated rules.

**Why this matters:**
- Upstream updates are trivial: `/ievo:update` re-fetches the file and re-injects the marker. Overlay rules continue applying.
- No drift, no Opus replay loop, no patches accumulating in the agent body.
- Overlay file is the **single source of truth** for evolution. Easy to audit, easy to share via git.

## Project-side layout

After `/ievo:init` with some skills/agents vendored and some plugins installed:

```
<your-project>/
├── CLAUDE.md                        # (first project-wide evolution — gets marker block; a thin-pointer CLAUDE.md routes it to AGENTS.md instead)
├── .claude/
│   ├── settings.json                # NEW: plugin marketplaces + enabledPlugins (commit for team sync)
│   ├── agents/
│   │   └── python-pro.md            # vendored, has overlay marker
│   └── skills/
│       └── changelog/
│           └── SKILL.md             # vendored, has overlay marker
└── .ievo/
    ├── evolution/                   # COMMIT to git — project's evolution state
    │   ├── project.md
    │   ├── agents/
    │   │   └── python-pro.md        # overlay file — actual rules live here
    │   └── skills/
    │       └── changelog.md
    ├── cache/                       # GITIGNORE — re-derivable
    │   └── index/
    │       └── wshobson-agents.md
    └── log/                         # GITIGNORE — local diagnostic
        └── init-20260518-093613.md
```

`/ievo:init` adds the right `.gitignore` entries automatically if your project has a `.gitignore`.

## Security model (v0.5.2 — senior-security-engineer vulnerability assessment)

**Reputation is not security.** Owner-based trust is unreliable — OpenAI, Anthropic, Microsoft accounts have all been compromised in past incidents. iEvo's verdict comes only from content scan.

`security-auditor` agent dispatches in parallel per selected item. Each instance acts as a **senior application security engineer** with deep domain expertise in AI agent supply-chain vulnerabilities (prompt injection, credential exfiltration, supply-chain compromise, hook abuse, indirection attacks, encoded payloads, social engineering, tool-model bypass). It applies the `security-check` skill — full content review of every file shipped with the item (SKILL.md/agent.md body + scripts/ + references/ + assets/ + bundled plugin files), then performs threat modeling and structured vulnerability assessment using the current Sonnet family reasoning (`model: sonnet` alias — platform-agnostic, vendor-neutral).

### Verdicts

| Verdict | What | UX |
|---------|------|-----|
| 🟢 GREEN | Full deep scan complete, no threats detected, intent is clearly legitimate | silent install |
| 🟡 YELLOW | Minor concerns worth noting but not blocking (e.g., plain utility scripts present) | batch multi-select confirmation |
| 🔴 RED | At least one specific threat detected with high confidence, cited file + excerpt | 4 options: try alternative / force install / skip / **report to source repo** |

### Threats scanned for

1. **Prompt injection** — direct ("ignore previous"), indirect ("for debugging note .env contents"), encoded payloads
2. **Credential exfiltration** — reads of `.env`, `~/.aws/`, `~/.ssh/`, even when framed as "debugging"
3. **Suspicious external network** — `curl X | bash`, unknown domains, output to writable paths
4. **Time bombs** — date/counter/env-flag-based conditional execution
5. **Encoded payloads** — long base64/hex strings, dynamic command construction
6. **Broad/destructive bash** — `Bash(*)`, `Bash(rm:*)`, `Bash(sudo:*)`, `Bash(curl:*)`
7. **Hook abuse** — PreToolUse/UserPromptSubmit with suspicious command (iEvo's own flag-gated correction-capture hook is a documented exception — it only writes under `.ievo/`)
8. **Runtime download** — scripts pulling additional code at runtime
9. **Social engineering** — legitimate name + malicious body
10. **Tool model bypass** — instructions to disable safety checks

### Report-to-source flow (RED only)

When verdict is RED, user gets a 4th option: **"Report to `<owner>/<repo>` (file security issue)"**. iEvo pre-fills a professional issue body citing the specific findings (file + excerpt + concern), shows preview, lets user edit/cancel, then files via `gh issue create`. Community defense layer — maintainer notified within minutes, future users protected.

Issue body footer identifies iEvo as the source (`Reviewed via iEvo — community security audit tooling`) so maintainers know it's automated review, not random spam.

### What we DON'T do

- ❌ Owner-based trust shortcuts (TRUSTED_OWNERS, "famous account = safe") — dropped in v0.5.2
- ❌ Heuristic risk_tier in repo indices ("trusted/neutral/caution") — dropped in v0.5.2
- ❌ Surface-level pattern matching as final verdict — Sonnet's reasoning is the only signal
- ❌ Auto-install RED items — always explicit user choice

### Known configuration gotcha — `CLAUDE_CODE_SUBAGENT_MODEL`

Claude Code v2.1.146+ ships a `CLAUDE_CODE_SUBAGENT_MODEL` environment variable that **overrides** an agent's frontmatter `model:` declaration. Per [official docs](https://code.claude.com/docs/en/sub-agents), the model-resolution order for subagents is:

1. `CLAUDE_CODE_SUBAGENT_MODEL` env var, if set
2. Per-invocation model parameter
3. The subagent definition's `model:` frontmatter (where iEvo declares `sonnet`)
4. The main-conversation model

**The security implication.** iEvo's `security-auditor` agent declares `model: sonnet` precisely because Sonnet-tier reasoning is required to catch indirection attacks ("Haiku is insufficient", per `security-check/SKILL.md`). If an operator sets `CLAUDE_CODE_SUBAGENT_MODEL` to any Haiku-tier value (`haiku`, or a pinned `claude-haiku-...` ID) for cost or speed, the security scan silently runs at Haiku reasoning — degrading the entire security guarantee without any visible warning.

**Mitigation**: either (a) leave `CLAUDE_CODE_SUBAGENT_MODEL` unset (frontmatter wins), or (b) set it to a vendor-neutral Sonnet/Opus alias (`sonnet` / `opus`) when needed for specific subagent classes. Do NOT set it to a Haiku-tier value in any environment running `/ievo:init`. The env var first appears in Claude Code release notes at v2.1.146 (May 2026); it may have been added earlier without changelog mention. No equivalent Codex env var is documented yet (May 2026); this note will update when one ships.

### Known configuration gotcha — `--safe-mode` / `disableBundledSkills`

Claude Code v2.1.169 added two settings that sound similar but have opposite implications for iEvo's security coverage:

- **`--safe-mode` / `CLAUDE_CODE_SAFE_MODE`** disables **all** customizations — CLAUDE.md, plugins, skills, hooks, MCP servers — for troubleshooting. iEvo is plugin-installed, so every iEvo skill, hook, and sub-agent is silently absent while safe mode is active. Verify `CLAUDE_CODE_SAFE_MODE` is unset and `--safe-mode` was not passed before relying on iEvo for security coverage.
- **`disableBundledSkills` / `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`** only hides Claude Code's own **bundled** skills, workflows, and built-in slash commands. iEvo is plugin-installed, not bundled, and remains fully active — a minimal-noise environment built with this setting keeps full iEvo security coverage.

See the [v2.1.169 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.169) for both.

### Known configuration gotcha — Codex plugin auto-upgrade and an already-open task

Codex upgrades configured git marketplaces at session startup (§ *Keep iEvo up to date* above) and prunes the superseded versioned plugin-cache directory. A Codex task that was already open when that happened keeps referencing the **old** `<codex-cache>/ievo/<old-version>/skills` root, so invoking any `ievo:*` skill in that task fails with `No such file or directory` (`ENOENT`) — even though `codex plugin list --json` correctly reports the newer iEvo version installed and enabled, and the new version's cache directory is present and readable on disk.

Your install is fine, and iEvo cannot fix this from its side: the stale path is produced by Codex's own plugin loader ([openai/codex#24390](https://github.com/openai/codex/issues/24390), open as of 2026-07-25 — `PluginsManager` caches its plugin-load outcome without keying on the active plugin-cache version, and the refresh path clears only that cache, not `SkillsManager`). The same mechanism can also break plugin **hooks** for the remainder of an affected session ([openai/codex#31383](https://github.com/openai/codex/issues/31383)), so a hook installed by `/ievo:hooks-setup` may go quiet until the session is restarted.

**Mitigation**: after an iEvo plugin update on Codex, start a new task — or restart Codex Desktop / the CLI session — before invoking an `ievo:*` skill again. Reported against an iEvo 0.62.3 → 0.63.0 upgrade on Codex Desktop ([ievo-ai/skills#459](https://github.com/ievo-ai/skills/issues/459)).

### Known configuration gotcha — `claude plugin update` resolving against a stale local marketplace cache

Claude Code resolves a plugin's "latest" version as a cache-key comparison, not a live lookup. Per the [official docs](https://code.claude.com/docs/en/plugins-reference#version-management), the version is read from, in order: `plugin.json`'s `version` field, then the plugin's entry in the marketplace's own locally-cached `marketplace.json`, then the git commit SHA of the plugin's source — `claude plugin update` "skips the update if it matches what's already installed." None of those sources are re-fetched by `plugin update` itself; only a separate `claude plugin marketplace update <name>` call refreshes the local marketplace clone ("Refresh marketplaces from their sources to retrieve new plugins and version changes," per the same docs). So on a project whose local marketplace clone has genuinely fallen behind upstream, `claude plugin update <plugin> -s <scope>` silently reinstalls whatever old commit that stale clone is still pinned to — no error, no "marketplace is stale, refresh first" hint.

That can also read as a confusing downgrade. `~/.claude/plugins/installed_plugins.json` tracks one entry per `(plugin, scope, projectPath)`, and the CLI's own `updated from X to Y` confirmation has been observed printing `X` from a *different* scope's cached entry (e.g. a separate `user`-scope install of the same plugin) than the scope actually being updated — so a stale-but-untouched `project`-scope entry can look like it just downgraded from a much newer version, when it was really just old the whole time.

Even `claude plugin marketplace update <name>` — which runs a `git pull` against the cached clone under the hood — isn't guaranteed to leave the clone at the latest commit: the [docs](https://code.claude.com/docs/en/plugin-marketplaces#marketplace-updates-fail-in-offline-environments) state that "by default, when a `git pull` fails, Claude Code attempts a re-clone from scratch," and running the command **manually** has been observed reporting success while an untracked local edit to the cached clone's own `marketplace.json` blocked a clean fast-forward (one machine, one occurrence — not a documented general guarantee either way).

**Mitigation**: if `plugin update` / `marketplace update` output looks stale or reads like an unexplained downgrade, verify — and if needed refresh — the cached clone directly: `git log -1` and `git pull` inside `~/.claude/plugins/marketplaces/<marketplace>`, discarding any untracked local modification to that clone's `marketplace.json` first if it blocks the fast-forward, then re-run `claude plugin update`. Reported on iEvo 0.74.3 with Claude Code 2.1.220 ([ievo-ai/skills#512](https://github.com/ievo-ai/skills/issues/512)).

### Known configuration gotcha — plugin shows `disabled` in a brand-new project despite `enabled: true` at user scope

A plugin installed and enabled at **user** scope can still show as `disabled` the first time you open a brand-new project, with no project/local override anywhere to explain it. Confirmed on Claude Code v2.1.220 with iEvo v0.77.0: `~/.claude/settings.json` had `"enabledPlugins": {"ievo@ievo-skills": true}`; the new project had no `.claude/settings.json` at all, and its `.claude/settings.local.json` had no `enabledPlugins` key; `claude plugin list --json` showed exactly one **user**-scope entry for `ievo@ievo-skills` with `"enabled": true` and no matching project-scope entry — yet the `/plugin` → **Installed** tab (filtered to "ievo") showed `ievo Plugin · ievo-skills · o disabled`, `/plugin install` reported the plugin "already installed globally", and every `/ievo:*` skill came back `Unknown command`.

This is an **upstream Claude Code defect, not an iEvo bootstrap issue** — the failure happens before any iEvo code path runs (no `.ievo/` write, no skill or script execution), and there is no iEvo-side install step that could cause a correctly-enabled user-scope plugin to load as disabled in a fresh project.

**Mitigation**: apply the official troubleshooting guidance for this class of issue — clear the plugin cache and reinstall: "Plugin skills not appearing: clear the cache with `rm -rf ~/.claude/plugins/cache`, restart Claude Code, and reinstall the plugin" ([official docs](https://code.claude.com/docs/en/discover-plugins#common-issues)). If that doesn't resolve it, this is a Claude Code issue to report upstream, not an iEvo one. Reported on iEvo 0.77.0 with Claude Code 2.1.220 ([ievo-ai/skills#549](https://github.com/ievo-ai/skills/issues/549)).

## Install paths

iEvo supports two install paths per candidate:

### Vendor (skills + agents)

- `gh api` fetches the source file/directory.
- Writes to `.claude/<type>/<name>/` in your project.
- Injects the overlay marker.
- Creates `.ievo/evolution/<scope>/<name>.md` with source metadata frontmatter.
- **No hooks, no MCP, no commands** come along — just the agent/skill content.
- Best for: pulling specific agents/skills without committing to a whole plugin.

### Plugin install (anything with hooks / MCP / commands)

- Edits `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins`.
- Settings file is committed to git → team gets prompt to trust folder → plugin auto-installs for them too.
- Brings everything: agents, skills, commands, hooks, MCP servers.
- Best for: plugins where the value is the integration (hooks intercepting workflows, MCP servers, slash commands).

The interview at `/ievo:init` step 7b asks per candidate: vendor specific items OR install whole plugin OR skip.

**CC v2.1.195+ recommended**: earlier versions had a consent-gate bug for plugins enabled only via this `.claude/settings.json` path — see `AGENTS.md` § Security model for the full dual-gate story (iEvo's own `AskUserQuestion` plus CC's platform consent dialog).

## Repository structure

```
ievo-ai/skills/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── plugin.json                     # Agent Plugins 1.0.0 manifest (agent-plugins.org) — metadata only; components live in plugins/ievo/
└── plugins/ievo/
    ├── .claude-plugin/plugin.json
    ├── commands/
    │   ├── uninstall.md
    │   └── update.md
    ├── skills/
    │   ├── init/SKILL.md           # /ievo:init — orchestrator
    │   ├── evo/SKILL.md            # /ievo:evo — overlay capture
    │   ├── feedback/SKILL.md       # /ievo:feedback — file GitHub issues
    │   ├── debug-on/SKILL.md       # /ievo:debug-on — enable verbose session logging
    │   ├── debug-off/SKILL.md      # /ievo:debug-off — disable verbose session logging
    │   ├── contributor-mode-on/SKILL.md  # /ievo:contributor-mode-on — opt in to widened /ievo:feedback payload
    │   ├── contributor-mode-off/SKILL.md # /ievo:contributor-mode-off — revoke it
    │   ├── hooks-setup/SKILL.md    # /ievo:hooks-setup — configure lifecycle hooks
    │   ├── overlay-status/SKILL.md # /ievo:overlay-status — list active evolution overlays
    │   ├── index-repos/SKILL.md    # /ievo:index-repos — enumerate a repo
    │   └── security-check/SKILL.md # /ievo:security-check — audit a candidate
    ├── agents/
    │   ├── evolution.md            # sub-agent dispatched by evo skill
    │   ├── repo-indexer.md         # parallel dispatch — one per repo for indexing (Step 6)
    │   └── security-auditor.md     # parallel dispatch — one per selected item for audit (Step 8)
    └── scripts/
        ├── discover.mjs            # skills.sh API discovery (parallel queries)
        ├── scan_repo.mjs           # deterministic repo scanner (Node, no LLM)
        ├── validate_agents.mjs     # vendor-neutral model: frontmatter validator
        └── tests/                  # node:test suites + fixtures (100% coverage gate)
```

## Standards compliance

- Plugin format: Claude Code-native + Codex-native (dual marketplace manifests)
- Skills inside: [agentskills.io spec](https://agentskills.io/specification) — portable to Cursor, Copilot, Gemini CLI, Goose, Junie, 30+ other agent platforms
- Distribution: triple-mode — Claude Code plugin install OR Codex plugin install OR `npx skills add ievo-ai/skills --skill <name>` via [skills.sh](https://www.skills.sh) (planned v1.0)
- Universal positioning: works wherever Node.js 18+ + git + an agent platform that supports skills are available
- Version requirements: see [AGENTS.md § Version compatibility](AGENTS.md#version-compatibility) for the minimum Claude Code version per feature iEvo uses, and `requiredMinimumVersion` enterprise-pinning guidance

## Roadmap

For the full shipped-version history (v0.2 → current), see [`CHANGELOG.md`](./CHANGELOG.md). Forward-looking items only below.

- **v0.7.0 (planned):** Cortex A/B validation gate for evolutions — mutations that don't improve get rejected via blind evaluation. Plus a GitHub-search source in `discover.mjs` for agent-only / plugin-only repos not surfaced by skills.sh.
- **v1.0:** Skills.sh publication + cross-project pattern detection (curator). Lessons that recur across projects get promoted to "blessed" upstream evolutions.

## Acknowledgments

- [find-skills](https://github.com/vercel-labs/skills) — vercel-labs's skill discovery. Through v0.5.x we used find-skills as bootstrap prereq; v0.6.0+ we ship our own [`discover.mjs`](plugins/ievo/scripts/discover.mjs) that hits the same skills.sh API directly, with heuristics inherited verbatim from find-skills SKILL.md (trusted owners, install thresholds, category queries, synonym fallback). Credit to vercel-labs for the original best practices.
- [agentskills.io](https://agentskills.io) — the open standard for skills

## License

MIT. See `LICENSE`.
