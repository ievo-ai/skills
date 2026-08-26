# Excerpt containment — Step 7b threat model

Rationale for `init/SKILL.md` Step 7b's "Excerpt containment" note. The
**operative rule** — which values to fence, how to size the fence, and the
`Header:` fixed-tag rule — lives inline in that note, next to the templates it
governs; this file records *why* each of those values is attacker-controllable,
so the rule can be re-derived (or extended to a new sink) without re-doing the
provenance work. Other steps' containment notes carry their own rationale
inline; this file covers Step 7b only.

## Why nothing in the interview is validated yet

The `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` slug check in `install-protocol.md` fires
in Step 9, on an item **already picked to install** — i.e. after every question
this step asks has already rendered. Every candidate `name`
(`<skill-name>`/`<agent-name>`/`<plugin-name>`/`<candidate-name>`), the
type=skill `<one-line desc>`, and the type=agent `<owner>/<repo>` reach the
chat UI unvalidated, and an `AskUserQuestion` renders the moment it is shown —
before any Install/Skip/tail choice is made. So a crafted name or description
smuggles a live-rendering exfiltration beacon or a spoofed link with no further
user action.

## The type=skill `<url>` is assembled, not copied — so it inherits the taint

`discover.mjs` emits no `url` field at all: a candidate is `{id, name,
source_repo, source_origin, installs, quality_tier, matched_queries,
rank_score}` — the object `discover.mjs`'s `rankCandidates` builds per id. So
the `skills.sh: <url>` half of that option's `description:` can only be *built*
out of the candidate's own values — its `id`, or its `source_repo` + `name` in
the `https://www.skills.sh/<owner>/<repo>/<skill>` shape
`security-check/SKILL.md` Step 1 uses. All three are copied verbatim off the
skills.sh API row (`searchSkillsSh` spreads each result as-is; `rankCandidates`
then carries that row's `name` and `source` straight through into the candidate
it builds) and are gated only by `rankCandidates`' truthiness check on `id` —
the codex path's `typeof c.id === "string"` filter in `fetchCodexMarketplace` is
no stricter, and neither is a charset check. An `id` or `source_repo` of
`x ![a](https://evil/b.png)` therefore beacons from inside that one
`description:`.

This is why the fence is measured over the **whole assembled URL string** end
to end rather than over the embedded fragment, and why fencing is the right
treatment at all: a fenced URL renders as literal text instead of a live link,
and a bare candidate-supplied link in a rendered option description *is* the
spoofed-link vector above.

## The Tail question's `description:` is an assembled O1 reason, not a system string

It is the `<one-line demotion reason from O1/O2>` assembled back in Step 7a
*(the Filter subsection)*. **O1**'s reason — `overlap: <tool> already covered
by <installed-item>` — embeds two values that inherit the candidate's taint:

- `<tool>` is read straight off the demoted candidate's own name/description —
  that is what makes the rule fire (`ruff` out of `ruff-recursive-fix`).
- `<installed-item>` is untrusted on **both** branches that produce it:
  - Where Step 7b's **live re-check** demoted the candidate, it is another
    candidate the user accepted *earlier this same run* — no more validated
    than the demoted one, since neither has reached Step 9's slug check.
  - Where Step 7a's **original static pass** demoted it, it is an item out of
    Step 3's installed inventory (both sets of demotions land in the same
    `overlap_tail[]` and reach this same Tail question) — a
    `.claude/skills/<name>/` or `.claude/agents/<name>.md` basename, a Codex
    `.agents/skills/<name>/` basename, or a key of `.claude/settings.json`'s
    `enabledPlugins` object. Step 3 reports those verbatim off the working tree
    and settings file and charset-validates none of them, and a POSIX directory
    name may carry any byte but `/` and NUL, so anyone able to land an ordinary
    commit, PR or fork controls one — the same threat model
    `overlay-status/SKILL.md`'s own "Excerpt containment" note applies to its
    Glob-matched basenames.

Hence the same whole-string measurement as the URL. **O2**'s reason — `overlap:
N <domain> specialists already installed` — embeds only Step 4's
locally-detected language/stack grouping and a count, so it needs no
containment; fencing it anyway is harmless.

## Why `Header:` is contained by construction instead

`AskUserQuestion`'s `Header:` is capped at 12 characters, and that budget cannot
hold an untrusted value *plus* a fence: a value sized to the cap grows past it
once the backtick runs are added, and a tag cut back to the cap can lose its
closing run, leaving an unterminated code span — worse than no fence at all. So
the field takes a **fixed** tag chosen in the skill (`Install` for type=skill,
`Vendor` for type=agent, `Plugin` for both type=plugin templates, and a fixed
tag likewise for each plugin sub-interview question) rather than an abbreviated
candidate name. Nothing untrusted is interpolated, so there is nothing left in
that field to contain.
