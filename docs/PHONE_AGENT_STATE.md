# PHONE AGENT STATE

Last updated: 2026-09-03

## WORKING RULE

For every phone-agent step, use this loop and do not skip it:

`PLAN STEP -> VERIFY CURRENT STATE -> DO ONE SMALL ACTION -> VERIFY RESULT -> WRITE JOURNAL ENTRY -> MOVE TO NEXT STEP`

Do not repeat a completed step unless the journal explicitly records new evidence that invalidates it. A failed approach is not task completion: find the next safe approach inside the same plan item until the item is actually complete or an external action is genuinely required.

## CRITICAL COMPLETION POLICY

### 1. Vertical slice first

The immediate objective is:

`CHAT REQUEST -> REAL PHONE CALL -> HUMAN CONVERSATION -> VERIFIED RESULT`

Any work that does not directly enable the next real production call is deferred when the call is otherwise technically possible. Working production path is more important than architectural perfection before the first verified E2E proof.

### 2. Blocker taxonomy

Every blocker must be classified before action:

- `CODE BLOCKER` — our runner, workflow, API request, parser, validation, task-contract or other implementation bug. Fix independently until verified.
- `PROVIDER BLOCKER` — Call2Me balance, number provisioning or provider capability limitation. Prove it with provider evidence and use a provider-supported resolution. Do not redesign our architecture without necessity.
- `BLOCKED_PRIVILEGE` — payment, OTP or privilege that requires user-controlled action and is unavailable to the current tool. Reduce it to one concrete minimum user action and continue everything else that can be automated.

A limitation of one connector or tool is not an architectural blocker for the entire PHONE AGENT.

### 3. No repeated probes

Once capability/state is verified and journaled, do not repeat password reset, email verification, API-key creation, signup-credit claim, secret-presence probes, number discovery, agent creation or greeting configuration unless new evidence shows the state changed.

Every failed path must shrink the search space. It must not restart the investigation.

### 4. New workflow/script gate

Before creating any new workflow, script or integration, answer:

`Why can the existing production path not perform the next required step?`

If there is no proven technical reason, do not create the new workflow/script/integration.

### 5. Provider freeze

Call2Me is the only provider until a genuine provider-level blocker proves that production outbound, caller-number provisioning, two-way AI conversation, required result retrieval, provider availability or economics are unusable.

Architectural imperfection is not a reason to switch to Bland, Twilio, Vapi, Retell, Telnyx or another provider.

### 6. First E2E proof before perfect secret architecture

The already verified RSA-OAEP/SHA-256 one-time encrypted credential path may be used for the first production E2E proof. Permanent production secret storage remains required after the E2E call but must not artificially block the first real call.

### 7. Production gate

Before the next production call verify only what is still open:

1. wallet can pay;
2. account owns a production `from_number`;
3. API key works — already verified unless new evidence invalidates it;
4. live agent exists — already verified unless new evidence invalidates it;
5. purpose-first live configuration — already verified unless new evidence invalidates it.

If only wallet and caller number are missing, work only those gates.

### 8. Real call is the acceptance test

HTTP 200/201 is not success. Green CI is not success. Agent configuration read-back is not success.

Success requires:

`TASK ACCEPTED -> CALL CREATED -> PHONE RINGS -> HUMAN ANSWERS -> AI IDENTIFIES ITSELF -> SAYS IT IS CALLING ON BEHALF OF SERGII -> STATES THE RUNTIME PURPOSE -> LISTENS -> UNDERSTANDS THE RESPONSE -> ASKS A RELEVANT FOLLOW-UP -> ENDS CORRECTLY -> TERMINAL CALL STATUS RETRIEVED -> VERIFIED RESULT RETURNED TO CHAT`

Only then may the PHONE AGENT MVP be considered working, and Sergii's confirmation of the live conversation remains part of final acceptance.

### 9. Purpose-first dynamic speech

Outbound agent must never open with `Can I help you?` or `How can I help you?`.

The opening is built from runtime task data, logically equivalent to:

`Hi, this is an AI phone assistant calling on behalf of Sergii. I'm calling because [OBJECTIVE]. [FIRST QUESTION].`

It must not be one hard-coded vendor script. `objective`, `caller_context`, `questions` and `success_condition` come from the PHONE TASK.

### 10. Dynamic conversation, not script recital

After the first question the agent must use the actual human response: determine whether the question was answered, ask a relevant clarification, avoid repeating information already obtained, request spelling/part number/price/date when precision matters, advance one question at a time, and stop when `success_condition` is met or cannot be met.

### 11. Raw evidence plus structured result

For a production call retrieve when provider-supported:

- `call_id`;
- final status;
- answered state;
- duration;
- provider transcript/raw conversation data;
- structured extracted answers;
- provider summary;
- cost.

Structured answers must be derived from actual transcript/provider data, never invented. Missing information is `unknown`.

Because the repository is public, transcript/raw conversation data, recording URLs, provider analysis, raw provider bodies and secrets must never be persisted in Git. Private conversational evidence may be retrieved only for Sergii's private ChatGPT result.

### 12. Call safety and cost guard

Every phone task requires a unique task ID and idempotency. Permit one dial `POST`; do not automatically repeat outbound `POST /calls` after an unknown result. GET/poll retries are allowed. Enforce maximum duration, terminal/stop conditions, no-answer/busy/voicemail handling, API timeout handling and a bounded spend guard. Recording remains off unless separately authorized.

### 13. Pre-E2E scope freeze

Before the first successful production E2E call, do not build dashboards, frontend, CRM UI, queue systems, microservices, multi-provider abstraction, DeepSeek integration, advanced analytics, elaborate schemas, mass dialing, automatic cold outreach or elaborate deployment architecture.

### 14. PR hygiene after E2E

PR #39 is experimental evidence, not the final production architecture merely because CI is green. After successful E2E, separate the proven production core — universal runner, production entry point, task schema, live-agent configuration, required docs and minimal security/idempotency — from historical reset/probe/Bland/bootstrap/discarded-provider experiments before final merge.

### 15. Journal is source of truth

After each completed micro-step: `VERIFY -> ACTION -> VERIFY RESULT -> JOURNAL`.

Use statuses: `DONE`, `ACTIVE`, `BLOCKED_PROVIDER`, `BLOCKED_PRIVILEGE`, `FAILED_PATH / DO NOT RETRY`, `SUPERSEDED`.

Before each action re-read this file. Never repeat `DONE`, represent `ACTIVE` as `DONE`, or treat an HTTP-level success as business-level success.

### 16. Failure handling

`Did not work` does not finish a task. Determine the exact cause, prove it with log/API/provider evidence, journal the failed path, choose a technically independent next path, execute and verify it. Stop only for a genuine external decision, payment, OTP or privilege unavailable to the tools; in that case reduce the request to one minimum user action.

### 17. Today's criterion

Today does not require a years-long platform. The target is a verified vertical slice:

`USER TEXT REQUEST -> PHONE TASK -> EXISTING OPENCLAW ENTRY -> CALL2ME -> REAL PRODUCTION CALL -> TWO-WAY CONVERSATION -> RESULT -> EVIDENCE`

Only after that: permanent credential integration and PR cleanup.

## PLAN

1. Validate the current Call2Me/OpenClaw phone runner and workflow. — DONE
2. Fix and verify the universal agent purpose-first opening. — DONE
3. Establish usable Call2Me authentication without plaintext credentials in Git history/logs. — DONE FOR CURRENT SESSION
4. Resolve usable wallet balance. — BLOCKED_PRIVILEGE: payment completion
5. Obtain or bind one production caller number (`from_number`). — ACTIVE IMMEDIATELY AFTER WALLET
6. Run the authorized self-test to `+12133611700`.
7. Verify ring -> answer -> purpose-first intro -> two-way conversation -> follow-up -> call completion -> result retrieval.
8. Only after that, perform one safe practical information call to an external business/manager.
9. After E2E proof, implement permanent credential storage and clean production core from historical experiments before merge.

## CURRENT CHECKPOINT

- Provider: Call2Me. Provider is frozen until a genuine provider-level blocker is proved.
- Account email: `2133611700c@gmail.com`.
- Universal agent: `agent_f2949915a3f2` (`Sergii Universal Phone Agent`).
- Account access was recovered and verified on 2026-09-03.
- Live agent is production purpose-first verified: `begin_message_mode=dynamic`, AI disclosure present, `on behalf of Sergii` present, runtime purpose-first present, inbound-style `Can I help you?` blocked, one-question-at-a-time present, recording disabled, voicemail action `hangup`.
- Correct outbound destination format is E.164 with leading `+`.
- Demo calling has already reached Sergii's real phone; Sergii confirmed the phone rang and the AI spoke.
- Production `/v1/calls` reached Call2Me and returned HTTP 402 `Insufficient balance`.
- Wallet evidence: balance `$0.00`, `can_proceed=false`, minimum `$0.01`, configured signup bonus `$5.00`, transactions `0`, total top-up `$0.00`, total usage `$0.00`.
- Call2Me confirmed the account email is already verified. The signup-credit verification/claim was also retried and the wallet still remained `$0.00`; do not repeat that claim unless provider state changes.
- Support request for the missing $5 signup credit was sent on 2026-09-03; latest support check found no reply.
- Dedicated Call2Me API key exists: key id `key_6ab5960f19cb52ed`, expiration `2027-03-02T18:37:47Z`. The key value is not stored in Git.
- GitHub Actions persistent secrets are absent: `CALL2ME_API_KEY=false`, `OPENCLAW_CONTROL_SHARED_SECRET=false`, `OPENCLAW_GITHUB_TOKEN=false`.
- This absence is not a blocker for the current E2E proof: the dedicated Call2Me key was successfully reused through the existing RSA-encrypted one-time payload workflow; consumed ciphertext is removed after use.
- `/v1/phone-numbers` returned HTTP 200 with an empty owned-number list.
- Read-only LA number search succeeded. Observed candidates had `upfront_price_usd=5.0`, `monthly_price_usd=5.0`, and `requires_payment=true`.
- Official Call2Me docs confirm number billing is wallet-backed and production outbound needs a provisioned/owned or BYOC/SIP caller number.
- Current public pricing page shows standard voice at about `$0.20/min` plus `$0.05/min` PSTN telephony; a 5-minute test therefore needs up to about `$1.25` usage credit. With the verified `$5` upfront number charge, a `$6.25` wallet budget covers one maximum-length self-test; `$7` is the practical target top-up amount if the provider accepts that amount.
- Call2Me wallet top-up is provider/payment-system controlled. The current provider path requires payment completion through a user-controlled payment method/Paddle when no already-authorized payment method token is available to the API execution path; do not request or expose card credentials.
- Sergii explicitly authorized Call2Me wallet funding up to `$7` and purchase of exactly one production number with an upfront charge not exceeding `$5`. Recording remains disabled and no other purchase is authorized.
- Demo-number bypass was checked: one demo call per destination number per day, 60-second cap. Sergii's number already received today's demo call, so demo cannot provide a second purpose-first self-test today.
- MVP runner: `scripts/openclaw-phone-call.mjs`.
- MVP workflow: `.github/workflows/openclaw-phone-call.yml`.
- Task template: `ops/agent-control/templates/phone-call.example.json`.
- Runtime phone task folder: `ops/agent-control/phone-calls/*.json`.
- Hardened runner head: `c221546829699ec48e1f1ba09d3bacf559dd97c2`.
- The runner has not changed since the completed P-04 security validation; do not repeat the security review unless the runner changes or new evidence appears.

## CURRENT BLOCKERS

1. **BLOCKED_PRIVILEGE — Call2Me wallet payment completion** — spending authorization up to `$7` is already granted, but the provider still needs a usable payment-method/Paddle completion if no existing payment method is available to the secure execution path. This is not a Node runner defect and is not a reason to change provider or architecture.
2. **ACTIVE AFTER WALLET — one production caller number** — owned-number list is empty. After usable balance exists, refresh inventory immediately before purchase, buy exactly one local US number with upfront price `<= $5`, verify ownership/binding to `agent_f2949915a3f2`, then proceed directly to P-07.

## CLOSED ITEMS — DO NOT REPEAT

- Password reset/account recovery.
- Email verification.
- Signup-credit claim retry.
- Universal agent creation.
- Production greeting cleanup/read-back.
- Dedicated Call2Me API-key creation.
- E.164 leading-plus fix.
- Runner/workflow validation.
- GitHub Actions secret-presence audit.
- Read-only LA number discovery, except immediately before the already-authorized purchase.
- Old CodeQL findings against superseded versions of `scripts/openclaw-phone-call.mjs`.
- Demo-number bypass for a second call to Sergii today.
- Provider comparison/switching unless Call2Me is proved technically or economically unusable for the production E2E path.

## JOURNAL — 2026-09-03

### J-001 — Inventory completed
- VERIFIED: repo `2133611700c-sudo/opencloud-gpt-agent`, branch `feat/openclaw-vendor-phone-calls`, PR #39, existing OpenClaw runner, Call2Me/Bland experiments.
- RESULT: Call2Me selected as the shortest proven path because a real demo call already reached Sergii's phone.
- STATUS: DONE.

### J-002 — Production Call2Me auth recovered
- VERIFIED: password reset HTTP 200, login HTTP 200, universal agent creation HTTP 201, later agent lookup HTTP 200.
- STATUS: DONE.

### J-003 — Destination-number bug fixed
- ACTION: corrected E.164 handling to preserve `+12133611700`.
- VERIFIED: subsequent request reached the wallet gate instead of number validation.
- STATUS: DONE.

### J-004 — Wallet audited
- VERIFIED: balance `$0.00`; minimum `$0.01`; configured signup bonus `$5.00`; transactions `0`; top-up `$0.00`; usage `$0.00`; account already verified.
- STATUS: DONE.

### J-005 — Support escalation sent
- ACTION: email sent to `support@call2me.app` with wallet/account facts and no credentials.
- STATUS: DONE / EXTERNAL WAIT.

### J-006 — Universal OpenClaw phone runner added
- ACTION: added runner, workflow and task template.
- VERIFIED DESIGN: E.164 validation, explicit approval, wallet/agent/caller checks, task-id dedupe, no automatic retry of dial POST, safe polling, sanitized public report.
- STATUS: DONE.

### J-007 — Process error identified
- ERROR: password-reset work was repeated after auth recovery.
- CORRECTION: closed-item checks are mandatory before each action.
- STATUS: CORRECTED.

### J-008 — Unnecessary fresh reset closed
- STATUS: CLOSED.

### J-009 — P-01 runner/workflow validation
- VERIFIED: workflow syntax/regressions passed after fixing unrelated SC2034.
- STATUS: DONE.

### J-010 — Historical failed finalize classified
- VERIFIED: old finalize run failed HTTP 401 and was superseded.
- STATUS: CLOSED / SUPERSEDED.

### J-011 — P-02 live purpose-first agent verified
- VERIFIED: `Call2Me Live Agent Config` run `33794652077` succeeded with production-purpose-first read-back assertions.
- STATUS: DONE.

### J-012 — Dedicated API key / readiness artifact reconciled
- VERIFIED: key `key_6ab5960f19cb52ed` exists until `2027-03-02T18:37:47Z`; wallet $0; owned numbers empty.
- STATUS: DONE.

### J-013 — Signup-credit claim conclusively checked
- VERIFIED: verify-email already verified; wallet remained $0.
- RESULT: do not repeat claim unless provider state changes.
- STATUS: DONE / PROVIDER PROVISIONING ISSUE.

### J-014 — Caller-number discovery completed
- VERIFIED: multiple 213-area candidates at `$5.00` upfront / `$5.00/month` at discovery time.
- STATUS: DISCOVERY DONE / PURCHASE NOT AUTHORIZED AT THAT TIME.

### J-015 — P-03 credential execution path verified
- VERIFIED: persistent GitHub secrets absent; dedicated key can be passed securely by one-time RSA-OAEP/SHA-256 payload and used successfully.
- STATUS: DONE FOR CURRENT SESSION.

### J-016 — P-04 hardened runner security validation
- VERIFIED hardened commit `c221546829699ec48e1f1ba09d3bacf559dd97c2`.
- VERIFIED Workflow Self Validation run `33795557371` = SUCCESS.
- VERIFIED OpenClaw PR Validation run `33795557050` = SUCCESS.
- VERIFIED CodeQL run `33795557092`, job `100782274434`, including Analyze = SUCCESS.
- VERIFIED all four CodeQL threads targeting the old `scripts/openclaw-phone-call.mjs` version are resolved/outdated.
- STATUS: DONE.

### J-017 — P-05 external financial gate quantified
- VERIFIED: Call2Me support has not replied yet.
- ACTION: wallet was not re-queried because no new provider-side state existed; verification/claim/reset were not repeated.
- VERIFIED: demo docs allow one call per destination number per day and max 60 seconds; Sergii's number already used today's demo path.
- VERIFIED artifact: candidate local numbers require payment and report `$5.00` upfront / `$5.00` monthly.
- VERIFIED current public pricing: about `$0.20/min` voice + `$0.05/min` PSTN telephony; recording is disabled on our agent.
- CALCULATED: maximum configured 5-minute self-test usage is about `$1.25`; number + full self-test budget is about `$6.25`; practical requested wallet funding target is `$7` if accepted by the payment provider.
- VERIFIED: current wallet docs expose wallet funding and number-purchase paths, but payment completion remains provider/payment-system controlled.
- RESULT: all remaining non-financial blockers before self-test are closed.
- STATUS: DONE / BLOCKED_PRIVILEGE UNTIL PAYMENT COMPLETION.

### J-018 — Current-state recheck before payment gate
- PLAN: Reconcile the new chat prompt against the live journal without repeating closed work.
- VERIFIED BEFORE: journal already marked P-04 DONE and P-05 at an external financial gate.
- ACTION: verified branch state and searched Gmail for any new Call2Me support response.
- VERIFIED AFTER: path-scoped commit history confirms `c221546829699ec48e1f1ba09d3bacf559dd97c2` remains the latest commit touching `scripts/openclaw-phone-call.mjs`; newer commits only changed/removed one-shot Call2Me helper workflows. No inbound support response was found from `support@call2me.app`, and a broader recent `Call2Me` mail search also found no support reply.
- RESULT: P-04 remains DONE; the remaining production gates are wallet payment completion and one caller number.
- STATUS: DONE.

### J-019 — Completion policy and blocker taxonomy locked
- PLAN: Make the vertical production proof the sole immediate priority and prevent architecture/probe work from displacing the final production call.
- VERIFIED BEFORE: runner/security/API-key/live-agent/purpose-first configuration are already verified; only wallet and caller-number gates remain before P-07.
- ACTION: added vertical-slice-first policy, blocker taxonomy, no-repeat/no-new-workflow rules, Call2Me provider freeze, safe one-time credential allowance for the first proof, real-call acceptance criteria, dynamic-conversation requirements, raw-evidence/structured-result rules, safety/cost guards and post-E2E PR hygiene.
- VERIFIED AFTER: these rules are now part of the source-of-truth file. Sergii's explicit authorization permits Call2Me wallet funding up to `$7` and exactly one production caller-number purchase with upfront price not exceeding `$5`; recording remains disabled and no other purchase is authorized.
- RESULT: P-04 remains closed. Wallet funding is `BLOCKED_PRIVILEGE` only if the provider requires user-controlled payment/Paddle completion; caller-number purchase becomes active immediately after wallet funding.
- STATUS: DONE.

## NEXT MICRO STEP

**P-05 PAYMENT COMPLETION:** Use the provider-supported Call2Me wallet funding path under the already granted `$7` cap. Do not request or expose card details. If the available tools cannot complete Paddle/payment using an already-authorized payment method, the only required user action is to complete a `$7` Call2Me Wallet -> Add Funds checkout; do not buy a number manually. Immediately after usable wallet is verified, refresh local-number inventory, purchase exactly one number with upfront price `<= $5`, bind/verify it for `agent_f2949915a3f2`, and proceed directly to the authorized P-07 self-test to `+12133611700` without adding new architecture.

## PHONE CALL TASK CONTRACT

```json
{
  "id": "phone-call-unique-id",
  "type": "phone_call",
  "status": "pending",
  "requested_by": "Sergii",
  "goal": "Obtain or communicate factual information by phone.",
  "params": {
    "phone_number": "+1XXXXXXXXXX",
    "objective": "What must be learned or communicated",
    "language": "en",
    "caller_name": "Sergii's AI phone assistant",
    "on_behalf_of": "Sergii",
    "caller_context": "Relevant factual background",
    "questions": ["Question 1", "Question 2"],
    "success_condition": "What counts as enough information"
  },
  "safety": {
    "explicit_approval": true,
    "purchase_authorized": false,
    "payment_authorized": false,
    "reservation_authorized": false,
    "recording_authorized": false
  }
}
```

## TARGET OUTBOUND BEHAVIOR

At the beginning of every outbound call the agent must immediately communicate three things: it is an AI phone assistant; it is calling on behalf of Sergii; and the concrete purpose of this call. It must not start with `Can I help you?` or `How can I help you?`. Then it asks one question at a time, listens, adapts follow-ups to the actual answer, asks for clarification when critical details are ambiguous, and ends when the success condition is met or cannot be met.

## DEFINITION OF DONE

`CHAT REQUEST -> PHONE TASK -> OPENCLAW PHONE WORKFLOW -> CALL2ME -> PHONE RINGS -> HUMAN ANSWERS -> PURPOSE-FIRST INTRO -> TWO-WAY CONVERSATION -> RELEVANT FOLLOW-UP -> CALL ENDS -> RESULT POLLED -> PRIVATE TRANSCRIPT/RAW EVIDENCE RETRIEVED IF AVAILABLE -> STRUCTURED RESULT RETURNED -> SERGII CONFIRMS CALL QUALITY`

A provider HTTP 200/201, green CI or configuration read-back by itself is not considered success.
