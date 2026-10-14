# OpenClaw V2 — Remaining 48h Execution Gates

This is the execution route for the remaining Walking Skeleton, subordinate to `START_HERE.md`, the complete `docs/02_48H_WALKING_SKELETON.md` and `SYSTEM.md`. It does not redefine the 15 scope items, nine mandatory acceptance tests or 14-phase master program.

## Verified entry baseline

- Branch: `v2/openclaw-clean-20261011`; legacy `main` remains frozen.
- Reviewed HEAD: `8c3ec70172d8c136b29a5dda853190af447e3908`, archive commit.
- Exact full CI: `38323842573`, `SUCCESS`.
- Latest implementation baseline: `fbbf05d7d7a016805353924b06732d0bacf39b81`, D1 Data contract; exact full CI `38302547362`, `SUCCESS`.
- Research and its accounting retain the previously proven `PASS_LIVE`; this route does not claim a new paid run.
- Fresh read-only hosted inspection by `hosted_inspector` at `2026-10-12T23:57:30.163Z`: zero active tasks, RUNNING nodes, unresolved reservations and artifacts; deployed active-lease guards inspected. This is not a new hosted behavioral write test.
- Latest archive CI hosted/live conditional steps were `SKIPPED`; external steps must execute before their layer is promoted.
- Complete production Data is now `PASS_CODE_CI` (D1–D4 accepted below); durable Evidence, phone result and actual user/GitHub dispatch remain unfinished.

Accepted Data checkpoint: D1–D4 and complete scope #12 are `PASS_CODE_CI` at `b0693ca2abc234348785ab83bf176fad625047a3`, exact full CI `38394312147` SUCCESS. Existing entry-baseline bullets above retain their historical provenance; no fresh hosted/paid Data PASS is implied.

Current functional route: **E1 -> E2 -> E3 -> P1 -> I1 -> I2 -> B1 -> G1 -> G2**. Authorized credential preparation may proceed independently, but does not advance a functional gate or prove G1.

## Shared operating rules

1. Before every write, re-read current remote HEAD; review any unknown delta and use expected-SHA semantics.
2. Define the Route Card: parent 48h item/acceptance, observed gap, invariant, smallest surface, verification and cleanup/rollback.
3. Implement one coherent gate or invariant per commit. Run full exact GitHub CI after every implementation commit. If it fails, diagnose and repair before the next feature.
4. Use only canonical truth labels. Passing tests establish `PASS_CODE_CI`; they do not establish `PASS_HOSTED` or `PASS_LIVE`. `SKIPPED` remains non-proof.
5. Hosted schema changes require child verification when possible, behavioral tests, hosted application and cleanliness checks. Never perform destructive Neon operations without explicit authorization.
6. Keep Research/runtime/model pins unless a reproduced regression proves a necessary change. Data has no LLM calls.
7. A gate handoff is an actual task/message to a named receiving agent, carrying exact SHA, findings, tests/run IDs and limitations. A planned role or catalog entry is not an executed agent.
8. Recorder entries distinguish observations, pending work and accepted evidence. Never announce a gate PASS before its verification completes.
9. Continue to the next obvious authorized gate after proof; no automatic conversational confirmation is required between gates.

## Agent lanes and real handoffs

| Lane | Responsibility | Required handoff |
|---|---|---|
| A — investigator/reviewer | Read-only inspect the exact gap and propose concrete cases. | Send reproducer/input, violated invariant, smallest surface and known limits to B/C/root. |
| B — independent specialist | Read-only challenge semantics, concurrency, source integrity and secret boundaries. | Send agreement or counterexample with evidence to A/C/root. |
| C — implementation | Sole feature writer for the assigned code zone. | Send actual diff, exact implementation SHA and focused validation to D/root. |
| D — independent verifier | Re-run appropriate tests; inspect exact CI jobs/steps and hosted/live layer when required. | Send verdict using canonical labels, failed/skipped steps, run/task IDs and cleanliness facts to root/E. |
| E — recorder/navigator | Sole writer of shared state/journal and execution route. | Collect actual lane reports, append observations/checkpoints, and publish next-route handoff after accepted evidence. |
| Root — integration owner | Assign actual agent tasks, resolve disagreements, manage commits/ref updates and prevent overlapping writers. | Confirm receiving lane, exact baseline and gate entry before the next feature writer starts. |

Actual lanes assigned for this continuation: `root` coordinator/publisher; `data_investigator`; `data_skeptic`; `verification_engineer`; `hosted_inspector`; `data_readonly_review` recorder. `data_implementer` is the intended sole Data writer once assigned at D2; a planned assignment does not prove execution. Seven concurrency slots are capacity, not seven always-running processes or a claim of different specialist model identities.

Read-only lanes operate in parallel. Separate file zones may be assigned explicitly; no two writers edit the same shared file. Lane E records reports throughout execution, preserving SHA and pending/negative findings. Checkpoint state advances only after exact verification. If an operation is still running, retain its ID and inspect it after timeout instead of starting a duplicate.

## D2 — Deterministic normalization and dedupe

Parent: scope #12. Entry: D1 `PASS_CODE_CI`, reviewed HEAD/CI, agreed canonical representation and duplicate identity.

Smallest surface: one new transformer in `src/data/*` and one new test file in `tests/data/*`; D1 remains the validated boundary. Investigator/skeptic agreement: accept only finite plain JSON values; normalize only declared contract strings; preserve data strings, keys, array order and source URL queries/fragments. Duplicate identity uses each full normalized source/item record except its id, including provenance; do not merge merely similar records or conflicting facts. Select the minimum codepoint id as stable representative; alias/remap item references, remove duplicate references and sort them; sort sources/items by id. Retain valid `false`/`0`, required fields, source linkage and meaningful value types. No LLM, guessed missing facts or external calls.

Verify canonical equivalence, repeat determinism, non-mutation, duplicate removal, source integrity and negative cases; focused tests -> full Node tests -> full exact CI.

Exit: `PASS_CODE_CI` for D2 only. Complete #12 remains `NOT_PROVEN`. Handoff canonical rules and test evidence to D3.

## D3 — Data Kernel runtime

Parents: scope #8/#12, acceptance #4/#6/#7. Entry: D2 `PASS_CODE_CI`.

Claim only `agent_id=data`; readiness requires Research SUCCESS. Read the actual parent Research output and required fields; execute production Data. Use active lease/fencing for completion and terminal failure. Validation/runtime failure must not leave abandoned RUNNING work. No paid reservations or LLM calls are needed for deterministic Data.

Verify local PostgreSQL E2E: blocked dependency, scoped claim, successful transform/completion, validation failure and stale lease/token zero mutation; full exact CI.

Exit: `PASS_CODE_CI` for production Data runtime integration. Handoff tested Kernel calls, lifecycle/cleanup and verification to D4.

## D4 — Production Data vertical

Parent: scope #12. Entry: D3 `PASS_CODE_CI`.

Prove Research structured output -> real deterministic Data transformer -> normalized/deduped/validated sourced result -> Data SUCCESS -> task SUCCESS. Replace gate-only completion in the production proof path. Reuse verified structured fixtures or stored Research results where appropriate; a fixture remains code evidence.

Verify positive and negative PostgreSQL vertical plus full exact CI. Perform direct hosted checks when execution uses Neon. Label each layer independently.

Exit: complete #12 `PASS_CODE_CI`; any additional hosted/live promotion requires its own executed evidence. Evidence feature work may now start.

## E1 — Versioned Evidence contract

Parent: scope #14. Entry: complete Data #12 `PASS_CODE_CI`.

Define the immutable/versioned input-output contract for task, acceptance criteria, nodes, Research/production Data results, sources, accounting, tool/model metadata, attempts, safe trace/errors and terminal status. Exclude secrets and private chain-of-thought. This gate has no database/runner lifecycle implementation.

Verify required fields/linkage, terminal status, accounting/provenance and positive/negative secret-safe cases; focused tests -> full exact CI.

Exit: `PASS_CODE_CI` for E1 contract only. Durable Evidence remains unbuilt until E2/E3 proof; hand off the contract to SQL persistence.

## E2 — Durable SQL persistence and retrieval

Parent: scope #14. Entry: E1 contract `PASS_CODE_CI`.

Persist/retrieve the validated bundle through the smallest existing PostgreSQL/artifacts surface, preserving task identity, immutable acceptance data and repeat-safe storage. Define ownership/atomicity and durable receipt linkage; no new S3/platform dependency is needed.

Verify actual SQL/adapter behavior, idempotency, retrieval, linkage and failure paths; real local PostgreSQL integration -> full exact CI. Apply any migration through child verification/hosted behavior/cleanliness protocol when applicable.

Exit: `PASS_CODE_CI` for SQL persistence/retrieval; `PASS_HOSTED` only for actual hosted execution. Runtime integration and survival remain E3.

## E3 — Runtime receipt/lifecycle and producer-process survival

Parent: scope #14. Entry: E2 storage/retrieval proved at the required layer.

Integrate durable Evidence receipt with the terminal runtime lifecycle. Persist from one process, terminate the producer, and retrieve/validate from a new process using durable identity/storage alone. Verify canonical task/Data/accounting/source linkage and no producer-local filesystem dependency.

Verify successful and failed terminal paths, persistence failure handling, receipt linkage, independent new-process retrieval and cleanup; real PostgreSQL integration -> full exact CI; direct hosted persistence/retrieval when that layer executes.

Exit: durable Evidence proof at its explicitly evidenced layer; complete #14 requires survival/retrieval, not a schema, local artifact or row counter alone. Only then start P1.

## P1 — Phone result and deep log

Parent: scope #15. Entry: E3 durable receipt/lifecycle and process-survival retrieval proved at the required layer.

Success: `[SUCCESS]`, 1–5 result lines, cost, attempts and reachable deep-log/evidence link. Failure: `[FAIL_WITH_EVIDENCE]`, reason, progress, evidence supporting zero further calls and deep-log link. Do not dump trace or implementation details into the phone result.

Verify production Data-backed success/failure formatting, limits, terminal status/accounting accuracy and actual evidence-link retrieval; full exact CI. Inspect output through the target GitHub/mobile-readable surface.

Exit: `PASS_CODE_CI` for formatting; actual delivery/link usability must be evidenced separately.

## I1 — Real user/GitHub intake

Parents: scope #3, acceptance #2. Entry: Data/Evidence/phone components verified.

Define the real supported GitHub intake payload, acceptance criteria and stable request/idempotency key. Atomically create or return exactly one durable task. Reject invalid requests before execution; duplicates must not reserve or spend twice.

Verify native GitHub event/request intake into Kernel, duplicate/concurrent delivery and no duplicate task/spend; full exact CI.

Exit: `PASS_CODE_CI` for intake; real externally received request must be evidenced for the deployed layer.

## I2 — Dispatch and terminal return

Parents: original 48h user goal, acceptance #1/#2 and scope #15. Entry: I1 verified.

A real user/GitHub request starts the proven Research -> production Data -> accounting -> Evidence -> phone-result vertical. Return the terminal result/deep-log on the actual GitHub surface. Retries/cancellations and duplicate delivery cannot duplicate spend or leave leases/reservations unresolved.

Verify code integration, full exact CI and the actual external intake/result path. Retain request, run, task and evidence IDs. Use the pinned runtime and bounded budget; do not silently skip external dependencies.

Exit: `PASS_LIVE` only for the executed real provider/tool vertical with hosted terminal/evidence/result correlation.

## B1 — Combined 48h battle suite

Entry: Data/Evidence/phone/intake/dispatch individually verified.

Execute and retain proof for all nine mandatory acceptance tests: real positive E2E; duplicate dispatch; crash/reclaim; stale fencing zero mutation; budget terminal zero further calls; dependency; failure cascade; deadline; accounting/reservation release.

Also verify Evidence survival, phone output/deep-log retrieval and real dispatch as one complete vertical. Use deterministic/hosted controlled cases for negative tests where sufficient; do not pay for unnecessary repeated provider calls.

Verify full exact CI, direct hosted facts and the real positive provider/web-tool execution. Check no active test tasks, RUNNING nodes or unresolved reservations after cleanup. Publish a matrix with exact evidence and skipped/unproven limits.

Exit: battle-suite evidence accepted per layer. Overall Walking Skeleton remains unfinished until required infrastructure/governance gaps are closed.

## G1 — Permanent machine credentials and continuous external verification

Entry: explicit authorization to configure credentials; verified storage/write capability. Can be prepared independently of feature gates.

Configure `DEEPSEEK_API_KEY` and `DATABASE_URL` in a persistent machine secret store consumed by the actual CI/runtime. Never put values in Git, logs, argv, artifacts or chat handoffs. File presence or a local session fallback alone does not prove continuous CI. API runtime needs no browser provider login.

Verify configured metadata without disclosing values, then execute the exact hosted/live CI steps in a fresh machine context and inspect terminal/accounting/evidence. If access is rejected, record the action/status/reason and the smallest missing capability.

Exit: permanent plumbing proved and formerly skipped hosted/live steps actually executed; retain separate `PASS_HOSTED`/`PASS_LIVE` evidence. Do not mark skipped actions PASS.

## G2 — Least privilege, required checks and final checkpoint

Entry: B1 and G1 verified at all required layers.

Reduce workflow permissions to the minimum required by proved operations. Enable V2 branch protection/required CI gate where supported; preserve legacy freeze. Verify permissions still support the actual intake/result flow and that the required check prevents unverified writes.

Run full exact CI after each implementation/configuration change. Verify required status checks/protection and publish final state/journal with all 15 scope items, nine acceptance tests and additional end-to-end proof. Preserve rollback references.

Exit: final 48h PASS only after the entire real durable vertical and required governance are evidenced. This does not complete master phases 9–14 or certify all 71 agents/311 skills.
