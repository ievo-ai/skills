# `.github/workflows-pending/` — temporary staging for this PR

**Delete this directory after applying the workflow below.** This is not a permanent convention — it exists only because the iEvo App token that authored this PR lacks the GitHub `workflows: write` permission (a deliberate privilege-ceiling that prevents a compromised App token from modifying CI), so any push touching `.github/workflows/<file>` is server-side rejected with:

```
refusing to allow a GitHub App to create or update workflow .github/workflows/<file> without 'workflows' permission
```

The check is permission-scoped, not token-scoped — REST API writes are gated the same way.

## Operator: how to apply

Pull the PR branch locally and run:

```bash
git mv .github/workflows-pending/cut-release.yml .github/workflows/cut-release.yml
git rm .github/workflows-pending/README.md
git commit -m "chore(ci): activate cut-release.yml + drop staging dir"
git push
```

The operator push has `workflows: write`, so the file lands at its intended path. Then merge the PR normally. The handler-authored decision-log comments on the PR are the review surface.

If a future handler-authored PR also needs to ship a workflow file, the pattern repeats — re-create this directory + this README. It stays out of `main` between such PRs.
