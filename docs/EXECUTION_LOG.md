# OpenClaw V2 — Execution Log

Purpose: durable chronological handoff between chats and engineering sessions. Update only with verified work.

## 2026-10-11

### Phase 1 — Foundation [PASS]
- Clean branch `v2/openclaw-clean-20261011`; legacy `main` frozen.
- Foundation CI run `38149188562`: PASS.

### Continuity hardening
- GitHub: `PROJECT_START_HERE.md`, `PROJECT_STATE.json`, master 14-phase roadmap, 48h plan, and this execution log.
- ChatGPT Library mirror: `/OpenClaw-V2-Project`.
- Future chats must restore from canonical files and current GitHub/CI before modifying anything.

### Phase 2 — Persistent State + Durable Kernel core [LOGIC PASS; HOSTED PERSISTENCE NOT YET VERIFIED]
- Core schema run `38152899381`: PASS on PostgreSQL 16 in GitHub Actions.
- Deterministic state machine run `38153032460`: PASS.
- Important: these prove schema/kernel behavior on ephemeral CI PostgreSQL; hosted persistent `DATABASE_URL` still requires live verification.

### Phase 3 — Lease, Fencing, Circuit Breakers [PASS]
- Atomic lease/fencing run `38153301256`: PASS after CI caught and fixed a real PL/pgSQL ambiguity.
- Budget/token reservation + deadline/steps/attempt breakers run `38154703360`: PASS.
- Async heartbeat manager run `38154875398`: PASS.

### Phase 4 — Lite Orchestrator [PASS]
- Idempotent intake + fixed `Research -> Data/Result` DAG run `38155010163`: PASS.
- Finalizer/failure cascade/deadline/max-steps/deadlock run `38155170623`: PASS.
- Phase 4 core gate: PASS.

### Phase 5 — DeepSeek + Model Accounting [IN PROGRESS]
- Safe secret-presence run `38155306054` reported `LIVE_DATABASE_URL=MISSING` and `LIVE_DEEPSEEK_API_KEY=MISSING`; no secret values were exposed.
- Hosted persistent Postgres remains BLOCKED until `DATABASE_URL` exists and persistence smoke passes.
- Live DeepSeek/OpenClaw inference remains BLOCKED until `DEEPSEEK_API_KEY` exists and provider smoke passes.
- Added deterministic model-usage normalization/accounting with cache-hit/cache-miss separation, conservative unclassified-token treatment, exact BigInt micro-USD accounting, and injected versioned rates. Run `38155477561`: PASS.
- Added `migrations/0006_exactly_once_accounting.sql` and `0007_accounting_lock_order.sql` to atomically reconcile a fenced reservation with a single `llm_accounting` row and to use a consistent DB lock order.
- Added crash recovery: when an expired lease is reclaimed, unresolved reservations tied to the stale fencing token are released before the new token is issued.
- Node SUCCESS is rejected while an unresolved reservation exists; retry requeue and terminal failure release unresolved reservations.
- Added `tests/sql/0006_exactly_once_accounting_test.sql` covering crash-after-reserve recovery, stale-accounting rejection, exactly-once call recording, no double charge on exact retry, contract-collision fail-closed behavior, unresolved-reservation SUCCESS rejection, retry cleanup, and terminal-failure cleanup.
- Verification run `38155852410` passed all Node tests, all PostgreSQL migrations/assertions, health check, and prior gates.
- Exactly-once model accounting + reservation recovery contract: PASS.

### Current engineering position
- Next unit: verify current official OpenClaw DeepSeek provider/CLI contract, then implement a deterministic provider-adapter boundary and tests without claiming live inference.
- Live hosted Postgres/DeepSeek smoke remains pending `DATABASE_URL` and `DEEPSEEK_API_KEY`.
- Do not advance to browser, vision, swarm, judge, repair or bulk 71/311 migration before the Walking Skeleton live research path passes.
