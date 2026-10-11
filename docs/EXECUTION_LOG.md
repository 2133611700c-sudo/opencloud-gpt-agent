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
- Deterministic model-usage accounting passed in run `38155477561`.
- Exactly-once model accounting + crash reservation recovery passed in run `38155852410`.
- Re-verified current official OpenClaw docs before implementing provider integration. The narrow provider/model/auth smoke is `openclaw infer model run --local --model <provider/model> --prompt ... --json`; it does not start an agent turn or load tools. Official DeepSeek provider id is `deepseek`, credential env is `DEEPSEEK_API_KEY`, plugin is `@openclaw/deepseek-provider`.
- Added `src/providers/openclaw-deepseek-infer.mjs` as a deterministic provider adapter: validates full `deepseek/<model>` refs, builds shell-free argv for local infer, validates JSON capability/transport/provider/model/output, and labels optional usage/cost telemetry without inventing cache split.
- Added adapter tests for argv isolation, provider/model mismatch, failed envelope, empty output, optional observed telemetry, and malformed telemetry.
- Initial adapter run `38156200874` failed because malformed usage with one valid field was still accepted as partial telemetry.
- Tightened parser so any malformed known usage field or inconsistent input/output/total invalidates the whole usage object; no partial financial trust.
- Verification run `38156265994` passed Node tests, all PostgreSQL migrations/assertions, health, and prior gates.
- OpenClaw DeepSeek infer adapter contract: PASS. Live DeepSeek remains BLOCKED because `DEEPSEEK_API_KEY` is absent.

### Current engineering position
- Next unit: executable DeepSeek smoke runner around the proven adapter: fail-fast missing secret, bounded stdout/stderr, timeout/abort, no shell, deterministic mocked-process tests.
- Live hosted Postgres/DeepSeek smoke remains pending `DATABASE_URL` and `DEEPSEEK_API_KEY`.
- Do not advance to browser, vision, swarm, judge, repair or bulk 71/311 migration before the Walking Skeleton live research path passes.
