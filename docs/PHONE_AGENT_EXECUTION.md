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

## 3. OPEN GAPS
1. Final Universal Agent has not passed live dynamic follow-up acceptance after final config.
2. Free demo is not yet proved bound to `agent_f2949915a3f2`.
3. Private result pipeline needs runtime acceptance on a new completed call.
4. Practical factual external call not yet done.
5. Paid production is locked until free testing is exhausted.

## 4. OFFICIAL CALL2ME FACTS
### Free demo
- public `POST /v1/demo/call`; no signup/card;
- shared temporary number; one destination/day; max 60 sec;
- workspace admin can choose custom agent at Dashboard `Demo -> Agent`;
- documented request has `phone_number` + `name`; arbitrary PHONE TASK runtime variables are not documented.

### Result/transcript
- call detail and transcript APIs documented;
- post-call structured extraction from transcript documented;
- webhook can deliver completed-call evidence;
- vCon optional.

## 5. ORDERED PLAN
### T-1 Governance/inventory — DONE
### T-2 Provider contract audit — DONE, continuing only where new auth evidence appears
### T-3 FREE LIVE CONVERSATION — ACTIVE / PRIORITY 1
- T-3.1 bind `agent_f2949915a3f2` as Demo Agent using supported/authenticated provider setting.
- T-3.2 verify binding by real free call.
- T-3.3 eligible explicitly authorized destination.
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
- Current work: keep finding an autonomous FREE path to authenticated Demo Agent binding before asking Sergii to do dashboard work.

## JOURNAL
### J-020 — Inventory reconciled — DONE
### J-021 — Historical spending authority — SUPERSEDED; current spend `$0.00`
### J-022 — BYOC/existing-number work — SUPERSEDED before free acceptance
### J-023 — Accidental `tmp-do-not-use` branch — NON-BLOCKING / never source of truth
### J-024 — FREE-FIRST governance — DONE
### J-025 — Official demo contract — DONE
### J-026 — Result audit start — SUPERSEDED by J-027
### J-027 — Official result/transcript/extraction contract — DONE
### J-028 — Demo binding + free/paid boundary — DONE
### J-029 — Existing permanent phone runner/workflow inspected — DONE
### J-030 — Generic integration considered — DONE
### J-031 — Unnecessary generic expansion reverted — DONE
### J-032 — Permanent private evidence pipeline — CODE DONE / LIVE ACCEPTANCE OPEN
- existing phone runner now retrieves transcript endpoint and provider extraction into private temp evidence;
- public Git only sanitized call metadata;
- phone workflow uploads private artifact separately (3 days);
- CI: OpenClaw PR Validation `33804632776` SUCCESS, Workflow Self Validation `33804632726` SUCCESS, CodeQL `33804632582` SUCCESS.

### J-033 — Official Demo binding surface — DONE
- docs: Dashboard `Demo -> Agent`;
- official Python/Node SDKs: no dedicated Demo binding method found.

### J-034 — Quick-login autonomous path discovered — DONE
- Existing repository workflow `call2me-multirole-selftest.yml` proves a historical passwordless strategy: POST `/v1/auth/quick-login`, extract token from returned URL, verify at `/v1/auth/quick-login/verify`, then use JWT.
- This is a new relevant path for current dashboard privilege, so the earlier conclusion “user must click dashboard now” is NOT terminal.

### J-035 — Permanent dashboard contract probe executed — FAILED_PATH / DO NOT RETRY AS-IS
- ACTION: converted existing `call2me-quick-login.yml` into a permanent read-only dashboard/OpenAPI contract probe; no new workflow created; no spend.
- RUN: `33805370158`.
- VERIFIED FAILURE: `POST /v1/auth/quick-login` returned HTTP `401`; workflow stopped before OpenAPI/settings audit.
- CLASS: PROVIDER/AUTH CONTRACT CHANGE, not product failure.
- RESULT: do not retry the same quick-login payload. Next path is public OpenAPI-first inspection (no auth) to discover the CURRENT auth contract/endpoints, then use the current documented/actual auth route.

### J-036 — NEXT ACTION
Modify the existing contract probe so public OpenAPI audit always runs before optional authentication. Extract current `/auth`, `/demo`, `/users/settings` paths and relevant request schemas from the official machine-readable contract. Then choose the next auth/binding path from evidence, not guesses.