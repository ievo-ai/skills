---
name: schedule
description: "Use this skill when the user asks \"schedule an iEvo audit\", \"set up weekly security scan\", \"automate iEvo\", \"run iEvo on a schedule\", \"periodic security check\", or \"create a routine for iEvo\". Configures a Claude Code Routine for periodic iEvo operations — recurring security audits, skill-update checks, or custom iEvo commands on a schedule. Three-step wizard: pick operation (security audit / skill refresh / custom), pick frequency (daily / weekly / monthly / one-off / custom cron), confirm and create via the in-session /schedule command. Routines run on Anthropic-managed infrastructure (research preview). Falls back to the claude.ai/code/routines web UI, or to CI cron instructions when Routines are unavailable (API-key auth, Free plan)."
license: MIT
effort: low
allowed-tools:
  - AskUserQuestion
  - Bash(claude --version)
  - Bash(env | grep*)
  - Read
compatibility: "Routines are Claude Code-only — a research preview (behavior, limits, and surface may change) requiring a Pro/Max/Team/Enterprise subscription with Claude Code on the web enabled; the /schedule command needs Claude Code v2.1.81+ and a claude.ai login (API-key auth hides it). The underlying iEvo operations (/ievo:security-check, /ievo:update) are cross-platform via agentskills.io. Cursor v3.8+: native `/automate` creates a Cursor Automation instead. Codex and others: CI cron fallback."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Schedule — create a Claude Code Routine for periodic iEvo operations

Set up a recurring Claude Code Routine that runs iEvo operations on a schedule — security audits, skill-update checks, or a custom iEvo command. Routines execute on Anthropic-managed infrastructure, so they run even when the local machine is off. Routines are a research preview: behavior, limits, and the surface may change.

Routines are created from three surfaces that all write to the same cloud account: the web UI at claude.ai/code/routines, the Desktop app, and the in-session `/schedule` command. This skill drives the `/schedule` path and falls back to the web UI, then to a CI cron template.

**Cursor v3.8+ users** have a platform-native alternative: the `/automate` command creates a Cursor Automation directly (including a GitHub "workflow run completed" trigger), no Claude subscription required — see the [Cursor changelog](https://cursor.com/changelog) for current syntax. This skill's wizard below still applies for Claude Code Routines, and the CI cron fallback (Step 1b) still applies on Codex and other platforms.

## When to use

- User asks "schedule an iEvo audit", "set up weekly security scan", "automate iEvo"
- User wants recurring security checks on installed skills after initial install
- User wants periodic skill-update discovery so installed skills stay current
- After `/ievo:init` — the natural follow-up is "keep this current automatically"
- User asks "create a routine for iEvo", "run iEvo on a schedule", "periodic security check"

## Step 1: Preflight — check for documented `/schedule` blockers

Routines are created with the in-session `/schedule` command. The CLI hides `/schedule` when a requirement is not met (the command menu shows "No commands match" and submitting returns "Unknown command"). Check the mechanically detectable causes before starting the wizard:

**1. CLI version** — `/schedule` requires Claude Code v2.1.81+:

```bash
claude --version
```

**2. Auth and telemetry environment variables** — any of these hides `/schedule`. This check prints variable NAMES only, never values:

```bash
env | grep -oE '^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|DISABLE_TELEMETRY|DO_NOT_TRACK|CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC|DISABLE_GROWTHBOOK)=' || true
```

- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` — API-key auth takes precedence over the claude.ai subscription login that `/schedule` requires
- `DISABLE_TELEMETRY` / `DO_NOT_TRACK` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` / `DISABLE_GROWTHBOOK` — disable the feature-flag fetching `/schedule` depends on

**3. `settings.json`** — if `~/.claude/settings.json`, the project's `.claude/settings.json`, or `.claude/settings.local.json` exists, Read it and check for (a) an `apiKeyHelper` key — same auth-precedence problem as the API-key variables — and (b) any of the four feature-flag variables from check 2 inside its `env` block, which hides `/schedule` just like a shell variable does.

**If no blocker is found** — proceed to Step 2. Three causes are not detectable from here: the subscription plan (Routines need Pro/Max/Team/Enterprise with Claude Code on the web enabled), a Team/Enterprise Owner may have disabled the organization-wide Routines toggle, and the session may itself be a Claude Code on the web session (where `/schedule` is hidden — manage routines from the web UI instead). If `/schedule` still turns out to be hidden at Step 6, those are the remaining suspects — and the web UI at claude.ai/code/routines works regardless of how the CLI is configured.

**If a blocker is found** — print which one and how to clear it (unset the variable, remove `apiKeyHelper`, or run `claude update`), note that the web UI still works, then ask via `AskUserQuestion` (single-select):

- **Question:** `/schedule is blocked in this session. How do you want to proceed?`
- **Header:** `Fallback`
- **Options:**
  - `Web UI` — description: `Continue the wizard; create the routine at claude.ai/code/routines with prepared copy-paste values.`
  - `CI cron` — description: `Print a GitHub Actions workflow template instead. Works without a Claude subscription.`
  - `Cancel` — description: `Stop; no routine created.`

`Web UI` → continue to Step 2 and use the web fallback path in Step 6. `CI cron` → print Step 1b, then exit cleanly. `Cancel` → exit cleanly.

### Step 1b: CI cron fallback

Print the following as an actionable alternative:

```
Alternative: create a GitHub Actions workflow for scheduled iEvo operations.
Save the following as .github/workflows/ievo-scheduled.yml and adjust the
cron expression and prompt for your use case:
```

Then show this workflow template:

```yaml
name: Scheduled iEvo operations
on:
  schedule:
    - cron: '0 9 * * 1'
  workflow_dispatch: {}

jobs:
  ievo-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          prompt: |
            Run /ievo:security-check to audit all installed skills
            for security vulnerabilities. Post findings as a PR comment
            or write to .ievo/log/scheduled-audit.md.
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Then print:

```
Adjust the cron expression for your preferred schedule (GitHub Actions
cron is UTC):
  0 9 * * *    — daily at 9am UTC
  0 9 * * 1    — weekly, Monday 9am UTC
  0 9 1 * *    — monthly, 1st at 9am UTC
```

Exit cleanly after printing the fallback.

## Step 2: Ask what to schedule

Use `AskUserQuestion` (single-select):

- **Question:** `What iEvo operation should run on a schedule?`
- **Header:** `Operation`
- **Options:**
  - `Security audit` — description: `Re-run /ievo:security-check on all installed skills. Catches supply-chain compromises discovered after initial install.`
  - `Skill refresh` — description: `Run /ievo:update to check for upstream changes to installed skills. Applies updates that pass re-audit.`
  - `Custom` — description: `Enter your own iEvo command or prompt to run periodically.`

If user selects "Custom" (or "Other"), ask a follow-up `AskUserQuestion`:

- **Question:** `What should the routine do? Describe as a prompt.`
- **Header:** `Prompt`
- **Options:**
  - `Run /ievo:init for new skills` — description: `Full discovery + audit + install pipeline.`
  - `Run /ievo:evo capture` — description: `Capture pending evolution lessons from recent sessions.`

The user can select "Other" to type a fully custom prompt.

## Step 3: Ask for schedule frequency

Use `AskUserQuestion` (single-select):

- **Question:** `How often should this routine run?`
- **Header:** `Frequency`
- **Options:**
  - `Weekly (Monday 9am)` — description: `Good default for security audits. Times are your local time.`
  - `Daily (9am)` — description: `For high-churn projects.`
  - `Monthly (1st, 9am)` — description: `Low-overhead for stable projects. Applied as a custom cron expression — see the custom-cron note below.`
  - `One-off (run once)` — description: `Fires a single time at a chosen date/time, then auto-disables. Exempt from the daily routine run cap.`

If the user selects "One-off", ask a follow-up for WHEN, in natural language (e.g. "tomorrow at 9am", "in 2 weeks"). `/schedule` resolves the phrase against the current time and confirms the absolute timestamp before saving. After the routine fires it auto-disables; to run it again the user edits the routine and sets a new one-off time.

The user can select "Other" to provide a custom cron expression. Validate BOTH before accepting:

1. **Format** — 5 space-separated fields (minute hour day month weekday).
2. **1-hour minimum interval** — Routines reject expressions that fire more than once per hour. The minute field must be a single fixed value (no `*`, no `*/n`, no ranges or lists). For example `*/30 * * * *` is rejected; `0 */2 * * *` (every 2 hours, on the hour) is fine.

If either check fails, explain the constraint and re-ask.

**Timezone**: natural-language and preset times are entered in the user's local timezone and converted automatically — the routine runs at that wall-clock time. Runs may start a few minutes after the scheduled time (per-routine stagger). For custom cron expressions the docs do not state an evaluation timezone — confirm the resolved schedule that `/schedule` reports back before finishing.

**Custom-cron mechanics** (Monthly and "Other"): the documented path is to create the routine with the closest preset frequency, then set the exact cron expression with `/schedule update`. Fold this into the Step 6 handoff — no extra decisions are needed from the user beyond the confirmation.

## Step 4: Build the routine prompt

Assemble the full prompt text. The Routine session starts fresh with no memory of this conversation, so the prompt must be self-contained.

### Security audit prompt

```
You are running a scheduled iEvo security audit.

1. Run /ievo:security-check to audit all currently installed skills and agents
   for security vulnerabilities.
2. For each item audited, record the verdict (GREEN / YELLOW / RED).
3. If any RED verdicts are found, create a summary with:
   - Which items were flagged RED
   - The specific findings (file, excerpt, concern)
   - Recommended actions (remove, update, or investigate)
4. Write the summary to .ievo/log/scheduled-audit-<date>.md.

Focus on actionable findings. GREEN items need no detailed report.
```

### Skill refresh prompt

```
You are running a scheduled iEvo skill refresh.

1. Run /ievo:update to check all installed skills and agents for upstream changes.
2. For items with available updates:
   - Re-run /ievo:security-check on the updated version
   - Apply updates that pass with GREEN verdict
   - Flag YELLOW/RED items for manual review
3. Write a summary to .ievo/log/scheduled-refresh-<date>.md listing:
   - Updated items (old to new commit SHA)
   - Items skipped due to security concerns
   - Items already up to date
```

### Custom prompt

Prepend the user's text with a context line:

```
You are running a scheduled iEvo operation.

```

Then append the user's prompt text verbatim.

## Step 5: Confirm with user

Show the assembled configuration and ask for confirmation via `AskUserQuestion`.

Print the configuration:

```
Routine configuration:

  Operation: <operation name from Step 2>
  Schedule:  <frequency / cron expression / one-off timestamp> (<human-readable>)
  Name:      <routine name — see Step 6 naming convention>

Times are your local wall-clock time (converted automatically). Runs may
start a few minutes after the scheduled time due to per-routine stagger.

Heads-up for the creation flow:
- Connectors: ALL of your claude.ai connectors are attached by default, and
  the routine can use every tool they expose — including writes — without
  permission prompts. Remove every connector this routine does not need
  when the creation flow shows the list.
- Repositories: each selected repo is cloned fresh per run; pushes are
  restricted to claude/-prefixed branches unless you enable unrestricted
  pushes (leave restricted for iEvo routines).
- Usage: recurring runs count against a daily per-account routine cap and
  draw subscription usage; one-off runs are exempt from the daily cap.

The routine runs on Anthropic-managed infrastructure — your machine does
not need to be on. Each run starts a fresh Claude Code session.
```

Then ask:

- **Question:** `Create this routine?`
- **Header:** `Confirm`
- **Options:**
  - `Create routine` — description: `Hands off to /schedule (or the web UI) to create it. Modify or delete later with /schedule or the web UI.`
  - `Cancel` — description: `No changes made.`

If "Cancel" — print "No routine created. Run `/ievo:schedule` again when ready." and exit.

## Step 6: Create the routine

Build a routine name from the operation:
- Security audit: `ievo-security-audit`
- Skill refresh: `ievo-skill-refresh`
- Custom: `ievo-scheduled`

If the creation flow reports that a routine with the same name already exists, append a numeric suffix (e.g. `ievo-security-audit-2`). There is no way to enumerate existing routines from this session before the handoff — collision handling happens inside the `/schedule` flow (or on the web form).

**Primary path — in-session `/schedule`.** `/schedule` in the CLI creates scheduled routines only; API and GitHub triggers are added later from the web UI. Ask the user to send the prepared invocation as their next message, for example:

```
/schedule weekly on Monday at 9am, run the iEvo security audit
```

or for a one-off run:

```
/schedule tomorrow at 9am, run the iEvo security audit
```

When the `/schedule` flow activates in this session, Claude walks through the same information the web creation form collects. Supply the configuration assembled in Steps 2–5 — the routine name, the schedule, and the full prompt text from Step 4 — instead of re-asking the user, and apply the Step 5 heads-up: remove connectors the routine does not need, and keep branch pushes restricted. `/schedule` checks whether the account has GitHub access for the selected repositories and prompts `/web-setup` if it does not.

For Monthly or custom-cron frequencies: create the routine with the closest preset, then immediately run `/schedule update` to set the exact cron expression (minimum interval one hour).

**Web fallback** — use when Step 1 routed here, or when `/schedule` turns out to be hidden ("Unknown command"). Direct the user to claude.ai/code/routines → New routine and print the prepared values for copy-paste:

```
Name:     <name>
Schedule: <frequency / cron expression / one-off time>
Prompt:
<full prompt text from Step 4>
```

**If both paths fail** — print the CI cron fallback from Step 1b. Exit without error — the user has the information to proceed manually.

## Step 7: Verify and hand off

After creation is confirmed, suggest the user verify with `/schedule list` and print:

```
Routine "<name>" created.

  Schedule:  <human-readable schedule>
  Operation: <operation>

Manage it:
  /schedule list           — see all routines
  /schedule update         — change schedule or prompt (also sets custom cron)
  /schedule run            — trigger a run immediately
  claude.ai/code/routines  — runs, pause/resume, delete, API and GitHub
                             triggers, connectors, environment

Each run starts a fresh cloud session. A green run status means the session
exited without infrastructure errors — not that the task succeeded. Open a
run to review what it did; files the routine writes (e.g. .ievo/log/
summaries) live in the run's workspace and reach the repo only via a
claude/-prefixed branch.
```

## Rules

- **Explicit confirmation required.** Never hand off to routine creation without Step 5 approval.
- **The only creation surfaces are in-session `/schedule`, the Desktop app, and the web UI** (claude.ai/code/routines). There is no `claude schedule` shell subcommand — verified absent on Claude Code v2.1.201 (2026-07-04): the CLI parses `claude schedule ...` as a session prompt, not a command. Never invoke one, and never probe availability by running one.
- **Times are local wall-clock.** Natural-language and preset times are entered in the user's local zone and converted automatically. Custom cron expressions: minimum interval is one hour; confirm the resolved schedule `/schedule` echoes back.
- **Routine prompts are self-contained.** The scheduled session has no context from this conversation. Include the full skill invocation and expected behavior.
- **Scope down connectors.** All account connectors attach by default with write access and no permission prompts during runs. Step 5 must warn about this, and the Step 6 creation flow should remove every connector the routine does not need.
- **Graceful fallback.** The web UI works regardless of how the CLI is configured; the CI workflow template in Step 1b is the no-subscription path and must be immediately actionable — real YAML the user can copy-paste, not a vague suggestion.
- **No secrets in prompts, no secrets in output.** Routine prompts are stored on external infrastructure — never include API keys, tokens, or sensitive project details in the prompt body. The Step 1 preflight prints environment variable names only, never values.
- **Create only.** This skill creates new routines. For editing, pausing, or deleting, point the user to `/schedule update` or the web UI.

## See also

- Official Routines documentation: https://code.claude.com/docs/en/routines
- `security-check/SKILL.md` — the security audit that the "Security audit" routine runs
- `init/SKILL.md` — the discovery + install pipeline (can be scheduled as a "Custom" operation)
- `hooks-setup/SKILL.md` — event-driven notifications (complements schedule-driven operations: hooks fire on specific events, schedules run on time intervals)
