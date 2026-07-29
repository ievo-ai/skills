---
name: consolidate
description: Use this skill when CLAUDE.md/AGENTS.md references many files and it's unclear what lives where, the same rule appears in multiple files, or — via `/ievo:evo`'s post-capture offer — an evolution overlay has grown large enough to warrant extracting a skill or agent. Consolidates fragmented documentation or an iEvo evolution overlay. Two modes, auto-detected from the root file. Doc-graph mode (default, root e.g. CLAUDE.md) maps the reference graph across linked files, finds duplicates and contradictions, proposes a target structure, executes the migration. Entry-cluster mode (root is an overlay file like `.ievo/evolution/project.md`) judges whether accumulated entries describing one recurring procedure or role generalize into a new skill/agent authored from scratch, or instead merge into one entry in the same overlay. Five phases (Discovery, Analysis, Proposal, Migration, Verification), three mandatory checkpoints in both modes — nothing created, merged, or deleted without explicit approval.
argument-hint: "[--root <path>]"
license: MIT
effort: high
compatibility: "Any agentskills.io-compatible platform. Uses Read/Write/Edit/Glob/Grep for file operations and AskUserQuestion for the three mandatory checkpoints (degrades to a plain yes/no confirmation prompt on platforms without structured questions). No sub-agent/Task-tool dispatch required — runs entirely inline in the calling session."
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Consolidate — Documentation & Overlay Consolidation

Fixes fragmented doc systems and overgrown evolution overlays: maps dependencies (or entry clusters), eliminates duplication, resolves "source of truth" ambiguity, and — when the source is an iEvo overlay — offers to extract a generalized cluster into a real, dispatchable skill or agent. Stops at 3 user checkpoints in every mode. Nothing is deleted, merged, or authored without explicit approval.

## When to use

**Doc-graph mode** (default):
- `CLAUDE.md`/`AGENTS.md` references N other files and you're unsure what lives where
- The same rule appears in multiple files with slight variations
- Circular references: A → B → A
- A new team member can't figure out which file to update

**Entry-cluster mode** (root is an iEvo overlay file):
- Any overlay under `.ievo/evolution/` — project-wide (`project.md`), agent-scope (`agents/<name>.md`), or skill-scope (`skills/<name>.md`) — has accumulated entries that keep describing the same recurring flow or role
- Invoked directly (`/ievo:consolidate --root .ievo/evolution/project.md`, or `--root .ievo/evolution/agents/<name>.md` / `--root .ievo/evolution/skills/<name>.md`), or handed off to from `evo/SKILL.md` Step 5.7 after any overlay capture, regardless of scope

## Step 0: Determine root and mode

Parse the invocation for a `--root <path>` flag. If absent, default to `CLAUDE.md`.

**Mode detection:** if the root path matches `.ievo/evolution/*.md` or `.ievo/evolution/**/*.md` (any iEvo overlay file — project-wide, agent, or skill scope) → **entry-cluster mode**. Otherwise → **doc-graph mode**.

The two modes share the same 5-phase, 3-checkpoint skeleton but differ in what a "unit" is (a *file* in doc-graph mode, a dated `## ` *entry* in entry-cluster mode) and what Phase 3 can propose (restructure vs. restructure-or-extract). Steps below are labelled by mode; shared steps have no mode label.

## Phase Overview

```
Phase 1 — Discovery      Map the full dependency graph (or parse entries)     
Phase 2 — Analysis       Duplicates, contradictions, decomposition principle
Phase 3 — Proposal       Target structure, or stay-vs-consolidate-vs-extract   [CHECKPOINT 1]
Phase 4 — Migration      Consolidate, or author + redirect, or merge in place       [CHECKPOINT 2]
Phase 5 — Verification   No broken refs / no orphaned entries     [CHECKPOINT 3]
```

---

## Phase 1: Discovery

### Doc-graph mode — Step 1: Collect all files

Starting from the root file:
1. Read the file.
2. Extract all file references: `Read X.md`, `See X.md`, `X.md for ...`, `→ X.md`, markdown links `[text](path)`.
3. For each referenced file: read it, extract its references.
4. Repeat recursively until no new files are found.
5. Stop recursion on files already visited (cycle detection).

Output: flat list of all files in the graph.

### Doc-graph mode — Step 2: Build dependency graph

For each file in the list, record `references: [...]` and `referenced_by: [...]`. Identify:
- **Roots** — files with no incoming edges (entry points)
- **Sinks** — files with no outgoing edges (leaf documents)
- **Cycles** — A → B → ... → A (list every cycle found)
- **Orphans** — files that exist on disk but are not referenced anywhere

Output: dependency graph summary + cycle list.

### Entry-cluster mode — Step 1: Parse entries

The root is a single flat overlay file — there is no reference graph to walk. If the root path does not exist on disk (e.g. `/ievo:consolidate --root .ievo/evolution/project.md` invoked before any `/ievo:evo` capture has run), report `Nothing to consolidate — <path> does not exist yet.` and exit cleanly (no checkpoints, no writes). Otherwise read it and split into its dated sections: every `## <YYYY-MM-DD HH:MM UTC> — <title>` heading starts a new entry, running until the next `## ` heading or EOF. Capture per entry: `date`, `title`, `trigger` (the `**Trigger:** ...` line), and `body` (the verbatim lesson text below it).

If the file has fewer than 2 entries, there is nothing to cluster — report `Nothing to consolidate — <path> has 0-1 entries.` and exit cleanly (no checkpoints, no writes).

### Entry-cluster mode — Step 2: N/A

No dependency graph exists in this mode (one file, no cross-references to map). Skip; note in the final report that Step 2 does not apply.

---

## Phase 2: Analysis

### Doc-graph mode — Step 3: Content classification

For each file, classify what content types it contains: `architecture`, `conventions`, `commands`, `workflow`, `agent-rules`, `project-state`, `external-refs`. Note files with **multiple content types** — consolidation candidates.

### Doc-graph mode — Step 4: Duplicate detection

For every pair of files, scan for identical blocks, semantic duplicates, and partial overlap. Output: duplicate inventory with file pairs and content excerpts.

### Doc-graph mode — Step 5: Contradiction detection

For any topic appearing in 2+ files, check agreement: different counts, different paths for the same concept, "always X" vs "X is optional", stale copy updated in one place but not another. Output: contradiction list with file/line references.

### Doc-graph mode — Step 6: Decomposition principle

Infer the current organizing principle: by domain, by role/audience, by process, by layer, or mixed/unclear. Rate the current structure: does each file have a single clear responsibility?

### Entry-cluster mode — Step 3: Content classification

For each entry, classify its shape:
- **Procedure** — describes a repeatable flow ("do A → B → C whenever X happens"). Candidate for extraction to a **skill**.
- **Judgment/role** — describes a repeatable stance or review posture needing its own context ("always push back when X", "act as the Y reviewer"). Candidate for extraction to an **agent**.
- **Fact/convention** — a project-wide fact or one-off rule ("we use Python 3.12", "never commit .env"). NOT a candidate — stays in the overlay regardless of cluster size.

### Entry-cluster mode — Step 4: Cluster detection (LLM judgment, no mechanical threshold)

Group entries that independently describe the **same recurring flow or role** — semantic overlap, not just shared keywords. This is a judgment call made the same lightweight way `evo/SKILL.md` Step 1 classifies lesson scope: no sub-agent dispatch, no fixed entry-count threshold. Two entries are enough to form a cluster if they clearly describe one recurring thing; ten entries about ten unrelated topics form no cluster at all. Output: list of clusters, each with its member entries and a provisional shape (procedure / judgment-role / mixed).

### Entry-cluster mode — Step 5: Contradiction detection

Within a cluster, check whether member entries agree. A later entry that revises an earlier one is not a contradiction (evolution overlays are chronological — the later entry wins per `evo/SKILL.md`'s own "Conflict surfacing" rule) unless both are still independently asserted as current. Flag genuine unresolved contradictions; do not silently pick one.

### Entry-cluster mode — Step 6: Decomposition principle

For each cluster from Step 4, decide the shape using Step 3's classification of its members:
- All members **procedure** → shape = **skill**
- All members **judgment/role** → shape = **agent**
- Mixed → shape = **skill+agent pair** (the repeatable "how" becomes the skill, the review stance/judgment becomes the agent that may invoke it)

Clusters made only of **fact/convention** entries are not extraction candidates — drop them from further consideration and leave them in the overlay untouched.

---

## Phase 3: Proposal [CHECKPOINT 1]

### Doc-graph mode — Step 7: Define target structure

Propose one of:
- **Option A — Flatten**: everything in CLAUDE.md, no external refs. Good for small projects with <5 topics.
- **Option B — Two-layer**: CLAUDE.md (project) + one conventions file. Good for medium projects.
- **Option C — Role-based hierarchy**: files split by audience (agent vs human vs CI). No cycles by design.
- **Option D — Process-based hierarchy**: files split by pipeline stage. Each stage doc is self-contained.

For the recommended option, show what stays, what moves, what gets deleted, what gets merged, what gets created.

### Entry-cluster mode — Step 7: Propose stay-vs-extract per cluster

For each cluster surviving Step 6, propose one of:
- **Option E1 — Extract to a new skill** (procedure shape). Show a draft `name` (kebab-case) and one-paragraph `description` synthesized from the cluster's entries, and which entries move.
- **Option E2 — Extract to a new agent** (judgment/role shape). Same, targeting `.claude/agents/<name>.md`. On Codex (`$CODEX_CLI` set), E2 — and E3's agent half — is unavailable: Codex documents no project-level custom-agent path (see Step 8), so state that at this checkpoint and offer E1/E4/E5 for the cluster instead.
- **Option E3 — Extract to a skill+agent pair** (mixed shape). Show both draft packages.
- **Option E4 — Stay in the overlay** — no extraction; the cluster is real but not yet worth the overhead (e.g. too small, too project-specific to generalize into a reusable package, or the user prefers it inline).
- **Option E5 — Consolidate in place** — no new package; merge the cluster's members into one deduplicated entry that stays in the *same* overlay. Fits a cluster that is real and recurring but intrinsically tied to this overlay's own scope (e.g. several entries refining the same point about the agent/skill/project this overlay already belongs to) rather than generalizable into a standalone, dispatchable package. Show the draft merged entry (title, trigger, body) that will replace the cluster's members.

Entries not in any cluster (Step 4) are never proposed for extraction — they are out of scope for this run and stay untouched regardless of the checkpoint outcome.

### CHECKPOINT 1 (both modes)

Present the full proposal — every option considered, the recommended one, and the exact set of entries/files it touches. Wait for explicit user approval via `AskUserQuestion` before any file is created, merged, or deleted. A user who picks Option E4 for a cluster (or declines entirely) ends the run for that cluster with no writes.

---

## Phase 4: Migration

### Doc-graph mode — Step 8: Consolidate content

For each file in the new structure: collect all content belonging to it, deduplicate (keep the most complete/current version of each rule), resolve contradictions (use the most recent source, note the decision), write the file. For files being deleted or emptied: add a one-line redirect (`# Moved to X.md`) or delete entirely if fully superseded.

### Doc-graph mode — Step 9: Fix cross-references

After all files are written, scan every file for references to old paths, update to new paths, verify no broken refs remain.

### Entry-cluster mode — Step 8: Author the extracted package

For each cluster approved at Checkpoint 1 (Option E1/E2/E3), author the package(s) from scratch — this is new logic, not file-to-file content moves. Full frontmatter templates, naming/description rules, and the registration mechanism are in [references/package-authoring.md](references/package-authoring.md); summary:

1. Finalize `name` (agentskills.io pattern: lowercase alnum + hyphens, ≤64 chars, must match the directory basename) and `description` (skill: ≤1024 chars; agent: keep equally tight for routing clarity) — synthesized from the cluster's entries, stating WHAT the package does and WHEN to use it.
2. Write the skill into the invoking client's project skill path (`$CODEX_CLI` env var rule, same as `evo/SKILL.md` Step 1 — `.claude/skills/<name>/SKILL.md` on Claude Code, `.agents/skills/<name>/SKILL.md` on Codex; writing to `.claude/skills/` from a Codex session strands the package where Codex never scans, issue #432) and/or agent (`.claude/agents/<name>.md` — Claude Code only: Codex documents no project-level custom-agent path, so on Codex an agent-shaped cluster cannot be registered — say so at Checkpoint 1 and offer the skill shape or leaving the entries in the overlay instead; never fall back to writing `.claude/agents/` from a Codex session) via the Write tool, project-scoped — same install model `init/SKILL.md` Step 9 uses for vendored packages, but this is original synthesis, not a vendor copy, so there is no `source:` block and no paired overlay file. No `<!-- ievo:start -->` marker either — that marker is for pre-existing bodies gaining their *first* evolution; a freshly authored package has no evolution history yet. Future lessons about it go through the normal `evo/SKILL.md` flow (Step 2 sees the file already exists locally and skips vendoring; Step 3 injects the marker on its first evolution, same as any project-local target).
3. Validate frontmatter before presenting at Checkpoint 2: apply the same rules `validate_skills.mjs`/`validate_agents.mjs` enforce (name pattern, description length, no vendor-locked `model:` ID) — run the actual scripts when this project is `ievo-ai/skills` itself; otherwise apply the rules by hand.
4. **Re-audit before Checkpoint 2 (security).** Item 2's write above just placed unreviewed content in `<project>/.claude/skills/<name>/SKILL.md` or `<project>/.claude/agents/<name>.md` — the project's trusted, auto-dispatched-by-name-or-description directory — and the source cluster's entries can carry attacker-influenced text: `evo/SKILL.md`'s "no paraphrasing, no sanitization" rule means a captured lesson is never sanitized before it lands in the overlay this cluster was drafted from. Gate the just-written file(s) exactly like `evo/SKILL.md` Step 2.5 gates a freshly vendored package, before Checkpoint 2 is presented:
   - **On Claude Code or Codex** (`Task`/`AskUserQuestion` available in this session): dispatch, per file just written,
     ```
     Task(subagent_type="security-auditor",
          prompt="Audit the freshly-authored <path> (type=<skill|agent>) for injected/malicious instructions")
     ```
     - **GREEN** → include this package at Checkpoint 2.
     - **YELLOW or RED** → do not present this package at Checkpoint 2 yet. Ask via `AskUserQuestion`: `<type>/<name> was flagged <verdict> on re-audit: <top 1-2 flags — category + one-line explanation>. Keep it anyway?` — options `Keep anyway (I've reviewed the flags)` (include at Checkpoint 2) or `Discard — do not extract this cluster` (delete the file(s) just written; the cluster's entries stay untouched in the overlay, same end state as Option E4).
     - **No interactive session available** (headless/scheduled run — same detection as `evo/SKILL.md` Step 2.5): auto-select `Discard`, same as an explicit decline, and note it in the final report (Checkpoint 3) as `DISCARDED — flagged <verdict>, no interactive session to confirm`.
   - **On any other platform** (no `Task`/sub-agent tool, or no `AskUserQuestion`): apply the antivirus deep-scan methodology from `security-check/SKILL.md` directly against the written content instead of dispatching a sub-agent — the same fallback `evo/SKILL.md` Step 2.5 documents for the identical constraint. Since there is also no way to prompt interactively here, treat YELLOW/RED as an unconditional discard — no "keep anyway" option, same outcome as the no-interactive-session case above.
   - Never fabricate a lower verdict, or silently keep a YELLOW/RED package at Checkpoint 2 without an explicit (or auto, for a headless run) override — this closes the same gap `evo/SKILL.md` Step 2.5 closes for vendored content, applied here to freshly-synthesized content instead.

For a cluster approved as **Option E5** instead, there is no package to author: draft the single merged entry directly — heading `## <today, YYYY-MM-DD HH:MM UTC> — <synthesized title>`, a `**Trigger:**` line noting it consolidates the cluster's N members (list their original dates so the "what changed and why" breadcrumb survives the merge even though git history is the full record), then a deduplicated body covering every source entry's content. Steps 1-4 above (name/description/frontmatter validation/re-audit) don't apply — skip them. The merged entry is appended to the end of the overlay at Step 9 below (never inserted where the deleted members used to sit).

### Entry-cluster mode — Step 9: Redirect, consolidate, and prune (ONLY after Checkpoint 2 approval)

Never remove entries from the overlay before Checkpoint 2 is explicitly approved — this is the issue's hard requirement, and it mirrors `evo/SKILL.md`'s own "NEVER modify the agent/skill body" / conflict-surfacing caution against silent overrides. Once approved, handle each cluster per the option chosen at Checkpoint 1:

1. **Option E1/E2/E3 (extract to a new skill/agent):** replace each migrated entry's body with a one-line redirect: `**Moved to** \`<new-package-path>\` (extracted <YYYY-MM-DD>).` Keep the original heading and date — the overlay stays a truthful chronological record of what happened, it just no longer duplicates content that now lives in the package. The new package is not loaded by default, so the pointer carries real navigation value.
2. **Option E5 (consolidate in place):** delete the cluster's member entries outright from their original positions, then append the single merged entry (drafted at Step 8, dated today) at the end of the overlay — same as any newly-appended entry (`evo/SKILL.md` Step 4 always appends; never insert it positionally where an old member used to be, since the overlay is a strictly chronological record and a today-dated entry sitting among earlier, untouched entries would break that ordering). Do NOT leave a redirect stub here — the merged entry lives in this exact overlay file, which is already loaded in full every time this overlay is loaded (every session for `project.md`, every dispatch of the target agent/skill for an agent- or skill-scope overlay per `evo/SKILL.md` Step 5.7) — a stub pointing elsewhere in the same loaded file adds tokens with zero information. The same reasoning applies whenever the destination is otherwise-always-loaded context (e.g. the project canon file `AGENTS.md`/`CLAUDE.md`, which loads `project.md` via its marker block).
3. Entries in Option E4 clusters, any entry outside a cluster, and any E1/E2/E3 cluster discarded at Step 8's re-audit gate, are left completely untouched.

### CHECKPOINT 2 (both modes)

Show a diff summary (files created / deleted / changed — entry-cluster mode: packages authored + overlay entries redirected or consolidated in place). Wait for approval before finalizing (before Step 9 in entry-cluster mode; the doc-graph mode's Step 8/9 file writes are also gated here, matching the upstream flow).

---

## Phase 5: Verification

### Doc-graph mode — Step 10: Section inventory check (content completeness)

Before Phase 4 finalizes, extract a section inventory from all source files: for every `## Heading`/`### Subheading`, record `file → heading → first 50 chars`. After migration, verify every heading is accounted for (appears in a new file, or was an explicit duplicate with one copy kept). Output: `source section → destination file` table. Flag any section with no destination as **MISSING** — stop and report; do not proceed until every section is placed or explicitly discarded by the user.

### Doc-graph mode — Step 11: Graph re-check

Re-run Phase 1 on the new structure: no cycles, no orphans (unless intentional), every referenced file exists.

### Doc-graph mode — Step 12: Duplicate re-check

Re-run Step 4 on the new structure: zero duplicates.

### Doc-graph mode — Step 13: Single source of truth audit

For each content type from Step 3, confirm it lives in exactly one file now.

### Entry-cluster mode — Step 10: Entry inventory check

Analogous to doc-graph Step 10, at entry granularity: every entry parsed in Step 1 must be accounted for — either it is in a package authored at Step 8, or it carries the Step 9 redirect note, or it was merged into a Step 9 in-place consolidated entry (Option E5), or its cluster was discarded at Step 8's re-audit gate and it remains untouched (same end state as Option E4), or it was never in a cluster and is untouched. Flag any entry that vanished with no destination as **MISSING** — stop and report.

### Entry-cluster mode — Step 11: N/A

No dependency graph in this mode (mirrors Step 1's Step 2). Skip.

### Entry-cluster mode — Step 12: Duplicate re-check

For Option E1/E2/E3 clusters, confirm no migrated content is duplicated between the overlay (which now holds only the Step 9 redirect note) and the new package. For Option E5 clusters, confirm the merged entry doesn't duplicate content living elsewhere in the overlay.

### Entry-cluster mode — Step 13: Single source of truth audit

Confirm each migrated fact lives in exactly one place: in the new package for Option E1/E2/E3 (the overlay's redirect note points to it but does not restate it), or in the single merged entry for Option E5 (with no leftover per-member stub, since there is nothing on-demand to point at).

### CHECKPOINT 3 (both modes)

Present the final report:

```
Files/entries before:      N
Files/entries after:       M
Sections/entries total:    S   (tracked from Step 10)
Sections/entries moved:    S   (must equal total — zero missing)
Duplicates removed:        K
Contradictions resolved:   J
Cycles broken (doc-graph): C
Packages authored (entry-cluster): <list of new skill/agent paths, or none>
Entries consolidated in place (entry-cluster): <list of merged clusters, or none>
```

## Anti-Pattern Detection

Stop and warn if:
- A new file is created that references back to a file that references it (new cycle) — doc-graph mode
- Content is moved but not removed from the source (new duplicate created)
- A file ends up containing 3+ content types after migration — doc-graph mode
- Migration is executed without CHECKPOINT 1 approval
- Section/entry inventory (Step 10) has any MISSING entries — never proceed past this
- **Entry-cluster mode:** an overlay entry is redirected, merged, or removed before CHECKPOINT 2 approval
- **Entry-cluster mode:** an authored package fails frontmatter validation (name/directory mismatch, description over the length limit, a vendor-locked `model:` ID) — fix before presenting at CHECKPOINT 2, never ship an invalid package
- **Entry-cluster mode:** an authored package flagged YELLOW/RED on Step 8's re-audit is presented at CHECKPOINT 2, or left on disk, without an explicit (or auto, for a headless run) override — discard it instead
- **Entry-cluster mode:** an Option E5 merged entry drops content present in any of its source entries — never lossy-merge
- **Entry-cluster mode:** a redirect stub is left for an Option E5 cluster instead of a full delete (the destination is the same already-loaded overlay — a stub there is noise, not signal)

## See also

- `evo/SKILL.md` Step 5.7 — the primary entry-cluster mode caller; offers this skill after any overlay capture (project-wide, agent-scope, or skill-scope) when accumulated entries look generalizable.
- `init/SKILL.md` Step 9 (and [references/install-protocol.md](../init/references/install-protocol.md)) — the vendor/install model this skill's package-authoring step reuses for project-scoped writes, adapted for from-scratch authoring rather than copying an upstream source.
- [references/package-authoring.md](references/package-authoring.md) — full frontmatter templates and the registration mechanism for Step 8 (entry-cluster mode). Shared with `extract-best-practices/SKILL.md`'s Phase 4, which extracts from a live session instead of already-`/evo`'d overlay entries.
- `extract-best-practices/SKILL.md` — the sibling "does this generalize into a skill/agent" judgment, triggered by a live, un-flagged session rather than entries already captured in an overlay. Its own Phase 4 Step 5 carries the same re-audit gate as this skill's Step 8.
- `security-check/SKILL.md` — the antivirus deep-scan methodology Step 8's re-audit above applies as a fallback when no `security-auditor` sub-agent is available, the same technique `evo/SKILL.md` Step 2.5 uses for a vendored package (see its own See-also entry).
