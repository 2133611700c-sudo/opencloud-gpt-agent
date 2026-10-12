# OpenClaw V2 — ChatGPT Project Archive

Archived: 2026-10-12
Repository: `2133611700c-sudo/opencloud-gpt-agent`
Working branch: `v2/openclaw-clean-20261011`

## Purpose and provenance

This file preserves the retrievable OpenClaw V2 project material that existed in prior ChatGPT project/conversation context and reconciles it against the current GitHub repository state at archive time.

Sources used:

- retrievable prior ChatGPT conversation/project context from 2026-10-11 through 2026-10-12;
- current repository files on the working branch, especially `START_HERE.md`, `docs/02_48H_WALKING_SKELETON.md`, `PROJECT_STATE.json`, `docs/RESULTS_JOURNAL.md`, `SYSTEM.md`, and `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`;
- current Git history and GitHub Actions status;
- previously preserved hosted/live verification facts already correlated in the project journal/state.

The internal ChatGPT project folder itself is not exposed as a raw browsable filesystem here, so raw full chat transcripts and any materials that were never surfaced into retrievable conversation context are not available for byte-for-byte export. This archive therefore records all project material available through retrievable context plus current GitHub sources. Historical statements are marked as historical when they have been superseded.

Secrets are intentionally excluded. This file contains no API keys, database connection strings, passwords, tokens, or private model reasoning.

## Current authoritative snapshot at archive time

Before this archive write, the working branch HEAD was:

`fbbf05d7d7a016805353924b06732d0bacf39b81` — `feat(v2): define production Data contract`

GitHub Actions run `38302547362` completed `SUCCESS` on that exact SHA.

Important CI nuance: the main code/tests/migrations/OpenClaw/plugin/config path passed, but the conditional hosted/live Actions steps were `SKIPPED` because repository Actions secrets were not available there. A skipped external gate is not promoted to PASS.

The current `PROJECT_STATE.json` predates `fbbf05d7...`; this archive does not modify `PROJECT_STATE.json` or reinterpret that file as fresher than Git HEAD/CI.

## Original mission and requirements

Historical project requirement, 2026-10-11:

OpenClaw V2 must be a real autonomous execution system, not a chatbot demo or metadata-only router. The intended vertical is:

`User / iPhone -> ChatGPT / GitHub -> OpenClaw V2 -> hosted PostgreSQL Kernel -> Planner/DAG -> agents/skills/tools/models -> evidence -> concise phone result`

The project was intentionally rebuilt in a clean V2 branch. Legacy `main` remains frozen as rollback material and must not be deleted or rewritten before successful production cutover and rollback verification.

Core user requirements repeatedly preserved across chats:

- build in small verified gates;
- no fake PASS, no marketing status, no promotion of mock/local/SKIPPED evidence;
- current Git HEAD, exact CI, hosted DB reality, and live provider evidence outrank stale summaries;
- one mutating writer per code zone; parallel lanes may review independently but must not race writes;
- no new implementation while CI is red;
- one defect/invariant per implementation commit where practical;
- preserve enough state so a new chat can recover without restarting the project;
- do not place credentials in code, logs, evidence, handoff material, or project archives.

## 48-hour Walking Skeleton — canonical target

Canonical source: `docs/02_48H_WALKING_SKELETON.md`.

Goal: deliver one real durable vertical slice that accepts a research goal, persists it, executes a real isolated Research Agent through DeepSeek/OpenClaw with live web search/fetch, enforces hard limits, survives worker failure, persists evidence, and returns a concise phone result.

Mandatory 15-item scope:

1. Hosted PostgreSQL and migrations.
2. Durable state machine.
3. Idempotent request intake.
4. Atomic lease + unique fencing token.
5. Heartbeat and stale-worker recovery.
6. Circuit breakers: attempts, total steps, token/cost budget, deadline.
7. Atomic budget reservation and reconciliation.
8. Lite DAG `Research -> Data/Result`.
9. Real DeepSeek/OpenClaw call.
10. Real native web search/fetch.
11. Structured Research output with sources.
12. Data/Result validation, dedupe, normalization.
13. LLM accounting including cache hit/miss when exposed, completion tokens, latency, pricing metadata, and cost.
14. Durable evidence artifacts.
15. Phone short result + deep-log link.

Canonical mandatory acceptance tests currently total nine:

1. Positive real Research E2E -> SUCCESS.
2. Duplicate dispatch -> one task only.
3. Worker crash -> another worker safely continues.
4. Stale worker -> old fencing token cannot mutate state.
5. Budget limit -> terminal stop with zero further model calls.
6. Dependency -> Data cannot run before Research SUCCESS.
7. Failure cascade -> descendant BLOCKED and task terminates.
8. Deadline -> unfinished work terminates correctly.
9. Accounting -> reservation -> actual charge -> unused reserve release invariant.

Some historical handoff text referred to ten acceptance tests. That is historical wording; the current canonical repository plan contains nine and controls.

Explicitly outside the mandatory 48h scope until the walking skeleton is complete:

- full browser automation;
- Vision/OCR/PDF intelligence;
- code sandbox as a new product layer;
- Swarm/full parallel orchestration;
- Repair Agent;
- independent Judge;
- activating all 71 ECC agents;
- activating all 311 ECC skills;
- Redis/Kubernetes/S3/IAM platform expansion.

## Canonical architecture decisions

Canonical architecture source: `SYSTEM.md` plus `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`.

Durable architecture principles:

- PostgreSQL is the source of truth for task lifecycle, node state, dependencies, accounting, artifacts, and registry data.
- Kernel owns lifecycle, permissions, retries, leases/fencing, budget/cost/time limits, cancellation, and state transitions.
- LLMs may decide what to do; the Kernel decides whether execution is allowed.
- OpenClaw native runtime should provide tools, isolated agent sessions, browser primitives later, and native subagent/Swarm capabilities later where justified.
- Internet/file content is untrusted input and cannot grant itself tools, permissions, secrets, or policy changes.
- High-impact side effects require explicit policy gates and, where required, operator approval.
- Login, 2FA, passkeys, and CAPTCHA are manual/security boundaries and must not be bypassed.
- Evidence must be durable; runner-local files alone are not proof.
- `main` remains frozen until V2 production cutover and rollback proof.

## Canonical 14-phase build plan

The broader architecture is a 14-phase sequence:

1. V2 Foundation.
2. Persistent State + Durable Kernel.
3. Lease, Fencing, Circuit Breakers.
4. Lite Orchestrator.
5. DeepSeek + Model Accounting.
6. First Real Research Agent + Web Skill.
7. Artifact + Evidence Layer.
8. Phone UX.
9. Perception Layer.
10. Browser Runtime.
11. Agent Runtime + Skill Runtime + Sandbox.
12. Full DAG / Parallelism / Repair / Judge.
13. Capability Scale-Out.
14. Production Cutover + Legacy Deletion.

Every phase follows: build -> deterministic tests -> live test where relevant -> evidence -> PASS -> next phase.

## Runtime/model decisions

Current pinned Research runtime decisions preserved from the project:

- OpenClaw: `2026.9.8`.
- DeepSeek route: `deepseek/deepseek-flash`.
- Release served: `DeepSeek-V4.1-Flash`.
- Thinking level: `max`.
- Research tool allowlist: `web_search`, `web_fetch` only for the current gate.
- Model fallbacks disabled for the Research primary route.
- Research runs in isolated state/config scope.
- Direct/fail-closed runtime and structured JSON contract are required.

The ECC catalog is treated as a capability universe: 71 agent-role templates and 311 skills may be available later, but catalog presence does not mean production readiness and they are not all launched simultaneously.

## Operating/governance contract

### Mandatory boot order

Before implementation writes:

1. `START_HERE.md`.
2. full `docs/02_48H_WALKING_SKELETON.md`.
3. `PROJECT_STATE.json`.
4. latest `docs/RESULTS_JOURNAL.md`.
5. current branch HEAD and exact CI.
6. direct hosted Neon check when the next gate depends on hosted state.
7. `SYSTEM.md` and `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md`.
8. `docs/EXECUTION_LOG.md` only for detailed historical reconstruction.

### Truth labels

Use only these evidence classes:

- `PASS_CODE_CI`
- `PASS_HOSTED`
- `PASS_LIVE`
- `SKIPPED`
- `NOT_PROVEN`
- `DRIFT`
- `NOT_BUILT`
- `BLOCKED`

A skipped, mock, local-only, schema-only, or stale result must never be presented as a stronger layer.

### Reviewer/write lanes

- Lane A — Investigator / Reviewer — read-only.
- Lane B — Independent specialist / skeptic — read-only.
- Lane C — Implementation — sole writer in the affected code/schema zone.
- Lane D — Independent verification — tests/CI/hosted/live evidence.
- Lane E — Recorder / Navigator — governance updates only after proof.

### Anti-hang / recovery rules

- Git commit + successful CI + journal/state checkpoint are durable project checkpoints.
- Sandbox-local state is temporary and never the source of truth.
- Long operations must retain a session/run/command ID where available.
- After timeout or omitted output, inspect the existing run before retrying; do not duplicate long-running work blindly.
- Re-read branch HEAD before every repository write.
- Use expected-SHA / force-with-lease semantics for ref movement.
- After unexpected write/tool behavior, re-read HEAD before continuing.
- Never probe an unknown connector schema with a write call.
- Do not restart already completed project work because a sandbox or chat died.

## Historical engineering timeline

### 2026-10-11 — clean V2 recovery and early audit

Historical: the project moved to `v2/openclaw-clean-20261011` and explicitly avoided restarting legacy work or modifying `main`.

A large number of early CI runs failed during recovery. Those failures are historical and were superseded by later green baselines; they are important mainly because they established the rule that old PASS claims cannot be trusted without checking current HEAD/CI.

Historical regression around commit `606b59f...`:

- `fail_node_terminal()` had been redefined by migration `0008_active_lease_write_hardening.sql` without preserving `cascade_block_descendants(...)` and `finalize_task(...)`.
- Result: Research could fail while dependent Data stayed `PENDING`.
- `complete_node_success()` did not have that same composition loss.

Fix:

- commit `6c14330b...` added `0009_fail_node_terminal_composition_fix.sql` and restored cascade/finalization.
- CI `38165100648` succeeded.

This incident drove the micro-audit rule: compare each overwritten SQL function against prior behavior before calling it safe.

### 2026-10-12 — hosted parity and Research runtime

Migration `0018_deadline_heartbeat_guard.sql` added the deadline guard to heartbeat behavior and was verified hosted.

DeepSeek model routing was corrected so OpenClaw selected the intended DeepSeek primary instead of failing on model resolution.

Key implementation checkpoint:

- `d1a64b91...` — pinned Research DeepSeek primary route.
- CI `38262169004` — SUCCESS.

Machine identity work:

- `2b281f9d...` — granted GitHub Actions workflow machine write identity.
- `c6523ddb...` — proved the workflow's own `GITHUB_TOKEN` could write a commit status and that OIDC request environment existed.
- This proves a GitHub machine identity, not the user's personal identity.

Accounting/runtime fixes then aligned OpenClaw usage semantics, including cache buckets.

Key checkpoint:

- `5dc127f8...` — mapped OpenClaw cache usage into Kernel accounting.

A real paid Research vertical then executed through hosted Neon + Kernel + OpenClaw + DeepSeek + live web tools and reached terminal SUCCESS.

Preserved live task:

- task id: `eae6daf8-e086-43a5-aea9-b6ec879ce65a`;
- task status: `SUCCESS`;
- Research: `SUCCESS`;
- Data: `SUCCESS`, but only deterministic gate completion, not production Data;
- model/provider path: DeepSeek / `deepseek-flash` -> `DeepSeek-V4.1-Flash`;
- real `web_search` and `web_fetch` required by the fail-closed gate;
- official required-domain sources from `api-docs.deepseek.com`;
- accounting rows: exactly 1;
- accounting basis: `OBSERVED_USAGE`;
- total tokens: `16,286`;
- prompt cache hit tokens: `11,008`;
- prompt cache miss tokens: `4,615`;
- completion tokens: `663`;
- cost: `$0.002246`;
- unresolved reservation after completion: `0`;
- durable artifacts for that task: `0`.

This proves the real paid Research vertical and accounting path, but also proves that the Evidence layer was not yet built at that point.

Hosted active-lease drift was later found: hosted `complete_node_success()` and `requeue_node_retry()` lacked the active-lease guard required by repo migration logic.

Fix:

- migration `0019_active_lease_write_parity.sql`;
- commit `aaed44ac...`;
- CI `38287719014` — SUCCESS;
- child verification and hosted application passed;
- expired workers can no longer complete or requeue before reclaim;
- post-check hosted state: `0` active tasks, `0` RUNNING nodes, `0` unresolved reservations.

Governance checkpoints then recorded Research as `PASS_LIVE` and advanced the route toward production Data.

### 2026-10-12 — Production Data gate begins

Checkpoint `7344ebce...` advanced the documented route to production Data. CI `38295672776` succeeded.

Current code HEAD before this archive:

- `fbbf05d7d7a016805353924b06732d0bacf39b81` — `feat(v2): define production Data contract`;
- CI `38302547362` — SUCCESS.

This commit implements the D1 contract layer only:

- Data result schema versioning;
- Research SUCCESS input validation;
- required-field enforcement;
- source presence and source-reference integrity;
- duplicate source/item/reference rejection;
- HTTP/HTTPS source URL validation;
- deterministic output contract validation;
- unit tests for positive and negative contract cases.

D1 being green does not mean the entire production Data runtime is complete.

## Current 48h status as of archive creation

Proven foundation/runtime layers:

- #1 Hosted PostgreSQL/migrations — `PASS_HOSTED`.
- #2 Durable state machine — `PASS_CODE_CI`.
- #3 Idempotent intake — `PASS_CODE_CI`.
- #4 Atomic lease + fencing — `PASS_HOSTED`.
- #5 Heartbeat + stale-worker recovery — `PASS_HOSTED`.
- #6 Attempts/steps/budget/deadline breakers — `PASS_HOSTED` at the hosted parity layer already verified.
- #7 Atomic reservation/reconciliation — `PASS_HOSTED` / real Research reconciliation also proven live.
- #8 Lite DAG Research -> Data — `PASS_CODE_CI`; existing live Data completion was gate-only and not the production Data runtime.
- #9 Real DeepSeek/OpenClaw — `PASS_LIVE`.
- #10 Real native web search/fetch — `PASS_LIVE`.
- #11 Structured Research with sources — `PASS_LIVE`.
- #13 LLM accounting — `PASS_LIVE`.

Still incomplete as complete 48h deliverables:

- #12 Production Data/Result runtime — overall still incomplete; D1 contract is now `PASS_CODE_CI`, but normalization/dedupe execution, Kernel integration, and full production Data E2E remain.
- #14 Durable Evidence bundle — `NOT_BUILT`; the real paid task has zero artifact rows.
- #15 Phone short result + deep-log link — `NOT_BUILT`.

Additional end-to-end work required by the original product goal even though it is not a separate numbered 15-item line:

- real user/GitHub intake/dispatch that creates exactly one idempotent task and runs the proven vertical;
- final combined battle suite;
- production governance hardening after feature gates are complete.

## Correct remaining execution order

The currently agreed engineering sequence is deliberately incremental:

### Data D1 — contract

Status at archive time: completed in code at `fbbf05d7...`, full CI SUCCESS.

Defines Research SUCCESS -> Data input/output contract, required fields, source integrity, and deterministic validation.

### Data D2 — normalization + dedupe

Next functional micro-gate.

Implement only deterministic normalization/deduplication rules plus negative tests. Full CI, then stop.

### Data D3 — Data Kernel adapter

Claim only the Data node after Research SUCCESS, use fenced complete/fail, no LLM, PostgreSQL E2E, then full CI.

### Data D4 — full production Data E2E

Research structured output -> real production Data runtime -> deterministic validated result -> terminal task SUCCESS.

Only after D4 and independent verification should 48h item #12 move to `PASS_CODE_CI` for the complete production Data runtime.

Then continue, one gate at a time:

1. Durable Evidence layer.
2. Prove evidence persistence/retrieval after runner termination.
3. Phone result formatter and deep-log link.
4. Real GitHub/user dispatch.
5. Final combined battle suite: positive live E2E, duplicate dispatch, crash/reclaim, stale token, budget stop, dependency, failure cascade, deadline, accounting/release.
6. Final governance: minimize workflow permissions, configure required CI/branch protection, freeze verified handoff.

Research should not be redesigned again unless Data exposes an actual reproduced Research regression.

## Known unresolved infrastructure/governance issues

These remain separate from the functional Data/Evidence/Phone sequence:

- GitHub Actions repository secrets for `DATABASE_URL` and `DEEPSEEK_API_KEY` were still absent in the latest CI at archive time, so hosted/live conditional CI steps were `SKIPPED`.
- Permanent credential plumbing therefore remains `NOT_PROVEN` for continuous CI use.
- Workflow currently has broad `permissions: write-all`; the machine write identity is proven, but least-privilege hardening remains pending.
- Working V2 branch is not protected and required status checks are not enforced yet.
- Some governance metadata can lag the current HEAD because a state file cannot reliably self-record the SHA of its own future commit; always verify current Git HEAD/CI directly.
- `PROJECT_STATE.json` historically used a descriptive suffix on item #8 (`PASS_CODE_CI_GATE_ONLY_DATA_NOT_PRODUCTION_RUNTIME`). The semantic distinction is useful, but governance should ultimately keep the canonical truth label separate from explanatory detail.

These issues do not invalidate the already-proven live Research run, but they must be resolved before final 48h production-quality PASS.

## Credential handling decision

Runtime credentials are separate from project documentation.

Required CI secret names are:

- `DEEPSEEK_API_KEY`
- `DATABASE_URL`

Secret values are intentionally absent from this archive. A password for GitHub must never be placed here. The workflow is already designed to consume those names when configured securely.

## Recovery handoff for a new chat

A new ChatGPT/engineer should continue with this exact recovery sequence:

1. Read `START_HERE.md`.
2. Read all of `docs/02_48H_WALKING_SKELETON.md`.
3. Read current `PROJECT_STATE.json`.
4. Read the latest `docs/RESULTS_JOURNAL.md` checkpoint.
5. Read this archive for historical project context that may not exist in current state files.
6. Read the current branch HEAD and exact latest CI; if HEAD is ahead of governance files, review the full delta before writing.
7. Run read-only hosted checks when the next gate depends on Neon state.
8. Read `SYSTEM.md` and `docs/01_MASTER_ARCHITECTURE_AND_ROADMAP.md` for architectural invariants and future phases.
9. Do not touch legacy `main`.
10. Continue from the earliest still-unproven dependency; do not restart completed work.

At archive time the current route is Production Data. D1 is already green. The next implementation gate is D2 normalization + dedupe unless a newer HEAD/CI proves the project has advanced further.

## Material known to be unavailable or intentionally excluded

Unavailable for literal export:

- a raw filesystem-style listing of the internal ChatGPT `/OpenClaw-V2-Project` project folder;
- full verbatim transcripts that were not surfaced through retrievable conversation context;
- any deleted or inaccessible project attachments that were never mirrored to GitHub or retrievable context.

Intentionally excluded:

- API keys;
- database connection strings;
- passwords;
- access/session tokens;
- authentication cookies;
- private model chain-of-thought/internal scratch reasoning.

No missing material was invented to fill those gaps.
