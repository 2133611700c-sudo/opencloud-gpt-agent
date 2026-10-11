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
- Added `src/accounting/model-usage.mjs`: strict DeepSeek usage normalization; cache-hit/cache-miss separation; unclassified prompt tokens conservatively treated as miss; exact BigInt micro-USD accounting; prices supplied as versioned runtime input, not hardcoded.
- Added model-accounting tests covering explicit/implicit cache-miss handling, deterministic cost calculation, conservative rounding, invalid totals/cache counts, invalid pricing contracts, and exact USD formatting.
- Verification run `38155477561` passed all Node tests, every PostgreSQL migration/assertion, health check, and safe secret-presence report.
- Deterministic model-usage accounting contract: PASS.

### Current engineering position
- Next unit: atomic exactly-once model-call accounting transaction in PostgreSQL: fenced lease verification + reservation reconciliation + `llm_accounting` insert in one transaction; repeated same `call_key` must not double-charge.
- Live hosted Postgres/DeepSeek smoke remains pending secrets.
- Do not advance to browser, vision, swarm, judge, repair or bulk 71/311 migration before the Walking Skeleton live research path passes.
