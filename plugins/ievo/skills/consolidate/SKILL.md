---
name: consolidate
description: Consolidate fragmented documentation or an iEvo evolution overlay. Two modes, auto-detected from the root file. Doc-graph mode (default, root e.g. CLAUDE.md) maps the reference graph across linked files, finds duplicates and contradictions, proposes a target structure, executes the migration. Entry-cluster mode (root is an overlay file like `.ievo/evolution/project.md`) judges whether accumulated entries describing one recurring procedure or role generalize into a new project-local `.claude/skills/<name>/SKILL.md` or `.claude/agents/<name>.md`, authoring the package from scratch. Five phases (Discovery, Analysis, Proposal, Migration, Verification), three mandatory checkpoints in both modes — nothing created, merged, or deleted without explicit approval. Use when CLAUDE.md/AGENTS.md references many files and it's unclear what lives where, the same rule appears in multiple files, or — via `/ievo:evo`'s post-capture offer — an evolution overlay has grown large enough to warrant extracting a skill or agent.
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
- `.ievo/evolution/project.md` (or another overlay under `.ievo/evolution/`) has accumulated entries that keep describing the same recurring flow or role
- Invoked directly (`/ievo:consolidate --root .ievo/evolution/project.md`), or handed off to from `evo/SKILL.md` Step 5.7 after a lesson capture

## Step 0: Determine root and mode

Parse the invocation for a `--root <path>` flag. If absent, default to `CLAUDE.md`.

**Mode detection:** if the root path matches `.ievo/evolution/*.md` or `.ievo/evolution/**/*.md` (any iEvo overlay file — project-wide, agent, or skill scope) → **entry-cluster mode**. Otherwise → **doc-graph mode**.

The two modes share the same 5-phase, 3-checkpoint skeleton but differ in what a "unit" is (a *file* in doc-graph mode, a dated `## ` *entry* in entry-cluster mode) and what Phase 3 can propose (restructure vs. restructure-or-extract). Steps below are labelled by mode; shared steps have no mode label.

## Phase Overview

```
Phase 1 — Discovery      Map the full dependency graph (or parse entries)     
Phase 2 — Analysis       Duplicates, contradictions, decomposition principle
Phase 3 — Proposal       Target structure, or stay-vs-extract    [CHECKPOINT 1]
Phase 4 — Migration      Consolidate, or author + redirect        [CHECKPOINT 2]
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
- **Option E2 — Extract to a new agent** (judgment/role shape). Same, targeting `.claude/agents/<name>.md`.
- **Option E3 — Extract to a skill+agent pair** (mixed shape). Show both draft packages.
- **Option E4 — Stay in the overlay** — no extraction; the cluster is real but not yet worth the overhead (e.g. too small, too project-specific to generalize into a reusable package, or the user prefers it inline).

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
2. Write the skill (`.claude/skills/<name>/SKILL.md`) and/or agent (`.claude/agents/<name>.md`) via the Write tool, project-scoped — same install model `init/SKILL.md` Step 9 uses for vendored packages, but this is original synthesis, not a vendor copy, so there is no `source:` block and no paired overlay file. No `<!-- ievo:start -->` marker either — that marker is for pre-existing bodies gaining their *first* evolution; a freshly authored package has no evolution history yet. Future lessons about it go through the normal `evo/SKILL.md` flow (Step 2 sees the file already exists locally and skips vendoring; Step 3 injects the marker on its first evolution, same as any project-local target).
3. Validate frontmatter before presenting at Checkpoint 2: apply the same rules `validate_skills.mjs`/`validate_agents.mjs` enforce (name pattern, description length, no vendor-locked `model:` ID) — run the actual scripts when this project is `ievo-ai/skills` itself; otherwise apply the rules by hand.

### Entry-cluster mode — Step 9: Redirect and prune (ONLY after Checkpoint 2 approval)

Never remove entries from the overlay before Checkpoint 2 is explicitly approved — this is the issue's hard requirement, and it mirrors `evo/SKILL.md`'s own "NEVER modify the agent/skill body" / conflict-surfacing caution against silent overrides. Once approved:

1. Replace each migrated entry's body with a one-line redirect: `**Moved to** \`<new-package-path>\` (extracted <YYYY-MM-DD>).` Keep the original heading and date — the overlay stays a truthful chronological record of what happened, it just no longer duplicates content that now lives in the package.
2. Entries in Option E4 clusters, and any entry outside a cluster, are left completely untouched.

### CHECKPOINT 2 (both modes)

Show a diff summary (files created / deleted / changed — entry-cluster mode: packages authored + overlay entries redirected). Wait for approval before finalizing (before Step 9 in entry-cluster mode; the doc-graph mode's Step 8/9 file writes are also gated here, matching the upstream flow).

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

Analogous to doc-graph Step 10, at entry granularity: every entry parsed in Step 1 must be accounted for — either it is in a package authored at Step 8, or it carries the Step 9 redirect note, or it was never in a cluster and is untouched. Flag any entry that vanished with no destination as **MISSING** — stop and report.

### Entry-cluster mode — Step 11: N/A

No dependency graph in this mode (mirrors Step 1's Step 2). Skip.

### Entry-cluster mode — Step 12: Duplicate re-check

Confirm no migrated content is duplicated between the overlay (which now holds only the Step 9 redirect note) and the new package.

### Entry-cluster mode — Step 13: Single source of truth audit

Confirm each migrated fact lives only in the new package — the overlay's redirect note points to it but does not restate it.

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
```

## Anti-Pattern Detection

Stop and warn if:
- A new file is created that references back to a file that references it (new cycle) — doc-graph mode
- Content is moved but not removed from the source (new duplicate created)
- A file ends up containing 3+ content types after migration — doc-graph mode
- Migration is executed without CHECKPOINT 1 approval
- Section/entry inventory (Step 10) has any MISSING entries — never proceed past this
- **Entry-cluster mode:** an overlay entry is redirected or removed before CHECKPOINT 2 approval
- **Entry-cluster mode:** an authored package fails frontmatter validation (name/directory mismatch, description over the length limit, a vendor-locked `model:` ID) — fix before presenting at CHECKPOINT 2, never ship an invalid package

## See also

- `evo/SKILL.md` Step 5.7 — the primary entry-cluster mode caller; offers this skill after a project-wide lesson capture when accumulated entries look generalizable.
- `init/SKILL.md` Step 9 (and [references/install-protocol.md](../init/references/install-protocol.md)) — the vendor/install model this skill's package-authoring step reuses for project-scoped writes, adapted for from-scratch authoring rather than copying an upstream source.
- [references/package-authoring.md](references/package-authoring.md) — full frontmatter templates and the registration mechanism for Step 8 (entry-cluster mode).
