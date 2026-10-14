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

---

## JRNL-2026-10-13-001 — D1 checkpoint reconciled and remaining 48h execution route defined

**Reviewed branch:** `v2/openclaw-clean-20261011`  
**Verified HEAD before this checkpoint:** `8c3ec70172d8c136b29a5dda853190af447e3908`  
**Exact latest full CI:** `38323842573` — `SUCCESS`  
**Latest implementation baseline:** `fbbf05d7d7a016805353924b06732d0bacf39b81` — D1 production Data contract, exact full CI `38302547362` `SUCCESS`

### Reconciliation and positive evidence

The complete delta from the recorded checkpoint through the reviewed HEAD was examined. D1 adds `src/data/data-contract.mjs` and `tests/data/data-contract.test.mjs`: schema v1, Research SUCCESS input, required-field validation including valid false/zero, source presence/unique identifiers and valid source references. Its exact full CI passed. **D1 result: `PASS_CODE_CI`.** This closes the contract subgate only. Focused local verification also executed all eight D1 cases with `node --test --test-isolation=none tests/data/data-contract.test.mjs`; this is local evidence, not a replacement for exact CI. Full-suite file-wrapper counts are not treated as assertion counts.

The archive `docs/handoff/CHATGPT_PROJECT_ARCHIVE.md` exists and was read completely. It preserves available historical context, states its completeness limits and correctly distinguishes gate-only Data from production Data. It is a reference; current HEAD/exact CI/hosted/live facts remain authoritative.

The state map now uses canonical `PASS_CODE_CI` for scope #8 with the gate-only Data limitation in a separate note. Scope #12 is `NOT_PROVEN` overall with D1 `PASS_CODE_CI`; D2 normalization/dedupe and D3 runtime are `NOT_BUILT`, D4 vertical is `NOT_PROVEN`.

### Negative evidence and retained proof limits

- Exact archive CI hosted/live credential-dependent steps remained `SKIPPED`; no skipped step was promoted to PASS.
- `hosted_inspector` performed a fresh direct read-only hosted inspection at `2026-10-12T23:57:30.163Z`: active tasks `0`, RUNNING nodes `0`, unresolved reservations `0`, artifacts total `0`; deployed complete/requeue/fail active-lease guards inspected. No hosted mutation, new behavioral write test or paid call occurred. Existing hosted behavioral facts and Research `PASS_LIVE` retain their earlier evidence.
- Complete production Data runtime remains `NOT_PROVEN`.
- Durable Evidence, phone result/deep log and real user/GitHub dispatch remain `NOT_BUILT`.
- Permanent machine credential plumbing remains `NOT_PROVEN`; branch protection and least-privilege workflow work remain open.
- The archive is not a literal complete ChatGPT Project/transcript/attachment export.

### Execution handoffs and recording

`docs/03_48H_EXECUTION_GATES.md` defines entry/exit evidence for D2/D3/D4, E1/E2, P1, I1/I2, B1 and G1/G2. Actual assigned lanes are `root` coordinator/publisher, `data_investigator`, `data_skeptic`, `verification_engineer`, `hosted_inspector` and `data_readonly_review` recorder. The intended `data_implementer` is the sole future Data writer; no implementation execution is claimed yet. Agents exchange exact-SHA findings and run/task IDs; catalog roles are never counted as executed agents. Seven available slots are concurrency capacity, not seven always-active agents or separate specialist-model proof. Read-only reviewers work in parallel, feature zones have one writer, and Lane E is the sole shared state/journal writer. Observations and pending/negative work are recorded without premature gate promotion; accepted state advances after independent exact verification.

### Route decision

**Next functional gate: D2 normalization + dedupe only.** Invariant: the same valid Research SUCCESS input produces deterministic canonical sourced Data output; duplicates are removed deterministically without losing required fields or source integrity; no LLM call occurs.

Investigator/skeptic agreement: two new transformer/test files; finite plain JSON; normalize declared contract strings only; preserve data strings/keys/array order and URL queries/fragments; compare full normalized source/item records except id including provenance; stable minimum-codepoint representative; alias/remap/unique/sort references and sources/items sorted by id. No implementation or PASS is pre-announced.

Verification: focused Data tests -> full Node suite -> full exact GitHub CI. Then hand off to D3; no automatic conversational pause is required when the next authorized gate is clear and the previous evidence is accepted.

Do not build Evidence, phone UX or dispatch until D4 proves complete production Data. Do not detour into browser/Vision/OCR/PDF, broad refactors, full 71-agent/311-skill activation or unneeded Research redesign. Authorized credential preparation is separate and cannot advance a functional gate or convert `SKIPPED` to PASS.

---

## JRNL-2026-10-13-002 — D2 normalization/dedupe independently verified

**Branch:** `v2/openclaw-clean-20261011`  
**Verified implementation HEAD before this checkpoint:** `9205d4b2d839b70927e174a09a2f85a7e6606357`  
**Parent governance baseline:** `97049ec12970de14401a23508c317619d25ee040`, exact full CI `38325184980` `SUCCESS`  
**Exact D2 full CI:** `38325890102` — `SUCCESS`  
**Independently inspected CI job:** `115064339732` — completed `success`, no failed steps

### Route Card and implementation

48h parent: scope #12 Data/Result validation/dedup/normalization. D1 was already `PASS_CODE_CI`; the observed gap was absence of the production deterministic transformer.

Invariant: valid Research SUCCESS input produces deterministic canonical Data output; duplicates are removed using full normalized record content and provenance; required-field values and source linkage remain valid; no LLM call occurs.

The sole Data writer added only:

- `src/data/data-transformer.mjs`;
- `tests/data/data-transformer.test.mjs`.

The transformer rejects non-finite/non-plain/non-JSON input, cycles, sparse/extra array properties, accessors and unsupported hidden properties before lossy cloning. It normalizes declared contract strings and URL representation while preserving data strings/keys/array order and URL query/fragment semantics. Source/item duplicates use the whole normalized record except id, including provenance; minimum-codepoint ids choose stable representatives. References are aliased/remapped/unique/sorted and source/item ordering is stable. False/zero, valid record extras, unused sources and differing provenance are retained. The implementation imports only the D1 contract and performs no database mutation or provider/tool call.

### Actual parallel agent handoffs and verification

- `data_investigator` and `data_skeptic` compared canonicalization, provenance and JSON-boundary semantics before the writer was assigned.
- `root` handed the agreed invariant and exact governance baseline to sole writer `data_implementer`.
- The writer returned the two-file implementation and focused D1+D2 evidence: `29` executed cases (`8` D1 + `21` D2), all passed.
- `root` reviewed source/tests and ran the full suite with `node --test --test-isolation=none --test-concurrency=1` over an explicit `34`-file list: `201` passed, `0` failed, `0` skipped; foundation/health checks passed. These are executed case totals, not file-wrapper counts.
- `data_skeptic` independently executed `140` assertions, including `100` seeded input permutations, and reported no invariant violation.
- `root` published implementation `9205d4b2d839b70927e174a09a2f85a7e6606357` using the exact expected parent HEAD. `data_readonly_review` independently read the published files and exact CI job/steps before receiving recorder GO.
- `verification_engineer` is assigned the next real PostgreSQL integration lane; its future D3 execution is not claimed as completed here.

Reviewed file fingerprints:

- transformer SHA256: `b94e1d56209593c64a4f0e6f85fc6079329836363974eb889bdf001416dbcf09`;
- tests SHA256: `0d73d5f8c894ef74137077125ccb44fb625a8defac107030c16cc9ebe42bfc68`.

**D2 result: `PASS_CODE_CI`.** D1 remains `PASS_CODE_CI`; D3 is `NOT_BUILT`; D4 and complete scope #12 remain `NOT_PROVEN`.

### Negative evidence and external limits

Exact D2 CI succeeded for checkout, machine identity, foundation, Node tests, health, migrations, SQL assertions, PostgreSQL Research E2E, pinned OpenClaw/DeepSeek/DuckDuckGo installation, credential-scope check and configuration validation. Five conditional steps were `SKIPPED`: hosted Neon persistence, live Kernel Research, its upload, live DeepSeek smoke and its upload. These are not hosted/live proof.

No new hosted mutation or paid call was made for D2. The last fresh hosted read-only inspection remains `2026-10-12T23:57:30.163Z` with clean counts; this checkpoint does not invent a newer hosted check. Existing Research `PASS_LIVE` retains its earlier evidence. Durable Evidence/phone/dispatch remain `NOT_BUILT`.

Root additionally verified that GitHub Actions secret public-key access returned HTTP `403`, `Resource not accessible by integration`, and branch-protection API access returned HTTP `403` despite network access. These configuration actions are `BLOCKED` by integration permissions; permanent machine credential plumbing remains `NOT_PROVEN`. No key/password/connection value is recorded or requested again. The infrastructure blocker does not invalidate D2 or divert the next Data code gate into browser login.

### Route decision

**Next functional gate: D3 Data Kernel runtime only.**

D3 Route Card: scope #8/#12; acceptance #4/#6/#7. Claim only the assigned Data agent/task. Read the successful Research parent from the same dependency/task under an active lease/fencing token and parent task deadline; obtain required fields from the authoritative immutable task request. Execute production Data, maintain heartbeat, stop on ownership loss, use fenced success/failure and preserve cleanup/finalization. No LLM call.

Verification: unit/negative adapter tests -> real ephemeral PostgreSQL E2E -> full exact GitHub CI. Managed ephemeral PostgreSQL is local integration evidence, not hosted Neon. Do not start D4 until D3 is accepted; Evidence/Phone/Dispatch feature work waits until complete Data #12 passes. No Research redesign, browser/Vision/PDF expansion, broad refactor or catalog activation.

---

## JRNL-2026-10-13-003 — D3 fenced Data Kernel runtime verified

**Branch:** `v2/openclaw-clean-20261011`  
**Verified implementation HEAD before this checkpoint:** `35900bc5ac499a7c3c0d787c71a40935b3dbf3fa`  
**Parent accepted D2 checkpoint:** `897ec28c38ac6fd66ecb0e732676a86a56997e72`, exact full CI `38326462023` `SUCCESS`  
**Exact D3 full CI:** `38391284569` — `SUCCESS`  
**Independently inspected CI job:** `115275425642` — completed `success`, no failed steps

### D3 Route Card and actual implementation

48h parents: scope #8/#12. Acceptance: #4 stale fencing, #6 dependency, #7 failure cascade. D2 was already `PASS_CODE_CI`; the observed gap was absence of the production Data Kernel worker and guarded dependency-input adapter.

The six-file change adds:

- `src/data/data-worker.mjs`;
- `src/data/postgres-data-adapter.mjs`;
- `tests/data/data-worker.test.mjs`;
- `tests/data/postgres-data-adapter.test.mjs`;
- `tests/integration/data-postgres-kernel-e2e.mjs`;
- one Data PostgreSQL E2E step in `.github/workflows/v2-ci.yml`.

No migration, new model/tool, Research redesign or secret-management change is included.

The worker claims only Data and supports exact task-scoped claims. It validates owner/task/UUID fence, renews before input and completion, stops mutations on heartbeat/ownership loss, transforms synchronously and validates output before fenced success. The adapter reads exactly one successful Research parent in the same dependency/task under a RUNNING Data node, correct agent/node/source binding, owner/token, unexpired lease and active task deadline. Required fields come from `tasks.request_payload`; malformed types remain visible to validation, while nullish fields retain the existing empty-requirements compatibility rule.

Validation/runtime failures use canonical fenced terminalization with sanitized error metadata. Rejected/uncertain failure persistence is surfaced. After accepted node completion the worker reports `nodeStatus` separately from authoritative finalized `taskStatus`: a deadline/cancellation race or finalizer error cannot downgrade an already successful node. Heartbeat timers stop before finalization. Data has no accounting/reservation API and makes no LLM call.

### Actual agent handoffs and recovery

The initial `data_implementer` and `data_skeptic` lanes encountered `AGENT_USAGE_LIMIT`. Root explicitly interrupted them and assumed sole D3 feature writer/final-review ownership. These were quota/infrastructure failures, not code-test failures. A brief execution-tool outage did not lose the six local files or overwrite the verified checkpoint.

`verification_engineer` performed no Docker operation. The initial filesystem Docker-socket permission request stalled/aborted; `root` used the authorized network-only Docker 28.4 path, created the isolated PostgreSQL 16 container, applied migrations/SQL and ran both PostgreSQL E2E checks. The verifier's final responsibility was read-only full unit/foundation/health/review. Docker availability itself was never called hosted proof. The recorder did not duplicate operations.

Real handoffs were: agreed investigator/skeptic contract -> initial writer -> root takeover/final source edits -> resumed independent specialist review and verifier read-only checks -> root Docker/SQL/PostgreSQL execution and publication/exact CI -> independent recorder inspection. `data_skeptic` separately resumed the final D3 review after the quota interruption and completed `81` independent assertions plus `50` focused Data cases with matching final source/test fingerprints. This was an actual completed specialist review, independent of root's feature/Docker/publication ownership. Existing D2 independent `140`-assertion/`100`-permutation proof remains intact; that in-memory harness is preserved in tool transcript only and is finite representative fuzz, not exhaustive proof.

### Verification evidence

- Full meaningful local Node suite: `222/222` passed, zero failures.
- Focused Data cases: `50/50` passed.
- Independent specialist assertions: `81` passed, as reported to root.
- Isolated PostgreSQL `16`: all `19` migrations applied, `16` SQL assertion files passed.
- Existing Research PostgreSQL E2E: exit `0`.
- Data PostgreSQL E2E: session `75514`, exit `0`.
- Exact full CI `38391284569`: all code steps succeeded, including new `Run PostgreSQL Data execution E2E` step `14`; independent job inspection found no failed steps.

The Data PostgreSQL harness checks dependency blocking, guarded task/owner/token reads, authoritative required fields, malformed payload/requirements, wrong or absent source dependency, real persisted transform/dedupe output, sanitized runtime/validation failure, stale/expired fencing and safe reclaim, deadline before execution and after node completion, upstream failure cascade, repeated invocation returning IDLE, and zero Data accounting/reservations/tokens/cost. It uses isolated `openclaw_v2_test` and fixture Research output; it is not a paid provider/web test.

**D3 result: `PASS_CODE_CI`.** D1/D2 remain `PASS_CODE_CI`. D4 and complete scope #12 remain `NOT_PROVEN`; overall Walking Skeleton remains `IN_PROGRESS`.

### Hosted observations and negative evidence

Fresh direct read-only Neon counts at `2026-10-13T11:36:55.060Z`:

- active tasks: `0`;
- RUNNING nodes: `0`;
- unresolved RESERVED reservations: `0`;
- artifacts total: `0`.

These are count observations, not a new hosted behavioral write test. Earlier deployed-guard/child-verification and Research live facts retain their own historical provenance. No hosted write or paid call was made for D3.

Five exact-CI conditional steps remained `SKIPPED`: hosted Neon persistence, live Kernel Research, its upload, live DeepSeek smoke and its upload. No skip is promoted to `PASS_HOSTED`/`PASS_LIVE`. Permanent CI credential plumbing remains `NOT_PROVEN`; recorded GitHub configuration API HTTP 403 permission blockers remain separate. Evidence, phone and real user/GitHub dispatch remain `NOT_BUILT`.

### Route decision

**Next functional gate: D4 production Data vertical only.**

Prove actual production Research structured output -> actual Data worker/transformer -> persisted validated normalized/deduped sourced result -> Data SUCCESS -> authoritative task terminalization. Existing deterministic live-gate completion is not production Data proof. Preserve the pinned Research runtime and previously verified live run; use existing structured results where appropriate, with fixture/local evidence labelled precisely. Focused/negative checks -> full exact GitHub CI; direct hosted/live proof when that layer executes.

Do not start Evidence/Phone/Dispatch before D4 acceptance closes complete scope #12. No browser/Vision/PDF/catalog scale-out, unrelated refactor or redundant paid Research experiment.

---

## JRNL-2026-10-13-004 — Complete production Data D4 vertical verified

**Branch:** `v2/openclaw-clean-20261011`  
**Verified implementation HEAD before this checkpoint:** `b0693ca2abc234348785ab83bf176fad625047a3`  
**Parent accepted D3 checkpoint:** `8b54e6f14a37485f1747ba6dab8653783fcdd319`, exact full CI `38392212344` `SUCCESS`  
**Exact D4 full CI:** `38394312147` — `SUCCESS`  
**Independently inspected CI job:** `115285527950` — completed `success`, zero failed steps; production Data PostgreSQL step `15` succeeded

### Route Card and completed production Data path

48h parent: scope #12 Data/Result validation/dedup/normalization. D1–D3 were already `PASS_CODE_CI`; D4's gap was gate-only Data completion in the Research acceptance path rather than the actual production worker and persisted result proof.

The live gate/script now invokes the real task-scoped Data worker. It verifies exact Research/Data/task/dependency identities, immutable request and JSON-transport-equivalent returned/stored Research. Returned and persisted Data must match schema v1 and the deterministic transform of the stored authoritative request/Research, without repairing array order or values. The canonical two-node/one-dependency task must terminate SUCCESS with two steps, reconciled cost/tokens and zero reservations. Required official-domain provenance must survive Data. The entire ordered accounting ledger is compared before/after Data, with one Research row and zero Data rows; Data reservation rows and counters remain zero.

Eight files changed: workflow; live Research script/gate; production Data PostgreSQL harness; existing Research PostgreSQL harness cleanup; three live-gate test files. No migration, runtime pin/model change, new provider or secret-storage change was included.

### Actual parallel handoffs and review findings

- `data_implementer` wrote the main D4 runtime/script/unit/workflow zones.
- After explicit handoff, `data_investigator` became sole writer of the PostgreSQL integration zone and refined the normalized Research fixture/persistence/accounting cases.
- `data_skeptic` supplied independent read-only `148` assertions, including `64` negative cases. Implementer/independent verification reports show full meaningful unit suite `228` and focused suite `70`, all passed.
- `root` owned Docker/PostgreSQL operations, final integration/review and publication; `verification_engineer` remained read-only and did not run Docker.
- The recorder read the published files/hashes and exact CI job before receiving governance GO; no recorder model/DB/Docker mutation occurred.

Review identified insufficient count-only accounting checks and returned/stored Research drift; full ordered accounting-ledger equality and JSON-transport Research comparison were added before publication. Root identified a new verification SQL reference error; the implementation lane corrected it to existing accounting `cost_usd` before the PostgreSQL run. Research integration fixture cleanup was corrected for sequential harness execution. These are D4 review/preparation findings, not invented earlier D3 defects or failed CI claims.

### Verification and local PostgreSQL evidence

Root ran the isolated PostgreSQL checks sequentially:

- Research E2E after fixture cleanup correction: exit `0`.
- D3 Data E2E session `24514`: exit `0`.
- D4 production vertical session `62196`: exit `0`.

The positive fixture uses production Research wiring with an injected synthetic runtime, actual Kernel/SQL and actual production Data worker/transformer. Normalized Research has `2` sources/`3` items; persisted Data has `2` sources/`2` items, preserving zero/false, nested array order and distinct provenance. One synthetic Research accounting row records `$0.01`/`20` tokens with its RECONCILED reservation; Data adds no model row/reservation/spend. These are synthetic fixture ledger values, not paid charges.

A partial required-field case leaves Research SUCCESS but terminalizes Data/task as FAIL_WITH_EVIDENCE, with no Data output and zero unresolved reservations. It is not filtered into a nominal success.

Exact full CI `38394312147` succeeded for all code steps, including new production Data PostgreSQL vertical. Five conditional hosted/live/upload steps were `SKIPPED`; those steps prove no new hosted/paid execution.

Reviewed SHA256 values:

- gate: `da4df3686231404aa81771a1b4f38a629005fa963631fc1a2dc031bc9a249b5f`;
- production PostgreSQL test: `d338201b92bdeeb770bdf4d2fd26c31c49c37f39ee55b34c7a495a57a084559b`;
- workflow: `2ae2f2f3e338c1afaaf5e49c49dda7b7a8dbd25b335b511274d6e9a612cc8fb4`.

**D4 and complete scope #12: `PASS_CODE_CI`. D1–D4 are complete at the code/CI layer.** This is not a new `PASS_HOSTED` or `PASS_LIVE`. Overall Walking Skeleton remains `IN_PROGRESS`.

### Read-only runtime preparation and retained limits

Root prepared private pinned OpenClaw `2026.9.8` with matching DeepSeek/DuckDuckGo plugins; configuration validation returned `valid:true`, no warnings, and DeepSeek auth scope had zero stored profiles. Root also used HTTPS Neon read-only transport to reach the expected database with clean `0/0/0` counts. These are installation/configuration/transport preflight facts. No credential value is recorded here, and the recorder inspected no secret file.

The last timestamped direct hosted observation retained in state is `2026-10-13T11:36:55.060Z`: active tasks/RUNNING nodes/unresolved reservations/artifacts all `0`. No hosted mutation, new paid Research/web call or new hosted production Data behavior was executed for D4. The older paid Research task/observed accounting remains separate historical live proof; its Data mode was gate-only.

Permanent external machine credential plumbing remains `NOT_PROVEN`; recorded secret/protection administration HTTP `403` actions remain `BLOCKED`. Evidence, Phone and actual user/GitHub dispatch remain `NOT_BUILT`. Private session credentials do not prove continuous hosted/live Actions execution.

### Route decision

**Next: Evidence E1 contract only.** Phase 7 begins; no Evidence PASS is declared.

Checkpoint publication resumed on `2026-10-14`. Fresh remote HEAD and exact run/job/step reads still matched `b0693ca2abc234348785ab83bf176fad625047a3` / CI `38394312147` SUCCESS. The four pending governance files survived the pause; no new feature implementation or live result was inferred from recovery.

Narrowed Evidence route: **E1 versioned terminal bundle contract -> E2 durable SQL persistence/retrieval -> E3 runtime receipt/lifecycle integration and retrieval from a new process after producer termination.** Persist task/immutable acceptance criteria/nodes/Research/production Data/sources/accounting/tool-model metadata/attempts/errors/terminal status, excluding credentials and private chain-of-thought.

Each micro-gate requires focused/negative checks and full exact CI; SQL/hosted changes require the applicable child/behavior/cleanliness protocol. Phone/Dispatch wait until durable Evidence is independently proved. Do not detour into browser/Vision/PDF, catalog activation, unrelated refactors or redundant paid Research experiments.


## JRNL-2026-10-14-005 — E1 versioned terminal Evidence contract verified

**Branch:** `v2/openclaw-clean-20261011`  
**Verified implementation HEAD before this checkpoint:** `b9b896f33b2a19a6b623045c1a7aae09d68e88a3`  
**Parent accepted D4 checkpoint:** `44675b282f61cb9adf9e1594b96d724063b09cff`, exact full CI `38498887712` SUCCESS, job `115640857524`  
**Exact E1 full CI:** `38501303395` — SUCCESS  
**Root-inspected CI job:** `115648653045` — all code steps successful; five hosted/live/upload conditional steps SKIPPED

### Route Card and implemented contract

48h parent: scope #14 durable Evidence. Complete production Data D1–D4 was already PASS_CODE_CI. E1 defines only the immutable schema-v1 terminal Evidence contract, safe public projection, canonical UTF8 serialization and SHA256, in `src/evidence/evidence-contract.mjs` and `tests/evidence/evidence-contract.test.mjs`. No SQL, runner lifecycle, migration or Kernel edit belongs to this gate.

The contract links task/immutable acceptance criteria/nodes/dependencies/Research/production Data/sources/accounting/reservations/tool-model metadata/attempts/safe errors and terminal status. It checks terminal closure, exact accounting totals, reciprocal ledger provenance, canonical Data and preserved source linkage. It removes credentials/private reasoning/raw process-envelope material using explicit projection and safe errors. This is validation and serialization proof, not durable storage or a runner-survival proof.

### Actual parallel handoffs and corrected defects

`evidence_investigator` supplied design and read-only E2 scouting; `evidence_writer` was sole writer of the two E1 files. `evidence_skeptic` independently challenged negative cases; `evidence_verifier` ran actual focused/full unit checks. Root integrated/reviewed, published with expected HEAD and inspected exact CI; `evidence_recorder` received governance-only GO after acceptance.

Initial focused35/full263 passes were limited pre-fix coverage and did not establish E1 acceptance. Independent review reproduced forged retained Data facts/title/source URL/item identity hidden behind an authentic redaction flag; impossible calendar/source timestamps; successful node/accounting attempt0 or absent startedAt; and inconsistent task steps versus summed node attempts. The writer corrected these before publication. Final negative cases reject those forgeries, preserve validation of retained facts/provenance after redaction, validate real calendar instants/nanosecond chronology and enforce executed attempts/step reconciliation. No closed Kernel/Research regression was invented or repaired.

### Accepted evidence and fingerprints

- Final focused unit cases: `39/39` passed.
- Final full actual unit cases: `267/267` passed.
- Independent assertions: `168` passed, including `100` seeded permutations (seed `17`).
- Contract SHA256: `b95fe8c1acf6da956f9666a3ce0e8da784bd7b3d88c92fa7acda1dd7ad731ac3`.
- Tests SHA256: `a1acd25e80b92c3bcad1db40c496083bb99ba91fd9bdef51505e22814262cc6a`.
- Exact full CI `38501303395` succeeded at implementation HEAD above; five external conditional steps remained SKIPPED.

**E1 contract: PASS_CODE_CI. Complete scope #14 durable Evidence: NOT_BUILT.** E2 persistence and E3 runtime receipt/process survival are still unbuilt. Overall Walking Skeleton remains IN_PROGRESS.

### Hosted observation, recovery and retained limits

Root's direct hosted read-only session `43993` observed `2026-10-14T02:37:10.789386Z`, database `openclaw_v2`: active tasks0/RUNNING nodes0/RESERVED reservations0/artifacts0. E2 functions `read_task_evidence_snapshot_v1(uuid)` and `persist_task_evidence_v1(uuid,text,text)` were absent. This proves only clean counts and absence at that timestamp; no hosted write or paid model call was made for E1.

Recorder remote-read tools stalled and were externally aborted after `1707.5s` and `557.7s`; no exec session IDs or writes resulted. Root re-read unchanged implementation HEAD and exact successful CI before authorizing these local governance edits. The recorder read local published source/fingerprints and root evidence, not secrets; this entry does not claim an independent recorder network/DB inspection.

Permanent external machine secret plumbing remains NOT_PROVEN; recorded administration HTTP403 actions remain BLOCKED. Five SKIPPED hosted/live/upload steps prove no new hosted/live behavior. Existing Research PASS_LIVE remains historical and separate. Phone and actual user/GitHub dispatch remain NOT_BUILT.

Privacy validation uses known projections, recognizable credential patterns and caller-supplied sensitive values; it cannot guarantee detection of undisclosed opaque secrets inside arbitrary prose. Redaction can collapse distinct records, so full dedupe equivalence after redaction is not claimed; retained facts/provenance are still checked and the public integrity flags preserve this limit.

### Route decision

**Next: E2 durable SQL persistence/retrieval only**, using the existing PostgreSQL/artifacts surface with immutable task/acceptance linkage, validated canonical payload and repeat-safe storage. Real local PostgreSQL positive/negative/idempotency/retrieval checks -> full exact CI; any hosted schema application follows child verification, hosted behavior and cleanliness protocol.

Then E3 integrates runtime receipt/lifecycle and retrieves from a new process after producer termination. Complete Evidence requires persistence and survival proof; Phone/Dispatch wait. Preserve pinned Research runtime and accepted Data proofs; no browser/catalog/refactor detours or redundant paid Research run.
