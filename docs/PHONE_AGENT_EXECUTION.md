# PHONE AGENT — ACTIVE EXECUTION PLAN AND JOURNAL

Status date: 2026-09-03

This file is the ACTIVE execution source of truth from journal entry J-020 onward.
`docs/PHONE_AGENT_STATE.md` remains the historical record for J-001 through J-019.

Authority order:
1. Sergii's latest explicit instruction.
2. This active execution plan.
3. Historical journal/evidence.

## NON-NEGOTIABLE FINANCIAL RULE

FREE-FIRST / ZERO-SPEND until Sergii gives a NEW explicit approval.

- Do not spend wallet balance, including $0.01.
- Do not buy or rent a phone number.
- Do not start a paid call or paid plan.
- Do not enable auto-recharge, subscriptions, recording, paid add-ons, SIP/BYOC/Twilio, porting, or another paid provider.
- Earlier authorization to fund up to $7 and buy one number up to $5 is SUPERSEDED and no longer valid.
- A paid step may be proposed only after all relevant free testing is exhausted and the exact need, free alternatives, and maximum cost are stated to Sergii. Execution still requires new explicit approval.

## PRODUCT GOAL

`SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> CALL2ME -> REAL HUMAN -> DYNAMIC CONVERSATION -> VERIFIED CALL RESULT -> CHATGPT -> SERGII`

The product is the working calling agent. GitHub workflows, scripts, numbers and provider setup are implementation details, not completion criteria.

## VERIFIED INVENTORY

### DONE

1. Provider path selected: Call2Me. Do not switch without a proven provider-level blocker.
2. Call2Me account access/authentication was recovered and a dedicated API key was created historically.
3. Universal agent exists: `agent_f2949915a3f2` / `Sergii Universal Phone Agent`.
4. Live agent configuration was previously verified purpose-first: dynamic opening, AI disclosure, `on behalf of Sergii`, no `Can I help you?`, one question at a time, recording off, voicemail hangup.
5. Real telephony transport is proven: a Call2Me demo call reached Sergii's phone and Sergii confirmed it rang and the AI spoke.
6. Correct E.164 destination formatting with leading `+` was fixed.
7. Production runner exists: `scripts/openclaw-phone-call.mjs`.
8. Production workflow exists: `.github/workflows/openclaw-phone-call.yml`.
9. PHONE TASK example exists: `ops/agent-control/templates/phone-call.example.json`.
10. Production runner contains approval, E.164, path, idempotency/dedupe, no automatic redial, duration, voicemail and sanitized-public-output guards.

### PARTIAL / NOT YET ACCEPTED

1. Dynamic conversation behavior is configured, but NOT verified after the final purpose-first configuration in a complete live call.
2. PHONE TASK exists as a separate phone template/path, but `phone_call` is NOT integrated into the generic `OPENCLAW_TASK_SCHEMA.v1.json` or generic ChatGPT task-ingestion contract.
3. Production runner can pass runtime variables (`objective`, context, questions, success condition), but it requires wallet readiness and an owned production `from_number`. Therefore it is not the free-test path.
4. Result handling currently returns sanitized call metadata and availability flags; it does NOT yet return the factual answers/transcript-derived structured result to ChatGPT.
5. The repository currently has no committed `ops/agent-control/phone-calls/` runtime task directory and no `ops/agent-control/reports/phone_call/` production result directory.

### NOT DONE

1. Verify that the free demo flow is currently bound to `agent_f2949915a3f2` rather than the default demo agent.
2. Prove one free live conversation after the final agent configuration: intro -> purpose -> human answer -> relevant follow-up -> second human answer -> proper end.
3. Prove multiple free conversational cases before paid production.
4. Retrieve private post-call evidence and convert it into evidence-only structured answers.
5. Complete `ChatGPT natural request -> PHONE TASK -> execution` integration for phone calls.
6. Return the verified factual call result automatically to Sergii in ChatGPT.
7. Run one real practical information call only after the conversational path is proven and explicitly authorized.

### DEFERRED / DO NOT WORK ON NOW

- Paid Call2Me number purchase/rental.
- Spending the current wallet balance.
- AT&T number integration or porting.
- Twilio/SIP/BYOC.
- Another voice provider.
- Permanent credential architecture.
- Dashboard/frontend/CRM/queue/microservices.
- PR cleanup of historical Call2Me/Bland/reset/bootstrap probes.

## FREE PATH — VERIFIED PROVIDER CAPABILITY

Call2Me's official demo path uses `POST /v1/demo/call`, a temporary demo number, no card, and a 60-second call limit. It limits calls to one per destination number per day. Call2Me documentation also states that Demo -> Agent can override which agent the demo flow uses.

Repository inspection shows two existing demo workflows already call the official free endpoint. They do NOT themselves select an agent; therefore the next problem is demo-agent binding, not new telephony architecture.

## ORDERED PLAN

### P-00 — FREE-FIRST governance — DONE
Freeze all spending and architecture expansion. Any financial action requires NEW explicit Sergii approval.

### P-01 — Inspect and reuse existing demo path — DONE
Verified existing workflows:
- `.github/workflows/call2me-demo-test.yml`
- `.github/workflows/call2me-demo-selftest.yml`
They POST directly to `/v1/demo/call` and require no wallet/owned number. They currently target Sergii's self-test number and do not select a custom agent in the request.

### P-02 — Bind/verify Universal Agent as the demo agent — ACTIVE
Goal: prove the provider's free demo flow is using `agent_f2949915a3f2`.
Rules:
- Do not create a new phone provider or new calling architecture.
- Prefer an existing provider-supported setting/API/dashboard capability.
- No paid action.
- If the binding requires an unavailable dashboard privilege, reduce it to one minimal user action.
Acceptance: provider-side readback or other direct evidence identifies `agent_f2949915a3f2` as the demo agent.

### P-03 — Free dynamic conversation acceptance test — NEXT AFTER P-02
Use only the free demo endpoint and an explicitly authorized destination eligible under the one-call-per-number/day rule.
Acceptance within the 60-second cap:
1. phone rings;
2. human answers;
3. AI identifies itself;
4. says it calls on behalf of Sergii;
5. states runtime purpose;
6. asks first task question;
7. listens to arbitrary human answer;
8. asks a logically relevant follow-up based on that answer;
9. human replies;
10. agent ends correctly.
No wallet usage and no number purchase.

### P-04 — Free evidence/result inspection
After P-03, inspect what the demo/provider exposes: call id/status/duration/transcript/summary/extraction when available. Never invent unavailable facts. Never commit private transcript/raw conversation to the public repository.

### P-05 — Repeat free conversational proofs
Use additional explicitly authorized eligible destination numbers/days to test materially different task shapes. Continue only within provider free limits. Do not spend wallet balance.

### P-06 — Minimal ChatGPT -> PHONE TASK integration
Only after conversation is proven. Add `phone_call` to the existing task-ingestion contract with the smallest necessary change; do not invent another orchestration layer.

### P-07 — Verified result -> ChatGPT
Consume provider transcript/post-call extraction/vCon if available and return evidence-only structured answers to Sergii. Public Git remains sanitized.

### P-08 — Full free vertical slice
Prove: `Sergii text request -> PHONE TASK -> free live call -> dynamic conversation -> verified result -> Sergii` to the maximum extent supported by the free demo path.

### P-09 — Paid production decision — BLOCKED BY POLICY UNTIL USER APPROVES
Only after P-03 through P-08 are sufficiently proven, present the minimum production cost and alternatives. No spending without a NEW explicit approval.

## FAILURE RULE

Every failure must be classified as CODE / PROVIDER / PRIVILEGE, journaled, and reduce the search space. Do not restart solved password/auth/agent/greeting/security work. Do not create a new integration unless the current proven path cannot perform the next required step.

## NEXT MICROSTEP

P-02 only: determine and verify the Call2Me Demo -> Agent binding for `agent_f2949915a3f2` using provider-supported read-only evidence first. No call, no purchase, no wallet usage.

## JOURNAL CONTINUATION

### J-020 — Full current inventory and financial-policy correction
- VERIFIED: historical journal exists in `docs/PHONE_AGENT_STATE.md` through J-019.
- VERIFIED: branch contains the universal production runner, production workflow, phone-task template, and two existing free-demo workflows.
- VERIFIED: generic OpenClaw task schema currently does not include `phone_call`; phone automation is still a separate path.
- VERIFIED: production runner requires wallet readiness and an owned `from_number`, so it cannot be the free test path.
- VERIFIED: current demo workflows use the free `/v1/demo/call` endpoint but do not select a custom agent themselves.
- USER RULE: all spending is frozen. Earlier $7 funding / <=$5 number authorization is SUPERSEDED. No payment or paid plan without a new explicit Sergii approval.
- RESULT: old wallet/number-first next step is obsolete. Free demo conversational proof is now the active path.
- STATUS: DONE.

### J-021 — Existing free-demo path inspected
- VERIFIED: `call2me-demo-test.yml` validates explicit approval and calls `/v1/demo/call` with only destination/name.
- VERIFIED: `call2me-demo-selftest.yml` also directly calls `/v1/demo/call`.
- VERIFIED: neither workflow binds/selects `agent_f2949915a3f2`; provider-side Demo -> Agent configuration is the remaining gate.
- RESULT: do not build a new calling workflow yet. Resolve only demo-agent binding.
- STATUS: DONE.

### J-022 — Demo-agent binding
- STATUS: ACTIVE.
