# OpenClaw V2 — Execution Log

Purpose: durable chronological handoff between chats and engineering sessions. Update only with verified work.

## 2026-10-11

### Phase 1 — Foundation
- Created clean branch `v2/openclaw-clean-20261011`.
- Legacy `main` left unchanged by V2 foundation work.
- Added clean V2 tree, `SYSTEM.md`, health checks, tests and V2 CI.
- GitHub Actions run `38149188562` completed successfully.
- Phase 1 gate: PASS.

### Continuity hardening
- Added `PROJECT_START_HERE.md` and `PROJECT_STATE.json` in V2 branch.
- Persisted canonical 14-phase architecture in `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`.
- Persisted canonical two-day vertical-slice plan in `docs/02_48H_WALKING_SKELETON.md`.
- Added this durable execution log.
- Canonical ChatGPT Library mirror exists at `/OpenClaw-V2-Project` with START_HERE, master roadmap, 48h plan, current state, and execution log.

### Phase 2 — Persistent State + Durable Kernel
- Added `migrations/0001_core.sql` with tasks, nodes, normalized same-task DAG dependencies, accounting, artifacts, agent/skill registry schemas, approval requests, budget/token invariants, and lease/fencing fields.
- Updated V2 CI to boot real PostgreSQL 16, apply the migration, and execute SQL invariants.
- Added SQL tests proving cross-task dependencies are rejected, duplicate idempotency keys are rejected, and budget oversubscription violates the DB invariant.
- Schema gate passed in GitHub Actions run `38152899381`.
- Added deterministic Task/Node state machine in `src/kernel/state.mjs` with terminal-state fail-closed rules and explicit retry/approval transitions.
- Added state-machine unit tests; current-head CI run `38153032460` passed Node tests, PostgreSQL migration, SQL invariants and health checks.
- Phase 2 core schema + state-machine units: PASS.

### Phase 3 — Lease, Fencing, Circuit Breakers [IN PROGRESS]
- Added `migrations/0002_lease_fencing.sql` implementing atomic `SKIP LOCKED` claim, unique fencing token per claim/reclaim, heartbeat renewal, fenced SUCCESS completion, and fenced retry requeue.
- Added `tests/sql/0002_lease_fencing_test.sql` covering active-lease exclusion, heartbeat token validation, expired-lease reclaim, new fencing token, attempt increment, stale heartbeat rejection, stale completion rejection, and release of a dependent node only after parent SUCCESS.
- First integrated CI run `38153199152` correctly failed on a real PL/pgSQL ambiguity: unqualified `attempt = attempt + 1` conflicted with the function return-column variable.
- Fixed the defect by qualifying mutable table columns and all fenced predicates.
- Verification run `38153301256` passed all Node tests, both PostgreSQL migrations, core schema assertions, lease/fencing assertions, and health checks.
- Atomic lease/fencing DB contract: PASS.
- Added `migrations/0003_budget_reservations.sql` with fenced, idempotent budget/token reservations plus transactional reconcile/release operations.
- Added `tests/sql/0003_budget_circuit_breakers_test.sql` proving stale-token reservation rejection, duplicate reservation idempotency, cost/token oversubscription rejection, actual-usage reconciliation, unused-reservation release, no new reservation after terminal node, and hard deadline/total-step/max-attempt claim stops.
- Verification run `38154703360` passed all Node tests, all PostgreSQL migrations, all kernel SQL assertions and health checks.
- Budget reservation + hard circuit-breaker DB contract: PASS.

### Current engineering position
- Current phase: Phase 3 — Lease, Fencing, Circuit Breakers.
- Next implementation unit: application-level asynchronous heartbeat manager over the proven `heartbeat_node` fencing contract. It must renew independently of long external calls, abort the worker's operation immediately on lost lease/renewal error, avoid overlapping renewals, and stop cleanly.
- External capabilities still to verify before live E2E: hosted PostgreSQL secret, DeepSeek API key, OpenClaw runtime/provider health, GitHub Actions artifact/dispatch permissions.
- Do not advance to Lite Orchestrator, browser, vision, swarm, judge, repair or bulk 71/311 migration until the current heartbeat gate passes.
