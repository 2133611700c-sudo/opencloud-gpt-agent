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
9. Current user order: finish all zero-spend production preparation first; live test and funding come later.

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
- Zero-spend production preflight implemented in `scripts/openclaw-phone-preflight.mjs`.
- Existing phone workflow now has `preflight_only` mode that performs read-only provider checks and cannot create a call.

## 3. OPEN GAPS
1. `CALL2ME_API_KEY` is not configured as a repository secret accessible to the production workflow; this is `BLOCKED_PRIVILEGE` from the current connector surface.
2. Production caller number is not yet purchased/selected; user wants funding and number purchase later.
3. Final Universal Agent has not passed live dynamic follow-up acceptance after final config.
4. Private result pipeline needs runtime acceptance on a new completed call.
5. Practical factual external call not yet done.

## 4. OFFICIAL CALL2ME FACTS
### Free demo — current machine-readable contract
- public `POST /v1/demo/call`; no signup/card for the public demo path;
- `DemoCallRequest` requires only `phone_number` and currently also exposes optional `name`, optional `website` honeypot, and optional `agent_id` described as `Optional agent ID override`;
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
### T-3 Zero-spend production build — ACTIVE
- T-3.1 permanent runner — DONE.
- T-3.2 permanent workflow — DONE.
- T-3.3 private transcript/extraction evidence pipeline — CODE DONE.
- T-3.4 read-only production preflight — CODE DONE.
- T-3.5 persistent production API credential — BLOCKED_PRIVILEGE until repository secret can be written through an authorized surface.
### T-4 Commercial activation — DEFERRED BY USER
- fund wallet;
- purchase/select one permanent Call2Me US local number;
- bind/configure `CALL2ME_FROM_NUMBER` if needed;
- run `preflight_only` and require `ready_for_paid_call=true` before any paid call.
### T-5 Live acceptance — DEFERRED BY USER UNTIL AFTER BUILD/FUNDING
- one explicitly authorized destination;
- disclosure -> concrete purpose -> first question -> real answer -> logical follow-up -> verified answer -> proper end;
- no recording;
- verify transcript/extraction/private evidence.
### T-6 Practical factual external call
- run only after T-5 passes.

## 6. DEFERRED
Twilio/SIP/BYOC/AT&T; new voice provider; CRM/frontend/queue/microservices; mass dialing; generic phone orchestration; cosmetic PR cleanup.

## 7. CURRENT CHECKPOINT
- Branch `feat/openclaw-vendor-phone-calls`, PR #39 open/unmerged.
- Production call path is implemented.
- Read-only zero-spend readiness path is now implemented in the same permanent workflow.
- The only non-commercial infrastructure blocker is persistent `CALL2ME_API_KEY` delivery to GitHub Actions.
- Funding, number purchase and live testing are intentionally deferred until Sergii authorizes them.

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
- existing phone runner retrieves transcript endpoint and provider extraction into private temp evidence;
- public Git only sanitized call metadata;
- phone workflow uploads private artifact separately (3 days);
- CI: OpenClaw PR Validation `33804632776` SUCCESS, Workflow Self Validation `33804632726` SUCCESS, CodeQL `33804632582` SUCCESS.

### J-033 — Official Demo binding surface — SUPERSEDED by J-037
### J-034 — Quick-login autonomous path discovered — SUPERSEDED for current path
### J-035 — Permanent dashboard contract probe — FAILED_PATH / DO NOT RETRY AS-IS
- RUN `33805370158`; `POST /v1/auth/quick-login` returned HTTP `401`.
- CLASS: PROVIDER/AUTH CONTRACT CHANGE.
### J-036 — OpenAPI-first contract audit — DONE
- RUN `33805529385`: SUCCESS; OpenAPI `3.1.0`, 217 paths.
### J-037 — Direct free-demo custom-agent path discovered — DONE
- current official OpenAPI exposes `DemoCallRequest.agent_id` override.

### J-038 — User changed execution order — RECORDED
- Finish all zero-spend production preparation first.
- Funding/number purchase/live test later.
- No paid action authorized.

### J-039 — Zero-spend production preflight — CODE DONE
- Added `scripts/openclaw-phone-preflight.mjs`.
- Read-only GETs only: agent, owned phone numbers, wallet balance.
- It reports agent existence, number readiness, wallet readiness and `ready_for_paid_call`.
- It makes no purchase, payment, reservation or call.
- Commit: `f349e46a722445b36245a02937c77f1490b503f4`.

### J-040 — Existing permanent workflow extended — CODE DONE
- `.github/workflows/openclaw-phone-call.yml` now supports manual `preflight_only=true`.
- Preflight mode skips task resolution, call creation, call evidence upload and report commits.
- Added optional `CALL2ME_FROM_NUMBER` repository variable support.
- Commit: `907e3907aae9dbc5349e29dd0252227a96ae6f04`.

### J-041 — CURRENT BLOCKER
- `CALL2ME_API_KEY` must exist as a GitHub Actions repository secret before authenticated preflight can run.
- Current GitHub connector explicitly does not expose sensitive repository Secrets APIs, so writing that secret from this chat is `BLOCKED_PRIVILEGE`.
- Do not weaken security by committing the API key to Git, workflow YAML, artifacts or logs.
- Once the secret is available, first action is `preflight_only=true`; no call is allowed until preflight proves the agent/number/wallet state.