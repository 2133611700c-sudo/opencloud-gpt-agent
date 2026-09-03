# PHONE AGENT — ACTIVE EXECUTION PLAN AND JOURNAL

Status date: 2026-09-03

This file is the ACTIVE execution source of truth from journal entry J-020 onward.
`docs/PHONE_AGENT_STATE.md` remains the historical record for J-001 through J-019.

Working loop for every step:

`PLAN STEP -> VERIFY CURRENT STATE -> DO ONE SMALL ACTION -> VERIFY RESULT -> WRITE JOURNAL ENTRY -> MOVE TO NEXT STEP`

Authority order:
1. Sergii's latest explicit instruction.
2. This active execution plan.
3. Historical journal/evidence in `docs/PHONE_AGENT_STATE.md`.

## PRODUCT GOAL

`SERGII REQUEST -> PHONE TASK -> EXISTING OPENCLAW ENTRY -> CALL2ME -> REAL PHONE CALL -> HUMAN ANSWERS -> PURPOSE-FIRST AI -> DYNAMIC TWO-WAY CONVERSATION -> VERIFIED RESULT -> CHATGPT -> SERGII`

The product is the working calling agent. GitHub workflows, scripts, numbers and provider setup are implementation details, not completion criteria.

## CURRENT FINANCIAL / NUMBER AUTHORITY

- Historical journal records Sergii's explicit authorization to top up Call2Me up to `$7` and purchase exactly one production caller number with upfront price `<= $5`.
- Recording remains disabled and no other purchase is authorized.
- No evidence has superseded that authorization.
- HOWEVER, Sergii's latest caller-ID preference is to use his existing real number if this can be done legitimately and without disrupting current service.
- Therefore do NOT buy a fallback Call2Me managed number until the exact-existing-number route is resolved or Sergii explicitly chooses the fallback.
- Do not port the existing number, open a new external carrier account, enable SIP/BYOC, or change its current voice/SMS service without separate explicit authorization.

## VERIFIED INVENTORY

### DONE

1. Provider selected and frozen: Call2Me unless a genuine provider-level blocker is proved.
2. Call2Me account access/authentication recovered historically.
3. Dedicated Call2Me API key exists historically; its value is not stored in public Git.
4. Universal live agent exists: `agent_f2949915a3f2` / `Sergii Universal Phone Agent`.
5. Final live agent configuration was verified purpose-first: dynamic opening, AI disclosure, `on behalf of Sergii`, runtime purpose, no inbound-style `Can I help you?`, one question at a time, recording off, voicemail hangup.
6. Real telephony transport was proven: Call2Me demo call reached Sergii and Sergii confirmed ring + AI speech.
7. Correct E.164 destination handling with leading `+` was fixed.
8. Production runner exists: `scripts/openclaw-phone-call.mjs`.
9. Production workflow exists: `.github/workflows/openclaw-phone-call.yml`.
10. Phone task template exists: `ops/agent-control/templates/phone-call.example.json`.
11. Production runner has explicit approval, E.164/path validation, task locking, provider dedupe by task id, no automatic re-dial after unknown result, polling, duration/voicemail handling and sanitized public persistence.
12. Runner/workflow security validation was completed; do not repeat unless runner changes or new evidence appears.
13. Historical password-reset, email-verification, signup-credit, agent-creation, greeting-cleanup, API-key-creation, secret-presence and demo-bypass investigations are closed and must not be repeated without new evidence.

### LAST VERIFIED PROVIDER STATE — NOT ASSUMED TO BE CURRENT WITHOUT NEW READBACK

1. Wallet last verified at `$0.00`, `can_proceed=false`.
2. Production `/v1/calls` reached Call2Me and stopped at HTTP 402 `Insufficient balance`.
3. Owned production phone numbers last verified as empty.
4. Read-only managed-number discovery previously found local 213 candidates at `$5` upfront / `$5` monthly at that time.
5. No newer provider-side wallet/number readback has yet been journaled.

### PARTIAL / NOT YET ACCEPTED

1. Dynamic conversational behavior is configured but NOT yet accepted in a complete purpose-first production conversation after final configuration.
2. Production runner passes runtime `objective`, context, questions and success condition, but the final human conversation has not yet proved that the agent reliably uses real answers for follow-up.
3. Result persistence currently records sanitized metadata/availability flags. It does not yet complete the user-facing evidence path of factual answers derived from transcript/provider data back into ChatGPT.
4. `phone_call` remains a separate phone-task path and is not integrated into the generic `OPENCLAW_TASK_SCHEMA.v1.json` / generic ChatGPT ingestion contract.
5. PR #39 is still experimental and historically Bland-oriented in title/body; cleanup is deferred until the Call2Me E2E path is proven.

### NOT DONE

1. Decide/verify the production caller identity route:
   - preferred: Sergii's existing real number through legitimate BYOC/SIP if current carrier/product supports it without disruptive porting;
   - fallback: one Call2Me managed number under the existing spending cap.
2. Identify the current carrier/product/SIP capability for Sergii's existing number. Current carrier is not yet verified.
3. Obtain a production-usable `from_number` by one of the above legitimate routes.
4. Obtain a usable wallet balance if the selected production route requires Call2Me wallet funding; last verified balance is still `$0`.
5. Run the real production self-test.
6. Prove ring -> answer -> AI disclosure -> on behalf of Sergii -> runtime purpose -> listens -> relevant follow-up -> second human response -> proper end.
7. Retrieve terminal provider result with `call_id`, status, duration and private transcript/summary/extraction when available.
8. Convert actual call evidence into structured factual result; missing data must be `unknown`.
9. Return that verified result automatically to Sergii in ChatGPT.
10. Run one safe practical external-business information call after self-test acceptance.
11. After E2E: permanent credential integration and PR cleanup/minimal production core.

## NUMBER STRATEGY — CURRENT ACTIVE DECISION

Official Call2Me documentation supports Bring Your Own Carrier (BYOC) using a SIP trunk: a number that already lives at a SIP-capable carrier can be bound to a Call2Me agent, and outbound calls can use that bound number as `from_number`.

This does NOT authorize arbitrary caller-ID spoofing. The number must be under legitimate control through a SIP carrier/trunk.

Current unknown: whether Sergii's existing carrier/product exposes SIP trunking for the existing number without porting or disrupting current voice/SMS. This must be proved before choosing BYOC.

If direct non-disruptive SIP/BYOC is unavailable, do not port automatically. Present that fact and use the already-authorized managed-number fallback only after the exact-number preference is resolved.

## ORDERED PLAN

### P-00 — Governance and journal — DONE
Use the loop in this file. Never repeat closed work. Classify failures as CODE / PROVIDER / BLOCKED_PRIVILEGE. Journal every meaningful microstep.

### P-01 — Full current inventory — DONE
Reconciled historical journal, branch contents, production runner/workflow/task template, generic task schema and PR state.

### P-02 — Universal agent / purpose-first behavior — DONE
Already verified live. No more greeting/config work unless new evidence invalidates it.

### P-03 — Production runner / security / idempotency — DONE
Already verified. No new calling architecture unless the existing production path is proved incapable of the next required step.

### P-04 — Authentication path — DONE FOR FIRST E2E
Dedicated key exists historically and one-time RSA-OAEP/SHA-256 credential execution was already proved. Permanent secret storage is post-E2E hardening.

### P-05 — Production caller identity — ACTIVE
Goal: resolve the preferred exact-number route first.

Substeps:
1. identify current carrier/product for Sergii's existing number;
2. verify whether that exact carrier/product provides SIP trunk/BYOC control for the number without porting;
3. if yes and non-disruptive, define the minimal legitimate Call2Me binding path and obtain any additional explicit authorization required before configuration;
4. if no, record `PROVIDER/CARRIER LIMITATION` and present the managed Call2Me number fallback;
5. no number purchase while exact-number preference remains unresolved.

Acceptance: a legitimate production `from_number` route is selected and verified.

### P-06 — Wallet readiness — BLOCKED_PRIVILEGE IF STILL `$0`
After caller-number route is known, read provider wallet once. If still insufficient and no provider-side free credit is available, complete only the minimum payment action already within Sergii's existing `$7` authorization. Never expose card credentials. If payment UI/OTP is user-controlled, reduce to one concrete user action.

Acceptance: provider readback says wallet can proceed for the bounded self-test.

### P-07 — Real production self-test — NEXT AFTER P-05/P-06
Destination: Sergii's approved self-test number.
Acceptance:
1. task accepted;
2. exactly one dial POST;
3. call created;
4. phone rings;
5. Sergii answers;
6. AI identifies itself;
7. says it calls on behalf of Sergii;
8. states runtime purpose;
9. asks first task question;
10. listens to Sergii's actual answer;
11. asks a logically relevant follow-up based on that answer;
12. Sergii replies;
13. agent ends correctly;
14. terminal provider state retrieved;
15. `call_id` / status / duration verified;
16. private transcript/summary/extraction retrieved if provider exposes them;
17. evidence-only result returned to Sergii;
18. Sergii confirms conversation quality.

Only then is the PHONE AGENT MVP considered working.

### P-08 — Practical business information call
One safe factual information call after P-07: availability/price/hours/status/documents/responsible contact. No purchase/payment/reservation unless separately authorized.

### P-09 — ChatGPT natural request -> PHONE TASK -> verified result
Integrate `phone_call` into the existing generic task ingestion with the smallest necessary change, and complete result return to ChatGPT. No new orchestration layer unless existing entry is technically insufficient.

### P-10 — Post-E2E hardening and cleanup
Permanent credential storage, remove/deprecate obsolete Bland/reset/bootstrap/probe paths from production core, correct PR #39 scope/title/body or create a clean production PR if necessary, then merge only the proven minimal core.

## DEFERRED / DO NOT WORK ON BEFORE P-07

- Dashboard/frontend/CRM/queue/microservices.
- Multi-provider abstraction.
- DeepSeek/analytics/elaborate database.
- Mass dialing or cold outreach automation.
- Porting Sergii's existing number.
- New external SIP/Twilio/Telnyx account.
- PR cleanup merely for aesthetics.

## CURRENT CHECKPOINT

- Branch: `feat/openclaw-vendor-phone-calls`.
- Historical journal: `docs/PHONE_AGENT_STATE.md` through J-019.
- Active plan/journal: this file from J-020 onward.
- PR #39 is open and not merged.
- Current active technical question: legitimate caller identity / exact existing number feasibility.
- Current product acceptance remains the real production E2E call, not CI/configuration.

## JOURNAL CONTINUATION

### J-020 — Full current inventory reconciled
- VERIFIED: historical source of truth exists in `docs/PHONE_AGENT_STATE.md` and defines the working loop, blocker taxonomy, provider freeze and production E2E acceptance criteria.
- VERIFIED: branch contains `scripts/openclaw-phone-call.mjs`, `.github/workflows/openclaw-phone-call.yml`, `ops/agent-control/templates/phone-call.example.json`, two historical demo workflows, universal agent configuration workflow and prior Call2Me experiments.
- VERIFIED: generic `OPENCLAW_TASK_SCHEMA.v1.json` does not currently enumerate `phone_call`; phone calling remains a separate path.
- VERIFIED: production runner requires a usable wallet and legitimate owned/bound `from_number`.
- VERIFIED: PR #39 remains open, unmerged and still carries historical Bland-oriented title/body.
- RESULT: no new architecture is justified. Continue from open production gates only.
- STATUS: DONE.

### J-021 — Financial authority corrected
- VERIFIED FROM HISTORICAL JOURNAL: Sergii authorized up to `$7` Call2Me funding and exactly one production number with upfront cost `<= $5`; recording off; no other purchase authorized.
- CORRECTION: no later evidence in the journal supersedes that authorization.
- RESULT: do not invent a zero-spend rule. Spending still must stay strictly within the existing scope and only when needed for the selected production path.
- STATUS: DONE.

### J-022 — Existing-number preference becomes caller-ID gate
- USER PREFERENCE: use Sergii's existing real number if legitimately possible.
- VERIFIED PROVIDER CAPABILITY: Call2Me supports BYOC through a SIP trunk and allows outbound `from_number` on a number bound to that trunk.
- UNKNOWN: Sergii's current carrier/product and whether it exposes SIP trunk control for this exact number without porting/disrupting service.
- SAFETY: no spoofing, no automatic port, no new external carrier account without separate explicit authorization.
- RESULT: managed-number purchase is paused until this exact-number route is resolved.
- STATUS: ACTIVE.

### J-023 — Connector-side housekeeping note
- During inventory tooling, an extra branch named `tmp-do-not-use` was accidentally created while probing branch-operation schema.
- It contains no intentional PHONE AGENT work and must not be used as a source of truth.
- The active branch remains `feat/openclaw-vendor-phone-calls`.
- STATUS: NON-BLOCKING HOUSEKEEPING.