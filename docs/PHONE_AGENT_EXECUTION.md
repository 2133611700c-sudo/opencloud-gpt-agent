# PHONE AGENT — ACTIVE PLAN + JOURNAL

Updated: 2026-09-03
Historical journal: `docs/PHONE_AGENT_STATE.md` (J-001..J-019).
This file is the active source of truth from J-020 onward.

## 0. MASTER RULES
1. `READ JOURNAL -> VERIFY -> ONE SMALL ACTION -> VERIFY RESULT -> JOURNAL -> NEXT`.
2. “Не получилось” не является конечным статусом. Ошибка = `CODE` / `PROVIDER` / `BLOCKED_PRIVILEGE`; затем следующий независимый путь.
3. Call2Me: official docs/OpenAPI/API responses/official SDK source first.
4. Permanent tools by default; no duplicate agents/workflows/orchestration without proven need.
5. **FREE FIRST. Spend $0.00 until Sergii gives NEW explicit approval.** No wallet use, number, paid call/plan/add-on, recording, SIP/BYOC/Twilio/porting/paid provider.
6. Product acceptance: `SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> REAL CALL -> HUMAN DIALOG -> VERIFIED FACTS -> SERGII`.
7. Architect rule: choose the shortest permanent path that satisfies the acceptance test; do not add infrastructure that does not remove a verified blocker.
8. Auditor rule: no DONE/READY claim without primary-source or runtime evidence; record contradictions and replace stale assumptions immediately.

## 1. LARGE TASK
One universal outbound AI agent: natural Sergii request -> PHONE TASK -> real phone call -> AI disclosure/on behalf/purpose -> listens to real answers -> logical follow-ups -> verified factual result.

## 2. VERIFIED DONE
- Call2Me selected/frozen.
- Universal agent `agent_f2949915a3f2` exists.
- Final live config purpose-first verified; recording off; voicemail hangup.
- Real Call2Me demo reached Sergii and AI spoke.
- E.164 fix done.
- Permanent runner `scripts/openclaw-phone-call.mjs`.
- Permanent workflow `.github/workflows/openclaw-phone-call.yml`.
- PHONE TASK template exists.
- Idempotency/no-redial/safety/public-sanitization guards exist.
- Private transcript/extraction artifact pipeline implemented and CI green.
- OpenClaw PR Validation, Workflow Self Validation and CodeQL green after current runner changes.
- Current official OpenAPI 3.1 contract audited successfully in run `33805529385`.

## 3. OPEN GAPS
1. Final Universal Agent has not passed live dynamic follow-up acceptance after final config.
2. Free demo has not yet been runtime-proved with `agent_f2949915a3f2` using the newly discovered direct `agent_id` override.
3. Private result pipeline needs runtime acceptance on a new completed call.
4. Practical factual external call not yet done.
5. Paid production is locked until free testing is exhausted.

## 4. OFFICIAL CALL2ME FACTS
### Free demo — current machine-readable contract
- public `POST /v1/demo/call`; no signup/card for the public demo path;
- `DemoCallRequest` requires only `phone_number` and currently also exposes optional `name`, optional `website` honeypot, and **optional `agent_id` described as `Optional agent ID override`**;
- therefore a custom agent can be selected directly per free demo call through the current API contract; dashboard binding is not required for this test path;
- `POST /v1/demo/reserve` separately accepts optional `agent_id` described as `Agent to bind the number to`;
- `/v1/demo/eligibility`, `/v1/demo/my-reservation`, `/v1/demo/pool`, `/v1/demo/release` also exist in current OpenAPI;
- arbitrary PHONE TASK runtime variables are still not documented on `DemoCallRequest`.

### Result/transcript
- call detail and transcript APIs documented;
- post-call structured extraction from transcript documented;
- webhook can deliver completed-call evidence;
- vCon optional.

## 5. ORDERED PLAN
### T-1 Governance/inventory — DONE
### T-2 Provider contract audit — DONE
### T-3 FREE LIVE CONVERSATION — ACTIVE / PRIORITY 1
- T-3.1 use public `POST /v1/demo/call` with `agent_id=agent_f2949915a3f2`; no dashboard/auth detour unless runtime evidence requires it.
- T-3.2 verify returned `call_id` and real free call.
- T-3.3 use only an eligible explicitly authorized destination; respect one-destination/day provider limit.
- T-3.4 prove disclosure -> purpose -> first question -> arbitrary answer -> relevant follow-up -> second answer -> correct end.
- T-3.5 no conversation data in public Git.
### T-4 Permanent result pipeline — CODE DONE / LIVE ACCEPTANCE OPEN
### T-5 Sergii request -> PHONE TASK — use existing dedicated permanent path
`ChatGPT -> ops/agent-control/phone-calls/<id>.json -> existing workflow -> existing phone runner`.
### T-6 Full free vertical slice — after T-3
### T-7 Paid production — LOCKED
### T-8 Practical call + hardening — after live acceptance

## 6. DEFERRED BEFORE FREE ACCEPTANCE
Twilio/SIP/BYOC/AT&T; number purchase; wallet spending; new voice provider; CRM/frontend/queue/microservices; mass dialing; generic phone orchestration; cosmetic PR cleanup.

## 7. CURRENT CHECKPOINT
- Branch `feat/openclaw-vendor-phone-calls`, PR #39 open/unmerged.
- T-4 code green; runtime acceptance pending.
- **Current work: execute a free demo call directly with the existing universal agent through the documented `agent_id` override.**
- No Call2Me authentication or dashboard binding is needed for the next test unless the provider rejects the documented public path at runtime.

## JOURNAL
### J-020 — Inventory reconciled — DONE
### J-021 — Historical spending authority — SUPERSEDED; current spend `$0.00`
### J-022 — BYOC/existing-number work — SUPERSEDED before free acceptance
### J-023 — Accidental `tmp-do-not-use` branch — NON-BLOCKING / never source of truth
### J-024 — FREE-FIRST governance — DONE
### J-025 — Official demo contract — DONE
### J-026 — Result audit start — SUPERSEDED by J-027
### J-027 — Official result/transcript/extraction contract — DONE
### J-028 — Demo binding + free/paid boundary — SUPERSEDED by J-037 direct agent override discovery
### J-029 — Existing permanent phone runner/workflow inspected — DONE
### J-030 — Generic integration considered — DONE
### J-031 — Unnecessary generic expansion reverted — DONE
### J-032 — Permanent private evidence pipeline — CODE DONE / LIVE ACCEPTANCE OPEN
- existing phone runner now retrieves transcript endpoint and provider extraction into private temp evidence;
- public Git only sanitized call metadata;
- phone workflow uploads private artifact separately (3 days);
- CI: OpenClaw PR Validation `33804632776` SUCCESS, Workflow Self Validation `33804632726` SUCCESS, CodeQL `33804632582` SUCCESS.

### J-033 — Official Demo binding surface — SUPERSEDED by J-037
- Earlier docs/dashboard reading suggested Dashboard `Demo -> Agent` was the relevant custom-agent surface.
- Current machine-readable OpenAPI proves a simpler direct API surface and takes precedence.

### J-034 — Quick-login autonomous path discovered — SUPERSEDED for current free test
- Historical quick-login path remains useful evidence but is not required for the next free test.

### J-035 — Permanent dashboard contract probe executed — FAILED_PATH / DO NOT RETRY AS-IS
- ACTION: converted existing `call2me-quick-login.yml` into a permanent read-only dashboard/OpenAPI contract probe; no new workflow created; no spend.
- RUN: `33805370158`.
- VERIFIED FAILURE: `POST /v1/auth/quick-login` returned HTTP `401`.
- CLASS: PROVIDER/AUTH CONTRACT CHANGE, not product failure.
- RESULT: do not retry the same quick-login payload.

### J-036 — OpenAPI-first contract audit — DONE
- Existing contract probe was changed so public OpenAPI is audited without authentication.
- RUN `33805529385`: SUCCESS.
- Artifact `call2me-current-contract-33805529385` captured API version `1.0.0`, OpenAPI `3.1.0`, 217 paths, relevant auth/demo/user schemas.

### J-037 — Direct free-demo custom-agent path discovered — DONE / ARCHITECTURE SIMPLIFIED
- PRIMARY EVIDENCE: current official OpenAPI `DemoCallRequest.agent_id` = optional `agent_id` override.
- `ReserveRequest.agent_id` also supports binding an agent to a demo reservation.
- AUDIT FINDING: the active plan's assumption that authenticated Dashboard Demo-Agent binding was required was stale/overcomplicated.
- CORRECTION: remove dashboard/auth from the critical path. Next test is direct public `/v1/demo/call` with existing universal agent ID.
- COST: `$0.00`; no wallet/number/SIP/recording change.

### J-038 — NEXT ACTION
Execute the free demo acceptance call with `agent_id=agent_f2949915a3f2` on an eligible explicitly authorized destination. Capture call_id/status privately, verify live dynamic follow-up, then journal PASS/FAIL and immediately continue to the next independent path if provider rejects it.