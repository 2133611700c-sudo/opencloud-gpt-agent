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
9. Current user order: complete launch today; continue all safe configuration immediately and test as soon as the remaining authenticated provider access is available.

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
- Private transcript/extraction artifact pipeline implemented.
- Current official OpenAPI 3.1 contract audited successfully.
- Zero-spend production preflight implemented in `scripts/openclaw-phone-preflight.mjs`.
- Existing phone workflow has `preflight_only` mode that performs read-only provider checks and cannot create a call.
- Current production call creation contract verified: `POST /v1/calls` supports `agent_id`, `to_number`, optional `from_number`, `metadata`, and `dynamic_variables`; existing runner matches it.
- Current official result fallback verified: `GET /v1/calls/{call_id}/vcon`; zero-spend vCon recovery code added to private evidence pipeline.
- Current number provisioning contract verified: read-only `GET /v1/numbers/search`; paid `POST /v1/numbers/purchase`; paid checkout `POST /v1/numbers/checkout`.
- Zero-spend US local number inventory/price preview implemented; it calls search only and masks phone numbers in logs.
- Latest branch head CI is green: Workflow Self Validation, OpenClaw PR Validation and CodeQL all succeeded on `d7302ec4183eb19e26fed618e1d41bcb22c3d0d5`.

## 3. OPEN GAPS
1. `CALL2ME_API_KEY` is not configured as a repository secret accessible to the production workflow; this is `BLOCKED_PRIVILEGE` from the current connector surface.
2. Production caller number is not yet purchased/selected.
3. Final Universal Agent has not passed live dynamic follow-up acceptance after final config.
4. Private result pipeline needs runtime acceptance on a new completed call.
5. Practical factual external call not yet done.

## 4. OFFICIAL CALL2ME FACTS
### Production calls — current machine-readable contract
- `POST /v1/calls`: required `agent_id`, `to_number`; optional `from_number`, `metadata`, `dynamic_variables`.
- `GET /v1/calls/{call_id}` provides call detail.
- Current OpenAPI exposes `GET /v1/calls/{call_id}/vcon` for conversation evidence.
- The earlier standalone `/calls/{call_id}/transcript` assumption is not present in the current OpenAPI; runner keeps it as best-effort compatibility only, while vCon is the current documented fallback.

### Phone numbers — current machine-readable contract
- `GET /v1/numbers/search` is the read-only inventory endpoint.
- Search parameters include `country` (default `US`), `locality`, `area_code`, `phone_number_type` (default `local`), `limit`, and `provider`.
- `SearchResponse.numbers[]` uses `AvailableNumber`; available-number data includes `monthly_price_usd` and `upfront_price_usd`.
- `SearchResponse` also exposes `requires_payment` and `upfront_price_usd`.
- `POST /v1/numbers/purchase` is the paid purchase endpoint.
- `POST /v1/numbers/checkout` is a commercial checkout endpoint.
- `GET /v1/phone-numbers` lists owned numbers; `PhoneNumberResponse.monthly_price_usd` records rental price.

### Free demo
- public `POST /v1/demo/call` exposes optional `agent_id` override.

## 5. ORDERED PLAN
### T-1 Governance/inventory — DONE
### T-2 Provider contract audit — DONE
### T-3 Zero-spend production build — DONE EXCEPT EXTERNAL CREDENTIAL DELIVERY
- T-3.1 permanent runner — DONE.
- T-3.2 permanent workflow — DONE.
- T-3.3 private transcript/extraction evidence pipeline — CODE DONE; current vCon fallback added.
- T-3.4 read-only production preflight — CODE DONE.
- T-3.5 read-only US local inventory/price preview — CODE DONE.
- T-3.6 persistent production API credential — BLOCKED_PRIVILEGE until repository secret can be written through an authorized surface.
- T-3.7 CI validation — DONE.
### T-4 Commercial activation — ACTIVE FOR LAUNCH DAY
- authenticate Call2Me account;
- verify current wallet balance and exact number price before any number purchase;
- purchase/select exactly one permanent Call2Me US local number only after verified price and available balance;
- bind/configure `CALL2ME_FROM_NUMBER` if needed;
- run `preflight_only=true` and require `ready_for_paid_call=true` before any paid call.
### T-5 Live acceptance — NEXT AFTER T-4
- one explicitly authorized destination;
- disclosure -> concrete purpose -> first question -> real answer -> logical follow-up -> verified answer -> proper end;
- no recording;
- verify vCon/transcript/extraction/private evidence.
### T-6 Practical factual external call
- run only after T-5 passes.

## 6. DEFERRED
Twilio/SIP/BYOC/AT&T; new voice provider; CRM/frontend/queue/microservices; mass dialing; generic phone orchestration; cosmetic PR cleanup.

## 7. CURRENT CHECKPOINT
- Branch `feat/openclaw-vendor-phone-calls`, PR #39 open/unmerged.
- Production call path is implemented against the current `POST /v1/calls` contract.
- Read-only zero-spend readiness and number-price preview paths are implemented in the same permanent workflow.
- Current documented vCon evidence fallback is implemented.
- Latest branch CI is green.
- A Paddle receipt dated 2026-09-03 confirms a user-initiated $5 Call2Me payment; do not treat this as wallet balance until Call2Me API readback confirms it.
- Latest Call2Me password reset email exists and is still within its one-hour validity window at this checkpoint.
- Current remaining hard blocker is authenticated Call2Me access plus secure delivery of `CALL2ME_API_KEY` to GitHub Actions; current GitHub connector cannot write Actions secrets and current chat has no form-capable browser.

## JOURNAL
### J-020 — Inventory reconciled — DONE
### J-021 — Historical spending authority — SUPERSEDED; current spend `$0.00`
### J-022 — BYOC/existing-number work — SUPERSEDED before free acceptance
### J-023 — Accidental `tmp-do-not-use` branch — NON-BLOCKING / never source of truth
### J-024 — FREE-FIRST governance — DONE
### J-025 — Official demo contract — DONE
### J-026 — Result audit start — SUPERSEDED by J-027
### J-027 — Official result/transcript/extraction contract — SUPERSEDED in part by current OpenAPI vCon finding
### J-028 — Demo binding + free/paid boundary — SUPERSEDED by J-037 direct agent override discovery
### J-029 — Existing permanent phone runner/workflow inspected — DONE
### J-030 — Generic integration considered — DONE
### J-031 — Unnecessary generic expansion reverted — DONE
### J-032 — Permanent private evidence pipeline — CODE DONE / LIVE ACCEPTANCE OPEN
- public Git only sanitized call metadata;
- phone workflow uploads private artifact separately (3 days).

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
- No paid action authorized at that checkpoint.

### J-039 — Zero-spend production preflight — CODE DONE
- Added `scripts/openclaw-phone-preflight.mjs`.
- Read-only GETs only: agent, owned phone numbers, wallet balance.
- It reports agent existence, number readiness, wallet readiness and `ready_for_paid_call`.
- It makes no purchase, payment, reservation or call.
- Commit: `f349e46a722445b36245a02937c77f1490b503f4`.

### J-040 — Existing permanent workflow extended — CODE DONE
- `.github/workflows/openclaw-phone-call.yml` supports manual `preflight_only=true`.
- Added optional `CALL2ME_FROM_NUMBER` repository variable support.
- Commit: `907e3907aae9dbc5349e29dd0252227a96ae6f04`.

### J-041 — Persistent credential blocker — OPEN / BLOCKED_PRIVILEGE
- `CALL2ME_API_KEY` must exist as a GitHub Actions repository secret before authenticated preflight/search can run.
- Current GitHub connector explicitly does not expose sensitive repository Secrets APIs.
- Do not weaken security by committing the API key to Git, workflow YAML, artifacts or logs.

### J-042 — Current production Call2Me contract re-audited — DONE
- Existing public OpenAPI audit workflow expanded; no authentication and no spend.
- Production call schema verifies the existing runner request shape for `POST /v1/calls`.
- Current OpenAPI exposes `GET /v1/calls/{call_id}/vcon`; standalone transcript endpoint is not present in the current contract.
- Number contract exposes `GET /v1/numbers/search`, `POST /v1/numbers/purchase`, `POST /v1/numbers/checkout`.
- Search supports US/local/area-code filtering and returns price fields before purchase.
- Audit run `33813374519`: SUCCESS; artifact `9915623357`, digest `sha256:88d70a6e8fabadc43917e5c98e7c5e766ef577a76ecd163cb6e881215f25eabe`.
- COST: `$0.00`.

### J-043 — Current vCon evidence fallback — CODE DONE
- Added `scripts/openclaw-phone-vcon-fallback.mjs`.
- If legacy/embedded transcript is unavailable after a completed call, it queries current documented `/v1/calls/{call_id}/vcon` and writes only to private evidence.
- Wired into the existing permanent phone workflow; no new orchestration.
- Commits: `91e8c387819394965549e0fe3c82a1d900f890f0`, `e099ec4b3d2b553ed7618edeb5629eaa6ca80213`.
- COST: `$0.00`.

### J-044 — Zero-spend US local number preview — CODE DONE
- Added `scripts/openclaw-phone-number-preview.mjs` using only `GET /v1/numbers/search`.
- Defaults: `country=US`, `phone_number_type=local`, limit 10; optional area code.
- Logs mask candidate phone numbers while retaining exact `monthly_price_usd`, `upfront_price_usd`, provider and payment flags.
- No purchase, checkout, payment or call endpoint is used.
- Existing `.github/workflows/openclaw-phone-call.yml` now supports `number_preview_only=true` and optional `number_area_code`.
- Read-only modes are mutually exclusive and both skip task resolution/call execution/evidence commits.
- Commits: `b7dd34f420504dbfb51939a38e44c8d28002a00e`, `f877e36ea97448922a911a72dc6e9acee7be0d04`.
- COST: `$0.00`.

### J-045 — CI validation — DONE
- Branch head `d7302ec4183eb19e26fed618e1d41bcb22c3d0d5`.
- Workflow Self Validation run `33814413076`: SUCCESS.
- CodeQL run `33814413083`: SUCCESS.
- OpenClaw PR Validation run `33814413043`: SUCCESS.

### J-046 — Launch-day commercial evidence — VERIFIED / NOT YET API-RECONCILED
- Gmail contains Paddle receipt dated 2026-09-03 for `$5.00`, product `Call2Me`.
- This proves the user made a payment; it does not prove current Call2Me wallet balance.
- Call2Me password-reset email is present and valid for one hour from issuance.

### J-047 — CURRENT ACTION
- Finish authenticated Call2Me access, then immediately run wallet/number inventory preview, select one permanent local number, preflight, and live acceptance.
- Current connector limitation: GitHub Actions secrets cannot be written through the GitHub connector, and this chat has no form-capable cloud browser to submit the password-reset form.
- Do not commit any credential or reset token to the public repository.