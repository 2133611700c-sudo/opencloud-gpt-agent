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

---

## JRNL-2026-10-12-002 — Execution control plane established

**Checkpoint time:** 2026-10-12 America/Chicago  
**Branch:** `v2/openclaw-clean-20261011`  
**Router:** `START_HERE.md` commit `719b9b1032f1951b8d5d749fc0bff79324b15b45` — CI `38244471179` SUCCESS  
**Independent journal bootstrap:** commit `8eba98fb5fdbd35c3c4ad1ef1049cfcaf4657a80` — CI `38244721760` SUCCESS  
**Machine state synchronization:** commit `189a222ff870bb7ef4b9d0fbed9cebc29f1c7b9b` — CI `38244985395` SUCCESS  
**Router truth enforcement:** commit `c7deec97870a6eb6cb529a969902bb4d02d7af59` — CI `38245212289` SUCCESS

### Result

The project now has a durable execution control plane instead of relying on chat memory or the last defect discussed.

`START_HERE.md` defines the mandatory boot order, authority rules, route-selection algorithm, multi-lane roles, pre-write Route Card, write discipline, evidence labels, journal policy, and recovery test for a new chat.

`PROJECT_STATE.json` is now schema v2 and carries the current 15-item 48h scope map, 9 acceptance gates, verified code baseline, hosted-state facts, current route, explicit gaps, recent innovations, and forbidden detours.

`docs/RESULTS_JOURNAL.md` is the independent append-only route-level record. Detailed commit history remains in `docs/EXECUTION_LOG.md` and Git.

The existing first CI step `npm run validate:foundation` now also enforces the route map. It requires the router/state/journal/48h artifacts, validates the 15/9 maps and canonical evidence labels, and prevents Walking Skeleton PASS while mapped gates remain unfinished. It also preserves the rule that Data/evidence/phone remain blocked until acceptance gate #1 is `PASS_LIVE`.

### Positive evidence

- Router commit: `PASS_CODE_CI`.
- Journal bootstrap: `PASS_CODE_CI`.
- State synchronization: `PASS_CODE_CI`.
- Route-map validator: `PASS_CODE_CI`.
- Every one of the four governance commits ran the full existing V2 CI, not a docs-only shortcut.
- CI continues to distinguish conditional external work correctly: hosted Neon and live DeepSeek steps remain `SKIPPED` when their Actions prerequisites are absent.

### Negative evidence preserved

This control-plane work did **not** change technical gate truth:

- hosted migration 0018 remains `DRIFT` until directly deployed and tested;
- real paid DeepSeek/OpenClaw remains `NOT_PROVEN`;
- real `web_search`/`web_fetch` remains `NOT_PROVEN`;
- production Data runtime remains `NOT_BUILT`;
- durable evidence remains `NOT_BUILT`;
- phone/deep-log remains `NOT_BUILT`.

No governance commit is allowed to turn any of those into PASS.

### Route decision

Governance construction is complete enough for the current 48h phase. Do not spend more time polishing the router unless the validator itself exposes a real defect.

**Next allowed gate:** hosted Neon migration 0018 parity.

Execution route:

`temporary Neon child -> apply exact 0018 -> expired-deadline heartbeat behavioral regression -> PASS -> apply exact 0018 to openclaw-v2 -> hosted re-check/cleanliness -> journal checkpoint -> real live Research E2E`

Production Data remains forbidden until the real Research vertical is `PASS_LIVE`.

---

## JRNL-2026-10-12-003 — New-chat handoff verification and operating doctrine

**Checkpoint time:** 2026-10-12 07:10 America/Chicago  
**Branch:** `v2/openclaw-clean-20261011`  
**Verified governance HEAD before this checkpoint:** `042bcb3fe0791fcf70a884927fe55cfb750e9976`  
**Full CI:** `38245503457` — `SUCCESS`  
**Verified technical code baseline:** `d51879dfe91ca0b72b94ed31f4b1584f7df7cf30`  
**Technical baseline CI:** `38241601260` — `SUCCESS`  
**Walking Skeleton:** `IN_PROGRESS`

### Fresh hosted reality at handoff

A direct read-only Neon check against `openclaw-v2 / openclaw_v2` at this checkpoint returned:

- active tasks: `0`;
- RUNNING nodes: `0`;
- unresolved `RESERVED` reservations: `0`;
- migration 0018 deadline guard inside hosted `heartbeat_node`: **absent**.

Therefore the hosted state is clean but still in **DRIFT** relative to repository migration `0018_deadline_heartbeat_guard.sql`.

### Exact route from this checkpoint

Do not restart broad defect hunting and do not jump to Data.

The next allowed route is exactly:

1. Create/use a temporary Neon child of `openclaw-v2`.
2. Apply the exact repository migration `0018_deadline_heartbeat_guard.sql` there.
3. Run the behavioral expired-deadline heartbeat regression: heartbeat after task deadline must return `false` and must not extend `lease_until`.
4. Confirm temp-branch cleanliness and no reservation/lease corruption.
5. If PASS, apply the same additive migration to hosted `openclaw-v2` using the provider-safe migration path.
6. Re-run direct hosted behavior + cleanliness checks.
7. Append a hosted-parity journal checkpoint.
8. Execute the real paid Kernel Research vertical: hosted task -> task-scoped Research claim -> DeepSeek-V4.1-Flash `thinking=max` -> real `web_search` + successful `web_fetch` -> required-domain source provenance -> accounting/reservation/fencing -> terminal task state.
9. Mark acceptance #1 `PASS_LIVE` only if that real path actually executes and evidence is complete.
10. Only then start production Data/Result runtime.

### Agent operating model — mandatory

Use independent lanes, with one writer only:

- **Lane A — Investigator/reviewer, read-only:** reproduce the exact current-gate defect or unproven invariant.
- **Lane B — Independent specialist, read-only:** DB/concurrency/security/provider specialist tries to falsify Lane A and checks side effects.
- **Lane C — Implementation, single writer:** smallest coherent fix only after A+B agree on the invariant.
- **Lane D — Verification, independent:** unit/negative tests -> SQL/kernel -> local PG E2E -> pinned OpenClaw/plugins -> hosted -> paid live as applicable.
- **Lane E — Recorder/navigator:** update `PROJECT_STATE.json` and this journal only after evidence exists.

Read-only lanes may run in parallel. Two writers must never edit the same code/schema zone concurrently. Before every write, re-read HEAD and use expected-SHA/lease semantics. If HEAD moved, review the delta first; never overwrite another lane.

### Positive experience to repeat

- One defect/invariant per commit + full CI kept regressions local and diagnosable.
- Independent reviewers caught bad cleanup assumptions, task-claim TOCTOU races, cache-token accounting mistakes, stale reservation leaks and false tool-success evidence.
- Task-scoped DB claims are stronger than queue-isolation prechecks.
- Temporary Neon branches + behavioral SQL tests are the safe pattern before hosted schema changes.
- Fail-closed preflight before a durable claim prevents poisoned state.
- Conservative reservation-fallback accounting is safer than inventing provider telemetry.
- Official/pinned DeepSeek and OpenClaw contracts must decide ambiguous semantics, not assumptions.
- A tool appearing in telemetry is not success; unresolved tool failure must fail the Research acceptance path.
- `SKIPPED` is useful evidence of non-execution, never PASS.

### Negative experience that must not be repeated

- Do not call a local/mock/code PASS a hosted/live PASS.
- Do not continue writing while the previous commit CI is still RED or incomplete.
- Do not use an agent-wide claim where task ownership can be enforced atomically in SQL.
- Do not copy scoped claim SQL and forget stale-lease reservation cleanup.
- Do not allow heartbeat interval >= lease duration.
- Do not leave invalid claimed work RUNNING for stale recovery when it can be terminalized immediately under the active fence.
- Do not add cache hit/miss counters on top of DeepSeek prompt tokens; they are subsets of prompt/input.
- Do not trust `costUsd=0` with nonzero usage without a provider contract proving it.
- Do not accept vendor-domain evidence when `requiredDomains` asks for a narrower host.
- Do not pass ambient process secrets to probes/children.
- Do not infer credential validity from the existence of auth/state files; verify semantics.
- Do not create duplicate migration numbers.
- Do not let journals/state materially lag behind the verified branch reality.
- Do not activate full 71 agents / 311 skills before the mandatory vertical slice is real.

### Boot order for the next chat

The new chat must follow this order before any write:

1. `START_HERE.md`.
2. `docs/02_48H_WALKING_SKELETON.md` completely.
3. `PROJECT_STATE.json`.
4. The **latest** entry in `docs/RESULTS_JOURNAL.md` (this checkpoint or a later one).
5. Current branch HEAD and exact latest CI job/step results.
6. Direct hosted Neon drift/cleanliness check because the next gate is hosted.
7. Only then `SYSTEM.md` and the 14-phase master roadmap for architecture context.
8. Use `docs/EXECUTION_LOG.md` for detailed history and the canonical engineering protocol. Its older SYSTEM-first continuation sentence is superseded by `START_HERE.md`.

Before writing, the new chat must be able to state: exact 48h goal; current verified technical baseline; current HEAD/CI; statuses of 15 scope items and 9 acceptance gates; hosted state; one next allowed step; and forbidden detours.

### Route decision

**Next gate remains hosted migration 0018 parity.**

Do not spend the next session on governance polish, generalized hardening, Data, evidence UI, phone UX, browser/Vision/PDF, or catalog scale-out unless a reproduced defect on the 0018/live-Research path requires it.

### Continuation sentence for a new chat

> Treat repository truth as authoritative, not chat memory. Read `START_HERE.md` -> full 48h plan -> `PROJECT_STATE.json` -> latest `RESULTS_JOURNAL` -> current HEAD/CI -> direct Neon reality. Use independent reviewer/DB/security lanes and one implementation writer. Current allowed route is hosted 0018 parity -> real paid Research E2E -> Data only after acceptance #1 is `PASS_LIVE`. Never promote `SKIPPED`, mock, local, or code-only evidence to hosted/live PASS.

---

## JRNL-2026-10-12-004 — Hosted migration 0018 parity proven

**Checkpoint time:** 2026-10-12 07:25 America/Chicago  
**Branch:** `v2/openclaw-clean-20261011`  
**Verified repository HEAD before hosted work:** `9883010f98379873b9bf73e0bd1ecbeabb552796`  
**Latest full CI before this checkpoint:** `38248010816` — `SUCCESS`  
**Technical migration baseline:** `d51879dfe91ca0b72b94ed31f4b1584f7df7cf30` — migration `0018_deadline_heartbeat_guard.sql`

### Child-branch verification

A fresh child could not be created because the Neon project was already at its branch limit. No hosted write was performed at that point. An existing clean verification child was identified instead:

- branch: `openclaw-v2-0018-verify-20261012`;
- branch id: `br-wandering-fire-a4vhwmd6`;
- parent: hosted `openclaw-v2` / `br-odd-forest-a4leyaqj`;
- pre-test state: `0` active tasks, `0` RUNNING nodes, `0` unresolved `RESERVED` reservations;
- full 0018 heartbeat guard was absent before application.

The exact repository `heartbeat_node` function body from migration 0018 was applied transactionally. The expired-deadline regression then created a task already past `deadline_at`, with a still-`RUNNING` node and a valid unexpired lease/fencing token.

Direct result:

- `heartbeat_node(...)` returned `false`;
- `lease_until` was unchanged;
- `heartbeat_at` was unchanged;
- the test task/node state was not mutated by the rejected heartbeat;
- cleanup returned the child to `0` active tasks / `0` RUNNING nodes / `0` unresolved reservations;
- the full active-lease + parent-task-status + deadline guard was present after migration.

This is a behavioral proof, not merely schema-existence proof.

### Hosted application and direct proof

Immediately before the hosted write, Git HEAD was re-read and remained `9883010f98379873b9bf73e0bd1ecbeabb552796`; no parallel writer delta was present.

The same repository function body was then applied to hosted `openclaw-v2 / openclaw_v2` and the same expired-deadline regression was executed directly there.

Hosted result:

- `heartbeat_node(...)` returned `false` after the parent task deadline;
- `lease_until` was byte-for-byte timestamp-equal before and after the rejected heartbeat;
- `heartbeat_at` was unchanged;
- post-test cleanup: active tasks `0`, RUNNING nodes `0`, unresolved `RESERVED` reservations `0`;
- full 0018 guard is now present in hosted `heartbeat_node`.

**Gate result: `PASS_HOSTED` for HOSTED MIGRATION 0018 PARITY.**

### Truth that remains open

This hosted PASS does not promote the external Research gate:

- real paid DeepSeek/OpenClaw: `NOT_PROVEN`;
- real native `web_search` + successful `web_fetch`: `NOT_PROVEN`;
- acceptance #1 positive real Research E2E: `NOT_PROVEN`;
- production Data runtime: `NOT_BUILT` and still blocked;
- durable evidence layer: `NOT_BUILT`;
- phone/deep-log result: `NOT_BUILT`.

The latest GitHub CI still had hosted/live credential-dependent steps `SKIPPED`; those skips remain non-PASS even though hosted 0018 was proven directly outside that Actions step.

### Route decision

The next allowed gate is now exactly:

`REAL_PAID_RESEARCH_E2E`

Required vertical:

`hosted PostgreSQL -> task-scoped Research claim -> reservation -> OpenClaw 2026.9.8 -> deepseek/deepseek-flash / DeepSeek-V4.1-Flash thinking=max -> real web_search -> successful real web_fetch -> required-domain provenance -> structured Research result -> accounting/reconciliation -> fencing completion -> Data dependency release -> terminal task result`

Production Data remains forbidden until acceptance #1 is directly proven `PASS_LIVE`.

---

## JRNL-2026-10-12-005 — Research primary-model resolution defect repaired

**Checkpoint time:** 2026-10-12 09:42 America/Chicago
**Branch:** `v2/openclaw-clean-20261011`
**Implementation commit:** `d1a64b91b15ba5f9c65d96a1535d91a3637c0e1e`
**Full CI:** `38262169004` — `SUCCESS`
**Current 48h phase:** Phase 6 — First Real Research Agent + Web Skill
**Next mandatory gate:** `REAL_PAID_RESEARCH_E2E`

### Lane A — plan / investigator

The 48h plan and route were re-read before implementation. The earliest unproven dependency remains acceptance #1: real paid Research E2E. Production Data, durable evidence feature work and phone UX remain blocked until that gate is `PASS_LIVE`.

A concrete defect was reproduced on the exact live Research path with pinned OpenClaw `2026.9.8`: the generated Research config allowed the DeepSeek plugin and the invocation requested `deepseek/deepseek-flash`, but the config did not pin that model as the agent primary. The runtime failed before provider authentication with `Unknown model: deepseek/deepseek-flash`.

### Lane B — independent provider/runtime falsification

The installed official `@openclaw/deepseek-provider@2026.9.8` manifest was inspected independently. It exposes DeepSeek models through the provider catalog. Testing multiple model names without a primary-model pin reproduced the same model-resolution failure, which falsified the hypothesis that the problem was only the alias spelling or the user credential.

A temporary config with `agents.defaults.model.primary = deepseek/deepseek-flash`, no fallbacks and empty utility model was then validated. With an intentionally invalid test credential, OpenClaw no longer failed with `Unknown model`; it reached `api.deepseek.com` and failed at the expected HTTP 401 authentication boundary. This proves runtime/provider model resolution, not paid inference.

### Lane C — implementation

Smallest coherent repair only:

- `src/research/openclaw-research-runtime.mjs` now pins `deepseek/deepseek-flash` as the Research agent primary model;
- model fallbacks are empty;
- utility model is disabled for this bounded Research scope;
- regression assertions were added to `tests/research/openclaw-research-runtime.test.mjs`.

No Data, evidence, phone, browser, Vision or broad orchestration work was added.

### Lane D — independent verification

Evidence after the repair:

- targeted Research runtime tests: PASS;
- full Node suite: `172/172` PASS;
- foundation/route-map validation: PASS;
- local PostgreSQL migrations `0001..0018`: PASS;
- SQL/kernel assertions: PASS;
- PostgreSQL Research execution E2E: PASS;
- pinned OpenClaw `2026.9.8` install: PASS;
- official DeepSeek provider plugin `2026.9.8`: PASS;
- official DuckDuckGo plugin `2026.9.8`: PASS;
- Research credential isolation: PASS;
- generated Research config validation: PASS;
- post-fix external provider-resolution probe: reached DeepSeek authentication boundary instead of model-resolution failure.

Full GitHub Actions run `38262169004` completed `SUCCESS`.

### Negative evidence preserved

The same CI run reported both external prerequisites absent in the Actions context:

- `DATABASE_URL`: MISSING;
- `DEEPSEEK_API_KEY`: MISSING.

Therefore the hosted persistence Actions step and the real Kernel Research/DeepSeek steps were `SKIPPED`. Per project truth rules, those skips are not PASS.

A fresh direct hosted Neon read-only check after the implementation showed:

- active tasks: `0`;
- RUNNING nodes: `0`;
- unresolved RESERVED reservations: `0`.

The hosted database remains clean.

### Gate truth

- Research model-resolution defect: **PASS_CODE_CI**;
- hosted PostgreSQL through migration 0018: **PASS_HOSTED**;
- real paid DeepSeek inference: **NOT_PROVEN**;
- real `web_search` + successful `web_fetch`: **NOT_PROVEN**;
- acceptance #1 positive Research E2E: **NOT_PROVEN**;
- production Data runtime: **NOT_BUILT / BLOCKED** until acceptance #1 is `PASS_LIVE`.

### Recorder recovery note

During the recorder/tooling pass, two unintended temporary repository-file writes were created by an incorrect tool selection. They were not treated as project work. The branch head was re-read immediately and force-with-lease was used with the exact expected accidental head to restore `v2/openclaw-clean-20261011` to `d1a64b91b15ba5f9c65d96a1535d91a3637c0e1e`. A follow-up branch read confirmed the restoration. This is now an explicit negative practice: never use a write-shaped connector call for discovery or probing; discover the exact read/write schema first, and re-read HEAD after any unexpected tool result.

### Route decision

Continue exactly with `REAL_PAID_RESEARCH_E2E`. Do not detour into production Data, evidence features, phone UX, browser/Vision/PDF, full agent/skill scale-out or broad refactors. The next status promotion is allowed only after the real paid provider + real web tools + hosted Kernel vertical executes and durable accounting/fencing/terminal evidence is inspected.

---

## JRNL-2026-10-12-006 — Hosted lease parity complete and real Research acceptance #1 proven

**Checkpoint time:** 2026-10-12 13:54 America/Chicago  
**Branch:** `v2/openclaw-clean-20261011`  
**Verified branch HEAD before this checkpoint:** `24fd5a023b0652254dd693999a6a11049765116a`  
**Latest full CI:** `38292953226` — `SUCCESS`  
**Latest hosted lease-parity implementation:** `aaed44ac0b2640e10368dca8ad8ad5087b0a7f1f` — migration `0019_active_lease_write_parity.sql`, CI `38287719014` SUCCESS

### CORRECTION to the prior live-gate route state

Earlier governance kept acceptance #1 and native web-tool execution at `NOT_PROVEN` because the hosted task tables did not persist the OpenClaw tool-summary telemetry and the task had zero `artifacts` rows. A fresh audit recovered independent runtime execution metadata from the exact Vercel sandbox that ran the paid gate and correlated it to the hosted task by timestamp and fail-closed gate semantics.

That evidence changes the truth of acceptance #1. It does **not** change the truth of mandatory durable Evidence item #14, which remains `NOT_BUILT`.

### Real paid runtime execution evidence

Vercel sandbox metadata preserves the real paid execution session:

- sandbox name: `openclaw2-live-runtime`;
- session: `sbx_cuMMQpe4KuCfXsGYJmfa0e1RJokT`;
- tag/purpose: `real-paid-research-e2e`;
- command: `cmd_1cb90e24ee6c42f8b219a97fe9d8`;
- command started at epoch `1791825931121` = `2026-10-12T17:25:31.121Z`;
- command: `node scripts/live-research-kernel-vertical.mjs` with the pinned OpenClaw runtime/state setup;
- command exit code: `0`;
- duration: `24603 ms`.

The script is fail-closed: any gate error sets process exit code `1`. The invoked `runLiveResearchKernelGate()` specifically rejects success unless all of the following are true in the same execution:

- Research worker executed the exact task and returned `SUCCESS`;
- at least one official DeepSeek source exists;
- at least one official source matches required domain `api-docs.deepseek.com`;
- at least one result item proves all required fields from an accepted source;
- OpenClaw telemetry contains **both** `web_search` and `web_fetch`;
- exactly one `llm_accounting` row exists;
- zero unresolved `RESERVED` reservations remain;
- Data becomes claimable only after Research `SUCCESS`;
- deterministic gate-only Data completion succeeds;
- final task status is `SUCCESS`.

Therefore an exit code `0` from this exact command is direct runtime proof that the real web-tool checks passed; it is not equivalent to a model merely returning source-looking URLs.

### Hosted Neon correlation

The hosted task created by that command is:

`eae6daf8-e086-43a5-aea9-b6ec879ce65a`

Direct hosted facts:

- idempotency key: `ci-live-research-33c78eb7-fbc0-418f-9ecb-26319675315b`;
- created: `2026-10-12T17:25:31.276Z`, only ~155 ms after the preserved gate command began;
- terminal: `2026-10-12T17:25:55.712Z`;
- task status: `SUCCESS`;
- terminal reason: `ALL_NODES_SUCCEEDED`;
- Research node: `SUCCESS`;
- Data node: `SUCCESS`, mode `DETERMINISTIC_LIVE_GATE_COMPLETION`;
- official sources persisted from `api-docs.deepseek.com`;
- structured fields persisted: `modelId=deepseek-flash`, `modelVersion=DeepSeek-V4.1-Flash`;
- `llm_accounting` rows: exactly `1`;
- accounting basis: `OBSERVED_USAGE`;
- cache hit tokens: `11008`;
- cache miss tokens: `4615`;
- completion tokens: `663`;
- total tokens: `16286`;
- cost: `$0.002246`;
- task reserved tokens/cost after reconciliation: `0 / 0`;
- artifacts for this task: `0`.

### Hosted lease parity added after the live run

Migration `0019_active_lease_write_parity.sql` subsequently restored the missing active-lease guard on both `complete_node_success()` and `requeue_node_retry()`.

Direct child verification + hosted application proved that an expired worker can no longer complete or requeue before reclaim. Post-test hosted state was clean: `0` active tasks, `0` RUNNING nodes, `0` unresolved reservations.

**0019 result: `PASS_HOSTED`.**

### Updated 48h truth

- Hosted PostgreSQL/migrations: **PASS_HOSTED**.
- Lease/fencing/heartbeat/deadline/write parity: **PASS_HOSTED**.
- Real DeepSeek/OpenClaw inference: **PASS_LIVE**.
- Real native `web_search` + `web_fetch`: **PASS_LIVE**.
- Structured Research output with official required-domain sources: **PASS_LIVE**.
- Paid accounting/reconciliation linkage: **PASS_LIVE**.
- Acceptance #1 positive real Research E2E -> terminal `SUCCESS`: **PASS_LIVE**.
- Production Data/Result validation/dedup/normalization: **NOT_BUILT**.
- Durable Evidence bundle/artifact: **NOT_BUILT**.
- Phone short result + deep-log link: **NOT_BUILT**.
- User/GitHub dispatch workflow: **NOT_BUILT**.
- Permanent CI credential plumbing remains **NOT_PROVEN**; latest GitHub Actions live/hosted conditional steps are still `SKIPPED` because repository secrets are unavailable there.

### Route decision

The Research gate is now closed. Production Data is no longer blocked by acceptance #1.

**Next allowed implementation step:** build only the production Data/Result runtime required by 48h item #12: schema validation -> normalization -> dedupe -> required-field enforcement -> source integrity -> deterministic structured output, with focused tests and full CI.

Do not start Evidence, phone UX, GitHub intake/dispatch, browser/Vision/PDF, full agent/skill scale-out or broad architecture refactors until the production Data gate is independently `PASS_CODE_CI`.
