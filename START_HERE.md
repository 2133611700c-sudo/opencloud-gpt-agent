# OpenClaw V2 — START HERE / Execution Router

This file is the operational router for every new chat, agent, reviewer, repair session, or continuation of OpenClaw V2.

It exists to prevent drift, duplicated work, speculative hardening, stale-state decisions, and accidental movement away from the 48-hour Walking Skeleton.

## 1. Boot order — mandatory before any write

Open this file only to obtain the route. The **first substantive source to read is the 48-hour plan**.

1. Read `docs/02_48H_WALKING_SKELETON.md` completely.
2. Read `PROJECT_STATE.json` for the current machine-readable checkpoint.
3. Read the latest entry in `docs/RESULTS_JOURNAL.md` for independent positive/negative evidence and the current route decision.
4. Read current branch HEAD and the exact latest CI job/step results. Never assume `PROJECT_STATE.json` is fresh merely because it exists.
5. If HEAD is ahead of `PROJECT_STATE.verified_head`, review the entire delta and its CI before making any write.
6. If the next gate depends on hosted PostgreSQL, perform a read-only hosted drift/cleanliness check before writing.
7. Read `SYSTEM.md` for architectural invariants and `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md` for the full 14-phase architecture only after the current 48-hour target is understood.
8. Use `docs/EXECUTION_LOG.md` and Git history for detailed historical reconstruction when needed.

This boot order supersedes the older `docs/EXECUTION_LOG.md` continuation sentence that told future agents to read `SYSTEM.md` first. The engineering rules in that log remain valid; only the operational reading order changes.

## 2. Authority and conflict rules

For the current delivery window:

- `docs/02_48H_WALKING_SKELETON.md` defines the mandatory delivery target and acceptance gates.
- `SYSTEM.md` defines architectural and safety invariants.
- `PROJECT_STATE.json` defines the current intended checkpoint and route.
- `docs/RESULTS_JOURNAL.md` is the independent append-only checkpoint record of what actually passed, failed, drifted, or remained unproven.
- Current Git HEAD + exact CI results + direct hosted/live checks are factual evidence and override stale governance metadata.
- `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md` defines the full future architecture but must not pull current work outside the 48-hour scope.

If these disagree, **do not continue implementation**. Reconcile the contradiction first and record it.

## 3. Route-selection algorithm

Before every implementation commit, map the proposed work to one or more of the 15 mandatory 48-hour scope items and, where applicable, one of the 9 mandatory acceptance tests.

Choose the next work item using this order:

1. The earliest unproven dependency that blocks the real positive E2E.
2. A reproduced defect that violates an invariant on that exact path.
3. Hosted/runtime drift that would make the next real gate invalid.
4. A fail-closed security/ownership/accounting defect that can corrupt the current gate.

Do **not** choose work merely because it is interesting, cleaner, more general, or future-useful.

Until the current real Research vertical passes, the following are out of route unless they are the direct cause of a failing current gate:

- production Data/Result feature build;
- durable evidence-layer feature build;
- phone UX feature build;
- browser automation;
- Vision/OCR/PDF work;
- full 71-agent or 311-skill scale-out;
- broad refactors;
- speculative security hardening with no reproduced defect on the current path.

A useful test is: **Would this change alter the result of the next mandatory acceptance gate or prevent it from running safely?** If the answer is no, backlog it.

## 4. Multi-lane operating model

Use multiple independent lanes, but only one writer for the same code zone.

### Lane A — Investigator / reviewer — read-only
Find a concrete defect or unproven invariant. Reproduce it. Compare behavior to the pinned runtime/provider/database contract.

### Lane B — Independent specialist — read-only
Try to falsify Lane A. Use DB/concurrency/security/provider expertise to identify side effects or a better explanation.

### Lane C — Implementation — single writer
Make the smallest coherent change after the defect and target invariant are clear.

### Lane D — Verification — independent evidence
Run full CI, SQL/kernel checks, hosted checks, and live gates as applicable. This lane decides whether the exact layer is GREEN or RED.

### Lane E — Recorder / navigator
At route changes and meaningful gate checkpoints, update `docs/RESULTS_JOURNAL.md` and `PROJECT_STATE.json` with both positive and negative evidence.

Read-only lanes may run in parallel. Two writers must not modify the same area concurrently.

## 5. Pre-write Route Card

Before changing code/schema/config, the implementation lane must be able to state:

- **48h parent item(s):** which numbered scope item(s) this serves;
- **acceptance gate:** which mandatory acceptance result it advances;
- **observed defect/gap:** concrete evidence, not speculation;
- **invariant to restore/prove:** exact desired behavior;
- **smallest file/schema surface:** what will change;
- **verification ladder:** unit → SQL/kernel → local PG E2E → pinned runtime → hosted → live, as applicable;
- **rollback/safety:** how to avoid poisoning hosted state or overwriting another writer.

If this card cannot be written clearly, implementation is not ready.

## 6. Write discipline

1. Re-read branch HEAD immediately before writing.
2. Use expected-SHA / force-with-lease semantics when moving refs.
3. One confirmed defect or one tightly coupled invariant repair per commit.
4. Full CI after every implementation commit.
5. No second implementation write until the previous commit is fully GREEN.
6. A RED commit is evidence. Diagnose it; never bypass it.
7. `SKIPPED` is not GREEN for the skipped layer.
8. A local/mock/injected PASS never substitutes for hosted or paid-provider execution.
9. Hosted schema changes are tested on a child verification branch first when provider capabilities allow it, then applied to the working branch, then re-checked for behavior and cleanliness.
10. Governance may be updated only from verified evidence; never pre-announce a PASS.

## 7. Evidence labels — use exactly

- `PASS_CODE_CI` — the exact code/contract/local CI layer executed successfully.
- `PASS_HOSTED` — the exact hosted database/runtime behavior was directly verified.
- `PASS_LIVE` — the real paid/provider/tool path executed successfully.
- `SKIPPED` — the conditional step did not execute; it proves nothing about that external layer.
- `NOT_PROVEN` — required behavior has not been directly evidenced.
- `DRIFT` — repository contract and deployed/hosted state differ.
- `NOT_BUILT` — required capability does not exist yet.
- `BLOCKED` — a named prerequisite prevents execution.

Never replace these distinctions with a generic “GREEN”.

## 8. Journal policy

`docs/RESULTS_JOURNAL.md` is independent of the detailed execution log and Git history.

It is append-only. Do not rewrite old entries to make history look cleaner. If an old statement becomes wrong, append a `CORRECTION` entry.

A journal checkpoint is mandatory when any of these occurs:

- a mandatory 48h gate changes status;
- hosted/live evidence changes;
- the execution route changes;
- a material drift is discovered or repaired;
- the project is about to switch chats/agents/sessions;
- several micro-commits have accumulated and a new engineer would otherwise need to reconstruct them manually.

Each checkpoint must contain:

- baseline branch/SHA/CI;
- 48h map status;
- positive evidence;
- negative evidence / skipped / not proven;
- important innovations since the prior checkpoint;
- hosted-state cleanliness/drift if relevant;
- next allowed step;
- explicit forbidden detours until that step is complete.

## 9. Recovery test for any new chat

After following this router, a new chat must be able to answer seven questions before writing:

1. What is the exact 48-hour goal?
2. What is the latest verified code baseline and CI run?
3. Which of the 15 mandatory scope items are proven, drifted, unproven, or not built?
4. Which of the 9 acceptance tests is the next blocker?
5. What is the current hosted/runtime state?
6. What is the single next allowed implementation step?
7. What work is explicitly forbidden until that gate passes?

If any answer is unclear, stop implementation and reconcile the map.

## 10. Current continuation pointer

Do not hardcode the current implementation task in this router. Read `PROJECT_STATE.json` and the latest `docs/RESULTS_JOURNAL.md` checkpoint. Those files carry the moving route; this file carries the stable navigation rules.
