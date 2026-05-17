# iEvo — Self-Evolving Plugin for Claude Code

> Capture lessons, patch local agents and skills, replay logs on upstream updates.

iEvo turns ad-hoc feedback ("the agent forgot to check git status before commits") into persistent improvements to your project's agents and skills — with a log that survives upstream plugin updates.

## Install

iEvo ships as a Claude Code plugin marketplace. Two steps:

```
/plugin marketplace add ievo-ai/skills
/plugin install ievo@ievo-skills
```

After install, the `/ievo:*` commands and the `evolution` skill become available. To activate iEvo in the current project:

```
/ievo:install
```

This injects the iEvo kernel (`iEVO.md`) into your project's `CLAUDE.md` (or `AGENTS.md`) and prepares the evolution log directory at `.ievo/`.

### Project-scope only

To make the marketplace and its plugins available **only in this project** (not globally for your user), add to your project's `.claude/settings.json`:

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

This loads the marketplace and enables the plugin scoped to this project only.

### Try without installing

To test the plugin without adding it to a marketplace:

```bash
git clone https://github.com/ievo-ai/skills /tmp/ievo-skills
claude --plugin-dir /tmp/ievo-skills
```

## Commands & Skills

**Commands** (explicit-only invocation, Claude Code-specific):

| Command | What it does |
|---------|--------------|
| `/ievo:install` | Inject `iEVO.md` reference + create `.ievo/evolution/` structure |
| `/ievo:uninstall` | Remove the injection. Preserves `.ievo/` (your evolution data) |
| `/ievo:update` | Refresh kernel from plugin + replay evolution logs onto fresh upstream |

**Skills** (slash-invocable AND auto-activatable, cross-platform via [agentskills.io](https://agentskills.io)):

| Skill | What it does |
|-------|--------------|
| `/ievo:evolution` `"<lesson>"` | Capture a lesson and patch the relevant agent or skill. Auto-activates when the user expresses a lesson worth persisting. |

Why the split: project-setup operations (install / uninstall / update) should be strictly explicit — we don't want the model deciding to deploy plugin state on its own. Evolution capture is **agentic** — the model picking up "we should remember X" is a feature, not a bug.

## How it works

When you record a lesson with `/ievo:evolution`:

1. The `evolution` agent classifies the lesson — agent or skill, which one.
2. If the target file lives in a plugin (not yet in your project's `.claude/`), it's copied into the project first.
3. The lesson is integrated into the local file with the help of Claude — same prompt the agent uses for upstream replay.
4. A timestamped entry is appended to `.ievo/evolution/<type>/<name>.md`.

When you run `/ievo:update`:

1. The plugin's `iEVO.md` is copied into your project, replacing the previous version.
2. For each evolved agent/skill, the fresh upstream is fetched and every log entry is replayed onto it. Your evolved local files are regenerated from `upstream + log`.

The evolution log is plain markdown and is the source of truth for your project's iEvo state. The `.claude/<type>/<name>.md` files are derived — re-creatable from `upstream + log`.

## Repository structure

```
ievo-ai/skills/
├── .claude-plugin/plugin.json   # Plugin manifest (name: "ievo")
├── commands/                    # Strictly-explicit slash commands
│   ├── install.md
│   ├── uninstall.md
│   └── update.md
├── skills/                      # agentskills.io-compliant skills (cross-platform)
│   └── evolution/
│       └── SKILL.md             # Capture-a-lesson — slash or auto-activate
├── agents/
│   └── evolution.md             # Sub-agent dispatched by the evolution skill on Claude Code
├── iEVO.md                      # The iEvo kernel — copied to your project on install
└── README.md
```

## Project-side layout (after `/ievo:install`)

```
<your-project>/
├── CLAUDE.md or AGENTS.md   # ← marker block injected, references .ievo/iEVO.md
└── .ievo/
    ├── iEVO.md              # Copy of the plugin kernel
    └── evolution/
        ├── agents/
        │   └── <agent>.md   # Per-agent evolution log (markdown)
        └── skills/
            └── <skill>.md   # Per-skill evolution log (markdown)
```

## Standards compliance

- **Skills** in `skills/` follow the [Agent Skills specification](https://agentskills.io/specification) — portable to Cursor, Codex, Copilot, Gemini CLI, Goose, Junie, and 30+ other agent platforms.
- **Plugin format** is Claude Code-native (commands, agents, hooks). Use via Claude Code plugin install.
- **Distribution** through both Claude Code (`/plugin install`) and [skills.sh](https://www.skills.sh/) (`npx skills add ievo-ai/skills --skill <name>`).

## License

MIT. See `LICENSE`.

## Roadmap

- **v0.1 (this release):** Patch-and-log. No A/B validation. Manual updates.
- **v0.2:** Opt-in A/B validation via the iEvo cortex pipeline. Mutations that don't improve get rejected.
- **v1.0:** Cross-project pattern detection (curator). Lessons that recur across multiple projects get promoted to "blessed" upstream evolutions.

## Contributing

iEvo is open and welcomes contributions. The standard contract for evolution logs is the markdown format documented in `iEVO.md`. Future versions may extend this with a sibling `LEARNING.md` spec for the broader agent-skills ecosystem.
