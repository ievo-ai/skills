# iEvo — Self-Evolving Plugin for Claude Code

> Capture lessons, patch local agents and skills, replay logs on upstream updates.

iEvo turns ad-hoc feedback ("the agent forgot to check git status before commits") and project context ("we use Unity, our team uses trunk-based dev") into persistent improvements — recorded in markdown evolution logs that survive upstream plugin updates.

## Install

iEvo ships as a Claude Code plugin marketplace.

```
/plugin marketplace add ievo-ai/skills
/plugin install ievo@ievo-skills
/reload-plugins
```

Then in your project:

```
/ievo:init
```

`init` is an interactive skill that uses [`find-skills`](https://www.skills.sh/vercel-labs/skills/find-skills) to discover skills relevant to your project and walks you through installing them one at a time.

### Project-scope only

To make iEvo's marketplace and plugin available **only in this project** (not globally for your user), add to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "ievo-skills": {
      "source": {
        "source": "github",
        "repo": "ievo-ai/skills"
      }
    }
  },
  "enabledPlugins": {
    "ievo@ievo-skills": true
  }
}
```

## Commands & Skills

**Skills** (slash-invocable AND auto-activatable, cross-platform via [agentskills.io](https://agentskills.io)):

| Skill | What it does |
|-------|--------------|
| `/ievo:init` | Discover and install relevant skills from skills.sh. Deep manifest scan (30+ stacks), per-skill interview. Sets up `.ievo/evolution/` structure. |
| `/ievo:evolution "<lesson>"` | Capture a lesson. Routes to the right place: an agent, a skill, or the project's `CLAUDE.md`. Auto-activates when the user expresses a lesson worth persisting. |
| `/ievo:feedback` | Submit a bug report, feature request, or general feedback. Posts a public GitHub issue to `ievo-ai/skills` via `gh` CLI. Auto-activates when the user expresses dissatisfaction or wants to suggest something. |

**Commands** (explicit-only invocation, Claude Code-specific):

| Command | What it does |
|---------|--------------|
| `/ievo:uninstall` | Ask the user, then remove iEvo's marker block from `CLAUDE.md` / `AGENTS.md`. Preserves all of `.ievo/`. |
| `/ievo:update` | Replay evolution logs against fresh upstream agents/skills (after `/plugin update`). |

Why the split: project-setup operations should be strictly explicit — we don't want the model deciding to remove plugin state on its own. Discovery and lesson capture are **agentic** — the model picking up "we should remember X" or "this project would benefit from skill Y" is a feature, not a bug.

## How project rules work

iEvo does **not** inject anything into your `CLAUDE.md` / `AGENTS.md` at install time. The first time you record a **project-wide** lesson via `/ievo:evolution` (e.g. "we use Unity", "PR titles start with the task ID"), the evolution skill:

1. Creates `.ievo/evolution/project.md` and appends the rule as a dated section.
2. Injects a one-time marker block into `CLAUDE.md` (or `AGENTS.md` if no `CLAUDE.md`):
   ```markdown
   <!-- ievo:start -->
   @.ievo/evolution/project.md
   <!-- ievo:end -->
   ```

After that, every Claude Code session in your project automatically loads `project.md` because of the `@` import in `CLAUDE.md`. Subsequent project-wide lessons just append to `project.md` — no further CLAUDE.md changes.

If you `/ievo:uninstall`, the marker block is removed (after confirmation). The `project.md` and all evolution logs are preserved.

## Project-side layout

After `/ievo:init`:
```
<your-project>/
└── .ievo/
    └── evolution/
        ├── agents/      # (empty) per-agent logs go here
        └── skills/      # (empty) per-skill logs go here
```

After first project-wide evolution:
```
<your-project>/
├── CLAUDE.md            # ← marker block injected, references .ievo/evolution/project.md
└── .ievo/
    └── evolution/
        ├── project.md   # ← project-wide rules log
        ├── agents/
        └── skills/
```

After init runs (diagnostic logs):
```
<your-project>/
└── .ievo/
    └── log/
        ├── init-20260517-143200.md     # ← each /ievo:init writes one
        └── init-20260517-150412.md
```

Logs capture: detected stack + dependencies, the exact prompt sent to find-skills and its raw response, dedup outcomes (which skills got dropped and why), your install/skip choices, install results per skill. Useful when iEvo suggested something off and you want to file a precise bug — `/ievo:feedback` can attach the latest log automatically.

`.ievo/log/` is intended for local debugging, not version control. Init auto-adds it to your `.gitignore` if you have one.

After more lessons:
```
<your-project>/
├── CLAUDE.md
├── .claude/
│   ├── agents/
│   │   └── spec-writer.md    # ← local copy, patched via evolution skill
│   └── skills/
│       └── changelog/
│           └── SKILL.md      # ← local copy, patched
└── .ievo/
    └── evolution/
        ├── project.md
        ├── agents/
        │   └── spec-writer.md   # ← evolution log for the agent
        └── skills/
            └── changelog.md     # ← evolution log for the skill
```

The `.ievo/evolution/` logs are the source of truth — patched `.claude/<type>/` files are derived artifacts, re-creatable from upstream + log via `/ievo:update`.

## Repository structure

```
ievo-ai/skills/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── commands/
│   ├── uninstall.md
│   └── update.md
├── skills/
│   ├── init/SKILL.md           # /ievo:init
│   ├── evolution/SKILL.md      # /ievo:evolution
│   └── feedback/SKILL.md       # /ievo:feedback
├── agents/
│   └── evolution.md            # sub-agent dispatched by evolution skill
└── README.md
```

## Standards compliance

- Plugin format: Claude Code-native
- Skills inside: [agentskills.io spec](https://agentskills.io/specification) — portable to Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms
- Distribution: dual-mode — Claude Code plugin install OR `npx skills add ievo-ai/skills --skill <name>` via [skills.sh](https://www.skills.sh/)

## Roadmap

- **v0.1 (this release):** Patch-and-log. No A/B validation. Manual updates. find-skills as prerequisite for init.
- **v0.2:** Opt-in A/B validation via the iEvo cortex pipeline. Mutations that don't improve get rejected.
- **v1.0:** Cross-project pattern detection (curator). Lessons that recur across multiple projects get promoted to "blessed" upstream evolutions.

## License

MIT. See `LICENSE`.
