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
- Deterministic model-usage accounting passed in run `38155477561`.
- Exactly-once model accounting + crash reservation recovery passed in run `38155852410`.
- Re-verified current official OpenClaw docs before provider integration. Narrow provider smoke uses `openclaw infer model run --local`; official provider id is `deepseek`, credential env is `DEEPSEEK_API_KEY`, plugin is `@openclaw/deepseek-provider`.
- Added deterministic adapter `src/providers/openclaw-deepseek-infer.mjs`. Initial run `38156200874` found overly permissive malformed-usage telemetry handling; parser was tightened to fail closed. Verification run `38156265994`: PASS.
- Added bounded process runner `src/providers/deepseek-smoke-runner.mjs`: missing-secret fail-fast, `shell:false`, stdout/stderr byte limits, timeout, AbortSignal kill, typed errors, exact secret/sk-token redaction, invalid success fail-closed. Run `38156463925`: PASS with all prior gates green.
- Added `scripts/live-deepseek-smoke.mjs` for one real provider-level smoke. It accepts only exact `smoke-ok` and emits safe evidence: provider/model/transport, wall latency, output SHA-256 and telemetry fidelity flags; it does not dump prompt/output or credentials.
- Extended V2 CI to install pinned OpenClaw and official DeepSeek provider before live smoke. First wiring run `38156864987` failed only because version assertion expected bare `2026.9.8`, while the CLI correctly returned `OpenClaw 2026.9.8 (fc23bc8)`.
- Version gate was fixed to validate the parsed version token and npm install now uses the official `--allow-scripts=openclaw` form.
- Verification run `38157033206`: PASS. OpenClaw `2026.9.8` installed successfully on Node 24; `@openclaw/deepseek-provider@2026.9.8` installed successfully; 39 Node tests and all PostgreSQL assertions remained green.
- Live DeepSeek smoke in run `38157033206` was correctly SKIPPED because repository Actions secret `DEEPSEEK_API_KEY` is still absent. No live inference claim is made.

### ECC review lanes selected for the current engineering stage
- `agentic-engineering`
- `security-review`
- `agent-security-hardening`
- `verification-loop`
- `postgres-patterns`
These are being used as independent review/check lanes. They are not described as separate running agents until the real Agent Runtime is implemented.

### Current engineering position
- Next gate only: securely store the user-provided credential as GitHub Actions secret `DEEPSEEK_API_KEY` via an authenticated GitHub browser session, then execute exactly one bounded live provider smoke and inspect safe evidence.
- GitHub connector itself cannot write repository secrets; browser authentication is required for this external setting.
- Hosted PostgreSQL remains blocked pending a secure `DATABASE_URL`; Neon plugin was suggested as the preferred hosted Postgres path.
- Do not advance to Research Agent, browser, vision, swarm, judge, repair or bulk 71/311 migration before the live provider gate passes.
