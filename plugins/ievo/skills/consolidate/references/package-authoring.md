# Package authoring — shared frontmatter templates and write mechanics

This reference covers the exact frontmatter templates and write mechanics for authoring a brand-new project-local skill or agent package from scratch. Two callers share it: `consolidate/SKILL.md`'s entry-cluster mode Step 8 ("Author the extracted package", extracting from already-`/evo`'d overlay entries) and `extract-best-practices/SKILL.md`'s Phase 4 Step 5 (extracting directly from a live session, no overlay involved). Read it only when a candidate was approved for extraction at the calling skill's own checkpoint. The templates below are caller-agnostic; each caller fills in its own `metadata.source` / `extracted_from` values (see the callouts after each template).

## Naming

Derive `name` from the source material's dominant topic (kebab-case): lowercase alphanumerics and hyphens only, no leading/trailing hyphen, no consecutive hyphens, ≤64 characters. It MUST match the directory basename exactly (`validate_skills.mjs`'s `name-dir-mismatch` rule, and the equivalent expectation for agents) — pick the name first, then create the directory with that exact name, not the other way around.

If the derived name collides with an existing project-local skill/agent, ask the user for a disambiguating name via `AskUserQuestion` rather than silently suffixing a number — a silent `-2` suffix is easy to miss and produces a worse `description` match at dispatch time.

## Description

Synthesize from the source material (a cluster's overlay entries, or a session-mined pattern) — state WHAT the package does and WHEN to use it, the same two-part shape every shipped iEvo `description` follows (see any file under `plugins/ievo/skills/*/SKILL.md` for the pattern this repo itself uses). Concretely:
- **What**: the recurring flow (skill) or judgment/stance (agent), generalized past the specific trigger that first surfaced it.
- **When**: the situations that should invoke it — phrased so the description alone (not the body) carries enough signal for description-match routing.

Length ceilings: skill `description` ≤1024 chars (agentskills.io spec, enforced by `validate_skills.mjs`). Agents have no spec-enforced ceiling, but keep it comparably tight (roughly the same order of magnitude) — a bloated agent description is exactly the "always-on token cost" problem this whole flow exists to fix, just moved one level up.

Do not add a `when_to_use` frontmatter field — it is not yet a supported field in this repo (proposed but unmerged as of this writing; `validate_skills.mjs` does not recognize it). Fold trigger phrasing into `description` per the current convention instead.

## Skill template (`SKILL.md` — target path per § Registration below)

```markdown
---
name: <name>
description: <synthesized description — what + when, <=1024 chars>
effort: low
metadata:
  source: <calling skill's name, e.g. consolidate | extract-best-practices>
  extracted_from: <consolidate: root overlay path, e.g. .ievo/evolution/project.md — extract-best-practices: "session-analysis (<ISO-8601 UTC date>)">
  extracted_at: <ISO-8601 UTC timestamp>
---

# <Title Case Name>

<1-2 sentence summary of the procedure, generalized from the cluster or session pattern>

## Steps

<numbered procedure synthesized from the source material — the "do A -> B -> C" flow independently observed>

## Origin

Extracted by `/ievo:<calling skill>` from <consolidate: "N entries in `<root path>`, dated <earliest> to <latest>" — extract-best-practices: "a repeated pattern observed in the current session">. See the source's redirect note (consolidate) or session context (extract-best-practices) for detail.
```

`effort: low` is the safe default for a freshly authored procedure skill unless the source material clearly describes heavier multi-phase reasoning — match effort to what the synthesized body actually asks the agent to do, the same judgment `evo/SKILL.md` uses nowhere explicitly but every shipped skill's frontmatter reflects.

`license:` is deliberately omitted from the template — it is optional per the agentskills.io spec, and unlike this repo's own shipped skills (genuinely MIT), a package synthesized inside an arbitrary end user's project has no established license. Do not default to `MIT` or any other license; only add the field if the user's project already has a clear license convention to match.

The `metadata.source` / `extracted_from` / `extracted_at` fields are NOT the same as the `source:` block `evo/SKILL.md` Step 4 writes into an *overlay* file for a *vendored* target (which records an upstream repo/path/commit). This is original synthesis authored in-project — there is no upstream commit to cite. `source` records which skill did the synthesis (`consolidate` or `extract-best-practices`); these fields exist purely as a provenance breadcrumb for a human later asking "where did this skill come from" (`git blame` on the commit that created the file is the deeper answer).

## Agent template (`.claude/agents/<name>.md`)

```markdown
---
name: <name>
description: <synthesized description — what + when>
model: inherit
metadata:
  source: <calling skill's name, e.g. consolidate | extract-best-practices>
  extracted_from: <consolidate: root overlay path, e.g. .ievo/evolution/project.md — extract-best-practices: "session-analysis (<ISO-8601 UTC date>)">
  extracted_at: <ISO-8601 UTC timestamp>
---

# <Title Case Name>

<1-2 sentence summary of the role/judgment stance, generalized from the cluster or session pattern>

## Approach

<the review posture / judgment rules synthesized from the source material>

## Origin

Extracted by `/ievo:<calling skill>` from <consolidate: "N entries in `<root path>`, dated <earliest> to <latest>" — extract-best-practices: "a repeated pattern observed in the current session">. See the source's redirect note (consolidate) or session context (extract-best-practices) for detail.
```

`model: inherit` is the safe default — only pin a stronger tier (`sonnet`/`opus`) if the source material specifically describes reasoning depth beyond the calling context (mirrors the judgment call in AGENTS.md's "Agent `model:` frontmatter" section). NEVER use a vendor-pinned ID (`claude-sonnet-4-6`, `gpt-5`, etc.) — only the family aliases `sonnet`/`opus`/`haiku`/`fable`/`inherit`.

## Skill+agent pair

Author both templates above. Cross-reference them: the skill's body gets a `## See also` line pointing at the agent (`` `.claude/agents/<name>.md` — <one-line: when the agent's judgment applies instead of/alongside this procedure> ``), and vice versa.

## Registration (project scope only)

Write via the Write tool (not a shell redirect — same reasoning as `feedback/SKILL.md` Step 6 and `init/SKILL.md` Step 8b: synthesized body text may contain backticks or `$(...)`-shaped substrings that a shell would try to expand). Target paths — the invoking client's own load path (`/ievo:init` Step 1.5's rule — `$CODEX_CLI` set, or a Codex Desktop signal when unset; same as `evo/SKILL.md` Step 1; a package written to the other client's dir is stranded where the invoking client never scans, issue #432):
- Skill: Claude Code (Step 1.5: no Codex signal): `<project>/.claude/skills/<name>/SKILL.md`; Codex (Step 1.5: `$CODEX_CLI` set, or a Codex Desktop signal): `<project>/.agents/skills/<name>/SKILL.md`
- Agent: `<project>/.claude/agents/<name>.md` — Claude Code only; Codex documents no project-level custom-agent path (see the calling skill for how an agent-shaped candidate is handled on Codex)

**Ordering — audit the draft, then write.** Both callers run a content security re-audit against the *drafted* body before this write happens (see § Validation before CHECKPOINT 2 below, and `consolidate/SKILL.md` Step 8 item 4 / `extract-best-practices/SKILL.md` Phase 4 Step 5). So draft the body in context first, gate it, and only then Write it — an unoverridden YELLOW/RED verdict then simply means "don't write", never "write and then delete". This is deliberate: neither caller declares a delete capability (consolidate's `compatibility:` is Read/Write/Edit/Glob/Grep), and it mirrors `evo/SKILL.md` Step 2.5, which likewise reads vendored content into context and writes only after the verdict.

No settings/config edit is needed — Claude Code picks up project-scoped `.claude/skills/` and `.claude/agents/` files automatically, and Codex picks up `.agents/skills/` automatically, the same as any other project-local skill/agent (this differs from `init/SKILL.md` Step 9b's *plugin* install path, which does need a settings.json merge — that path is for installing a whole third-party plugin, not authoring a single project-local file).

## Validation before CHECKPOINT 2

Apply (or, in `ievo-ai/skills` itself, literally run) the same checks `validate_skills.mjs` and `validate_agents.mjs` enforce:
- `name` matches `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, ≤64 chars, matches the directory/file basename
- `description` present, skill ≤1024 chars
- `model:` (agent) is one of `sonnet | opus | haiku | fable | inherit` — never a pinned ID

A package that fails any of these is an Anti-Pattern per the calling skill's own Anti-Pattern Detection section (`consolidate/SKILL.md` or `extract-best-practices/SKILL.md`) — fix before presenting the CHECKPOINT 2 diff, never ship an invalid package.

This section covers frontmatter *shape* only. Both callers separately run a **content security re-audit** against the drafted body itself — `security-check/SKILL.md`'s antivirus deep-scan methodology (its Step 3 threat-pattern reasoning + Step 4 verdict construction) applied **inline in the calling session**, before the § Registration write and before CHECKPOINT 2 — mirroring `evo/SKILL.md` Step 2.5's gate for vendored content, applied here to freshly-synthesized content instead. Neither caller dispatches a `security-auditor` sub-agent for this: that agent's § Input takes remote candidate identifiers (`<owner>/<repo>@<skill>`, `<owner>/<repo>:<path>`, `<owner>/<repo>/<plugin>`) and its Step 1 runs `security-check`'s fetch-shaped Steps 1-2, which an unpublished local draft cannot satisfy — and a sub-agent's context isolation adds nothing to content the calling session synthesized itself. See `consolidate/SKILL.md` Step 8 (entry-cluster mode, item 4) or `extract-best-practices/SKILL.md` Phase 4 Step 5 for the exact verdict handling and the YELLOW/RED override gate — frontmatter validation passing does not substitute for it.
