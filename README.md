# iEvo — Self-Evolving Plugin for Claude Code

> Capture lessons, patch local agents and skills, replay logs on upstream updates.

iEvo turns ad-hoc feedback ("the agent forgot to check git status before commits") into persistent improvements to your project's agents and skills — with a log that survives upstream plugin updates.

## Install

```
/plugin install ievo-ai/skills
```

Then, in any project where you want iEvo to be active:

```
/ievo:install
```

This injects the iEvo kernel (`iEVO.md`) into your project's `CLAUDE.md` (or `AGENTS.md`) and prepares the evolution log directory at `.ievo/`.

## Commands

| Command | What it does |
|---------|--------------|
| `/ievo:install` | Inject `iEVO.md` reference + create `.ievo/evolution/` structure |
| `/ievo:uninstall` | Remove the injection. Preserves `.ievo/` (your evolution data) |
| `/ievo:evolution "<lesson>"` | Capture a lesson and patch the relevant agent or skill |
| `/ievo:update` | Refresh kernel from plugin + replay evolution logs onto fresh upstream |

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
├── commands/                    # Slash commands
│   ├── install.md
│   ├── uninstall.md
│   ├── evolution.md
│   └── update.md
├── agents/
│   └── evolution.md             # The evolution sub-agent
├── skills/                      # Bundled skills (agentskills.io-compliant)
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
