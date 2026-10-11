# OpenClaw V2 — START HERE

This branch is the active clean V2 line. Legacy `main` stays frozen until V2 cutover and rollback gates pass.

## Mandatory continuation protocol
1. Read `PROJECT_START_HERE.md`.
2. Read `SYSTEM.md`.
3. Read `PROJECT_STATE.json`.
4. Inspect current branch CI/evidence before changing anything.
5. Work phase-by-phase; do not advance until the current gate is PASS.
6. Do not call metadata `executed`: an agent is executed only with a real run/session record; a skill is applied only when its content/version/hash is actually loaded and recorded.

## Current strategy
First deliver a 48-hour Walking Skeleton: Hosted Postgres -> Durable Kernel -> Lite DAG -> DeepSeek/OpenClaw Research Agent -> real web search/fetch -> accounting -> durable evidence -> phone summary.

After that, extend incrementally with perception, browser, sandbox, full DAG, parallelism, Repair/Judge, capability scale-out, cutover and legacy deletion.

## Kernel invariants
- one node -> at most one valid active lease
- one lease attempt -> one unique fencing token
- stale token -> zero state-changing writes
- current_cost + reserved_cost <= budget_limit
- terminal task -> zero new model/tool calls
- node cannot run before every parent SUCCESS
- terminal failed parent -> descendants cannot execute
- same request_id -> same task
- every external model call -> accounting record
- every terminal task -> durable evidence
- risky side effects -> approval policy

## Persistent project knowledge
The complete master plan is also stored in ChatGPT Library under `/OpenClaw-V2-Project` so future chats can retrieve the canonical roadmap instead of relying on conversation memory.