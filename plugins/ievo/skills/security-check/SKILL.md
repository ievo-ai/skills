---
name: security-check
description: Assess the security risk of a Claude Code skill, agent, or plugin before installation. Combines skills.sh audit results (Snyk/Socket/Gen Agent Trust Hub) with our own content scan (hooks, allowed-tools permissions, scripts, prompt injection patterns) and repository metadata (stars, age, license). Returns a structured risk report — GREEN/YELLOW/RED — with specific flags and suggested next-ranked alternatives. Use before installing any third-party skill, agent, or plugin.
license: MIT
compatibility: Requires `gh` CLI installed. WebFetch available for skills.sh audit results.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Security Check

Pre-install security review for skills, agents, and plugins. Combines existing skills.sh audits with our own scans focused on runtime risks (hooks, tool permissions, prompt patterns) that skills.sh doesn't surface.

## Input

A candidate identifier:
- For skills: `<owner>/<repo>@<skill>` (e.g. `wshobson/agents@security-requirement-extraction`)
- For agents (vendored): `<owner>/<repo>:<path>` (e.g. `wshobson/agents:plugins/python-development/agents/python-pro.md`)
- For plugins (whole): `<owner>/<repo>/<plugin>` (e.g. `wshobson/agents/python-development`)

And type: `skill` | `agent` | `plugin`.

Optional: ranked list of alternatives (sibling candidates from the same find-orchestration pass). Used in the report's `alternatives` field if RED.

## Step 1: External audit signals (skills only)

For `type=skill`, fetch skills.sh's existing audit results — they already run Snyk, Socket, Gen Agent Trust Hub. Don't duplicate this work.

Use WebFetch on the skill's skills.sh page:
```
https://www.skills.sh/<owner>/<repo>/<skill>
```

Parse the displayed audit table:
- **Snyk**: Pass / Warn (severity: Low/Medium/High/Critical) / Fail
- **Socket**: 0 alerts / N alerts (severity if shown)
- **Gen Agent Trust Hub**: Safe / Unsafe

For `type=agent` or `type=plugin`: skip Step 1 (skills.sh doesn't audit those).

## Step 2: Content scan via gh API

Fetch the candidate's source via gh CLI. What to check depends on type:

### For skill (SKILL.md + optional scripts/, references/, assets/)

```bash
gh api repos/<owner>/<repo>/contents/<path-to-SKILL.md> --jq '.content' | base64 -d
```

Check the SKILL.md frontmatter and body for:
- **`allowed-tools` field**: parse the value
  - `Bash(*)` or `Bash(rm:*)` or `Bash(sudo:*)` → RED flag (broad/dangerous exec)
  - `Bash(<specific-cmd>:*)` → YELLOW (depends on cmd)
  - Read/Glob/Grep only → GREEN
- **External URLs in body**: fetch/curl/wget patterns → YELLOW (network access at runtime)
- **Suspicious phrases**: "ignore previous instructions", "system prompt is", "<system>", base64-encoded payloads → RED (prompt injection signatures)

Check for `scripts/` directory:
```bash
gh api repos/<owner>/<repo>/contents/skills/<skill>/scripts --silent 2>/dev/null
```
If present → YELLOW flag, list the files. If any script is binary or has obfuscation patterns → RED.

### For agent (single `<name>.md` file)

Similar checks — read the agent file, scan:
- `tools:` field — same Bash permission analysis
- Body for prompt injection patterns
- Body for "execute X command" patterns that bypass tool model

### For plugin (whole directory)

Wider scan:
- `hooks/hooks.json` — list all hooks
  - **`PreToolUse` hook → RED** (intercepts every tool call)
  - **`PostToolUse` hook → YELLOW** (runs after, can still exfiltrate)
  - `Stop` / `SessionStart` / `SessionEnd` → YELLOW (run on session boundaries)
  - `UserPromptSubmit` → RED (intercepts user input — can prompt-inject responses)
- `.mcp.json` — MCP server configurations
  - Network endpoints to unknown domains → YELLOW
  - Endpoints to `localhost` or known providers → GREEN
- `commands/*.md` — slash command files (similar checks as skills)
- All bundled agents (per-agent scan as above)

## Step 3: Repository metadata

For all types, fetch repo metadata:

```bash
gh api repos/<owner>/<repo> --jq '{stars: .stargazers_count, age_days: ..., license: .license.spdx_id, last_commit: ..., default_branch}'
```

Compute repo trust signals:
- `stars >= 1000` or `owner ∈ {vercel-labs, anthropics, microsoft, wshobson}` → trust boost (GREEN)
- `stars < 10` AND `age_days < 30` → low-trust (YELLOW)
- `license` absent → YELLOW
- `last_commit older than 365 days` → YELLOW (abandoned)

## Step 4: Aggregate risk

Apply rules in priority order. First match wins.

```
# RED conditions (any one triggers RED)
- skills.sh audit FAIL (any provider)
- `allowed-tools` contains `Bash(*)`, `Bash(rm:*)`, `Bash(sudo:*)`, or similar broad/destructive
- `PreToolUse` hook (plugin only)
- `UserPromptSubmit` hook (plugin only)
- Prompt injection signatures in content
- MCP server pointing to unknown external endpoint
- Scripts/ contains binary or obfuscated code

# YELLOW conditions (any one triggers YELLOW, no RED present)
- skills.sh audit WARN (any provider)
- Has `scripts/` directory (even if plain)
- Has hooks (non-tool-intercepting events)
- Has MCP server (any)
- `stars < 100` AND `age_days < 180`
- No license
- Last commit > 365 days

# GREEN otherwise
```

**Trust override**: if owner is in trusted list AND no RED conditions, YELLOW for "<100 stars" or "no license" gets demoted to GREEN. Trusted authors get benefit of doubt on metadata edge cases.

## Step 5: Build report

Return structured markdown report:

```markdown
# Security check — <owner/repo@name>

**Risk:** 🔴 RED | 🟡 YELLOW | 🟢 GREEN
**Type:** skill | agent | plugin

## skills.sh audits (skills only)
- Snyk: Pass | Warn (severity) | Fail
- Socket: 0 alerts | N alerts
- Gen Agent Trust Hub: Safe | Unsafe
- (omitted if type != skill)

## Content scan flags
- <flag 1, e.g. "Has PreToolUse hook running ./scripts/intercept.sh">
- <flag 2, e.g. "allowed-tools: Bash(rm:*) — destructive permission">
- ... (empty for clean content)

## Repo metadata
- Owner: <owner> (trust: official | high | medium | unknown)
- Stars: <count>
- Age: <N> days
- License: <SPDX or "missing">
- Last commit: <relative>

## Reasoning
<1-3 sentences explaining why this risk level>

## Alternatives (if RED — and caller provided ranked list)
- <next-ranked candidate of same purpose, with risk if pre-computed>
- ...

## Decision suggestion
- GREEN → safe to install
- YELLOW → review flags, install with awareness
- RED → recommend skip + try alternative; force-install requires explicit user confirmation
```

## Rules

- **No security through obscurity.** Always print specific flags. Don't say "this is risky" without naming what.
- **Trust the closed audit list.** Skills.sh's Snyk/Socket/Gen Agent Trust Hub catch most dep vulnerabilities. We layer on top — don't duplicate.
- **Hooks > MCP > scripts** in risk severity. Hooks run on every tool call; MCP is sandboxed-ish; scripts only run when explicitly invoked.
- **Trust boost is narrow.** Only applies to verified-author edge cases (low stars, no license). It does NOT excuse RED flags from content scan.
- **Never auto-install RED.** Even with user "force" intent, require explicit confirmation flow in the caller (e.g. /ievo:init). This skill returns risk, decision is caller's.
- **Cache results inline.** No separate cache file — let caller (init) hold the report in memory for the duration of its session.
