---
name: contributor-mode-on
description: "Use this skill when the user wants to opt in to iEvo 'contributor mode' for this project — trigger words \"turn on contributor mode\", \"enable contributor mode\", \"I am a contributor\", \"share more diagnostics with feedback\", \"widen feedback payload\". Enables a project-local, off-by-default consent flag (`.ievo/contributor.flag`) that widens what `/ievo:feedback` MAY offer to attach to a filed report: the environment context it already collects for every report, plus — only when available — the existing scrubbed tool-failure/permission-denial capture stream from `/ievo:evo-auto-enable`. The existing per-report Submit/Cancel confirmation in `/ievo:feedback` is unchanged; this flag only widens the attachment OPTIONS offered and never auto-posts. Does NOT add a session-transcript export or standing consent to skip the per-report confirmation — both are separate, unbuilt proposals (see `## Scope` below)."
license: MIT
effort: low
compatibility: "Any agentskills.io platform. Flag is project-local (`.ievo/contributor.flag`), needs write access to `.ievo/`. Paired with `/ievo:contributor-mode-off`. Widens `/ievo:feedback`'s optional attachments; only produces a NEW attachment option when `/ievo:evo-auto-enable`'s `signal: corrections+failures` has ALSO been opted into separately and has accumulated candidates — contributor mode alone creates no new capture data."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Contributor Mode On — opt in to widened `/ievo:feedback` diagnostics

Turns on a project-local consent flag, `.ievo/contributor.flag`, that widens
what `/ievo:feedback` may OFFER to attach to a filed report. Off by default;
disabled again with `/ievo:contributor-mode-off`.

## Scope (read before enabling) — what this is, and is not

This is **Phase 1** of a two-phase proposal (`ievo-ai/skills#448`). Only Phase
1 is built. Read both lists before enabling.

**What turning this ON actually changes:**
- `/ievo:feedback` gains one additional, always-optional attachment it may
  offer at report time: the existing **scrubbed tool-failure/permission-denial
  capture stream** — the same records `/ievo:evo-auto-enable`'s
  `signal: corrections+failures` already accumulates under
  `.ievo/evolution-candidates/`, each one already redacted by `scrub.mjs`
  before it ever touched disk. Without this flag, `/ievo:feedback` never
  offers that stream, even if it has candidates.
- The environment context `/ievo:feedback` already collects for **every**
  report (client, versions, OS, project stack) is unaffected — that was
  already always included and this flag changes nothing about it.
- The existing per-report **Submit / Cancel confirmation**
  (`/ievo:feedback` Step 5) is completely unchanged: you still see the full
  title + body and approve before anything reaches a public issue, on every
  single report, contributor mode or not.

**What this explicitly does NOT do (out of scope, not built here):**
- **No session-transcript export.** Attaching a distilled session
  transcript/`.jsonl` export is "Phase 2" of `#448` — a separate, larger,
  more security-sensitive capability with no design or approval yet. Turning
  this flag on attaches nothing transcript-shaped, ever.
- **No standing consent to auto-post.** A later `#448` follow-up proposed an
  `/ievo:i-am-contributor` mode that would let `/ievo:feedback` skip the
  per-report confirmation entirely. That is a **different, separate, explicitly
  out-of-scope** proposal — this skill does not implement it, and enabling
  this flag never removes a confirmation step.
- **Creates no new data by itself.** If `/ievo:evo-auto-enable`'s
  failure/denial capture was never turned on, or has no candidates yet, this
  flag changes nothing observable — `/ievo:feedback` still only offers the
  environment-context section it always has.

## When to use

- User says "turn on contributor mode", "enable contributor mode", "I am a
  contributor", "I want to share more diagnostics", "widen feedback payload"
- User wants their `/ievo:feedback` reports to be able to include captured
  tool-failure/permission-denial records for maintainers to diagnose issues
  more precisely

## Steps

### 1. Verify `.ievo/` exists

If `.ievo/` is absent → init hasn't been run in this project. Tell the user:

```
iEvo not initialized in this project. Run /ievo:init first.
Contributor mode widens /ievo:feedback's payload — nothing to widen yet.
```

Exit.

### 2. Show the consent manifest and confirm

This is the **static, category-level consent manifest** — shown in full
before the flag is written, never skipped. Show the user this text (or
render it verbatim in your own words, keeping every point):

```
Contributor mode — what turning this ON allows

When /ievo:feedback files a report while this is ON, it may OFFER (never
auto-attach) to include:

1. Full environment context (client, versions, OS, project stack) — already
   collected for every report, on or off. Unaffected by this flag.
2. The existing scrubbed tool-failure/permission-denial capture stream —
   only if /ievo:evo-auto-enable's "signal: corrections+failures" has
   separately been turned on and has candidates. These records are already
   redacted by scrub.mjs before they ever touch disk.

Every report still shows you the full title + body and asks Submit/Cancel
before anything reaches a public issue (github.com/ievo-ai/skills) — this
flag only widens what MAY be offered as an attachment choice. It never
auto-posts, and it does not attach a session transcript (a separate,
unbuilt, larger proposal).
```

Then ask via `AskUserQuestion`:

- **Question:** `Turn on contributor mode for this project?`
- **Header:** `Contributor mode`
- **Options** (single-select):
  - `Enable (Recommended if you want to share more diagnostics)` — description: `Widens /ievo:feedback's optional attachments as described above. Reversible any time with /ievo:contributor-mode-off.`
  - `Cancel` — description: `Leave contributor mode off. /ievo:feedback keeps working exactly as it does today.`

If the user picks **Cancel**, stop here — write nothing.

### 3. Write the flag file

If the user picked **Enable**, use the Write tool (NOT Bash) to create:

```
file_path: <project>/.ievo/contributor.flag
content:
  enabled: true
  enabled_at: <ISO-8601 UTC timestamp>
  enabled_by: <user identifier if known, else "user-invocation">
  scope: feedback-payload-widening
```

The file format is YAML for easy human reading, mirroring `.ievo/debug.flag`
and `.ievo/evo-auto.flag`. `scope: feedback-payload-widening` names exactly
what this flag does — so a future, separately-approved capability (e.g. a
transcript-export phase) can add its own distinct scope value rather than
silently expanding what an already-enabled flag implies.

### 4. Confirm to user

Print:

```
🧬 iEvo contributor mode ENABLED

Flag: .ievo/contributor.flag (commit to share the setting with teammates)

From now on, /ievo:feedback may offer to attach the scrubbed tool-failure/
permission-denial capture stream to a report, in addition to the environment
context it already always collects. Every report still requires your
Submit/Cancel confirmation before anything is posted.

Want that capture stream to actually have data to offer? Turn on
/ievo:evo-auto-enable's "signal: corrections+failures" option separately —
contributor mode only controls whether /ievo:feedback is ALLOWED to offer it,
not whether it's being captured.

Turn off: /ievo:contributor-mode-off
```

## Rules

- **Idempotent:** if contributor mode is already on, just refresh
  `enabled_at` and confirm — never re-ask the consent question as if it were
  a fresh opt-in.
- **Off by default, project-local:** lives in `.ievo/`, not user config —
  per-project, and shared with teammates only if the flag file is committed.
- **Never skip the consent manifest.** Step 2's manifest text is shown in
  full on every fresh enable — this is the one place contributor mode's scope
  is stated before the user commits to it.
- **Never widen beyond Phase 1.** This skill enables ONLY the capture-stream
  attachment option in `/ievo:feedback`. It must never be extended to cover a
  transcript export or a standing auto-post consent without a fresh,
  separately-approved design — see `## Scope` above.
- **Creates no capture data itself.** This flag is a permission gate on
  `/ievo:feedback`'s attachment offer, not a capture mechanism — the
  underlying tool-failure/denial stream is `/ievo:evo-auto-enable`'s
  `signal: corrections+failures`, opted into independently.

## See also

- `/ievo:contributor-mode-off` — turn contributor mode back off
- `/ievo:feedback` — where the widened attachment option appears (Step 3.9)
- `/ievo:evo-auto-enable` — turns on the underlying tool-failure/permission-
  denial capture stream this flag can offer to attach
- `plugins/ievo/scripts/scrub.mjs` — the privacy scrub every captured record
  already passed through before it reached disk
