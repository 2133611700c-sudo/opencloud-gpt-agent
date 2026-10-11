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

### Phase 2 — Persistent State + Durable Kernel core [PASS]
- Core schema run `38152899381`: PASS on PostgreSQL 16 in GitHub Actions.
- Deterministic state machine run `38153032460`: PASS.
- Hosted persistence was then brought live by safely reusing the existing Neon project `little-tree-63040612` without modifying its primary `main` branch.
- Created isolated Neon branch `openclaw-v2` (`br-odd-forest-a4leyaqj`) and separate database `openclaw_v2`; existing `neondb` remained separate.
- Applied V2 migrations `0001_core.sql` through `0007_accounting_lock_order.sql` to `openclaw_v2` only.
- Hosted schema verification returned 9/9 expected core tables and 14/14 expected core functions.
- Real hosted DB E2E task `947e17d9-0958-4436-a23f-df4eba8b4a38` passed idempotent intake, Research claim/fencing/heartbeat/completion, Data dependency release/completion, finalizer SUCCESS, and a separate persistence read.
- No Neon password or connection string is committed to GitHub or Library.
- GitHub Actions still needs repository secret `DATABASE_URL` before CI can reach this hosted database directly.

### Phase 3 — Lease, Fencing, Circuit Breakers [PASS]
- Atomic lease/fencing run `38153301256`: PASS after CI caught and fixed a real PL/pgSQL ambiguity.
- Budget/token reservation + deadline/steps/attempt breakers run `38154703360`: PASS.
- Async heartbeat manager run `38154875398`: PASS.

### Phase 4 — Lite Orchestrator [PASS]
- Idempotent intake + fixed `Research -> Data/Result` DAG run `38155010163`: PASS.
- Finalizer/failure cascade/deadline/max-steps/deadlock run `38155170623`: PASS.
- Phase 4 core gate: PASS.

### Phase 5 — DeepSeek + Model Accounting [PARTIAL: external live-secret gate pending]
- Safe secret-presence run `38155306054` originally reported `LIVE_DATABASE_URL=MISSING` and `LIVE_DEEPSEEK_API_KEY=MISSING`; no secret values were exposed.
- Deterministic model-usage accounting passed in run `38155477561`.
- Exactly-once model accounting + crash reservation recovery passed in run `38155852410`.
- Added deterministic OpenClaw DeepSeek infer adapter. Initial run `38156200874` found overly permissive malformed-usage telemetry handling; parser was tightened to fail closed. Verification run `38156265994`: PASS.
- Added bounded process runner `src/providers/deepseek-smoke-runner.mjs`: missing-secret fail-fast, `shell:false`, stdout/stderr byte limits, timeout, AbortSignal kill, typed errors, exact secret/sk-token redaction, invalid success fail-closed. Run `38156463925`: PASS.
- Pinned OpenClaw `2026.9.8` and official `@openclaw/deepseek-provider@2026.9.8`; wiring run `38157033206`: PASS.
- Live DeepSeek smoke remains intentionally SKIPPED until the credential is available to the execution runtime. No live inference claim is made.

### Phase 6 — Research Agent + native Web Search/Fetch [IN PROGRESS]
- Strict research result/source contract passed in run `38159514170`: every accepted item must cite a real source; unknown/unsourced references fail closed; canonical URLs are deduplicated; JS/login/CAPTCHA/access failures escalate as `NEEDS_BROWSER` instead of guessing.
- Evidence timestamp hardening passed in run `38159670726`: date-only and timezone-less evidence timestamps are rejected; only ISO-8601 instants with timezone are accepted.
- Native OpenClaw Research runtime policy passed in run `38159803006`: Research is restricted to `web_search` and `web_fetch`, DeepSeek model refs, direct code mode, bounded timeout, strict JSON output, and untrusted-web-content prompt boundary.
- Pinned official `@openclaw/duckduckgo-plugin@2026.9.8` plus actual `openclaw config validate --json` passed in run `38159959702`.
- Official CLI contract review found `--auth-env-only` cannot be combined with `--config`; this incompatible design was removed before building the next layer.
- Dedicated `OPENCLAW_STATE_DIR` trust scope, mode-0700 CI setup, and plugins installed inside that scope passed in run `38160694918`.
- Canonical runner/envelope consolidation passed full CI run `38161523563`.
- Research trust-root fail-closed gate passed full CI run `38161772567`.
- Hosted-Neon-in-CI and live-DeepSeek steps remain correctly SKIPPED because repository Actions secrets are absent; hosted Neon itself is separately proven live historically.

### ECC review lanes selected for the current engineering stage
- `agentic-engineering`
- `security-review`
- `agent-security-hardening`
- `verification-loop`
- `postgres-patterns`
These are independent review/check lanes, not claimed as separate running agents until the real Agent Runtime exists.

### Current engineering position
- Hosted PostgreSQL persistence and DB-only Lite DAG E2E: PASS historically through migrations 0001-0007; current hosted state needs revalidation after migrations 0009-0012.
- Research contract/runtime/plugin/process/trust boundary: PASS without a live model call.
- External secrets remain pending for live hosted-CI and live DeepSeek proof.
- Do not advance to Browser, Vision, Swarm, Judge, Repair, or bulk 71/311 migration yet.

### Kernel regression recovery — terminal failure composition [PASS]
- Regression at HEAD `606b59fcac481c392c620f00312d15e9273a94ff`: active-lease hardening accidentally removed descendant cascade and task finalization from `fail_node_terminal()`.
- Added `migrations/0009_fail_node_terminal_composition_fix.sql` in commit `6c14330b964c65eb826544a02c6eaaaca03df90d`.
- Full CI run `38165100648`: SUCCESS.

### Kernel stabilization — expired final attempt [PASS]
- Read-only audit proved dangling RUNNING when expired node had `attempt == max_attempts`.
- Added migration/test 0010 in implementation commit `38a29dc15e28a863c205119e14d25a0942430df0`.
- First CI failure was a test-only canonical `agent_id` typo; test-only correction commit `bb5489750efdd7fa92d43e2326179188c758c86f`.
- Full CI run `38165702632`: SUCCESS; no reclaim, Research FAIL_WITH_EVIDENCE, Data BLOCKED, reservation RELEASED, zero reserved totals.

### Kernel stabilization — expired total-step exhaustion [PASS]
- Read-only audit proved dangling RUNNING when `current_steps >= max_total_steps` and attempts remained.
- Added migration/test 0011 in commit `bcf26ee0bd9f36fdf48438dc2332598c1f745354`.
- Migration 0011 preserves attempt-exhaustion precedence, releases reservations before blocking expired RUNNING nodes, and terminalizes with `MAX_TOTAL_STEPS_EXCEEDED`.
- Full CI run `38166064399`: SUCCESS.

### Kernel stabilization — deadline reservation cleanup [PASS]
- Read-only audit proved overdue tasks could terminalize through `block_task_nodes()` while an existing budget reservation remained `RESERVED`.
- Reviewer confirmed canonical accounting lock order is `task_node -> task -> budget_reservation`; a naive release after taking the task lock would invert that order.
- Added only `migrations/0012_deadline_reservation_cleanup.sql` and `tests/sql/0012_deadline_reservation_cleanup_test.sql` in commit `a719e00ea7b8b36052923936ecdab08e42c1601c`.
- Deadline terminalization now locks all task nodes deterministically, then the task row, then releases every RESERVED lease with reason `DEADLINE_EXCEEDED`, blocks nonterminal nodes, and writes the terminal task state.
- Deadline handling runs before attempt/step recovery reapers, keeping the task-wide `DEADLINE_EXCEEDED` reason authoritative while preventing reservation leaks.
- Full CI run `38166510250`: SUCCESS. The regression test proves active Research reservation -> RELEASED, Research/Data -> BLOCKED, and task/node reserved totals -> zero.
- Hosted Neon and live DeepSeek remained SKIPPED because repository Actions secrets are absent; they are not counted as PASS.

### Kernel audit — DAG deadlock reservation reachability [PASS: supported-state contract]
- `DAG_DEADLOCK` is reachable only when `v_running = 0`, `v_pending > 0`, and `v_ready = 0`.
- A budget reservation can be created only for an active RUNNING node.
- Supported exits from RUNNING either reject SUCCESS while reservation is unresolved or release reservations on requeue, terminal failure, lease reclaim, max-attempt recovery, max-step recovery, or deadline terminalization.
- No supported Kernel transition path to `DAG_DEADLOCK` with an unresolved `RESERVED` reservation was found.
- No code change was made. This verdict does not certify arbitrary externally corrupted SQL state.

### Kernel audit — cancellation lifecycle [NOT IMPLEMENTED / ACCEPTANCE GAP]
- `CANCELLED` exists in the SQL execution-status enum and the JS task/node transition matrix and is terminal.
- The current V2 tree contains no canonical `cancel_task` SQL function, no cancellation runtime command/handler, and no cancellation lifecycle regression test.
- Therefore reservation cleanup on cancellation is neither implemented nor proven. This is not marked PASS and no speculative cleanup migration was added.
- Next micro-gate: read-only comparison of `src/kernel/state.mjs` against all effective SQL lifecycle transitions after migrations 0009-0012; produce the exact mismatch set before changing either side.


### Kernel stabilization — JS↔SQL lifecycle alignment [PASS]
- Read-only audit found a real contract mismatch: SQL deadline terminalization can move a task from `PENDING` or `AWAITING_APPROVAL` to `FAIL_WITH_EVIDENCE`, while the JS matrix rejected those transitions.
- Writer commit `17f00c6569df8d583b47559de014b21e7b7a48d0` changed only `src/kernel/state.mjs`: added supported system terminal-failure transitions from `PENDING` and `AWAITING_APPROVAL`.
- Verification commit `2c0668a252a9eda7ae382cb4df24f9800f288756` added targeted tests proving those failure transitions are allowed while direct `PENDING/AWAITING_APPROVAL -> SUCCESS` remains forbidden.
- Reviewer diff audit: PASS; only state contract and targeted test changed, no SQL/migration mutation, terminal-state fail-closed behavior preserved.
- Full CI run `38167555303`: SUCCESS. Node tests, migrations, PostgreSQL kernel assertions, pinned OpenClaw install, provider/plugin installs, and Research config validation all passed.
- Hosted Neon and live DeepSeek steps remained SKIPPED because repository Actions secrets are absent; they are not counted as PASS.
- Next micro-gate: canonical cancellation lifecycle and reservation cleanup.
