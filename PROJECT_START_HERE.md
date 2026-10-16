# OpenClaw V2 — START HERE

This branch is the active clean V2 line. Legacy `main` stays frozen until V2 cutover and rollback gates pass.

## Mandatory continuation protocol
Whenever the user asks to continue, resume, check, build, audit, or discuss OpenClaw V2 in any chat:
1. Read `PROJECT_START_HERE.md`.
2. Read `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md` — this is the full 14-phase program, not only the current sprint.
3. Read `docs/02_48H_WALKING_SKELETON.md` — this is the current first production vertical slice.
4. Read `PROJECT_STATE.json` — this defines the current phase and exact `next_action`.
5. Read `docs/EXECUTION_LOG.md` — this records verified work and CI evidence.
6. Inspect the actual current V2 branch head, CI and evidence before changing anything.
7. If Library is available, cross-check `/OpenClaw-V2-Project`; GitHub/current passing evidence wins if state differs.
8. Work phase-by-phase; do not advance until the current gate is PASS.
9. Never rely on old chat wording when GitHub/current-state files differ.
10. Do not call metadata `executed`: an agent is executed only with a real run/session record; a skill is applied only when its content/version/hash is actually loaded and recorded.

## Current strategy
Stage A: deliver the 48-hour Walking Skeleton: Hosted Postgres -> Durable Kernel -> Lite DAG -> DeepSeek/OpenClaw Research Agent -> real web search/fetch -> accounting -> durable evidence -> phone summary.

Stage B: continue the master 14-phase program incrementally: perception, browser, sandbox, full DAG, parallelism, Repair/Judge, capability scale-out, production cutover and legacy deletion.

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
The complete project is mirrored in ChatGPT Library under `/OpenClaw-V2-Project` so future chats can retrieve the roadmap and state instead of depending on conversation memory.
