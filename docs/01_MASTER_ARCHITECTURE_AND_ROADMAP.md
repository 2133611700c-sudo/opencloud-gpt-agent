# OpenClaw V2 — Master Architecture and Roadmap

## Target architecture

USER / iPHONE
    |
 ChatGPT
    |
 GitHub Dispatch
    |
    v
+--------------------------------------------------+
|                 OPENCLAW V2                      |
|                                                  |
| Intake / Idempotency                             |
|        |                                         |
| Task Kernel ---------------- Hosted PostgreSQL   |
|        |                    Source of Truth       |
|        |                                         |
| Circuit Breakers / Budgets / Leases / Fencing   |
| HITL Approval / Deadlines / Checkpoints          |
|        |                                         |
|        v                                         |
| Orchestrator / Planner -> Execution DAG          |
|        |                                         |
|   +----+------+---------+----------+----------+   |
|   |           |         |          |          |   |
| Research    Browser   Vision/PDF   API      Builder|
|   |           |         |          |        Sandbox|
|   +-----------+----- Data/Synthesis ----------+   |
|                         |                        |
|                      Reviewer                     |
|                         |                        |
|                  failure -> Repair               |
|                         |                        |
|                   Independent Judge              |
|                         |                        |
|                      Evidence                    |
+-------------------------+------------------------+
                          |
                Artifact Store / Deep Log
                          |
                  Phone Short Result
                          |
                    GitHub Mobile
                          |
                       ChatGPT

## Architectural principles
- Postgres owns durable state.
- Kernel owns lifecycle, permissions, retries, cost/time limits, and fencing.
- OpenClaw native runtime owns tools, isolated subagents, browser primitives, and later Swarm.
- LLM decides what to do; Kernel decides whether execution is allowed.
- 71 agents and 311 skills are a capability universe, not one prompt or one simultaneous process pool.
- Registry schema supports all 71/311 from the beginning, but production readiness is certified incrementally.
- Browser/data/perception results are evidence-bearing structured objects, not free-form claims.
- Phone UX is short summary + link; deep execution trace is stored separately.

## Full roadmap — 14 phases

### Phase 1 — V2 Foundation [DONE/PASS]
Clean branch, minimal project tree, CI, config, health gate. No legacy runtime dependency.
Exit: foundation CI PASS.

### Phase 2 — Persistent State + Durable Kernel
Hosted PostgreSQL. Tables: tasks, task_nodes, task_node_dependencies, llm_accounting, artifacts, registry_agents, registry_skills. State machine, idempotency, checkpoints.
Exit: task survives process restart without state loss.

### Phase 3 — Lease, Fencing, Circuit Breakers
Atomic SKIP LOCKED claim, lease_owner, lease_token, lease_until, heartbeat, stale-worker recovery. Hard limits: attempts, total steps, tokens/cost, deadline. Atomic budget reservation/reconciliation.
Exit: concurrent workers cannot duplicate a node; stale worker cannot finalize/write/account.

### Phase 4 — Lite Orchestrator
Minimal deterministic DAG: Research -> Data/Result. Dependency resolver, descendant blocking, task finalizer, deadlock detection.
Exit: positive path and failure cascade both terminate correctly.

### Phase 5 — DeepSeek + Model Accounting
Real DeepSeek through target OpenClaw runtime. Isolated sessions. Cache-hit/miss/output tokens, latency, pricing version/effective rates, cost reconciliation.
Exit: real call and accounting record linked to task/node.

### Phase 6 — First Real Research Agent + Web Skill
One real isolated Research Agent. Native search/fetch. Structured output and source provenance.
Exit: live internet research traverses the entire Kernel.

### Phase 7 — Artifact + Evidence Layer
Persist result, sources, accounting snapshot, execution trace, errors, task/node state. Runner filesystem is temporary; durable evidence is uploaded before job end.
Exit: evidence remains available after runner termination.

### Phase 8 — Phone UX
Phone result: terminal status, 1-5 line result, cost, next action, deep-log link. No trace dump on phone.
Exit: useful result readable from iPhone.

### Phase 9 — Perception Layer
Images/screenshots/PDF/scans/downloads -> MIME detection -> extraction -> vision/OCR fallback -> structured data -> provenance.
Exit: downloaded/observed file is actually interpreted.

### Phase 10 — Browser Runtime
Isolated browser; navigation, snapshots, clicks, typing, pagination, screenshots, downloads, network/errors, sessions. Escalation search -> fetch -> browser.
Exit: real JS-heavy page completes end-to-end.

### Phase 11 — Agent Runtime + Skill Runtime + Sandbox
Native isolated subagents. Dynamic skill loader records skill id/version/hash. Code execution only in sandbox. Add specialists incrementally.
Exit: Supervisor safely assigns different specialists with bounded tools/skills.

### Phase 12 — Full DAG / Parallelism / Repair / Judge
Branching DAG, bounded concurrency, native subagents/Swarm where justified, synthesis/conflict resolution. Failure classifier, bounded Repair, independent Judge.
Exit: parallel E2E plus controlled failure/recovery PASS.

### Phase 13 — Capability Scale-Out
Certify remaining agents/skills in batches. Certification: schema -> availability -> security profile -> deterministic test -> integration test -> READY.
Exit: required catalog is production-certified, not merely listed.

### Phase 14 — Production Cutover + Legacy Deletion
Battle suite: research, browser, PDF/image, downloads, stale lease, duplicate dispatch, budget exhaustion, deadline, HITL, injection, secrets, Judge rejection, parallelism. Cut over after PASS, verify rollback, archive then delete legacy.
Exit: V2 production + rollback proof + approved legacy cleanup.

## Kernel statuses
PENDING, RUNNING, SUCCESS, FAIL_WITH_EVIDENCE, BLOCKED, AWAITING_APPROVAL, CANCELLED.

## Kernel invariants
1. one node has at most one current valid fencing token
2. stale token causes zero mutating writes
3. `current_cost_usd + reserved_cost_usd <= budget_limit_usd`
4. terminal task causes zero new model/tool calls
5. node readiness requires all parents SUCCESS
6. terminal parent failure blocks descendants
7. request idempotency prevents duplicate spend
8. every paid/external model call has accounting
9. every terminal task has evidence
10. approval-required side effects cannot execute without approval

## Legacy policy
Legacy remains frozen until Phase 14. No cleanup before successful cutover and rollback proof.
