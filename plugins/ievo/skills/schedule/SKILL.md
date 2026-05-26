---
name: schedule
description: Configure a Claude Code Routine for periodic iEvo operations — recurring security audits, skill-update checks, or custom iEvo commands on a cron schedule. Three-step wizard: pick operation (security audit / skill refresh / custom), pick frequency (daily / weekly / monthly / custom cron), confirm and create. Uses Claude Code Routines for Anthropic-managed execution. Falls back to CI cron instructions when Routines are unavailable (API-key auth, Free plan). Use when the user asks "schedule an iEvo audit", "set up weekly security scan", "automate iEvo", "run iEvo on a schedule", "periodic security check", or "create a routine for iEvo".
license: MIT
effort: low
allowed-tools:
  - AskUserQuestion
  - Bash(claude*)
  - Write
compatibility: Claude Code only — Routines require Pro/Max/Team/Enterprise subscription and Claude Code v2.1.149+. The underlying iEvo operations (/ievo:security-check, /ievo:update) are cross-platform via agentskills.io, but the scheduling wrapper is Claude Code-specific. Codex and other platforms: use the CI cron fallback printed when Routines are unavailable. No external dependencies beyond Claude Code itself.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Schedule — create a Claude Code Routine for periodic iEvo operations

Set up a recurring Claude Code Routine that runs iEvo operations on a schedule — security audits, skill-update checks, or a custom iEvo command. Routines execute on Anthropic-managed infrastructure, so they run even when the local machine is off.

## When to use

- User asks "schedule an iEvo audit", "set up weekly security scan", "automate iEvo"
- User wants recurring security checks on installed skills after initial install
- User wants periodic skill-update discovery so installed skills stay current
- After `/ievo:init` — the natural follow-up is "keep this current automatically"
- User asks "create a routine for iEvo", "run iEvo on a schedule", "periodic security check"

## Step 1: Check Routines availability

Verify Claude Code Routines are accessible in this session:

```bash
claude schedule list 2>&1
```

**If available** (exit code 0) — proceed to Step 2.

**If unavailable** (non-zero exit, "not found", or error message) — print the explanation below, then the CI workflow template from Step 1b, then exit cleanly. Do NOT proceed to Step 2.

Explanation to print:

```
Claude Code Routines are not available in this session.

Possible reasons:
- Routines require a Pro, Max, Team, or Enterprise subscription
- API-key authentication does not support Routines — use OAuth login (claude login)
- Claude Code v2.1.149+ is required
```

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
Adjust the cron expression for your preferred schedule:
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
  - `Run /ievo:evolution capture` — description: `Capture pending evolution lessons from recent sessions.`

The user can select "Other" to type a fully custom prompt.

## Step 3: Ask for schedule frequency

Use `AskUserQuestion` (single-select):

- **Question:** `How often should this routine run?`
- **Header:** `Frequency`
- **Options:**
  - `Weekly (Monday 9am UTC)` — description: `Cron: 0 9 * * 1. Good default for security audits.`
  - `Daily (9am UTC)` — description: `Cron: 0 9 * * *. For high-churn projects.`
  - `Monthly (1st, 9am UTC)` — description: `Cron: 0 9 1 * *. Low-overhead for stable projects.`

The user can select "Other" to provide a custom cron expression. If they do, validate it has 5 space-separated fields (minute hour day month weekday). If invalid, explain the format and re-ask.

All times are UTC. Note this to the user in the confirmation step.

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
  Schedule:  <cron expression> (<human-readable, e.g. "weekly, Monday 9am UTC">)
  Name:      <routine name — see Step 6 naming convention>

All times are UTC. Adjust the cron expression if your preferred time differs.

The routine runs on Anthropic-managed infrastructure — your machine
does not need to be on. Each run starts a fresh Claude Code session.
```

Then ask:

- **Question:** `Create this routine?`
- **Header:** `Confirm`
- **Options:**
  - `Create routine` — description: `Creates the scheduled routine. Modify or delete later with /schedule.`
  - `Cancel` — description: `No changes made.`

If "Cancel" — print "No routine created. Run `/ievo:schedule` again when ready." and exit.

## Step 6: Create the routine

Build a routine name from the operation:
- Security audit: `ievo-security-audit`
- Skill refresh: `ievo-skill-refresh`
- Custom: `ievo-scheduled`

Create via Bash. For the two static templates (security audit, skill refresh),
inline `--prompt` is safe since the content is fully controlled. For Custom
operation prompts, ALWAYS write to a temp file first to prevent shell injection
(user input may contain `$()`, backticks, or other shell metacharacters):

```bash
# Static templates (security audit / skill refresh) — safe inline:
claude schedule create --name "<name>" --schedule "<cron>" --prompt "<static prompt from Step 4>"

# Custom operation — ALWAYS use --prompt-file:
# Write the prompt to /tmp/ievo-routine-prompt.txt first, then:
claude schedule create --name "<name>" --schedule "<cron>" --prompt-file /tmp/ievo-routine-prompt.txt
```

If a routine with the same name already exists, append a numeric suffix (e.g. `ievo-security-audit-2`).

**On failure:** print the error output, then provide manual instructions:

```
Routine creation via CLI failed. You can create it manually:

1. Run /schedule in Claude Code
2. Use these settings:
   - Name: <name>
   - Schedule: <cron>
   - Prompt: <full prompt text from Step 4>
```

Exit without error — the user has the information to proceed manually.

## Step 7: Verify and confirm

After successful creation, verify the routine exists:

```bash
claude schedule list
```

Check the output includes the routine name. Print:

```
Routine "<name>" created successfully.

  Schedule:  <cron> (<human-readable>)
  Operation: <operation>

Manage your routines:
  /schedule list   — view all routines
  /schedule        — create, edit, or delete routines

Each run starts a fresh session. Results are written to .ievo/log/.
```

## Rules

- **Explicit confirmation required.** Never create a routine without Step 5 approval.
- **All times UTC.** State this clearly. Do not convert timezones — cron expressions are opaque enough without hidden conversions.
- **Routine prompts are self-contained.** The scheduled session has no context from this conversation. Include the full skill invocation and expected behavior.
- **Graceful fallback.** When Routines are unavailable, the CI workflow template in Step 1b must be immediately actionable — real YAML the user can copy-paste, not a vague suggestion.
- **No secrets in prompts.** Routine prompts are stored on external infrastructure. Never include API keys, tokens, or sensitive project details in the prompt body.
- **Create only.** This skill creates new routines. For editing or deleting, point the user to `/schedule`.

## See also

- `security-check/SKILL.md` — the security audit that the "Security audit" routine runs
- `init/SKILL.md` — the discovery + install pipeline (can be scheduled as a "Custom" operation)
- `hooks-setup/SKILL.md` — event-driven notifications (complements schedule-driven operations: hooks fire on specific events, schedules run on time intervals)
