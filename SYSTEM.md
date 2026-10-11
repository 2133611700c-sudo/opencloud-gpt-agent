# OpenClaw V2 — Canonical System Specification

This file is the single architectural source of truth for V2. The canonical delivery-phase numbering is the 14-phase sequence in this specification and is mirrored with detailed exit criteria in `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`. If phase numbering or scope ever differs, this file and the master roadmap must be corrected in the same verified change before implementation continues.

## 1. Mission

OpenClaw V2 is an autonomous execution system controlled from ChatGPT/GitHub. It must accept a goal, plan it, select agents/skills/tools/models, execute independent work in parallel when useful, inspect web pages and downloaded content, synthesize results, repair bounded failures, independently verify acceptance criteria, preserve evidence, and return a terminal result.

## 2. Control plane

```text
USER / iPHONE
     |
  ChatGPT
     |
   GitHub
     |
OPENCLAW V2
     |
+----+------------------------------+
| Orchestrator     Task Kernel      |
| AI planning      state/retry      |
| routing          permissions      |
| team design      budget/cancel    |
+---------+-------------------------+
          |
 Capability + Agent + Skill Registry
          |
       Planner
          |
     Execution DAG
  +-------+--------+---------+---------+
  |       |        |         |         |
Research Browser Vision/PDF  API     Builder
  |       |        |         |         |
  +-------+---- Data/Synthesis --------+
                  |
               Reviewer
                  |
          failure? -> Repair -> retest
                  |
          Independent Judge
                  |
               Evidence
                  |
        GitHub result / phone
                  |
               ChatGPT
```

## 3. Native-first rule

Do not rebuild OpenClaw features that already exist natively. V2 must use native OpenClaw browser automation, sub-agent sessions, Swarm/Code Mode, skills, media understanding, tools/plugins, model providers, and tool policies. Custom code owns only the missing control-plane semantics: lifecycle, policy, routing, registry, provenance, evidence, task schemas, and integrations.

## 4. Capability universe

V2 may use, when configured and verified:

- web search and fetch
- managed browser automation
- screenshots and browser UI trees
- downloads and file inspection
- image understanding
- PDF/document extraction with vision fallback for scanned/visual pages
- structured data extraction/normalization/deduplication
- authenticated APIs through approved tools/plugins
- GitHub read/write operations within task scope
- code execution and repository work
- native OpenClaw sub-agents and Swarm
- ECC-derived agent-role catalog (71 role templates)
- ECC-derived skill catalog (311 skills)
- dynamic temporary specialist agents
- DeepSeek provider and other explicitly approved model providers
- optional computer-use escalation when browser/API surfaces are insufficient

A catalog entry being present does not mean it is READY. Runtime states: READY, UNTESTED, NEEDS_SECRET, NEEDS_LOGIN, DEGRADED, DISABLED, BLOCKED.

## 5. Perception pipeline

Anything acquired from the internet must be inspectable, not merely downloaded:

```text
acquire -> identify type -> hash/provenance -> extract/understand -> normalize -> verify -> route onward
```

Image/screenshot: native vision or configured image model.
Document/PDF: text extraction first; scanned/visual pages escalate to rendered-image/vision processing.
CSV/JSON/text: parse structurally.
Unknown/executable downloads: quarantine; never execute automatically.

## 6. Agent model

The 71 ECC agents are specialist role templates available to the orchestrator, not 71 always-running processes. The orchestrator creates isolated native OpenClaw sessions only for agents useful to the current task. It may also instantiate a temporary specialist role when the registry has no exact match.

Typical lanes:
- planning/supervision
- discovery/research
- browser operation
- vision/document analysis
- data processing/synthesis
- architecture/build
- specialist review
- failure classification/repair
- testing/verification
- independent judging
- reporting/evidence

## 7. Skill model

All 311 ECC skills are catalogued. A task loads only the smallest relevant subset into each agent. Every applied skill must record id, source/version/hash, agent/session, and task. Unsafe or unverified skills remain non-runnable until reviewed.

## 8. Parallelism

Use ordinary native sub-agents for a few independent workstreams. Use Swarm for larger homogeneous fan-out. Parallelism is bounded by explicit concurrency, task budget, timeout, and cancellation policy. No recursive uncontrolled spawning.

## 9. Model routing

Model assignment is evidence-driven. DeepSeek V4.1 Flash is the initial canonical DeepSeek candidate because it supports text, images, tool calls, and large context through the official provider. Planner/worker/judge roles are finalized only after live comparative tests. Each important role uses an isolated model session. The Judge receives task, acceptance criteria, outputs and evidence, not the Builder's private reasoning.

## 10. Safety boundary

Maximize autonomy inside task scope; minimize authority outside it.

Read/research/analyze/test operations may be highly autonomous. High-impact actions such as payments, public posting, destructive changes, account/security changes, production deployment, secrets handling, or sending communications as the user require explicit policy gates and, where required, operator approval.

Login/2FA/CAPTCHA are manual handoff boundaries; V2 does not bypass protections.

All external web/file content is untrusted and cannot grant itself tools, permissions, secrets, or policy changes.

## 11. Evidence contract

A terminal task result must include:

- task id and immutable acceptance criteria
- final status: PASS / FAIL / BLOCKED / PARTIAL
- one-line outcome
- agents/sessions actually executed
- skills actually applied with provenance
- tools/models actually used
- source URLs/files and timestamps
- relevant screenshots/download hashes/artifacts
- tests and repair attempts
- independent Judge verdict
- GitHub run/commit/artifact references
- explicit next action when not PASS

Selected metadata alone is never proof of execution.

## 12. Migration rule

`main` and legacy branches remain frozen as rollback material while V2 is built. V2 is promoted only after battle-test E2E PASS. Legacy deletion happens only after production cutover and rollback verification.

## 13. Delivery phases — canonical 14-phase sequence

1. **V2 Foundation** — clean branch, minimal project tree, canonical spec, CI, health gate; no legacy runtime dependency.
2. **Persistent State + Durable Kernel** — hosted PostgreSQL, task/node/dependency/accounting/artifact/registry state, deterministic lifecycle, idempotency, checkpoints.
3. **Lease, Fencing, Circuit Breakers** — atomic claims, lease/heartbeat/stale-worker recovery, attempts/steps/token/cost/deadline limits, atomic reservation/reconciliation.
4. **Lite Orchestrator** — minimal deterministic `Research -> Data/Result` DAG, dependency resolver, descendant blocking, task finalizer, deadlock detection.
5. **DeepSeek + Model Accounting** — real DeepSeek through target OpenClaw runtime, isolated sessions, token/cache/latency/pricing accounting linked to task/node.
6. **First Real Research Agent + Web Skill** — one isolated Research Agent using real `web_search`/`web_fetch`, structured sourced output, and full Kernel traversal.
7. **Artifact + Evidence Layer** — durable task/result/source/accounting/trace/error artifacts that survive runner termination.
8. **Phone UX** — terminal status, concise result, cost, next action, and deep-log link suitable for iPhone/GitHub Mobile.
9. **Perception Layer** — images/screenshots/PDF/scans/downloads through MIME detection, extraction, vision/OCR fallback, structured data, and provenance.
10. **Browser Runtime** — isolated browser navigation, snapshots, clicks, typing, pagination, screenshots, downloads, sessions, network/error evidence, with search -> fetch -> browser escalation.
11. **Agent Runtime + Skill Runtime + Sandbox** — native isolated subagents, dynamic skill loading with id/version/hash provenance, bounded tools, sandboxed code execution, incremental specialist enablement.
12. **Full DAG / Parallelism / Repair / Judge** — branching DAG, bounded concurrency, justified subagents/Swarm, synthesis/conflict handling, failure classification, bounded repair/retest, independent Judge.
13. **Capability Scale-Out** — certify remaining agent and skill catalog entries through schema, availability, security, deterministic and integration tests before READY.
14. **Production Cutover + Legacy Deletion** — complete battle suite, production promotion, rollback proof, archive, then approved legacy removal.

Every phase has the rule: build -> deterministic tests -> live test where relevant -> evidence -> PASS -> next phase.

## 14. Phase exit authority

Detailed phase exit criteria live in `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`, but they may not redefine or renumber the 14 canonical phases above. `PROJECT_STATE.json` records the currently verified phase/gates; `docs/EXECUTION_LOG.md` records chronological proof. Neither file may claim PASS for a live gate that was skipped or not directly evidenced.
