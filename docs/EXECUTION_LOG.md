# OpenClaw V2 — Execution Log

Purpose: durable chronological handoff between chats and engineering sessions. Update only with verified work.

## 2026-10-11

Earlier verified phase history remains in Git history and `PROJECT_STATE.json`. This continuation records the Kernel→Research stabilization and 48h Walking Skeleton gates.

### Kernel regression recovery — terminal failure composition [PASS]
- Migration 0009 restored descendant cascade and task finalization while preserving active-lease validation and reservation release.
- Full CI `38165100648`: SUCCESS.

### Kernel stabilization — expired final attempt [PASS]
- Migration/test 0010 terminalizes expired RUNNING nodes at max attempts, releases reservations, cascades descendants.
- Full CI `38165702632`: SUCCESS.

### Kernel stabilization — expired total-step exhaustion [PASS]
- Migration/test 0011 releases reservations and blocks abandoned expired RUNNING nodes at max total steps.
- Full CI `38166064399`: SUCCESS.

### Kernel stabilization — deadline reservation cleanup [PASS]
- Migration/test 0012 preserves canonical `task_node -> task -> budget_reservation` locking and releases all unresolved reservations before deadline terminalization.
- Full CI `38166510250`: SUCCESS.

### Kernel audit — DAG deadlock reservation reachability [PASS: supported-state contract]
- No supported Kernel transition path to `DAG_DEADLOCK` with unresolved `RESERVED` budget was found.

### Kernel stabilization — JS↔SQL lifecycle alignment [PASS]
- JS permits supported system terminal failure from `PENDING` and `AWAITING_APPROVAL`; unsupported direct SUCCESS remains forbidden.
- Full CI `38167555303`: SUCCESS.

### Kernel stabilization — canonical cancellation lifecycle [PASS]
- Migration 0013 adds canonical cancellation with deterministic node→task→reservation locking, reservation release, lease clearing, terminal idempotency and post-cancel claim/reservation prevention.
- Verification commit `c29998623f775269cd1b02d0c0f4d8bc664bf9db`; full CI `38168598358`: SUCCESS.

### Kernel→Research execution adapter [PASS]
- Added deterministic/injectable claimed-Research execution adapter: reserve → heartbeat → Research → accounting → fenced completion/failure.
- Heartbeat loss aborts execution; success fencing rejection cannot be reported as SUCCESS.
- Verification commit `e6b770746d21968e6a186859e2760babac92f7da`; full CI `38169102637`: SUCCESS.

### PostgreSQL Kernel adapter [PASS]
- Added JS bridge to canonical SQL heartbeat, budget reservation/release, success/failure fencing and exactly-once model accounting.
- Verification commit `fa7d82a37256ef4fbf23aefbf6c5a2124897169c`; full CI `38170249463`: SUCCESS.

### Research↔PostgreSQL Kernel bindings [PASS]
- Added Research execution binding with deterministic reservation key and canonical fenced completion/failure.
- Later accounting repair below supersedes the original missing-telemetry failure policy.
- Verification commit `bc377db0500cdb7ad9ed35efb952e2fe5bdf7f71`; full CI `38170407768`: SUCCESS.

### Agent-scoped Kernel claim [PASS]
- Migration 0014 adds `claim_next_node_for_agent(worker, agent, lease)` so a dedicated Research worker cannot claim a Data node.
- SQL regression proves dependency-blocked Data is not claimable and Research is claimed only by requested agent scope.
- Verification commit `1dd0b1a4a399b2eeef7b33e0b93895607bf408cb`; full CI `38170660200`: SUCCESS.

### Agent-scoped PostgreSQL adapter claim [PASS]
- PostgreSQL adapter exposes the agent-scoped SQL claim without weakening the generic scheduler API.
- Verification commit `c851faf358c424aeda573498683d3bea2071250e`; full CI `38170808454`: SUCCESS.

### Research UUID fencing fixture repair + PostgreSQL integration harness [PASS]
- Two stale Node-test fixtures still used integer `leaseToken: 1` after the production adapter correctly required UUID fencing tokens.
- Commit `a5d2210e72cc88250b634aa8d21a74f1d7867107` aligned the fixtures/call key with the UUID contract.
- Full CI `38173071765`: SUCCESS, including Node tests, migrations, SQL assertions and `research-postgres-kernel-e2e`.
- The harness proves Research claim → reserve → injected Research → accounting → fenced Research SUCCESS → Data becomes claimable. It is a Kernel integration test, not a live DeepSeek/web E2E.

### Research telemetry/accounting contract repair [PASS]
- Existing SQL `record_llm_call_reservation_fallback()` was wired through the PostgreSQL adapter and Research bindings.
- Missing usage and/or cost telemetry charges the full reservation ceiling with explicit `RESERVATION_FALLBACK`; malformed observed telemetry still fails closed.
- Commit `5633a63b26dce6f46c9761fd619fa6ecca111a61`; full CI `38173723528`: SUCCESS.

### Hosted Neon catch-up and Kernel smoke [PASS: direct Neon verification]
- Isolated `openclaw-v2` Neon branch was brought through migrations 0009–0014 semantics.
- Hosted SQL smoke proved Research → reservation → accounting → fenced Research SUCCESS → Data claim/completion → finalizer SUCCESS.

### Hosted reservation-fallback accounting [PASS: direct Neon verification]
- Direct inspection found hosted Neon missing the historical accounting-fallback function/columns even though later Kernel migrations were present.
- Fallback schema was first applied/tested on a safety child branch, then on `openclaw-v2`.
- Hosted fallback smoke: task `SUCCESS`; accounting basis `RESERVATION_FALLBACK`; charged cost `$0.010000`; charged tokens `100`; reservation basis `RESERVATION_FALLBACK`; reservation status `RECONCILED`.

### Canonical accounting-fallback migration ordering [PASS]
- Repository contained two migrations with prefix `0008`.
- Accounting fallback was moved to canonical idempotent `0015_accounting_fallback.sql`; duplicate `0008_accounting_fallback.sql` was removed.
- Commit `c3597f38fbefe65f78a454e91153a9d49f1297c2`; full CI `38175260212`: SUCCESS.

### Hosted accounting-fallback schema gate [PASS]
- Hosted persistence gate requires fallback function and all four accounting/reconciliation basis/note columns.
- Commit `9398529650a8aff401c0223bd02233fd591f7efd`; full CI `38175402188`: SUCCESS.
- Hosted step was SKIPPED because Actions lacks `DATABASE_URL`; skipped is not a live hosted PASS.

### PROJECT_STATE truth repair [PASS]
- Removed stale empty `known_gaps` and old continuation point; recorded direct Neon proof and still-open live/Data/evidence/phone gaps.
- Commit `376e30571e56407298e5fddcb86f18654b0271f0`; full CI `38175591266`: SUCCESS.

### Execution log truth repair [PASS]
- Rebuilt this durable handoff around verified Kernel/Neon/accounting facts.
- Commit `d4475878c83ba3a20b9de256e13a7ae404de089c`; full CI `38175726070`: SUCCESS.

### Canonical 14-phase governance alignment [PASS]
- `SYSTEM.md` was aligned to the 14-phase master roadmap and now explicitly forbids claiming PASS for skipped/live-unproven gates.
- Commit `0df11c8794ef7e263bc8263a7b3ee4de2ba25d5d`; full CI `38175847377`: SUCCESS.

### Production Research worker composition [PASS: code/tests]
- Added production composition: PostgreSQL adapter → scoped Research worker → Kernel executor → native `runResearchAgent`.
- Native runtime preflight rejects missing `DEEPSEEK_API_KEY` or invalid/non-absolute `OPENCLAW_STATE_DIR` before any durable node claim.
- Commit `b5208f68596dbb640071eb50a3395036cfcaf6bc`; full CI `38176181858`: SUCCESS.
- This is production-path wiring proof, not a live paid-call proof.

### Secret-isolated PostgreSQL transport [PASS]
- Added SELECT-only `psql` transport with parameter binding, minimal libpq child environment and no connection URL or DeepSeek secret in argv/child environment.
- Commit `5b2f7978e4cf3fd48fa8806fa752762eb2b62ea5`; full CI `38176401017`: SUCCESS.

### Live Kernel Research vertical gate [CODE PASS / LIVE NOT PROVEN]
- Added a real acceptance path: hosted task creation → scoped Research claim → production `runResearchAgent` → DeepSeek/OpenClaw → required `web_search` + `web_fetch` evidence → exactly one accounting row → zero unresolved reservations → fenced Research SUCCESS → Data becomes claimable → deterministic gate-only Data completion → finalizer `SUCCESS`.
- Deterministic Data completion exists only to terminalize this live Research gate and does **not** certify the future Data runtime.
- Commit `af945990ec4f421f62600b759d38326093ee367b`; full CI `38176693444`: SUCCESS.
- The live Kernel step was SKIPPED because Actions lacked the required credentials; therefore real DeepSeek/web Kernel vertical remains NOT PROVEN.

### Hosted PostgreSQL schema verification secret isolation [PASS]
- Removed `DATABASE_URL` from `psql` argv and removed the rollback write-smoke from hosted schema verification.
- Hosted verification is now read-only and uses the secret-isolated query transport.
- Commit `aa6571baa02b06cadc9d098ca67012960dbc9726`; full CI `38176893991`: SUCCESS.
- Hosted/live conditional steps remained SKIPPED because Actions credentials were absent.

### PROJECT_STATE sync after Research hardening [PASS]
- Recorded production Research wiring, secret-isolated DB transport, live Kernel gate and explicit `CODE_PASS_LIVE_SKIPPED` status.
- `Data/Result runtime` remains blocked by policy until the live Research gate actually passes.
- Commit `85397dce74fa635b25d8a2b9b1f2a4f6ffa8cb90`; full CI `38177049882`: SUCCESS.

### Live gate poison-state cleanup [PASS]
- A post-create live-gate failure could leave its own task claimable/running and poison the next queue-isolation precheck.
- The gate now best-effort calls canonical `cancel_task()` on only its own task before rethrowing, which clears leases and releases unresolved reservations.
- Commit `f4b7288059b894c4e31c13723ba52f36de9f8b91`; full CI `38177455334`: SUCCESS.

### Bound SQL process-argument isolation [PASS]
- The `psql` transport was hardened so bound SQL is not carried in process argv, reducing process-list/log exposure of query-bound values.
- Commit `c1822161700fa73a327cfdcce6a8fe9a7b918acb`; included in full green verification at CI `38178228559`.

### Shared hosted live-gate serialization [PASS]
- V2 CI serializes hosted live gates against the shared Neon branch and does not cancel an in-progress gate, preventing concurrent queue-isolation races and abrupt cleanup bypass.
- Commit `cae3c4c16d818eb2bf0f7a1f2231709df1956903`; included in full green verification at CI `38178228559`.

### Official DeepSeek V4.1 model alignment [PASS]
- Production/live Research model is aligned to official DeepSeek API id `deepseek-flash`, which resolves to DeepSeek-V4.1-Flash.
- Pricing identity remains `deepseek-v4.1-flash-2026-09-10` for deterministic accounting metadata.
- Commit `dba9728fc4912f7604a13a653d59610d82d157fe`; included in full green verification at CI `38178228559`.

### Required live Research evidence hardening [PASS]
- The live gate was tightened to reject incomplete success evidence rather than accepting a nominal Research SUCCESS without all mandatory proof fields.
- Commit `b02d14974f38d0809e270dd23ae9aadb5bc96152`; included in full green verification at CI `38178228559`.

### DeepSeek V4.1 Flash maximum reasoning [PASS: code/tests]
- Research invocation was upgraded from `--thinking off` to `--thinking max` while retaining official model id `deepseek/deepseek-flash`.
- Pinned OpenClaw `2026.9.8` supports direct DeepSeek V4 `max`, mapping it to native DeepSeek `reasoning_effort=max`.
- Commit `297bbb6f045891188eb47be73bb031f3192c69dd`; full CI `38178228559`: SUCCESS.
- This proves configuration/runtime compatibility; it does not substitute for a real paid DeepSeek Kernel call.

### PROJECT_STATE sync through max reasoning [PASS]
- `PROJECT_STATE.json` now records current verified code head, all live-gate hardening, official V4.1-Flash model identity, `thinking=max`, and the still-unproven paid live vertical.
- Commit `36d513eadad267af768c2dee0b6862370f3fbe05`; full CI `38178475376`: SUCCESS.

### Current engineering position
- Verified code baseline: `297bbb6f045891188eb47be73bb031f3192c69dd`; governance state sync commit: `36d513eadad267af768c2dee0b6862370f3fbe05`.
- Full CI `38178475376`: SUCCESS for Node tests, migrations, SQL assertions, PostgreSQL Research E2E, pinned OpenClaw installation, DeepSeek/DuckDuckGo plugin installation and config validation.
- Hosted Neon `openclaw-v2` remains directly verified through migration 0015 and fallback accounting semantics.
- Research uses official DeepSeek-V4.1-Flash (`deepseek/deepseek-flash`) at `thinking=max`.
- The production Research path and hardened live Kernel acceptance gate exist, including failure cleanup, queue serialization, web-tool evidence and accounting/fencing checks.
- Credential-dependent hosted/live GitHub Actions steps are still SKIPPED in current CI and therefore are not counted as live PASS.
- Real paid DeepSeek + `web_search` + `web_fetch` through the entire hosted Kernel vertical remains the next required gate.
- Do **not** begin Data runtime, durable evidence, or phone result until that live Research gate returns PASS evidence.
- 48-Hour Walking Skeleton remains `IN PROGRESS`, not PASS.
