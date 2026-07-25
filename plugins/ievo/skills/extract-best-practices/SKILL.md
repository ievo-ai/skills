---
name: extract-best-practices
description: Use this skill when a workflow repeated this session, wrapping up and wondering if anything should become a skill, or asked to extract best practices from this session. Mines the current session for repeated multi-step workflows, decision frameworks, or error-recovery patterns never explicitly captured via /ievo:evo. Cross-checks against installed skills/agents, then presents candidates for explicit selection before anything is authored — generalizable patterns become new skills/agents (reusing consolidate's package-authoring machinery); patterns too narrow to stand alone, or refining an existing skill/agent, route to /ievo:evo rather than reinventing overlay-writing. For a marketplace-worthy new package, optionally offers (explicit permission, never silent) to submit a distilled version upstream to ievo-ai/skills, mirroring evo/SKILL.md's upstream-escalation for a full package instead of a lesson. Distinct from /ievo:consolidate's entry-cluster mode, which only clusters already-captured overlay entries.
license: MIT
effort: high
compatibility: "Any agentskills.io-compatible platform. Reasons over the session's own context (no transcript file needed, like /ievo:handoff); Glob + Read for installed-skill discovery; Write to author packages via consolidate/references/package-authoring.md. AskUserQuestion drives both checkpoints and the upstream offer (degrades to yes/no where unsupported). Upstream sharing hands off to /ievo:feedback, which needs `gh`; the mining/authoring flow itself has no `gh` dependency."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Extract Best Practices — Session Pattern Mining

Mines the *current session* — not an overlay, not a file — for repeatable patterns nobody explicitly flagged, and turns the genuinely reusable ones into real, dispatchable skills or agents. Nothing is authored, edited, or posted anywhere without explicit approval at the relevant checkpoint.

## When to use

- You notice you performed the same multi-step workflow more than once this session, and never ran `/ievo:evo` on it
- You're wrapping up a session and wondering "should any of this become a skill?"
- You hit the same error and recovered the same way more than once
- You explicitly invoke `/ievo:extract-best-practices`

## When NOT to use — related but different tools

| Situation | Better tool |
|-----------|-------------|
| You already know the lesson and just want it recorded | `/ievo:evo` — direct, explicit single-lesson capture |
| `.ievo/evolution/project.md` already has accumulated `/evo`'d entries that look clustered | `/ievo:consolidate --root .ievo/evolution/project.md` — entry-cluster mode judges *already-captured* entries, not a live session |
| You want to see what's already captured | `/ievo:overlay-status` |

This skill's job ends where those begin: it finds patterns nobody captured yet, then hands off to the tool that actually owns writing (`/ievo:evo` for a lesson, this skill's own Phase 4 for a new package).

## Phase Overview

```
Phase 1 — Mining          Scan the session for repeatable patterns
Phase 2 — Cross-check     Match against installed skills/agents
Phase 3 — Proposal        Classify + propose disposition   [CHECKPOINT 1]
Phase 4 — Authoring       Write new packages, or hand off to /ievo:evo  [CHECKPOINT 2]
Phase 5 — Upstream        Optional: offer to share a new package upstream
Phase 6 — Report          Summary table
```

---

## Phase 1: Mining

Reason over the current session's own context — the conversation so far, not a transcript file or session log path. This is the same portable approach `/ievo:handoff` Step 2 uses to gather "what this session did": no host-specific file format to assume, works identically on any agentskills.io platform.

Look for three pattern shapes:

- **Procedure** — a multi-step workflow performed more than once, or performed once but unambiguously general and non-trivial ("do A → B → C whenever X happens").
- **Judgment / decision framework** — a recurring reasoning rule applied more than once ("whenever X, prefer Y because Z", a review stance requiring its own context).
- **Error-recovery pattern** — a specific failure and its fix, repeated or clearly reusable beyond this one incident.

**Threshold**: seen 2x in this session, OR clearly reusable from a single occurrence (a well-defined, non-trivial, generalizable procedure doesn't need to repeat to qualify — matching the source anti-pattern this skill is built to respect, see Anti-Pattern Detection below). This is a judgment call, not a mechanical count — the same lightweight style `consolidate/SKILL.md` Step 4 and `evo/SKILL.md` Step 5.7 use for cluster detection: no sub-agent dispatch, no fixed entry-count threshold beyond this floor.

Do NOT flag:
- One-off tasks with no reuse signal
- Project-specific trivia with no generalizable shape
- Anything already captured this session via `/ievo:evo` (that's what it's for — this skill exists for what was *never* flagged, not to duplicate a capture that already happened)

**If nothing qualifies:** report `Nothing to extract — no repeated or clearly-reusable patterns found this session.` and stop. No checkpoints, no writes.

---

## Phase 2: Cross-check against installed skills/agents

Enumerate what's already installed, same client-gated target set `evo/SKILL.md` Step 1 matches lesson targets against (detect the invoking client once via the `$CODEX_CLI` env var — same rule):

**On Claude Code (`$CODEX_CLI` unset) — project-level (preferred):**
- `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`
- `.claude/plugins/*/skills/*/SKILL.md`, `.claude/plugins/*/agents/*.md`

**On Claude Code — user-level (fallback):**
- `~/.claude/skills/*/SKILL.md`, `~/.claude/agents/*.md`
- `~/.claude/plugins/*/skills/*/SKILL.md`, `~/.claude/plugins/*/agents/*.md`

**On Codex (`$CODEX_CLI` set) — skills only:**
- `.agents/skills/*/SKILL.md` (project-level, preferred), `~/.agents/skills/*/SKILL.md` (user-level fallback) — Codex documents no project-level custom-agent path, so there is no agent set to cross-check on Codex

For each pattern from Phase 1, check whether an existing skill/agent's `description` (and, if ambiguous, its body) already covers it. This feeds Phase 3's disposition call — it does not itself write or propose anything.

---

## Phase 3: Proposal [CHECKPOINT 1]

### Step 3: Classify shape

For each pattern, classify using the same three-way vocabulary `consolidate/SKILL.md` entry-cluster mode Step 3 applies to overlay entries, adapted to session-observed patterns:

- **Procedure** → candidate shape: skill
- **Judgment / decision framework** → candidate shape: agent
- **Mixed** → candidate shape: skill+agent pair

Fold error-recovery patterns into whichever shape their content resembles: a specific recovery sequence → skill; a general "when X fails, reason about Y" stance → agent.

### Step 4: Propose disposition

Using Phase 2's scan, propose one of three dispositions per pattern:

- **Option A — Extract to a new skill/agent(/pair)**: no existing coverage, and the pattern is clearly general and reusable beyond this project.
- **Option B — Route to `/ievo:evo`**: covers two cases — (a) the pattern is real but too narrow or project-specific to stand alone, or (b) an existing skill/agent already covers the general shape and this session surfaced a refinement, gap, or extension of it. Either way, `/ievo:evo` already does its own target/scope classification (project-wide vs. the specific skill/agent this refines) in its own Step 1 — this skill does not pre-resolve that, it just hands off.
- **Option C — Skip**: on reflection, no reuse signal despite passing Phase 1's rough filter (e.g. it turns out to be genuinely one-off).

### CHECKPOINT 1

Present every candidate via `AskUserQuestion`, batched up to 4 per call (same batching `feedback/SKILL.md` Step 1b uses for multiple structured questions), each with its proposed disposition and a one-line rationale:

- **Question:** `<pattern summary> — <proposed disposition>. Proceed?`
- **Header:** `<short tag, max 12 chars>`
- **Options** (single-select):
  - `Extract to new skill/agent` — description: `Author a new project-local package now (Phase 4).`
  - `Route to /ievo:evo` — description: `Hand off as a lesson — evo decides the exact overlay target.`
  - `Skip` — description: `Not worth capturing. Nothing happens to this pattern.`

The proposed disposition is a suggestion, not a decision — the user can pick any option regardless of what Step 4 proposed. Wait for explicit approval before any file is created, edited, or handed off. A candidate the user skips ends there.

---

## Phase 4: Authoring [CHECKPOINT 2]

### Step 5: Option A candidates — author the package

Reuse the shared machinery in [`../consolidate/references/package-authoring.md`](../consolidate/references/package-authoring.md) — Naming, Description, the Skill/Agent/Pair templates, Registration, and pre-checkpoint Validation all apply unchanged. The only difference from `consolidate/SKILL.md`'s own use of that reference: set

```yaml
metadata:
  source: extract-best-practices
  extracted_from: session-analysis (<ISO-8601 UTC date of this run>)
  extracted_at: <ISO-8601 UTC timestamp>
```

in place of consolidate's overlay-path `extracted_from` value — there is no single overlay file this pattern came from, it was distilled directly from the session.

### Step 6: Option B candidates — hand off to `/ievo:evo`

Pass the pattern's synthesized description as the lesson text — session-mined patterns have no single verbatim quote to preserve the way a user-stated correction does, so the synthesis itself *is* the lesson; state it plainly, don't dress it up or oversell its generality. Let `evo` run its own Steps 1–5.7 unchanged, including its own upstream-offer (Step 5.6) and cluster-extraction offer (Step 5.7) — this skill's job for that candidate ends at the handoff.

### CHECKPOINT 2

Before Step 5's writes finalize, show a diff summary: packages about to be created (exact paths) and evo handoffs about to run (pattern summary + evo will resolve the target). Wait for approval — same gating discipline as `consolidate/SKILL.md`'s CHECKPOINT 2. A user who declines here for a given candidate leaves it untouched; already-approved-and-written candidates from an earlier batch in the same run are not rolled back.

---

## Phase 5: Upstream sharing (Option A candidates only, optional)

After a Step 5 package write is approved and complete, decide — same lightweight heuristic style as `evo/SKILL.md` Step 5.6, no sub-agent dispatch — whether it's a genuinely marketplace-worthy contribution to `ievo-ai/skills` itself, a materially higher bar than "worth keeping in this project."

**Classify upstream relevance. Default: local — and when local, do NOT prompt.**

Upstream-relevant only when ALL of:
- It's an **Option A** package (an Option B candidate is never offered upstream here — `evo`'s own Step 5.6 already covers upstream escalation for lessons, once handed off in Step 6).
- It contains **no project-specific content** — no internal tool/service names, company-specific paths, secrets, or business logic. The procedure/judgment would help any project doing this kind of work, not just this one.
- It doesn't **duplicate** an existing `ievo-ai/skills` shipped skill (re-use the Phase 2 scan if it happened to include this plugin's own skills) — a near-duplicate is a lesson on the existing skill, not a new contribution.

**When in doubt, stay local** — the offer is a nicety, not a gate; a false nag undercuts the "never create without user approval" discipline this whole flow exists to protect.

**If local:** skip straight to Phase 6. Ask nothing, submit nothing.

**If upstream-relevant:** offer once per candidate via `AskUserQuestion` (never auto-submit):

- **Question:** `<name> looks like a genuinely reusable pattern, not specific to this project — also submit it as a contribution to the ievo-ai/skills marketplace?`
- **Header:** `Share upstream`
- **Options** (single-select):
  - `Share as feedback (Recommended)` — description: `Hands off to /ievo:feedback with the distilled package pre-filled as a Feature proposal. You still review and explicitly confirm before anything is posted publicly.`
  - `Skip` — description: `Keep the package local to this project. Nothing is posted.`

If **Skip** (or the platform can't prompt / has no `feedback` skill available): proceed to Phase 6. Nothing is posted.

If **Share as feedback:** hand off to the `feedback` skill (`/ievo:feedback`) — the same pre-filled-content handoff `feedback/SKILL.md` Step 0 flow (C) already supports for `evo/SKILL.md` Step 5.6, just with a distilled package writeup instead of a one-line lesson as the pre-filled body:

- Pass a pre-filled body: a short paragraph (what the pattern is, why it generalizes, that it was distilled from a project session — no project name/path) followed by the full authored `SKILL.md` (and `agent.md`, if a pair) content in a fenced code block, verbatim from the Step 5 write.
- `feedback` still runs its own Step 1 (classify type — the user typically picks Feature), Step 3 (environment), Step 3.5 (clarify — usually skipped, already detailed), Step 4 (build body, flow-A format — the pre-filled text becomes `<body_en>`), and — critically — **Step 5 (public-posting confirmation gate) unchanged**. Public posting stays behind that explicit `Submit`/`Cancel` gate; this skill never posts anything itself.

Then continue to Phase 6. The locally-authored package from Step 5 already stands regardless of the upstream outcome (share, skip, or cancel at feedback's gate) — it is never deleted or altered based on what happens here.

---

## Phase 6: Report

```
Patterns found:              N
Extracted (new skill/agent): <list of paths, or none>
Routed to /ievo:evo:         <list of pattern summaries, or none>
Skipped:                     <count>
Shared upstream:             <list of feedback issue URLs, or "none offered" / "offered, all skipped" / "offered, cancelled at feedback gate">
```

## Anti-Pattern Detection

Stop and reconsider if any of these hold — kept from the pattern this skill was distilled from:

- **No skill/agent for a one-off task.** Phase 1's threshold (seen 2x, or unambiguously general from one occurrence) exists to stop this.
- **One skill = one concern.** A pattern spanning multiple unrelated concerns should be split into separate candidates before CHECKPOINT 1, never authored as one bloated package.
- **Never create without user approval.** CHECKPOINT 1 gates disposition, CHECKPOINT 2 gates the write/handoff, Phase 5's own gate covers the upstream offer, and `feedback`'s own Step 5 covers the actual public post — four independent gates, none skippable.
- **Never edit an existing skill/agent body directly.** Option B routes through `/ievo:evo`'s overlay model; this skill has no direct-edit path by design, mirroring `evo/SKILL.md`'s own "NEVER modify the agent/skill body" rule.
- **A newly authored package that fails `package-authoring.md`'s validation checklist** (name/directory mismatch, description over length, a vendor-locked `model:` ID) — fix before CHECKPOINT 2, never ship an invalid package.

## See also

- `evo/SKILL.md` — Option B candidates land here (Step 6); its own Step 5.6 (upstream escalation) and Step 5.7 (cluster extraction) run independently once handed off. Its Step 5.6 pattern is what Phase 5 above mirrors for a full package instead of a one-line lesson.
- `consolidate/SKILL.md` — the sibling "does this generalize into a skill/agent" judgment, but triggered by already-`/evo`'d overlay entries (`.ievo/evolution/*.md`) rather than a live, un-flagged session. [`references/package-authoring.md`](../consolidate/references/package-authoring.md) is shared infrastructure between both skills.
- `feedback/SKILL.md` — Phase 5's upstream-sharing handoff target; its flow (C) pre-filled-content path now covers both an `/ievo:evo` lesson and an `/ievo:extract-best-practices` package writeup, public posting always behind its own Step 5 gate.
- `overlay-status/SKILL.md` — lists what's already captured, useful context before a mining run to avoid re-flagging something already `/evo`'d.
