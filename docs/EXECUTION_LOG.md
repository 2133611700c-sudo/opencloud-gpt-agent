# OpenClaw V2 — Execution Log

Purpose: durable chronological handoff between chats and engineering sessions. Update only with verified work.

## 2026-10-11

Earlier verified phase history remains in Git history and PROJECT_STATE.json. Current continuation records the kernel stabilization and Kernel→Research gates relevant to the 48h Walking Skeleton.

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
- JS now permits supported system terminal failure from `PENDING` and `AWAITING_APPROVAL`; unsupported direct SUCCESS remains forbidden.
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
- Added Research execution binding that uses deterministic reservation key, telemetry-gated accounting and canonical fenced completion/failure.
- This entry was later superseded by the verified reservation-fallback repair below: missing provider telemetry is now conservatively accounted instead of terminally failing Research.
- Verification commit `bc377db0500cdb7ad9ed35efb952e2fe5bdf7f71`; full CI `38170407768`: SUCCESS.

### Agent-scoped Kernel claim [PASS]
- Migration 0014 adds `claim_next_node_for_agent(worker, agent, lease)` so a dedicated Research worker cannot claim a Data node.
- SQL regression proves dependency-blocked Data is not claimable and Research is claimed only by the requested agent scope.
- Verification commit `1dd0b1a4a399b2eeef7b33e0b93895607bf408cb`; full CI `38170660200`: SUCCESS.

### Agent-scoped PostgreSQL adapter claim [PASS]
- PostgreSQL adapter now exposes the agent-scoped SQL claim without weakening the existing generic scheduler API.
- Focused Node regression verifies exact SQL function and parameters.
- Verification commit `c851faf358c424aeda573498683d3bea2071250e`; full CI `38170808454`: SUCCESS.

### Research UUID fencing fixture repair + PostgreSQL integration harness [PASS]
- Two stale Node-test fixtures still used integer `leaseToken: 1` after the production adapter correctly required UUID fencing tokens.
- Commit `a5d2210e72cc88250b634aa8d21a74f1d7867107` aligned the fixtures/call key with the real UUID contract.
- Full CI `38173071765`: SUCCESS, including Node tests, migrations, SQL assertions and `research-postgres-kernel-e2e`.
- The deterministic PostgreSQL harness proves Research claim → reserve → injected Research → accounting → fenced Research SUCCESS → Data becomes claimable. It is a Kernel integration test, not a live DeepSeek/web Walking Skeleton E2E.

### Research telemetry/accounting contract repair [PASS]
- Existing SQL `record_llm_call_reservation_fallback()` was wired through the PostgreSQL adapter and Research bindings.
- Missing usage and/or cost telemetry now charges the full reservation ceiling with explicit `RESERVATION_FALLBACK` basis; malformed observed telemetry still fails closed.
- Commit `5633a63b26dce6f46c9761fd619fa6ecca111a61`; full CI `38173723528`: SUCCESS.

### Hosted Neon catch-up and Kernel smoke [PASS: direct Neon verification]
- Isolated `openclaw-v2` Neon branch was verified directly and brought through migrations 0009–0014 semantics.
- Hosted SQL smoke proved Research → reservation → accounting → fenced Research SUCCESS → Data claim/completion → task finalizer SUCCESS.
- This direct Neon verification is independent of GitHub Actions; the Actions hosted-Neon step remains conditional on a `DATABASE_URL` secret.

### Hosted reservation-fallback accounting [PASS: direct Neon verification]
- Direct inspection found hosted Neon missing the historical accounting-fallback function/columns even though later Kernel migrations were present.
- The fallback schema was first applied and tested on a safety child branch, then applied to `openclaw-v2`.
- Hosted fallback smoke result: task `SUCCESS`; accounting basis `RESERVATION_FALLBACK`; charged cost `$0.010000`; charged tokens `100`; reservation basis `RESERVATION_FALLBACK`; reservation status `RECONCILED`.

### Canonical accounting-fallback migration ordering [PASS]
- Repository contained two migrations with prefix `0008`: active-lease hardening and accounting fallback.
- Historical accounting fallback was moved to canonical idempotent migration `0015_accounting_fallback.sql`; the duplicate `0008_accounting_fallback.sql` path was removed.
- Commit `c3597f38fbefe65f78a454e91153a9d49f1297c2`; full CI `38175260212`: SUCCESS.

### Hosted accounting-fallback schema gate [PASS]
- Hosted persistence gate now requires `record_llm_call_reservation_fallback` plus all four accounting/reconciliation basis/note columns, so this schema drift cannot be silently classified healthy when `DATABASE_URL` is configured.
- Commit `9398529650a8aff401c0223bd02233fd591f7efd`; full CI `38175402188`: SUCCESS.
- In that run the hosted Neon step was still SKIPPED because Actions has no `DATABASE_URL`; skipped is not a live hosted PASS.

### PROJECT_STATE truth repair [PASS]
- Removed the stale empty `known_gaps` state and old `c851faf...` continuation point.
- Recorded current verified head, direct Neon proof, accounting fallback repairs, and the still-open live DeepSeek/web/Data/evidence/phone gaps.
- Commit `376e30571e56407298e5fddcb86f18654b0271f0`; full CI `38175591266`: SUCCESS.

### Current engineering position
- Local/full CI is green through canonical migration 0015 and the PostgreSQL Research integration harness.
- Hosted Neon `openclaw-v2` is directly verified through the current Kernel schema and reservation-fallback accounting path.
- GitHub Actions still lacks `DATABASE_URL`, so the conditional hosted schema gate is SKIPPED even though direct Neon verification is PASS.
- GitHub Actions still lacks `DEEPSEEK_API_KEY`; live DeepSeek smoke and the real Kernel→DeepSeek→web vertical remain unproven.
- Data/Result runtime, durable evidence bundle, and phone short-result/deep-log path are not built yet.
- Governance defect still open at this exact point: `SYSTEM.md` describes 12 delivery phases while `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md` defines 14. The next micro-unit is to align `SYSTEM.md` to the 14-phase canonical roadmap, then run full CI before production wiring.
