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
- During Research process-runner work CI found and prevented several issues before integration: duplicate runner implementations, an abort-test race, and stale assumptions about where state isolation belongs.
- Duplicate `openclaw-research-runner.mjs` path was removed. Canonical architecture is now `openclaw-research-runtime.mjs` + `research-agent-runner.mjs` + `research-agent-envelope.mjs`.
- Canonical runner/envelope consolidation passed full CI run `38161523563`:
  - shell-free child process;
  - bounded timeout and stdout/stderr;
  - AbortSignal kill;
  - credential redaction;
  - sanitized child environment excluding unrelated secrets;
  - provider/model/direct-code-mode attestation;
  - only `web_search`/`web_fetch` tool evidence accepted;
  - `SUCCESS` requires `web_fetch` evidence;
  - strict sourced Research JSON contract;
  - optional usage telemetry is never invented and malformed telemetry fails closed.
- Research trust-root fail-closed gate passed full CI run `38161772567`:
  - `OPENCLAW_STATE_DIR` is mandatory and must be absolute before any temp config or process spawn;
  - missing/relative roots produce typed `INVALID_OPENCLAW_STATE_DIR`;
  - negative tests prove zero spawn/temp side effects on rejection;
  - all existing Node/PostgreSQL/OpenClaw/DeepSeek-plugin/DuckDuckGo-plugin/config-validation gates remained green.
- Hosted-Neon-in-CI and live-DeepSeek steps remain correctly SKIPPED because repository Actions secrets are absent; hosted Neon itself is separately proven live.

### ECC review lanes selected for the current engineering stage
- `agentic-engineering`
- `security-review`
- `agent-security-hardening`
- `verification-loop`
- `postgres-patterns`
These are independent review/check lanes, not claimed as separate running agents until the real Agent Runtime exists.

### Current engineering position
- Hosted PostgreSQL persistence and DB-only Lite DAG E2E: PASS historically through migrations 0001-0007; current hosted state needs revalidation after migration 0009.
- Research contract/runtime/plugin/process/trust boundary: PASS without a live model call.
- External secrets remain pending for live hosted-CI and live DeepSeek proof.
- Do not advance to Browser, Vision, Swarm, Judge, Repair, or bulk 71/311 migration yet.

### Kernel regression recovery — terminal failure composition [PASS]
- Regression was detected at HEAD `606b59fcac481c392c620f00312d15e9273a94ff`: `0008_active_lease_write_hardening.sql` preserved active-lease validation and reservation release but accidentally removed `cascade_block_descendants(...)` and `finalize_task(...)` from `fail_node_terminal()`.
- Read-only micro-audit results: `complete_node_success()` PASS, `requeue_node_retry()` PASS, `heartbeat_node()` PASS, `fail_node_terminal()` FAIL.
- Added only `migrations/0009_fail_node_terminal_composition_fix.sql` in commit `6c14330b964c65eb826544a02c6eaaaca03df90d`; older applied migrations were not rewritten.
- The effective function now requires `RUNNING` + exact worker + exact fencing token + active `lease_until > NOW()`, releases reservations, writes `FAIL_WITH_EVIDENCE`, cascades descendants, and immediately calls `finalize_task(v_task_id)`.
- Full CI run `38165100648`: SUCCESS. PostgreSQL migrations and all kernel assertions passed, including the pre-existing Research-failure -> Data-BLOCKED -> task-terminal regression test.
- Hosted Neon verification and live DeepSeek smoke were SKIPPED in that run because `DATABASE_URL` and `DEEPSEEK_API_KEY` are absent from GitHub Actions; SKIPPED is not PASS.
- Phase 3/4 local-CI kernel gates are therefore revalidated at this commit, but hosted Neon still needs migration 0009 + E2E revalidation.
- Next micro-gate: read-only audit of an expired `RUNNING` node where `attempt == max_attempts`. Determine whether `claim_next_node()` and `finalize_task()` can leave the task dangling. No code change before PASS/FAIL evidence.
