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

### Phase 3 — Lease, Fencing, Circuit Breakers [PASS]
- Added `migrations/0002_lease_fencing.sql` implementing atomic `SKIP LOCKED` claim, unique fencing token per claim/reclaim, heartbeat renewal, fenced SUCCESS completion, and fenced retry requeue.
- Added `tests/sql/0002_lease_fencing_test.sql` covering active-lease exclusion, heartbeat token validation, expired-lease reclaim, new fencing token, attempt increment, stale heartbeat rejection, stale completion rejection, and release of a dependent node only after parent SUCCESS.
- First integrated CI run `38153199152` correctly failed on a real PL/pgSQL ambiguity: unqualified `attempt = attempt + 1` conflicted with the function return-column variable.
- Fixed the defect by qualifying mutable table columns and all fenced predicates.
- Verification run `38153301256` passed all Node tests, PostgreSQL migrations, core schema assertions, lease/fencing assertions, and health checks.
- Added `migrations/0003_budget_reservations.sql` with fenced, idempotent cost/token reservations and transactional reconcile/release operations.
- Added `tests/sql/0003_budget_circuit_breakers_test.sql` proving stale-token rejection, duplicate reservation idempotency, cost/token oversubscription rejection, reconcile/release correctness, no reservation after terminal node, and hard deadline/total-step/max-attempt stops.
- Verification run `38154703360` passed all migrations and kernel SQL assertions.
- Added `src/kernel/heartbeat.mjs` with an independent asynchronous renewal loop and explicit abort semantics.
- Added heartbeat tests for lease-loss abort, renewal exception wrapping, non-overlapping renewals, clean shutdown, stop/in-flight-renewal race, and duplicate start rejection.
- Verification run `38154875398` passed Node tests, all PostgreSQL migrations/assertions, and health checks.
- Phase 3 gate: PASS.

### Phase 4 — Lite Orchestrator [IN PROGRESS]
- Current sub-step 4A: idempotent intake + deterministic `Research -> Data/Result` DAG creation only.
- Gate requirements: repeated request ID returns the same task, exactly two canonical nodes exist, and Data depends on Research.
- Finalizer/failure cascade/deadlock logic is intentionally deferred until sub-step 4A passes.

### Current engineering position
- Current phase: Phase 4 — Lite Orchestrator.
- Next action: implement and test Phase 4A only.
- External capabilities still to verify before live E2E: hosted PostgreSQL secret, DeepSeek API key, OpenClaw runtime/provider health, GitHub Actions artifact/dispatch permissions.
- Do not advance to DeepSeek, browser, vision, swarm, judge, repair or bulk 71/311 migration until Lite Orchestrator gates pass.
