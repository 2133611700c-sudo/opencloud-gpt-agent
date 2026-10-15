# OpenClaw V2 — Final 48h Walking Skeleton Verification

Date: 2026-10-15  
Canonical branch: `v2/openclaw-clean-20261011`  
Verified implementation head: `e9059b4a5646684dd7efcc026a285a9113528b54`  
Exact implementation CI: `38735424042` / foundation `116423380776` — SUCCESS

## Final conclusion

**PASS_LIVE — the canonical 48h Walking Skeleton is complete.**

The closing proof is one real authenticated external USER HTTP request that created exactly one durable PostgreSQL task and completed the same production chain through paid Research, production Data, observed accounting, reconciled reservation, runtime receipt, durable Evidence, and reachable HTTPS Phone/deep-log output.

No production contract was weakened to obtain this result. `main` remains frozen.

## Failure investigated before closure

The reported short CI failure was run `38730914293` on checkpoint commit `c7633630a14eccff4a649d0d5bffde09cd06418e`.

Root cause was a stale governance assertion in `scripts/validate-foundation.mjs`: it required exactly four entries in `remaining_48h_gaps` even after F2 had legitimately reduced the inventory to three. The failure occurred at `Validate foundation`; it was not a Research, Data, DeepSeek, PostgreSQL, Evidence, or paid-runtime failure.

Repair commit `118f044e3b24a28a9fc2a0d2376a32575dc7c935` made the gap inventory evolvable while preserving the invariant that a PASS state cannot coexist with unfinished mapped gates. Subsequent exact CI runs #292 through #295 passed.

## Codex work recovered and independently checked

1. `c7633630a14eccff4a649d0d5bffde09cd06418e` — F2 paid production Data + receipt-bound Evidence checkpoint.
2. `118f044e3b24a28a9fc2a0d2376a32575dc7c935` — corrected stale gap-count validator.
3. `384bb7d5b84a3532bebdaa694819d8db1cb00949` — removed mutation of frozen canonical Evidence from Phone formatting and added recursive-freeze regressions.
4. `51421c30a13ac611da2fdc98cae63c156bcb6dab` — automatic terminal Evidence -> HTTPS deep-log + Phone publication.
5. `e9059b4a5646684dd7efcc026a285a9113528b54` — authenticated external USER HTTP intake and one-shot durable task worker integration.

Current exact CI on `e9059b4...`: `38735424042` — SUCCESS. Production Data, bound Evidence, runtime Evidence lifecycle, authenticated PostgreSQL intake, mobile Function build, pinned OpenClaw, DeepSeek plugin, DuckDuckGo plugin and generated runtime config all passed. Secret-dependent Actions live steps remained SKIPPED and are not used as proof.

## Final external live proof

External request identity:

- principal: `operator`
- request id: `ba5a6544-5d43-4aa5-9756-7f2a22442a23`
- idempotency key: `user:http:operator:ba5a6544-5d43-4aa5-9756-7f2a22442a23`
- durable task: `f48c0505-ac37-47be-a8bc-8ccdf879dc85`
- tasks with this exact idempotency key: **1**

Task:

- status: `SUCCESS`
- terminal reason: `ALL_NODES_SUCCEEDED`
- Research: `SUCCESS`, attempt 1
- production Data: `SUCCESS`, attempt 1
- final production Data items: 1
- official source records: 2

Runtime:

- OpenClaw: `2026.9.8`
- configured model: `deepseek/deepseek-flash`
- observed provider/model: `deepseek` / `deepseek-flash`
- release returned by the sourced result: `DeepSeek-V4.1-Flash`
- thinking level: `max`
- native tools observed: `web_search`, `web_fetch`
- tool calls: 4
- tool failures: 0

Accounting:

- accounting id: `a3637b21-c0b7-4b0e-9e2e-94fd2c980fae`
- basis: `OBSERVED_USAGE`
- prompt cache hit: 12,544
- prompt cache miss: 6,475
- completion: 723
- total: 19,742
- latency: 21,792 ms
- pricing version: `deepseek-v4.1-flash-2026-09-10`
- actual cost: `$0.002885`

Budget reservation:

- reserved: `$0.100000` / 50,000 tokens
- final status: `RECONCILED`
- actual: `$0.002885` / 19,742 tokens
- unresolved reservations after run: 0

Runtime receipt:

- `4ea7df6c-5aa4-4ba1-b6b0-2e329614f701`
- linked to the same accounting row and Research node
- configured runtime/model/thinking values match the pins
- observed tools contain both native web tools
- receipt error: null

Durable Evidence:

- artifact id: `b5707132-529c-4d03-8661-3cca73af79e9`
- type: `EVIDENCE_BUNDLE_V1`
- artifact SHA-256: `7894d39686b8e1d02ede9a0f3461b61e674ae859e21f720412e0cfd1e63eeb42`
- size: 6,466 bytes
- canonical Data verified before redaction and at retrieval
- accounting reconciled: true
- unresolved reservations inside Evidence: 0

The artifact, receipt, accounting row and task were re-read independently after producer completion.

## Hosted Phone and deep-log

Active Neon Function:

- slug: `openclawv2mobile`
- branch: `br-odd-forest-a4leyaqj`
- deployment: 4
- runtime: Node 24

Public sanitized surfaces for the closing task:

- Phone: `https://br-odd-forest-a4leyaqj-openclawv2mobile.compute.c-1.us-east-1.aws.neon.tech/tasks/f48c0505-ac37-47be-a8bc-8ccdf879dc85/phone`
- Deep log: `https://br-odd-forest-a4leyaqj-openclawv2mobile.compute.c-1.us-east-1.aws.neon.tech/tasks/f48c0505-ac37-47be-a8bc-8ccdf879dc85/deep-log`

A separate browser session after producer completion loaded both HTTPS endpoints. Phone reported SUCCESS, task identity, `$0.002885`, and the deep-log URL. Deep-log independently exposed the matching task, Evidence identity/hash, provider/model, native tools, cost/tokens/latency, and the two official source URLs.

## 15-item inventory

| # | Mandatory scope | Status |
|---|---|---|
| 1 | Hosted PostgreSQL + migrations | PASS_HOSTED |
| 2 | Durable state machine | PASS_CODE_CI |
| 3 | Idempotent request intake | PASS_LIVE |
| 4 | Atomic lease + unique fencing token | PASS_HOSTED |
| 5 | Heartbeat + stale-worker recovery | PASS_HOSTED |
| 6 | Attempts/steps/token+USD/deadline breakers | PASS_HOSTED |
| 7 | Atomic reservation + reconciliation | PASS_LIVE |
| 8 | Lite DAG Research -> Data/Result | PASS_CODE_CI |
| 9 | Real DeepSeek/OpenClaw | PASS_LIVE |
| 10 | Native web_search + web_fetch | PASS_LIVE |
| 11 | Structured Research provenance/sources | PASS_LIVE |
| 12 | Data validation/normalize/dedupe/source integrity | PASS_LIVE |
| 13 | LLM accounting | PASS_LIVE |
| 14 | Durable Evidence | PASS_LIVE |
| 15 | Phone short result + deep-log link | PASS_LIVE |

## 9 mandatory acceptance tests

| # | Acceptance | Status |
|---|---|---|
| 1 | Positive real Research E2E -> SUCCESS | PASS_LIVE |
| 2 | Duplicate dispatch -> one task | PASS_CODE_CI |
| 3 | Worker crash -> safe continuation | PASS_CODE_CI |
| 4 | Stale fencing token -> zero mutations | PASS_HOSTED |
| 5 | Budget terminal stop -> zero further calls | PASS_CODE_CI |
| 6 | Data cannot run before Research SUCCESS | PASS_CODE_CI |
| 7 | Failure cascade -> descendants BLOCKED + terminal task | PASS_CODE_CI |
| 8 | Deadline terminalization | PASS_HOSTED |
| 9 | Reservation -> actual -> reconcile/release invariant | PASS_LIVE |

## Database cleanliness after final run

Independent hosted inventory:

- tasks: 22
- RUNNING nodes: 0
- unresolved `RESERVED`: 0
- accounting rows: 9
- `EVIDENCE_BUNDLE_V1` artifacts: 15
- runtime receipts: 5

The closing task intentionally remains as durable acceptance evidence.

## Remaining mandatory 48h gaps

**NONE.**

GitHub-specific `issues:opened` / webhook delivery remains NOT_PROVEN, but it is no longer a mandatory blocker because the canonical goal permits a real goal from iPhone/ChatGPT/GitHub and the authenticated USER HTTP path has now been proven live end-to-end.

## Risks and control

1. `.github/workflows/v2-ci.yml` still declares `permissions: write-all`. This is a post-48h least-privilege hardening item. Do not combine its repair with runtime feature work.
2. Canonical V2 branch protection is not yet the final cutover governance posture. `main` must remain frozen until separate cutover and rollback gates are proven.
3. Secret-dependent live steps in GitHub Actions are still SKIPPED because continuous Actions secret plumbing is not proven. They are not counted as PASS; the live acceptance above comes from direct hosted/runtime evidence.
4. The Neon Function emitted a `pg-connection-string` forward-compatibility warning about future SSL mode semantics. The installed version states the current behavior is verify-full; explicitly pinning the desired SSL semantics should be handled as a separate hardening change.
5. GitHub-specific external webhook delivery remains optional post-48h integration work; do not rewrite `main` merely to enable it.

## Next exact engineering action

Harden `.github/workflows/v2-ci.yml` from `permissions: write-all` to the minimum GitHub token permissions required by the V2 workflow, in an isolated V2 change, and run the full exact CI. Do not touch `main`.
