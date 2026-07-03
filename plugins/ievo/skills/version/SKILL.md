---
name: version
description: "Show the installed iEvo plugin version (plus commit SHA when resolvable) and the changelog of what changed between it and the latest published release, so you can decide whether to run `/plugin update`. Reads the installed `version` from the plugin's `plugin.json`, fetches the latest version from the marketplace manifest on `main`, and prints the intervening `CHANGELOG.md` entries. Use when the user asks \"which iEvo version am I on\", \"what iEvo version is installed\", \"am I up to date\", \"how far behind is iEvo\", \"what changed since my iEvo version\", \"show the iEvo changelog\", \"what would /plugin update give me\", or invokes /ievo:version. Read-only — never writes, installs, or updates."
license: MIT
effort: low
allowed-tools:
  - Bash(jq *)
  - Bash(curl *)
  - Bash(git *)
compatibility: "Any agentskills.io platform with a Bash tool. Reads the installed version locally (`jq` on the plugin's plugin.json); the latest-version + changelog check needs network (`curl` to raw.githubusercontent.com) and degrades gracefully offline. Commit SHA is best-effort (`git`) — omitted when the install has no `.git`. Read-only — no files written, no install, no update."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Version — show installed iEvo version and changelog

Answers "which iEvo version am I running, and what would I gain by updating?" from inside the session — no manual poking at the plugin cache directory. Reports the installed version (and commit SHA when it can be determined), the latest published version, and — when behind — the `CHANGELOG.md` entries for every release in between so the user can decide whether `/plugin update` is worth running.

This complements the passive SessionStart version-check nudge (`hooks-setup` Step 5.7): that nudge only whispers "you're behind" once a day and only if the user opted into hooks. This skill is the on-demand, interactive answer — the full version + changelog, whenever asked.

## When to use

- User asks "which iEvo version am I on", "what version is installed", "am I up to date", "how far behind is iEvo", "what changed since my version", "show the iEvo changelog", "what would `/plugin update` give me".
- Before deciding whether to run `/plugin update` — see the concrete list of changes first.
- Onboarding / debugging — confirm exactly which iEvo build is active in this session.

## Steps

### 1. Resolve the installed version (+ commit SHA, best-effort)

The skill runs *inside* the plugin, so `CLAUDE_PLUGIN_ROOT` points at the installed plugin directory (same resolution `hooks-setup` Step 5.7.2 relies on). Read the installed version from its manifest:

```sh
jq -r '.version // empty' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null
```

If this prints a version, that is the **installed version**. If it prints nothing (empty output, missing file, `jq` absent, or `CLAUDE_PLUGIN_ROOT` unset because the skill wasn't invoked from within the plugin), the installed version cannot be determined — tell the user that plainly and stop; do not guess a version.

Commit SHA is **best-effort only** — an installed plugin cache usually has no `.git`, so treat this as optional decoration, never a hard requirement:

```sh
git -C "${CLAUDE_PLUGIN_ROOT}" rev-parse --short HEAD 2>/dev/null
```

If it prints a short SHA, include it (`0.41.0 (abc1234)`); if it prints nothing, render the version without a SHA and note the SHA is "not available" rather than failing. Never treat a missing SHA as an error.

### 2. Resolve the latest published version

Fetch the marketplace manifest from `main` (the same source the version-check nudge uses) and read `plugins[0].version`:

```sh
curl -fsS --max-time 5 "https://raw.githubusercontent.com/ievo-ai/skills/main/.claude-plugin/marketplace.json" 2>/dev/null | jq -r '.plugins[0].version // empty'
```

If this prints a version, that is the **latest version**. If it prints nothing (offline, rate-limited, `curl` unavailable), the latest version can't be checked — report just the installed version (from Step 1) with a short "couldn't reach the network to check for updates; run again when online" note, and stop. This is a normal degraded path, not a failure.

### 3. Compare installed vs latest

Compare the two version strings as **semver** (numeric field-by-field: major, then minor, then patch — `0.9.0 < 0.41.0`, never string-compare):

- **installed == latest** → up to date. Print the installed version (+ SHA) and "You're on the latest iEvo release." Do **not** fetch the changelog — there's nothing between them.
- **installed > latest** → the install is ahead of `main`'s published version (a dev / pre-release build). Note this and stop; there is no forward changelog to show.
- **installed < latest** → the install is behind. Continue to Step 4 to show what changed.

### 4. Fetch and window the changelog

Fetch `CHANGELOG.md` from the same `main` ref:

```sh
curl -fsS --max-time 10 "https://raw.githubusercontent.com/ievo-ai/skills/main/CHANGELOG.md" 2>/dev/null
```

The file is **reverse-chronological**, one `## vX.Y.Z` section per release (per `AGENTS.md` § "Changelog goes in CHANGELOG.md"). Select every `## vX.Y.Z` section whose version is **strictly greater than the installed version** (i.e. everything from the top of the file down to — but not including — the installed release). Since it's reverse-chronological, stop at the first section whose version is **≤ installed**.

Robustness notes:
- Compare by **semver**, not exact header text. Not every version has its own entry (infra-only releases don't bump the plugin version, and some minor versions have no standalone section) — so an exact `## v<installed>` header may be absent. Selecting "every section with version > installed" is correct regardless of whether the installed version itself appears.
- Present the selected sections **verbatim and in file order** (newest first). Do not summarise or rewrite them unless the user asks — the changelog prose is the payload.
- If the changelog fetch fails but Steps 1–2 succeeded, still report the version delta ("installed X, latest Y — N releases behind") and note the changelog couldn't be fetched. Never fail hard on a malformed or unreachable changelog.

### 5. Render

Suggested format when behind:

```
iEvo version

- Installed: 0.41.0 (abc1234)
- Latest:    0.42.0
- Status:    1 release behind — run `/plugin update` to upgrade

Changes since your version:

## v0.42.0
<verbatim changelog body for v0.42.0>
```

When up to date:

```
iEvo version

- Installed: 0.42.0 (abc1234)
- Latest:    0.42.0
- Status:    up to date — you're on the latest release
```

When the latest check couldn't run (offline):

```
iEvo version

- Installed: 0.41.0 (abc1234)
- Latest:    unknown (couldn't reach the network to check)

Run `/ievo:version` again when online to see the latest release and changelog.
```

Adapt the exact wording as fits the conversation; keep the three facts (installed, latest, status) legible and lead with them.

## Rules

- **Read-only.** This skill never writes, edits, installs, or updates anything. It reports state; the user decides whether to run `/plugin update`.
- **Installed version is authoritative from `plugin.json`.** Read it via `jq` on `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`; if it can't be resolved, say so and stop — never fabricate a version.
- **SHA is best-effort.** An installed plugin cache typically has no `.git`. A missing SHA is "not available", never an error.
- **Network is optional and throttling-free here.** This is an explicit, user-invoked command, so it fetches on every run (unlike the once/24h-throttled SessionStart nudge). If the network is unavailable, degrade to the installed-version-only report — clearly, not silently.
- **Compare versions as semver**, field-by-field numerically — never as strings.
- **Changelog prose is shown verbatim.** Print the intervening `## vX.Y.Z` sections as-is (newest first); don't paraphrase unless asked.
- **Bash is used only for read-only lookups** — `jq` (parse the two manifests), `curl` (fetch the manifest + changelog from `main`), and a best-effort `git rev-parse` for the SHA. No writes, no destructive commands.

## See also

- `hooks-setup/SKILL.md` Step 5.7 — the passive, throttled SessionStart nudge that tells a user they're behind. This skill is its on-demand, changelog-showing complement.
- `update.md` (`/ievo:update`) — refreshes vendored skills/agents; distinct from Claude Code's native `/plugin update`, which upgrades the plugin itself.
- `overlay-status/SKILL.md` — the read-only, graceful-degradation skill pattern this one follows.
