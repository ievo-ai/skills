---
name: init
description: Initialize iEvo in the current project — discover and install relevant agent skills from skills.sh through an interview, and prepare the project's evolution log structure. Use when the user runs `/ievo:init`, opens a new project that does not yet have `.ievo/`, or asks "set up iEvo here", "initialize iEvo", or "find skills for this project".
license: MIT
compatibility: Requires the `find-skills` skill from vercel-labs/skills to be installed and reloaded. Requires `npx` and network access for skill installation.
metadata:
  author: ievo-ai
  homepage: https://github.com/ievo-ai/skills
---

# Init

Set up iEvo in the current project by discovering and installing relevant skills from [skills.sh](https://www.skills.sh/) through a per-skill interview. iEvo does not inject anything into `CLAUDE.md` / `AGENTS.md` at init time — those files are only modified later, on the first project-specific evolution.

## Steps

### 1. Verify find-skills is installed

The `find-skills` skill from `vercel-labs/skills` is a hard prerequisite. Without it, the rest of this skill cannot work.

Check if find-skills is available:
- Look for `.claude/skills/find-skills/SKILL.md` (project-local install)
- Or `~/.claude/skills/find-skills/SKILL.md` (user-level install)
- Or a plugin-bundled `find-skills` skill in `.claude/plugins/*/skills/find-skills/SKILL.md`

If **not** installed, stop and instruct the user:

```
The `find-skills` skill is required. Please run:

  npx skills add vercel-labs/skills --skill find-skills
  /reload-plugins

Then run /ievo:init again.
```

Do not proceed. Do not auto-install find-skills — the user needs to reload plugins manually after install, and asking them to reload twice in one flow is bad UX.

### 2. Prepare project directories

Create (if missing):
- `.ievo/evolution/agents/` — per-agent evolution logs
- `.ievo/evolution/skills/` — per-skill evolution logs
- `.claude/` — required by `npx skills add` for project-local installs (without it, the Claude Code symlinks are silently skipped — see vercel-labs/skills bug reports)

Do not create `.ievo/iEVO.md` — iEvo v0.1 does not inject a kernel.

Do not touch `CLAUDE.md` or `AGENTS.md` here. They are only modified on the first project-specific evolution.

### 3. Invoke find-skills

Trigger the `find-skills` skill with the project context. Use this prompt:

```
Use the `find-skills` skill to discover skills relevant to this project.

Examine the project (existing files, manifests like package.json /
pyproject.toml / cargo.toml / go.mod / pom.xml / *.uproject / project.godot,
README content, .claude/ structure) and the user's stated intent (if any).

Return a ranked list of up to 10 candidate skills, each with:
- name (in `<owner>/<repo>@<skill>` format)
- one-line description
- install count
- source repo URL on github.com
- skills.sh URL

DO NOT install anything. Just return the list. I will run the interview
with the user and install only those they accept.
```

Wait for find-skills to return the list.

### 4. Interview: one question per skill

For each candidate skill from find-skills's output, ask the user using the `AskUserQuestion` tool. **One question per skill** (batched in groups of 4, since `AskUserQuestion` supports up to 4 questions per call).

Per-skill question shape:
- **Question:** `Install <skill-name>?`
- **Header:** `<short-tag>` (max 12 chars — e.g. "react", "testing")
- **Options** (single-select):
  - `Install (Recommended)` if install count > 10K, else just `Install` — include description that says: `<one-line desc>. https://skills.sh/<owner>/<repo>/<skill>`
  - `Skip` — description: `Don't install this one.`

The user reads the description (which includes the skills.sh URL) before choosing. They can open the URL to learn more before answering.

### 5. Install selected skills

For each skill the user chose `Install` for:

```bash
npx skills add <owner/repo@skill-name> -y
```

Notes:
- **No `-g` flag** — install project-local into `.claude/skills/<name>/`.
- `-y` suppresses interactive confirmation from the `skills` CLI (we already got user consent in step 4).
- Run each install in its own Bash invocation. If one fails, report the error and continue with the next — do not abort the whole flow.

### 6. Final reminder

After all installs complete, report a summary and remind the user about reload:

```
✓ Installed N skills.

Run `/reload-plugins` to activate them. The skills will appear under
their plugin namespaces (e.g. /react-best-practices:...).

iEvo is set up. From here:
- Use the skills you just installed
- Record lessons with /ievo:evolution "<your lesson>"
- Update later with /ievo:update
```

## Rules

- **Hard prereq, no auto-install of find-skills.** Reload requirement makes auto-install bad UX.
- **One question per skill.** No multi-select batch — user makes informed per-skill decisions with URLs visible.
- **Project-local only.** Never use `-g` here. iEvo is per-project by design.
- **Do not touch CLAUDE.md/AGENTS.md.** Those files only get a marker block when the first project-specific evolution is recorded — that is the `evolution` skill's job, not init's.
- **Idempotent re-runs.** If the user runs `/ievo:init` again later, the directories already exist (fine, do not error). The interview happens again with whatever find-skills suggests now — typically new candidates since some were already installed.
- **Skip find-skills's own install offer.** Tell find-skills explicitly "DO NOT install anything" so we get a plain list and run our own interview.
