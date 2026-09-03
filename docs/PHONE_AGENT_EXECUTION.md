# PHONE AGENT — ACTIVE EXECUTION PLAN AND JOURNAL

Status date: 2026-09-03

Historical journal: `docs/PHONE_AGENT_STATE.md` (J-001 through J-019).
This file is the ACTIVE source of truth from J-020 onward.

## MASTER RULES

### R-01 — Execution loop
For every meaningful step:

`READ JOURNAL -> VERIFY CURRENT STATE -> DO ONE SMALL ACTION -> VERIFY RESULT -> WRITE JOURNAL -> NEXT STEP`

No step is DONE because code exists or HTTP returned 2xx. DONE means its acceptance condition is proved.

### R-02 — No terminal “could not do it”
A failed path is not a task result. Determine the exact cause, classify it as `CODE`, `PROVIDER`, or `BLOCKED_PRIVILEGE`, record it, then use the next technically independent path. Stop only for a genuine provider hard limit or an action that requires Sergii-controlled payment/OTP/privilege unavailable to the current tools.

### R-03 — Primary sources first
For Call2Me behavior, pricing, limits and API contracts use Call2Me official docs/OpenAPI/API responses first. Repository history is evidence of what OUR system already did; it is not a substitute for current provider documentation.

### R-04 — Permanent tools by default
Do not build throwaway pyramids, duplicate workflows, duplicate agents or temporary orchestration when an existing permanent path can be extended. Necessary product changes must live in the existing production runner/workflow/task contract or permanent provider configuration.

### R-05 — FREE FIRST / NO SPEND WITHOUT NEW APPROVAL
Sergii’s latest instruction supersedes prior spending authorization.
- Spend `$0.00` unless Sergii gives a NEW explicit approval after the free path is exhausted.
- Do not consume wallet balance, buy/rent a number, start a paid production call, enable paid plans/add-ons, auto-recharge, recording, SIP/BYOC/Twilio, porting, or another paid provider.
- Before proposing any paid step, state: why it is necessary, what free paths were exhausted, exact expected cost, and a hard maximum.

### R-06 — Product, not infrastructure
The product is:

`SERGII REQUEST -> PHONE TASK -> UNIVERSAL AGENT -> REAL CALL -> HUMAN CONVERSATION -> VERIFIED FACTS -> SERGII`

GitHub, numbers, secrets, workflows and providers are implementation details.

## LARGE TASK

Build one universal outbound calling assistant that can accept a natural-language task from Sergii, place a real call, introduce itself correctly, conduct a dynamic human-like factual conversation, ask follow-ups based on actual answers, stop when the objective is met, and return verified facts with evidence.

## VERIFIED INVENTORY

### DONE
1. Call2Me selected as the single voice provider for the current path.
2. Account access/auth recovery completed historically.
3. Universal agent exists: `agent_f2949915a3f2` — `Sergii Universal Phone Agent`.
4. Final live agent config was verified purpose-first: dynamic opening, AI disclosure, `on behalf of Sergii`, runtime purpose, no inbound-style `Can I help you?`, one question at a time, recording off, voicemail hangup.
5. Real telephony transport is proven: a Call2Me demo call reached Sergii’s real phone and Sergii confirmed ring + AI speech.
6. E.164 leading `+` bug fixed.
7. Permanent production runner exists: `scripts/openclaw-phone-call.mjs`.
8. Permanent production workflow exists: `.github/workflows/openclaw-phone-call.yml`.
9. Phone task template exists: `ops/agent-control/templates/phone-call.example.json`.
10. Runner has approval, E.164/path validation, lock/dedupe/idempotency, no automatic redial, polling, duration/voicemail guards and sanitized public persistence.
11. Runner/workflow security validation was completed. Do not repeat unless the runner changes or new evidence appears.
12. Historical auth/reset/email/signup-credit/agent-creation/greeting/API-key/secret-presence investigations are closed unless new evidence changes state.

### LAST VERIFIED PROVIDER STATE — MUST NOT BE ASSUMED CURRENT
1. Wallet was `$0.00`, `can_proceed=false` at the last provider readback.
2. Production call path reached Call2Me and stopped at HTTP 402 `Insufficient balance`.
3. Owned production number list was empty.
4. Managed-number discovery previously found local numbers requiring payment.
5. Signup `$5` credit was advertised/configured but was not present in the verified wallet ledger at that time.

### PARTIAL
1. Agent is configured for dynamic conversation, but the final configuration has not yet passed a complete live acceptance conversation.
2. Production runner passes objective/context/questions/success condition, but real follow-up based on a human answer is not yet accepted.
3. Call detail/result handling does not yet complete the full verified-facts return path into ChatGPT.
4. `phone_call` remains separate from the generic `OPENCLAW_TASK_SCHEMA.v1.json` ingestion path.
5. PR #39 remains experimental and historically Bland-oriented; cleanup is post-E2E.

### NOT DONE
1. Prove one free live purpose-first conversation after the final agent config.
2. Prove the agent uses an arbitrary human answer to ask a relevant follow-up.
3. Establish a permanent evidence path for transcript/post-call extraction without publishing private conversation data.
4. Integrate `phone_call` into the existing generic task contract/ingestion with the smallest permanent change.
5. Return verified factual answers automatically to Sergii.
6. Prove one practical external factual call after self-test acceptance and explicit authorization.
7. Only after free proof: decide whether any production telephony spend is actually necessary.

## OFFICIAL FREE-PATH FACTS

From Call2Me official Demo documentation:
- `POST /v1/demo/call` is public, no signup/card required.
- Demo number comes from a shared pool and is reserved for 15 minutes.
- One demo call per destination phone number per day.
- Maximum demo call duration is 60 seconds.
- Default route uses Call2Me’s demo agent.
- Workspace admins can change `Demo -> Agent` in the dashboard to use their own agent.
- The documented public demo request contains `phone_number` and `name`; it does not document runtime `objective/questions/dynamic_variables`.

Implication: the free demo path is suitable to prove the voice/agent conversational loop, but it is not yet proven to carry arbitrary runtime PHONE TASK data. Do not pretend otherwise.

## ORDERED PLAN

### T-1 — Governance + complete inventory — DONE
Acceptance: active journal contains rules, verified inventory, open gaps and ordered plan.

### T-2 — Official provider contract audit — ACTIVE
Small steps:
- T-2.1 Verify free demo endpoint, limits and custom-agent capability from Call2Me official docs. — DONE
- T-2.2 Verify official call-result/transcript/post-call extraction mechanisms. — ACTIVE
- T-2.3 Verify whether any documented API exists to set the workspace Demo -> Agent binding, or whether it is dashboard-only. — ACTIVE
- T-2.4 Record exact free-vs-paid boundary; no assumptions from marketing text. — ACTIVE

Acceptance: every provider-dependent next step has an official-source answer or is explicitly marked undocumented/provider-unknown.

### T-3 — Permanent free conversational test path
Goal: make the existing Universal Agent the workspace demo agent and use the public free demo transport.
Small steps:
- T-3.1 Resolve permanent Demo -> Agent binding for `agent_f2949915a3f2` using documented provider capability first.
- T-3.2 Verify binding by provider-side readback or direct observed behavior.
- T-3.3 Place one free eligible self-test call.
- T-3.4 Acceptance conversation within 60 sec: disclosure -> on behalf of Sergii -> purpose -> first question -> arbitrary answer -> relevant follow-up -> second answer -> proper end.
- T-3.5 Record actual call evidence; never publish transcript in Git.

Acceptance: Sergii confirms the agent actually listened and followed up logically.

### T-4 — Permanent verified-result pipeline
Small steps:
- T-4.1 Use official call-detail/transcript/post-call extraction endpoint(s) supported by Call2Me.
- T-4.2 Update the EXISTING `scripts/openclaw-phone-call.mjs`; do not create a competing runner.
- T-4.3 Keep private transcript/raw provider bodies out of the public repository and public logs.
- T-4.4 Produce a sanitized structured result: called/answered/status/duration + requested factual answers + `unknown` for missing facts.
- T-4.5 Make the result retrievable by ChatGPT from the existing execution path.

Acceptance: a completed call produces evidence-derived structured facts, not merely `call completed`.

### T-5 — Permanent natural request -> PHONE TASK ingestion
Small steps:
- T-5.1 Add `phone_call` to the existing generic task schema if this can be done without breaking other OpenClaw task types.
- T-5.2 Define required PHONE TASK fields once: destination, objective, language, caller identity, context, questions, success condition, approval flags.
- T-5.3 Reuse the existing OpenClaw dispatch/runner path; no new orchestration layer unless technically required.
- T-5.4 Validate schema/task creation without making a paid call.

Acceptance: a natural Sergii request can be represented by one validated permanent PHONE TASK consumed by the existing system.

### T-6 — Full free vertical slice
Goal: to the maximum extent the provider’s free demo allows, prove:
`SERGII REQUEST -> PHONE TASK/TEST CONTEXT -> UNIVERSAL AGENT -> FREE REAL CALL -> DYNAMIC CONVERSATION -> VERIFIED RESULT -> SERGII`.

If the public demo API cannot carry runtime task variables, record that exact provider limitation and do not fake completion. Prove all conversation/result capabilities that can be proved for free before discussing production telephony.

### T-7 — Paid production decision — LOCKED
No work that spends money until Sergii gives new explicit authorization. If production telephony is still required after T-3 through T-6, present the minimum permanent option and exact hard cost cap.

### T-8 — Practical external call + post-E2E cleanup
Only after self-test acceptance and explicit authorization: one factual external call. Then permanent secret storage if needed, remove/deprecate obsolete experiments, and clean PR scope.

## DEFERRED / FORBIDDEN BEFORE FREE ACCEPTANCE
- Twilio/SIP/BYOC/AT&T-number work.
- Number purchase/rental.
- Wallet spending.
- New voice provider.
- Dashboard/frontend/CRM/queue/microservices.
- Multi-provider abstraction.
- Mass dialing/cold outreach.
- Cosmetic PR cleanup.

## CURRENT CHECKPOINT
- Active branch: `feat/openclaw-vendor-phone-calls`.
- PR #39: open, unmerged.
- Historical journal: `docs/PHONE_AGENT_STATE.md` through J-019.
- Active journal/plan: this file from J-020 onward.
- Current execution item: `T-2 official provider contract audit`, then `T-3 permanent free conversational test path`.

## JOURNAL CONTINUATION

### J-020 — Full current inventory reconciled
- VERIFIED: historical source of truth defines the original execution loop and production E2E acceptance criteria.
- VERIFIED: branch contains universal runner, workflow, task template, demo workflows, agent config and historical provider experiments.
- VERIFIED: generic task schema does not enumerate `phone_call`.
- VERIFIED: PR #39 is open/unmerged and historically Bland-oriented.
- STATUS: DONE.

### J-021 — Historical spending authority recorded
- Historical journal recorded authorization for Call2Me funding/one number.
- STATUS: HISTORICAL FACT ONLY.

### J-022 — Exact-number investigation
- Historical work explored BYOC/SIP for Sergii’s existing number.
- STATUS: SUPERSEDED BY CURRENT FREE-FIRST PRIORITY.

### J-023 — Connector housekeeping
- An accidental `tmp-do-not-use` branch was created during tool-schema probing. It is not a source of truth and contains no intentional PHONE AGENT work.
- STATUS: NON-BLOCKING HOUSEKEEPING.

### J-024 — Latest user governance supersedes spending path
- USER RULE: no payment, wallet use, paid plan, number purchase, SIP/BYOC/Twilio or other financial step without a NEW explicit approval.
- USER RULE: exhaust and prove the free path first.
- USER RULE: failure of one method means find another method; only genuine provider hard limits or unavailable user privilege may block execution.
- USER RULE: use primary sources and permanent tools; no unnecessary temporary architecture.
- RESULT: prior wallet/number-first plan is superseded. Active work is free conversational proof + permanent task/result plumbing.
- STATUS: DONE.

### J-025 — Official demo contract verified
- PRIMARY SOURCE: Call2Me official Demo docs, updated 2026-05-06.
- VERIFIED: public `POST /v1/demo/call`, shared temporary number, no card/signup, one call per destination per day, 60-second cap.
- VERIFIED: default demo agent is used unless workspace admin overrides `Demo -> Agent` in dashboard.
- VERIFIED: documented demo request only includes destination/name; arbitrary PHONE TASK runtime variables are not documented on this endpoint.
- RESULT: free demo can prove real phone transport and dynamic conversation, but arbitrary runtime-task delivery through demo remains unproved.
- STATUS: DONE.

### J-026 — Next action
- ACTIVE: audit official Call2Me call-result/transcript/extraction contract and documented Demo -> Agent binding surface; then implement only the smallest permanent changes required.
