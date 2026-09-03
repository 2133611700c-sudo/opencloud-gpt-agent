# PHONE AGENT — ACTIVE EXECUTION PLAN AND JOURNAL

Status date: 2026-09-03
Historical record: `docs/PHONE_AGENT_STATE.md` (J-001..J-019).
This file is the active source of truth from J-020 onward.

## MASTER RULES

1. `READ JOURNAL -> VERIFY -> ONE SMALL ACTION -> VERIFY RESULT -> JOURNAL -> NEXT`.
2. A failed path is not a result. Classify `CODE` / `PROVIDER` / `BLOCKED_PRIVILEGE`, record the cause, then use the next technically independent path. Stop only at a genuine provider hard limit or a Sergii-controlled payment/OTP/privilege unavailable to the current tools.
3. Call2Me facts come from Call2Me official docs/OpenAPI/API responses first. Repo history proves only what our system already did.
4. Permanent tools by default: extend the existing runner/workflow/task contract and permanent provider config. Do not create duplicate agents, duplicate orchestration, throwaway workflows or architecture pyramids without a proven need.
5. **FREE FIRST. Spend $0.00 unless Sergii gives a NEW explicit approval.** Prior funding/number authorization is superseded by the latest user instruction. No wallet use, number purchase/rental, paid call, plan, auto-recharge, recording, SIP/BYOC/Twilio, porting or paid provider without new approval.
6. Product acceptance is the real behavior, not infrastructure:
   `SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> REAL CALL -> HUMAN DIALOG -> VERIFIED FACTS -> SERGII`.

## LARGE TASK

Build one universal outbound calling assistant that accepts Sergii's natural-language task, calls a real person, identifies itself correctly, states the purpose, listens, follows the human's real answers, asks useful follow-ups, stops when enough information is obtained, and returns evidence-derived facts.

## VERIFIED INVENTORY

### DONE
- Provider frozen to Call2Me for this path.
- Account access/auth recovery completed historically.
- Universal agent exists: `agent_f2949915a3f2` / `Sergii Universal Phone Agent`.
- Final live config verified purpose-first: dynamic opening; AI disclosure; `on behalf of Sergii`; runtime purpose; no `Can I help you?`; one question at a time; recording off; voicemail hangup.
- Real telephony transport proven: Call2Me demo rang Sergii and AI spoke.
- E.164 leading `+` bug fixed.
- Permanent runner exists: `scripts/openclaw-phone-call.mjs`.
- Permanent workflow exists: `.github/workflows/openclaw-phone-call.yml`.
- Phone task template exists: `ops/agent-control/templates/phone-call.example.json`.
- Runner already has approval checks, E.164/path validation, lock/dedupe/idempotency, no automatic redial, polling, duration/voicemail handling and sanitized public persistence.
- Runner/workflow security validation completed; do not repeat unless code changes or new evidence appears.
- Historical password reset, email verification, signup-credit retry, agent creation, greeting cleanup, API-key creation and secret-presence investigations are CLOSED unless new evidence changes state.

### LAST VERIFIED PROVIDER STATE — HISTORICAL, NOT CURRENT READBACK
- wallet `$0.00`, `can_proceed=false`;
- production request reached HTTP 402 `Insufficient balance`;
- owned production number list empty;
- prior managed-number discovery required payment;
- advertised/configured signup `$5` credit was not present in the verified wallet ledger at that time.

### PARTIAL / NOT ACCEPTED
- Dynamic conversation is configured but has not passed a complete live acceptance conversation after the final config.
- Production runner passes objective/context/questions/success condition, but relevant follow-up from a human's arbitrary answer is not yet accepted.
- Current result path does not yet complete factual-answer return to ChatGPT.
- `phone_call` is still outside generic `OPENCLAW_TASK_SCHEMA.v1.json` ingestion.
- PR #39 is open/unmerged and historically Bland-oriented; cleanup is post-E2E.

## OFFICIAL CALL2ME CONTRACT — VERIFIED 2026-09-03

### Free demo
Official Demo docs (updated 2026-05-06):
- public `POST /v1/demo/call`;
- no signup/card required;
- shared temporary number, reserved 15 minutes;
- one demo call per destination phone number per day;
- 60-second maximum;
- default demo agent unless workspace admin changes `Demo -> Agent` in dashboard;
- documented request body contains `phone_number` and `name` only.

**Conclusion:** free demo can prove real telephony and conversation. The documented public endpoint does NOT prove support for arbitrary PHONE TASK runtime variables.

### Call evidence / transcript / extraction
Official Calls/API/Post-Call/Webhook docs verify:
- call detail is available after a call;
- full transcript is part of call results/Calls tab;
- API reference documents `GET /v1/calls/{id}` and `GET /v1/calls/{id}/transcript`;
- post-call extraction fields are configured on the agent and stored on the call;
- `call.ended` webhooks can include a transcript URL;
- post-call extraction runs automatically from the transcript;
- vCon export is optional and not required for the MVP.

**Conclusion:** our permanent result pipeline should use call detail + transcript + configured extraction; no custom transcript hallucination is needed.

### Demo -> Agent binding surface
Official Demo docs explicitly document dashboard `Demo -> Agent` for workspace-admin override. The official API reference lists the public `POST /v1/demo/*` utility family but does not document an endpoint for setting the workspace demo-agent binding.

**Conclusion:** documented binding is dashboard-side. An undocumented/internal endpoint must not be treated as a stable production contract unless directly proved and deliberately accepted.

### Free vs paid boundary
Official docs verify:
- demo call is the explicit free phone-call surface;
- regular PSTN calls use the prepaid workspace wallet;
- production numbers are rented or supplied through BYOC/SIP;
- regular answered voice is metered; unanswered/busy/no-answer is $0;
- signup credit is advertised, but our last real wallet readback did not contain it.

**Conclusion:** no production PSTN spend is required to finish code/task/result plumbing or the free demo proof. Paid production telephony remains locked.

## ORDERED PLAN

### T-1 — Governance + complete inventory — DONE
Acceptance: rules, inventory, open gaps and ordered plan are journaled.

### T-2 — Official provider contract audit — DONE
- T-2.1 free demo/limits/custom-agent capability — DONE.
- T-2.2 result/transcript/post-call extraction mechanisms — DONE.
- T-2.3 documented Demo -> Agent binding surface — DONE: dashboard documented; no setting endpoint found in official API reference.
- T-2.4 exact free-vs-paid boundary — DONE.

### T-3 — Permanent free conversational test path — ACTIVE
Goal: use the EXISTING Universal Agent with Call2Me's free demo surface.
- T-3.1 Set `agent_f2949915a3f2` as workspace Demo -> Agent using a permanent provider setting. — ACTIVE.
- T-3.2 Verify binding by provider-side readback if available or direct observed call behavior.
- T-3.3 Place one free call to an eligible, explicitly authorized destination.
- T-3.4 Within 60 seconds prove: AI disclosure -> on behalf of Sergii -> concrete purpose -> first question -> arbitrary human answer -> relevant follow-up -> second answer -> proper end.
- T-3.5 Keep private conversation data out of public Git; journal only sanitized evidence.
Acceptance: Sergii confirms the agent listened and followed up logically.

### T-4 — Permanent verified-result pipeline — ACTIVE IN PARALLEL WHERE NO CALL IS NEEDED
- T-4.1 Use official call detail/transcript/post-call extraction contract. — DONE DESIGN.
- T-4.2 Extend EXISTING `scripts/openclaw-phone-call.mjs`; do not create a competing runner.
- T-4.3 Keep raw transcript/provider bodies out of public Git and public logs.
- T-4.4 Produce evidence-only structured result; missing = `unknown`.
- T-4.5 Make private result retrievable by ChatGPT from the existing execution path.
Acceptance: completed call returns requested facts, not merely `call completed`.

### T-5 — Permanent natural request -> PHONE TASK ingestion
- T-5.1 Add `phone_call` to existing generic task schema without breaking other task types.
- T-5.2 One task contract: destination, objective, language, caller identity, context, questions, success condition, approvals.
- T-5.3 Reuse existing OpenClaw dispatch/runner path; no extra orchestration layer.
- T-5.4 Validate without making a paid call.
Acceptance: one validated PHONE TASK can represent a normal Sergii calling request.

### T-6 — Full free vertical slice
Prove as much as provider's free demo contract supports:
`SERGII REQUEST -> PHONE TASK/TEST CONTEXT -> UNIVERSAL AGENT -> FREE REAL CALL -> DYNAMIC DIALOG -> VERIFIED RESULT -> SERGII`.
If demo cannot carry arbitrary runtime variables, record that exact provider limitation and do not fake completion.

### T-7 — Paid production decision — LOCKED
Only after free proof. Any paid proposal must state why necessary, all exhausted free alternatives, exact expected cost and hard maximum. Execution requires new Sergii approval.

### T-8 — Practical external call + post-E2E hardening
After self-test acceptance and explicit authorization: one factual external call; then permanent secret storage if needed and cleanup of obsolete experiments/PR scope.

## FORBIDDEN / DEFERRED BEFORE FREE ACCEPTANCE
Twilio/SIP/BYOC/AT&T work; number purchase; wallet spending; new voice provider; frontend/CRM/queue/microservices; multi-provider layer; mass dialing/cold outreach; cosmetic PR cleanup.

## CURRENT CHECKPOINT
- Branch: `feat/openclaw-vendor-phone-calls`.
- PR #39: open/unmerged.
- Current active tasks: T-3, T-4, T-5.
- Next action: inspect existing runner/schema/ingestion against official result contract; make only permanent changes; journal each verified change.

## JOURNAL CONTINUATION

### J-020 — Inventory reconciled
- VERIFIED historical journal + branch + PR + runner/workflow/task template.
- VERIFIED generic schema did not enumerate `phone_call`.
- STATUS: DONE.

### J-021 — Historical spending authority
- Prior authorization existed historically.
- STATUS: HISTORICAL FACT ONLY.

### J-022 — Exact-number investigation
- Historical BYOC/SIP exploration occurred.
- STATUS: SUPERSEDED by current free-first priority.

### J-023 — Connector housekeeping
- Accidental branch `tmp-do-not-use` exists from tool-schema probing; it contains no intentional PHONE AGENT work and is not a source of truth.
- STATUS: NON-BLOCKING.

### J-024 — Latest governance rule
- USER: no financial action without new explicit approval; exhaust free path; failed method must lead to another path; primary sources; permanent tools.
- RESULT: wallet/number-first plan superseded.
- STATUS: DONE.

### J-025 — Official demo contract
- VERIFIED public free demo, 15-minute temporary number, 60-second cap, one destination/day, dashboard custom-agent override, no documented runtime task variables in public request.
- STATUS: DONE.

### J-026 — Official result contract audit started
- STATUS: SUPERSEDED by J-027 completion.

### J-027 — Official result/transcript/extraction contract verified
- PRIMARY SOURCES: Call2Me Calls, API Reference, Post-Call Actions, Webhooks, vCon docs.
- VERIFIED: call detail + transcript endpoints exist; full transcript is available after calls; structured extraction can be configured on agent and is stored on call; webhook can deliver call-ended/transcript references.
- DECISION: extend the existing runner to consume provider evidence rather than build a separate result service.
- STATUS: DONE.

### J-028 — Demo binding and free/paid boundary verified
- PRIMARY SOURCES: Call2Me Demo, API Reference, Phone Numbers, Pricing, Wallet docs.
- VERIFIED: documented custom demo-agent selection is a workspace-admin dashboard setting; official API reference does not document a demo-agent-setting endpoint.
- VERIFIED: public demo is the explicit free phone-call surface; normal PSTN calls use wallet and production caller-number infrastructure.
- DECISION: free conversation proof first; production spend remains locked.
- STATUS: DONE.

### J-029 — Next permanent implementation action
- ACTIVE: inspect and modify only the existing production runner/schema/ingestion so PHONE TASK and provider-derived results are permanent. No call and no spend required for these code steps.
