# Entry-cluster mode — package authoring (Step 8 detail)

This reference covers the exact frontmatter templates and write mechanics for `consolidate/SKILL.md`'s entry-cluster mode Step 8 ("Author the extracted package"). Read it only when a cluster was approved for extraction at CHECKPOINT 1.

## Naming

Derive `name` from the cluster's dominant topic (kebab-case): lowercase alphanumerics and hyphens only, no leading/trailing hyphen, no consecutive hyphens, ≤64 characters. It MUST match the directory basename exactly (`validate_skills.mjs`'s `name-dir-mismatch` rule, and the equivalent expectation for agents) — pick the name first, then create the directory with that exact name, not the other way around.

If the derived name collides with an existing project-local skill/agent, ask the user for a disambiguating name via `AskUserQuestion` rather than silently suffixing a number — a silent `-2` suffix is easy to miss and produces a worse `description` match at dispatch time.

## Description

Synthesize from the cluster's entries — state WHAT the package does and WHEN to use it, the same two-part shape every shipped iEvo `description` follows (see any file under `plugins/ievo/skills/*/SKILL.md` for the pattern this repo itself uses). Concretely:
- **What**: the recurring flow (skill) or judgment/stance (agent), generalized past the specific trigger that first surfaced it.
- **When**: the situations that should invoke it — phrased so the description alone (not the body) carries enough signal for description-match routing.

Length ceilings: skill `description` ≤1024 chars (agentskills.io spec, enforced by `validate_skills.mjs`). Agents have no spec-enforced ceiling, but keep it comparably tight (roughly the same order of magnitude) — a bloated agent description is exactly the "always-on token cost" problem this whole flow exists to fix, just moved one level up.

Do not add a `when_to_use` frontmatter field — it is not yet a supported field in this repo (proposed but unmerged as of this writing; `validate_skills.mjs` does not recognize it). Fold trigger phrasing into `description` per the current convention instead.

## Skill template (`.claude/skills/<name>/SKILL.md`)

```markdown
---
name: <name>
description: <synthesized description — what + when, <=1024 chars>
effort: low
metadata:
  source: consolidate
  extracted_from: <root path, e.g. .ievo/evolution/project.md>
  extracted_at: <ISO-8601 UTC timestamp>
---

# <Title Case Name>

<1-2 sentence summary of the procedure, generalized from the cluster>

## Steps

<numbered procedure synthesized from the cluster's entries — the "do A -> B -> C" flow each member entry independently described>

## Origin

Extracted by `/ievo:consolidate` from <N> entries in `<root path>`, dated <earliest date> to <latest date>. See that file's redirect note for the original entries.
```

`effort: low` is the safe default for a freshly authored procedure skill unless the cluster's entries clearly describe heavier multi-phase reasoning — match effort to what the synthesized body actually asks the agent to do, the same judgment `evo/SKILL.md` uses nowhere explicitly but every shipped skill's frontmatter reflects.

`license:` is deliberately omitted from the template — it is optional per the agentskills.io spec, and unlike this repo's own shipped skills (genuinely MIT), a package synthesized inside an arbitrary end user's project has no established license. Do not default to `MIT` or any other license; only add the field if the user's project already has a clear license convention to match.

The `metadata.source: consolidate` / `extracted_from` / `extracted_at` fields are NOT the same as the `source:` block `evo/SKILL.md` Step 4 writes into an *overlay* file for a *vendored* target (which records an upstream repo/path/commit). This is original synthesis authored in-project — there is no upstream commit to cite. These fields exist purely as a provenance breadcrumb for a human later asking "where did this skill come from" (`git blame` on the commit that created the file is the deeper answer).

## Agent template (`.claude/agents/<name>.md`)

```markdown
---
name: <name>
description: <synthesized description — what + when>
model: inherit
metadata:
  source: consolidate
  extracted_from: <root path, e.g. .ievo/evolution/project.md>
  extracted_at: <ISO-8601 UTC timestamp>
---

# <Title Case Name>

<1-2 sentence summary of the role/judgment stance, generalized from the cluster>

## Approach

<the review posture / judgment rules synthesized from the cluster's entries>

## Origin

Extracted by `/ievo:consolidate` from <N> entries in `<root path>`, dated <earliest date> to <latest date>. See that file's redirect note for the original entries.
```

`model: inherit` is the safe default — only pin a stronger tier (`sonnet`/`opus`) if the cluster's entries specifically describe reasoning depth beyond the calling context (mirrors the judgment call in AGENTS.md's "Agent `model:` frontmatter" section). NEVER use a vendor-pinned ID (`claude-sonnet-4-6`, `gpt-5`, etc.) — only the family aliases `sonnet`/`opus`/`haiku`/`fable`/`inherit`.

## Skill+agent pair

Author both templates above. Cross-reference them: the skill's body gets a `## See also` line pointing at the agent (`` `.claude/agents/<name>.md` — <one-line: when the agent's judgment applies instead of/alongside this procedure> ``), and vice versa.

## Registration (project scope only)

Write via the Write tool (not a shell redirect — same reasoning as `feedback/SKILL.md` Step 6 and `init/SKILL.md` Step 8b: synthesized body text may contain backticks or `$(...)`-shaped substrings that a shell would try to expand). Target paths:
- Skill: `<project>/.claude/skills/<name>/SKILL.md`
- Agent: `<project>/.claude/agents/<name>.md`

No `.claude/settings.json` edit is needed — project-scoped `.claude/skills/` and `.claude/agents/` files are picked up automatically by Claude Code and Codex, the same as any other project-local skill/agent (this differs from `init/SKILL.md` Step 9b's *plugin* install path, which does need a settings.json merge — that path is for installing a whole third-party plugin, not authoring a single project-local file).

## Validation before CHECKPOINT 2

Apply (or, in `ievo-ai/skills` itself, literally run) the same checks `validate_skills.mjs` and `validate_agents.mjs` enforce:
- `name` matches `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, ≤64 chars, matches the directory/file basename
- `description` present, skill ≤1024 chars
- `model:` (agent) is one of `sonnet | opus | haiku | fable | inherit` — never a pinned ID

A package that fails any of these is an Anti-Pattern per `SKILL.md`'s Anti-Pattern Detection section — fix before presenting the CHECKPOINT 2 diff, never ship an invalid package.
