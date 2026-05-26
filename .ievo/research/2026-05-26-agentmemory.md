# Research: rohitg00/agentmemory — Persistent Memory for AI Agents

**Date:** 2026-05-26
**Issue:** #113
**Author:** Issue Handler (automated research)
**Status:** Complete — recommendation below

---

## 1. Architecture Map

### What agentmemory is

[rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) is a TypeScript persistent-memory server for AI coding agents. It captures agent activity across sessions (tool calls, file edits, user prompts) and injects relevant context when the next session starts. Runs as a local server on port 3111.

- **Stars:** ~18k (as of May 2026, ~3 months old — created 2026-02-25)
- **License:** Apache-2.0 (the agentmemory project itself)
- **Author:** Rohit Ghumare (`rohitg00`) — **Principal Product Evangelist at iii.dev**
- **NPM:** `@agentmemory/agentmemory` (v0.9.21)
- **LOC:** ~21,800 across 118 source files
- **Tests:** 950+ passing

### How it stores data

- **Storage:** SQLite with in-memory vector index, stored at `~/.agentmemory/`
- **Search:** Triple-stream hybrid — BM25 (keyword) + vector (semantic) + knowledge graph, reranked on-device
- **Benchmarks (claimed):** 95.2% R@5 on LongMemEval-S (ICLR 2025, 500 questions), 2.2x precision vs grep baseline, P50 retrieval under 20ms
- **MCP tools:** 8 core + 43 extended (51 total, gated behind `AGENTMEMORY_TOOLS=all`)
- **REST API:** 124 endpoints on port 3111 (per project README/OpenAPI spec; local network only by default)
- **Hooks:** 12 capture hooks for Claude Code, 6 for Codex CLI, 22 for OpenCode
- **No external DBs** — self-contained by default

### The iii engine — critical dependency

agentmemory does not run standalone. It runs **as a worker on the iii engine** (`iii-hq/iii`), a Rust-based framework described as "replaces Express.js, SQLite/Postgres, pm2, and Prometheus."

iii architecture: **Worker x Function x Trigger**. Workers connect over WebSocket, register functions and triggers, and the engine routes invocations. agentmemory is one such worker.

| Component | License | Inspectable? |
|---|---|---|
| agentmemory (TypeScript) | Apache-2.0 | Yes |
| iii SDKs, CLI, Console, Docs | Apache-2.0 | Yes |
| **iii engine (Rust binary)** | **Elastic License 2.0** | **No — precompiled native binary** |

The iii engine is **NOT open source** per OSI definition. ELv2 permits use in internal applications but **prohibits providing the software as a managed/hosted service** and prohibits circumventing license key functionality.

iii stats: 16.1k stars, 217 releases, latest v0.13.0 (2026-05-25). Active development.

### iii-hq and rohitg00 relationship

Rohit Ghumare is **Principal Product Evangelist at iii.dev**. agentmemory is effectively a **showcase/adoption vehicle** for the iii engine — it drives developer adoption of iii by solving a visible problem (agent memory) while embedding the iii runtime as a hard dependency.

---

## 2. Comparison Matrix

| Axis | agentmemory | iEvo `MEMORY.md` + evolution | Claude Code native | Cursor |
|---|---|---|---|---|
| **Architecture** | Running server (port 3111) + native binary | Plain markdown files, read at session start | `CLAUDE.md` + auto memory (MEMORY.md) | No built-in; community MCP tools |
| **Storage** | SQLite + vector index in `~/.agentmemory/` | `.md` files in project tree | `.md` files in project tree | Varies by community tool |
| **Search** | Hybrid BM25 + vector + knowledge graph | Sequential file read (200-line cap on index) | Sequential file read (200-line cap) | Varies |
| **Cross-platform** | Claude Code, Codex, Cursor, Gemini CLI, OpenCode, + 10 others via MCP | Any agentskills.io platform (files are universal) | Claude Code only | Cursor only |
| **Dependencies** | Node 20+, iii native binary (Rust), NPM | None — plain files | None — built into Claude Code | Varies by tool |
| **Setup** | `npm install -g`, server process, hook wiring | Zero — exists as files in project | Zero — built in | Varies |
| **Query cost** | Local compute, ~170K tokens/year claimed | Zero (file read at session start) | Zero (file read at session start) | Varies |
| **Manual curation** | Auto-capture via hooks, optional manual | Manual curation (user/agent writes files) | Semi-auto (auto memory + manual CLAUDE.md) | Varies |
| **Lock-in** | iii engine (ELv2), @agentmemory NPM org | None — portable markdown | Claude Code platform | Cursor platform |
| **Process model** | Persistent daemon on port 3111 | No process | No process | Varies |
| **Data sovereignty** | Local by default; OTEL traces configurable | Fully local, committed to git | Fully local | Varies |
| **License** | Apache-2.0 (app) + ELv2 (engine) | MIT | Proprietary (platform) | Proprietary (platform) |

### Strengths per system

**agentmemory:** Sophisticated retrieval (hybrid search), automatic capture (hooks), knowledge graphs, cross-platform via MCP, high recall benchmarks. Best for heavy multi-session workflows where manual curation is impractical.

**iEvo MEMORY.md + evolution:** Zero dependencies, zero processes, git-tracked, fully inspectable, universal (files work everywhere). Best for curated, high-signal memory that composes with the evolution overlay system.

**Claude Code native:** Zero-config, built into platform, auto memory learns without setup. Best for users already on Claude Code who want "just works" memory.

### Weaknesses per system

**agentmemory:** Heavy runtime dependency (iii engine native binary under ELv2), requires persistent process, single-vendor supply chain risk, 51 MCP tools is massive tool-surface attack area, benchmarks self-reported.

**iEvo MEMORY.md + evolution:** No semantic search, 200-line index cap, manual curation burden, no auto-capture hooks, no knowledge graph.

**Claude Code native:** Platform-locked, 200-line cap, no cross-session retrieval beyond simple file read, no knowledge graph.

---

## 3. Integration Options Spectrum

### Option A: Endorse only
Add agentmemory to suggested-skills list in `/ievo:init` if user explicitly asks for memory tooling.

| | |
|---|---|
| **Pros** | Zero coupling, zero risk, user choice preserved |
| **Cons** | Passive — doesn't leverage iEvo's position |
| **Effort** | Trivial — one mention in init skill |
| **Risk** | Low |

### Option B: Bundle as MCP
Package iEvo with agentmemory MCP pre-configured (add to default MCP config during init).

| | |
|---|---|
| **Pros** | Seamless UX, users get memory "for free" |
| **Cons** | Hard dependency on iii engine (ELv2), npm install required, running process on user machine, supply chain risk (who controls @agentmemory NPM org?), violates iEvo's "no package.json dependencies" convention |
| **Effort** | Medium — MCP config templates, hook wiring, error handling for server-down |
| **Risk** | **High** — ELv2 engine, native binary users can't inspect, single-vendor governance |

### Option C: Fork/adapter
Wrap agentmemory behind an iEvo-branded API, hide upstream.

| | |
|---|---|
| **Pros** | Control over interface, can swap backend |
| **Cons** | Maintenance burden of fork, still depends on iii engine (ELv2), "embrace-extend" optics, 21k+ LOC to maintain |
| **Effort** | Very high — fork + adapter + ongoing sync |
| **Risk** | **Very high** — inherits all of B's risks plus fork maintenance |

### Option D: Compete
Build iEvo's own memory system, extending the evolution overlay pattern.

| | |
|---|---|
| **Pros** | Full control, no external dependencies, aligns with iEvo's zero-dep philosophy, could leverage Claude Code's auto memory as substrate |
| **Cons** | Significant engineering effort, "not invented here" optics, competing with 18k-star project |
| **Effort** | High — hybrid search, hook integration, storage layer |
| **Risk** | Medium — engineering risk, but no supply chain risk |

### Option E: Ignore
Declare different problem spaces, no integration.

| | |
|---|---|
| **Pros** | No coupling, no maintenance, focus stays on iEvo's core value (skills + security + evolution) |
| **Cons** | May lose mindshare if users expect memory integration, doesn't address "smart zone" pain |
| **Effort** | Zero |
| **Risk** | Opportunity cost only |

---

## 4. Risk Surface

### License risk — CRITICAL

The iii engine runtime is **Elastic License 2.0**, which is:
- **Not OSI-approved open source** — it restricts managed-service use and license-key circumvention
- **Not copyleft** — but also not permissive in the way Apache/MIT are
- A native binary that users cannot inspect, audit, or rebuild from source

If iEvo bundles or recommends agentmemory as a default, every iEvo user inherits this license constraint. Any future iEvo-as-a-service offering would need to navigate ELv2 restrictions on the iii engine.

### Supply chain risk — HIGH

| Vector | Detail |
|---|---|
| **NPM org control** | `@agentmemory` NPM scope — controlled by rohitg00/iii.dev. A malicious update would affect all users. |
| **iii engine binary** | Precompiled Rust binary downloaded from GitHub releases. Not reproducible-build verified. Users trust the artifact. |
| **Primary author** | rohitg00 is the primary author of the agentmemory layer (additional contributors not independently verified). Single-org governance risk is captured in the NPM org control row above. |
| **iii-hq governance** | No documented governance model found. iii engine decisions are made by iii-hq org. |
| **Native binary hooks** | The iii engine intercepts all worker I/O — any telemetry or exfiltration would be invisible at the TypeScript layer. |

### Data egress risk — LOW (with caveats)

- No phone-home behavior documented in README
- OTEL traces export to `memory` (in-process) by default
- Can be reconfigured to export to external collectors (Jaeger, Honeycomb, Grafana Tempo)
- The iii engine binary's behavior at the network layer is **not auditable** without reverse engineering

### Attack surface risk — MEDIUM

- 51 MCP tools is a very large tool surface for any agent client
- 124 REST endpoints on port 3111 — local network exposure
- Hooks capture user prompts, tool inputs/outputs, file access patterns
- `AGENTMEMORY_ALLOW_AGENT_SDK` enables Claude subscription fallback — potential API key exposure

### Conflict with iEvo security model

iEvo's security model (AGENTS.md v0.5.2+) mandates:
- "No owner-based trust shortcuts"
- Content scan alone determines trust
- `security-auditor` deep-scans candidates with current Sonnet reasoning

Recommending agentmemory as a default install would bypass this model — users would get a native binary they can't scan, under a non-OSI license, from a single vendor's NPM scope.

---

## 5. Recommendation: **Modified A — Acknowledge, don't integrate**

### Verdict: Option A with constraints

**Do NOT bundle, fork, or default-install agentmemory.** Instead:

1. **Acknowledge it exists** — if users ask about persistent memory during `/ievo:init` or elsewhere, mention agentmemory as a third-party option alongside other community memory MCP tools.

2. **Do NOT add to default init flow** — the iii engine ELv2 dependency and supply chain risks disqualify it from being a recommended-by-default install. iEvo's value proposition is zero-dep, inspectable, cross-platform. Recommending a proprietary-engine-dependent MCP server contradicts this.

3. **Invest in iEvo's existing memory** — the `MEMORY.md` + evolution overlay system is architecturally sound and aligns with iEvo's zero-dep philosophy. Future improvements should extend this pattern (better indexing, auto-capture hooks at the skill/agent level) rather than outsourcing memory to a third party.

4. **Monitor iii licensing** — if iii-hq relicenses the engine to Apache-2.0 or AGPL-3.0 (truly open source), the risk calculus changes. Worth periodic re-evaluation.

### Why not B (Bundle) or C (Fork)

The iii engine's **Elastic License 2.0** is the dealbreaker. Bundling a non-OSI-licensed native binary as part of iEvo's default install would:
- Contradict iEvo's security model (can't content-scan a native binary)
- Create supply chain risk iEvo can't mitigate
- Lock users into iii-hq's governance decisions
- Violate the "stdlib only, no dependencies" convention

### Why not D (Compete)

Building a competing memory system is premature. Claude Code's native auto memory (shipped Feb 2026) + iEvo's existing MEMORY.md + evolution overlays cover the primary use cases. The gap (hybrid search, auto-capture) is real but not urgent enough to justify the engineering investment when the platform itself is iterating on memory primitives.

### Why not E (Ignore completely)

agentmemory has 18k stars in 3 months. It is the category leader for agent memory. Ignoring it entirely means iEvo can't help users who discover it independently. A minimal acknowledgment ("here's what it is, here are the tradeoffs, here's why iEvo doesn't bundle it") is more helpful than silence.

### What changes in iEvo

No code changes needed for Option A. The acknowledgment can live in documentation or be surfaced verbally by agents during init conversations. No new skills, no new scripts, no new dependencies.

### Composition with #112 (handoff)

The issue correctly identifies that agentmemory and handoff (#112) address the same "smart zone" pain from different angles. They compose rather than compete: handoff branches sessions, agentmemory persists facts. But iEvo's existing evolution overlays already persist facts (in a simpler, inspectable way). The composition opportunity is between handoff and evolution overlays, not handoff and agentmemory.

---

## Acceptance Criteria Status

- [x] Research file at `.ievo/research/2026-05-26-agentmemory.md` (this file)
- [x] Comparison matrix in markdown (Section 2)
- [x] Concrete recommendation: **A (Endorse only, with constraints)** + rationale (Section 5)
- [x] Recommendation = A: no separate proposal issue needed (no implementation work — acknowledgment is passive)
- [ ] `.ievo/memory/CONTEXT.md` update: not applicable (directory does not exist in repo; verdict does not change iEvo strategy — existing approach is validated)
