# Step 12 — Post-install verification (Claude Code)

Runs immediately after Step 12's Claude Code summary block prints, ahead of the
`**On Codex**` variant. **Claude Code only** — skip this file entirely on Codex
(`$CODEX_CLI` set), which installs through its own `codex plugin` catalog, not
this one.

The summary is a text confirmation; it cannot detect a silent activation failure
(e.g. an `enabledPlugins` entry left `false` in `settings.json`, or a path
conflict under `.claude/skills/`). Run **both** checks below: **A** covers
everything this run just *wrote* (all `<K>` plugins plus iEvo itself), **B**
covers what the client has *already loaded*. Neither is sufficient alone — a
plugin this run enabled by writing `settings.json` is not in the client's plugin
registry yet (it loads when the user runs the `/reload-plugins` the summary just
asked for), and the registry in turn sees nothing under `.claude/skills/`.

## A — the `enabledPlugins` writes landed

Re-read `.claude/settings.json` with the Read tool (the same field Step 3 parses
for its inventory) and confirm, for iEvo's own Step 2.2 entry **and for every
item in Step 9b's `final_plugin_list`** (the `<K>` plugins the summary just
reported):

- `enabledPlugins["<plugin-name>@<marketplace-name>"]` is present and `true`
  (`"ievo@ievo-skills"` for Step 2.2's entry), and
- the matching `extraKnownMarketplaces.<marketplace-name>` key is present.

A key that is missing or `false` means that item's merge never landed — Step 2.2
and install-protocol.md § 9b both report-and-continue on a failed write, so a
failure arrives here looking exactly like a success. Re-run just that one merge
(Step 2.2 for iEvo, § 9b for a plugin), then re-read. This is the check that
covers the `<K>` plugins Step 9b just enabled: their absence from B is *expected*
until the reload, never a failure signal.

## B — what the client has already loaded

Run the `claude` CLI shell form via Bash — never the interactive `/plugin` slash
form, whose menu this skill can neither drive nor read back (the same reason
`version/SKILL.md` § Rules renders `claude plugin ...` shell commands instead of
slash forms):

```sh
claude plugin list --json
```

It prints a top-level JSON array of installed plugins — `{"id", "version",
"scope", "enabled", "installPath", ...}` per entry (field shape and flag surface
confirmed by running `claude plugin list --json` and `claude plugin list --help`
on Claude Code v2.1.220, 2026-07-26 — `list` accepts only `--available` and
`--json`). Parse it directly (no `jq` needed) and read **every** entry whose `id`
matches `^ievo(@.*)?$`, not just the first — `scope` reports where that copy is
*installed*, so one id can carry one entry per install scope, and a first-match
read can answer for a copy this project doesn't resolve to:

- All matching entries `"enabled"` literally `true` → the plugin layer is loaded,
  which is only half the install. Reaching this branch proves less than it looks:
  this skill is running from iEvo, so iEvo is necessarily loaded from *some*
  scope, and a user-scope install alone reports `true` here — A, not this, is what
  establishes the project-scope entry team sync depends on. And `plugin list` sees
  nothing under `.claude/skills/`, where Step 9a's vendored skills/agents live and
  where the path conflict named above would sit. So finish with the same read-only
  smoke test the degrade branches use — run `/ievo:overlay-status` and confirm it
  lists an overlay for what Step 9a just vendored; only if it doesn't, and only
  when this run actually vendored something (vendor-count gate below), is the
  vendored half incomplete (check `.claude/skills/` for a path conflict).
- Any matching entry `"enabled"` literally `false` → run `claude plugin enable
  <id> -s <scope>`, passing **that same entry's own `id` and `scope` values**,
  then re-run the check above. The `id` is read off the entry for the same reason
  the `scope` is: the `^ievo(@.*)?$` match is deliberately broad, so a hardcoded
  `ievo@ievo-skills` would enable a different plugin than the disabled
  `ievo@<other-marketplace>` copy this check actually found — and leave that copy
  disabled. The id must still be fully qualified, since the bare `ievo` name
  fails (`version/SKILL.md` § Rules); on a normal install the entry's own `id`
  already is (`ievo@ievo-skills`), and if the matched `id` carries no
  `@<marketplace>` suffix, never invent one — degrade read-only instead (below).
  Never run the command unscoped either: `-s` defaults to `user`
  (`version/SKILL.md` § Rules), so omitting it flips the *user* copy while the
  project- or local-scope entry this check actually found stays disabled. If the
  entry carries no `scope` value, detect the scope the way `version/SKILL.md`
  Step 5 does — first `enabledPlugins` key matching `^ievo(@.*)?$` in
  `.claude/settings.json`, then `.claude/settings.local.json`, then
  `~/.claude/settings.json`, `project` → `local` → `user` precedence, first match
  wins — with one deliberate divergence: match the key at whatever value it
  holds, not only at `true`. Step 5 filters on `true` because it is picking the
  scope an *update* should target; the entry being chased here is by definition
  the disabled one, so a `true`-only filter would resolve to a different, healthy
  copy. If the id is unqualified, or no settings file carries the key either,
  degrade read-only rather than mutating an id or a scope you could not confirm:
  report the disabled entry and leave the user to run `claude plugin list` for
  its id and scope, then `claude plugin enable <id> -s <scope>` themselves.
- Command succeeded but no entry matched, or the match's `enabled` is not a
  boolean → inconclusive, **not** a failed install: the shape above is only
  confirmed for the version cited, and a build that wraps or renames the payload
  parses fine and matches nothing (all the more likely to be drift, not breakage,
  when A came back green). Degrade exactly like the unparseable case below rather
  than pushing a possibly-healthy install back through a mutating step — run
  `/ievo:overlay-status` first, and only if that too shows no overlay layer, with
  this run's vendor count non-zero (vendor-count gate below), treat the install
  as genuinely incomplete (re-run Step 9, or check `.claude/skills/` for a path
  conflict).
- Command unavailable or unparseable (no `claude` on `PATH`, non-zero exit, or
  output that isn't JSON — e.g. a build predating `plugin list --json`) → do not
  guess: skip the mechanical check and fall back to the manual smoke test
  instead — run `/ievo:overlay-status` to confirm the overlay layer initialized.

## Vendor-count gate

The `/ievo:overlay-status` smoke test only carries a signal when this run
vendored something. Step 9a writes one overlay file per vendored skill/agent, so
gate every "no overlay layer" reading above on the summary's own counts: run the
smoke test as a *failure* signal only when `<N>` + `<M>` > 0. When both are
zero — every candidate declined by the user, filtered out, or skipped by the
security gate into `<P>` — there is nothing for `/ievo:overlay-status` to list,
so an empty report is this run's correct outcome, not evidence of an incomplete
install: record check A's (and, where it ran, B's) plugin-layer result and stop
there. Never let an empty-by-design vendor set route the run back into re-running
Step 9, or into a `.claude/skills/` path-conflict hunt for files it never wrote.
