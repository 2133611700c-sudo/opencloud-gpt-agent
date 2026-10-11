# OpenClaw V2 — 48-Hour Walking Skeleton

## Goal
Deliver one real, durable vertical slice — not mocks, heartbeats, or metadata-only routing.

The system must accept a real research goal from iPhone/ChatGPT/GitHub, persist it, execute one real isolated Research Agent through DeepSeek/OpenClaw using live web search/fetch, enforce hard limits, survive a worker failure, persist evidence, and return a concise phone result.

## Required scope
1. Hosted PostgreSQL and migrations.
2. Durable state machine.
3. Idempotent request intake.
4. Atomic lease + unique fencing token.
5. Heartbeat and stale-worker recovery.
6. Four circuit-breaker dimensions in schema/policy: attempts, total steps, token/cost budget, deadline.
7. Atomic budget reservation and reconciliation.
8. Lite DAG `Research -> Data/Result`.
9. Real DeepSeek/OpenClaw call.
10. Real native web search/fetch.
11. Structured Research Agent output with sources.
12. Data/Result validation/dedup/normalization.
13. LLM accounting including cache hit/miss where provided, completion tokens, latency, pricing metadata, cost.
14. Durable evidence artifacts.
15. Phone short result + deep-log link.

## Day 1 — Durable backend spine
### A. Database + migrations
Create hosted Postgres migrations for tasks, task_nodes, task_node_dependencies, llm_accounting, artifacts, registry_agents, registry_skills.
Important fields: request/idempotency key, status, budget limit/reserved/current cost, max/current steps, deadline, lease owner/token/acquired/until/heartbeat, attempts/max attempts, input/output JSON, accounting/artifact linkage.
Gate: clean migration and repeatable migration path.

### B. State machine
Only explicit valid transitions. No hidden auto-success.
Gate: allowed/forbidden transition tests.

### C. Atomic claim + fencing
Use transaction + `FOR UPDATE SKIP LOCKED` or equivalent atomic claim. New UUID fencing token every claim attempt. All heartbeat/finalize/accounting/reconcile writes require node id + lease owner/token + RUNNING state where applicable.
Gate: two workers cannot own the same node.

### D. Heartbeat + recovery
Heartbeat runs independently of long model/tool calls. If heartbeat update affects zero rows, worker has lost lease and must stop mutating work. Expired lease can be reclaimed by another worker with a new token.
Gate: crash/reclaim/stale-worker test.

### E. Circuit breakers + budget reservation
Hard controls: max attempts per node; max total steps per task; token/USD budget; wall-clock deadline. Before a paid call reserve enough budget atomically. After call record actual cost and release unused reserve. On terminal task no further calls.
Gate: cost invariant never violated under concurrency.

### F. Lite DAG + finalizer
DAG: Research -> Data/Result. Dependency table normalized. Finalizer handles SUCCESS, failure cascade, descendant BLOCKED, deadline, deadlock/no-runnable-node conditions.
Gate: no dangling tasks.

## Day 2 — Real intelligence + evidence
### G. DeepSeek/OpenClaw runtime
Use real target provider/runtime, isolated Research session. Record model, usage, latency, pricing metadata, cost.
Gate: real response + linked accounting.

### H. Research Agent + web search/fetch
Agent receives goal, constraints, output schema, tool policy, budget. It must use live web search/fetch and produce structured results with URLs/sources. If a target needs browser/JS/login, return `NEEDS_BROWSER` instead of inventing data.
Gate: internet-derived answer with source provenance.

### I. Data/Result node
Validate schema, normalize fields, remove duplicates, ensure source presence, sort/filter, produce final structured result.
Gate: deterministic schema validation.

### J. Evidence
Persist task state, nodes, result, sources, accounting, trace, errors. Never store secrets or private chain-of-thought. Upload durable artifact before runner termination.
Gate: evidence survives runner termination.

### K. Phone output
Success: `[SUCCESS]` + short summary + cost + attempts + deep log link.
Failure: `[FAIL_WITH_EVIDENCE]` + reason + progress + proof no further calls + deep log link.

## Mandatory acceptance tests
1. Positive E2E: real research task -> SUCCESS.
2. Duplicate dispatch -> one task only.
3. Worker crash -> another worker safely continues.
4. Stale worker -> old fencing token cannot mutate state.
5. Budget limit -> immediate terminal stop and zero further model calls.
6. Dependency -> Data cannot run before Research SUCCESS.
7. Failure cascade -> descendant BLOCKED and task terminates.
8. Deadline -> unfinished work terminates correctly.
9. Accounting -> reservation -> actual charge -> unused reserve release invariant.

## Example real acceptance request
"Find 5 current Toyota Highlander Hybrid XLE 2026 listings in California. Return dealer, price, source URL, and verification date."

## Explicitly out of mandatory 48h scope
- full browser automation
- Vision/OCR/PDF intelligence
- code sandbox
- Swarm
- Repair Agent
- independent Judge
- all 71 agents
- all 311 skills
- Redis
- Kubernetes
- S3/IAM platform work

## Optional bonus only after all mandatory gates pass
Basic Browser Agent: open -> snapshot/read -> click -> type -> screenshot -> download.
