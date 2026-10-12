# OpenClaw V2 — Independent Results Journal

Purpose: durable, independent checkpoint journal that lets any new chat or engineer recover the exact project picture without reconstructing dozens of commits.

This file is **append-only**. Never rewrite prior entries to make history cleaner. If an earlier statement becomes wrong, append a `CORRECTION` entry that names the affected checkpoint.

Detailed per-commit history remains in `docs/EXECUTION_LOG.md` and Git history. This journal records route-level checkpoints: what is proven, what is not proven, what changed, where the project is going next, and which detours are forbidden.

Use the evidence labels defined in `START_HERE.md`: `PASS_CODE_CI`, `PASS_HOSTED`, `PASS_LIVE`, `SKIPPED`, `NOT_PROVEN`, `DRIFT`, `NOT_BUILT`, `BLOCKED`.

---

## JRNL-2026-10-12-001 — Route reset and independent project map

**Checkpoint time:** 2026-10-12 06:36 America/Chicago  
**Branch:** `v2/openclaw-clean-20261011`  
**Verified code baseline:** `d51879dfe91ca0b72b94ed31f4b1584f7df7cf30`  
**Verified CI:** `38241601260` — `success`  
**Governance router:** `719b9b1032f1951b8d5d749fc0bff79324b15b45` — full CI `38244471179` SUCCESS  
**Current 48h phase:** Phase 6 — First Real Research Agent + Web Skill  
**Walking Skeleton:** `IN PROGRESS`

### Why this checkpoint exists

Work had accumulated faster than `PROJECT_STATE.json` and the older execution-log continuation point. Multiple useful hardening commits were GREEN, but there was no compact route map showing how each change related to the 48-hour target. This checkpoint resets navigation around the actual mandatory plan instead of continuing from memory or from whichever defect was most recently discovered.

The operating rule from this checkpoint onward is:

`48h plan -> current state -> latest journal checkpoint -> HEAD/CI -> hosted/live reality -> one next gate`

### 48-hour scope map

| # | Mandatory scope item | Status at checkpoint | Evidence / limitation |
|---|---|---|---|
| 1 | Hosted PostgreSQL + migrations | **DRIFT** | Hosted Neon is operational and clean, but repository migration `0018_deadline_heartbeat_guard.sql` is not yet reflected in hosted `heartbeat_node`. |
| 2 | Durable state machine | **PASS_CODE_CI** | Deterministic lifecycle/terminalization regressions pass. |
| 3 | Idempotent request intake | **PASS_CODE_CI** | Kernel intake/idempotency path is tested. |
| 4 | Atomic lease + unique fencing token | **PASS_HOSTED** | Hosted scoped claim/fencing primitives exist; stale-reclaim cleanup is present. |
| 5 | Heartbeat + stale-worker recovery | **DRIFT** | Local/CI deadline heartbeat guard passes; hosted Neon still has pre-0018 heartbeat behavior. |
| 6 | attempts / total steps / budget / deadline breakers | **PASS_CODE_CI** | Breaker tests pass; hosted deadline-heartbeat parity still requires 0018. |
| 7 | Atomic budget reservation/reconciliation | **PASS_HOSTED** | Hosted accounting fallback and stale-lease reservation cleanup have direct proof. |
| 8 | Lite DAG `Research -> Data/Result` | **PASS_CODE_CI** | Kernel DAG/dependency/finalizer path works. This does not certify a production Data runtime. |
| 9 | Real DeepSeek/OpenClaw call | **NOT_PROVEN** | Pinned OpenClaw/provider/plugin/config/auth path is GREEN, but real paid Kernel call did not execute. |
| 10 | Real native web search/fetch | **NOT_PROVEN** | Tool contracts are hardened, but real `web_search` + `web_fetch` through the hosted Kernel has not executed. |
| 11 | Structured Research output with sources | **PASS_CODE_CI** | Result/source/provenance/required-domain/unresolved-tool-failure contracts are tested. Live internet-derived proof remains part of the unproven gate. |
| 12 | Data/Result validation/dedup/normalization | **NOT_BUILT** | Gate-only deterministic Data completion is not a production Data runtime. |
| 13 | LLM accounting | **PASS_HOSTED** | Hosted accounting/fallback semantics are proven. Real paid DeepSeek-linked accounting remains part of the unproven live gate. |
| 14 | Durable evidence artifacts | **NOT_BUILT** | Required persistent task evidence layer does not exist yet. |
| 15 | Phone short result + deep-log link | **NOT_BUILT** | Phase 8 has not started. |

### Mandatory acceptance map

| # | Acceptance test | Status |
|---|---|---|
| 1 | Positive real research E2E -> `SUCCESS` | **NOT_PROVEN** |
| 2 | Duplicate dispatch -> one task only | **PASS_CODE_CI** |
| 3 | Worker crash -> another worker safely continues | **PASS_CODE_CI** |
| 4 | Old fencing token cannot mutate | **PASS_HOSTED** |
| 5 | Budget terminal stop + zero further model calls | **PASS_CODE_CI** |
| 6 | Data cannot run before Research `SUCCESS` | **PASS_CODE_CI** |
| 7 | Research failure -> descendant `BLOCKED` + termination | **PASS_CODE_CI** |
| 8 | Deadline -> unfinished work terminates correctly | **DRIFT** — local/CI PASS; hosted heartbeat deadline guard 0018 missing |
| 9 | reservation -> actual -> unused release invariant | **PASS_HOSTED** for Kernel/SQL semantics; paid live linkage still belongs to acceptance #1 |

### Positive evidence at this checkpoint

- Full CI `38241601260` is GREEN for foundation validation, Node tests, migrations, SQL assertions, PostgreSQL Research E2E, pinned OpenClaw install, DeepSeek plugin install, DuckDuckGo plugin install, Research credential-scope check, and generated Research config validation.
- The same run **skipped** hosted Neon persistence and live DeepSeek/web steps; those skips are not counted as PASS.
- Direct Neon read-only inspection at this checkpoint: `0` active tasks, `0` RUNNING nodes, `0` unresolved `RESERVED` reservations.
- Hosted Neon has `claim_node_for_task_and_agent`.
- Both scoped claim functions contain `LEASE_RECLAIM` reservation cleanup.
- Hosted accounting fallback function is present.
- DeepSeek runtime target remains `deepseek/deepseek-flash` / DeepSeek-V4.1-Flash with `thinking=max` on pinned OpenClaw `2026.9.8`.

### Negative evidence / open truth

- Hosted Neon `heartbeat_node` does **not** yet contain the migration 0018 task-deadline guard. Repository and hosted state are therefore in `DRIFT`.
- GitHub Actions still skipped the hosted persistence gate because `DATABASE_URL` was unavailable there.
- GitHub Actions still skipped the live Kernel Research vertical and live DeepSeek smoke because the required runtime credentials were unavailable there.
- Therefore the real paid DeepSeek + `web_search` + `web_fetch` + accounting + fencing vertical is **NOT_PROVEN**.
- Production Data runtime is **NOT_BUILT**.
- Durable evidence layer is **NOT_BUILT**.
- Phone/deep-log UX is **NOT_BUILT**.

### Important verified innovations since the older stale state checkpoint

The following changes are part of the current GREEN branch history and materially improve the real Research path:

- `015713e0…` — Research SUCCESS now rejects an unresolved tool error; invocation alone is no longer treated as successful web evidence.
- `e98c9201…` — Research worker gained task-scoped claim support.
- `b0da03a4…` — production Research composition exposes task-scoped `runTask(taskId)`.
- `fccd2b4a…` — live Research gate uses task-scoped Research claim, closing the TOCTOU race where an agent-wide claim could take another task.
- `51cc025a…` — live-gate fixtures aligned with task-scoped Research behavior.
- `19938a3c…` — stored Research credential state is rejected instead of silently trusted.
- `3694d37b…` — CI verifies plugin installation does not leave Research auth state behind.
- `dadb8e2a…` — stored authentication state is verified semantically rather than by file presence.
- `99ab9de8…` — semantic DeepSeek authentication probe added.
- `56571085…` — durable Research claims are gated on semantic auth preflight so runtime-independent auth failure occurs before claim.
- `b23a2c85…` — semantic auth probe environment is isolated from ambient process secrets.
- `b97d8838…` — verified engineering lessons codified into the detailed execution protocol.
- `d51879df…` — migration 0018 makes task deadline a hard heartbeat breaker; local/CI proof is GREEN, hosted deployment remains pending.

### Route decision

The next work is **not** another general hardening pass.

The allowed route is:

1. **Hosted parity gate:** test migration 0018 on a temporary Neon child branch with the real expired-deadline heartbeat regression.
2. If the temporary branch passes, apply the same additive `heartbeat_node` migration to hosted `openclaw-v2`.
3. Re-check hosted behavior and cleanliness: deadline heartbeat must return false without extending the lease; active tasks/running nodes/unresolved reservations must remain clean after the test.
4. **Live Research gate:** execute the already-built real Kernel Research vertical using real DeepSeek-V4.1-Flash at `thinking=max`, real `web_search`, real `web_fetch`, source provenance, accounting, budget/fencing, and terminal state evidence.
5. Only after that exact live gate is `PASS_LIVE` may Phase 12-of-48h-scope Data/Result runtime implementation begin.

### Explicit detours forbidden until live Research PASS

Do not start:

- production Data/Result implementation;
- durable evidence feature layer;
- phone UX;
- browser/Vision/PDF expansion;
- full 71-agent / 311-skill activation;
- broad architecture refactors;
- speculative hardening that does not reproduce a defect on the hosted-0018 or live-Research path.

### Continuation sentence for a new chat

> Read `START_HERE.md`, then the 48h plan, then `PROJECT_STATE.json`, then this checkpoint. Verify HEAD/CI and hosted Neon before writing. Current route is hosted migration 0018 parity -> real live Research E2E -> Data only after live PASS.
