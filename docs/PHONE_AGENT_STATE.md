# PHONE AGENT STATE

Last updated: 2026-09-03

## WORKING RULE

For every phone-agent step, use this loop and do not skip it:

`PLAN STEP -> VERIFY CURRENT STATE -> DO ONE SMALL ACTION -> VERIFY RESULT -> WRITE JOURNAL ENTRY -> MOVE TO NEXT STEP`

Do not repeat a completed step unless the journal explicitly records new evidence that invalidates it. A failed approach is not task completion: find the next safe approach inside the same plan item until the item is actually complete or an external action is genuinely required.

## PLAN

1. Validate the current Call2Me/OpenClaw phone runner and workflow. — DONE
2. Fix and verify the universal agent purpose-first opening. — DONE
3. Establish usable Call2Me authentication without plaintext credentials in Git history/logs. — DONE FOR CURRENT SESSION
4. Resolve usable wallet balance. — EXTERNAL FINANCIAL GATE
5. Obtain or bind one production caller number (`from_number`). — EXTERNAL FINANCIAL GATE
6. Run the authorized self-test to `+12133611700`.
7. Verify ring -> answer -> purpose-first intro -> two-way conversation -> follow-up -> call completion -> result retrieval.
8. Only after that, perform one safe practical information call to an external business/manager.

## CURRENT CHECKPOINT

- Provider: Call2Me.
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
- This absence is not a blocker for the current session: the dedicated Call2Me key was successfully reused through the existing RSA-encrypted one-time payload workflow; consumed ciphertext is removed after use.
- `/v1/phone-numbers` returned HTTP 200 with an empty owned-number list.
- Read-only LA number search succeeded. Observed candidates had `upfront_price_usd=5.0`, `monthly_price_usd=5.0`, and `requires_payment=true`.
- Official Call2Me docs confirm number billing is wallet-backed and production outbound needs a provisioned/owned or BYOC/SIP caller number.
- Current public pricing page shows standard voice at about `$0.20/min` plus `$0.05/min` PSTN telephony; a 5-minute test therefore needs up to about `$1.25` usage credit. With the verified `$5` upfront number charge, a `$6.25` wallet budget covers one maximum-length self-test; `$7` is the practical target top-up amount if the provider accepts that amount.
- Official current wallet docs expose `POST /v1/wallet/topup` with `{"amount_usd": ...}` to initiate a top-up; no payment is executed without explicit authorization.
- Demo-number bypass was checked: one demo call per destination number per day, 60-second cap. Sergii's number already received today's demo call, so demo cannot provide a second purpose-first self-test today.
- MVP runner: `scripts/openclaw-phone-call.mjs`.
- MVP workflow: `.github/workflows/openclaw-phone-call.yml`.
- Task template: `ops/agent-control/templates/phone-call.example.json`.
- Runtime phone task folder: `ops/agent-control/phone-calls/*.json`.
- Hardened runner head: `c221546829699ec48e1f1ba09d3bacf559dd97c2`.
- Current branch head verified at `4e1506160f74cfca0701af861716fdff640bb38a`; commit history scoped to `scripts/openclaw-phone-call.mjs` confirms `c221546829699ec48e1f1ba09d3bacf559dd97c2` is still the latest commit touching the runner.

## CURRENT BLOCKERS

1. **Wallet funding authorization / payment completion** — wallet is `$0.00`; Call2Me production calls return HTTP 402.
2. **Production caller-number purchase authorization** — owned-number list is empty; observed local numbers require `$5` upfront and `$5/month` renewal.

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
- Read-only LA number discovery, except immediately before an authorized purchase.
- Old CodeQL findings against superseded versions of `scripts/openclaw-phone-call.mjs`.
- Demo-number bypass for a second call to Sergii today.

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
- STATUS: DISCOVERY DONE / PURCHASE NOT AUTHORIZED.

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
- VERIFIED: current wallet docs expose `POST /v1/wallet/topup` and current API reference exposes `POST /v1/phone-numbers/buy`.
- RESULT: all remaining non-financial blockers before self-test are closed. The next action can create/complete funding and purchase one production caller number, then immediately run the self-test.
- STATUS: DONE / AWAITING EXPLICIT PAYMENT AUTHORIZATION.

### J-018 — Current-state recheck before payment gate
- PLAN: Reconcile the new chat prompt against the live journal without repeating closed work.
- VERIFIED BEFORE: journal already marked P-04 DONE and P-05 at an external financial gate.
- ACTION: verified branch head and searched Gmail for any new Call2Me support response.
- VERIFIED AFTER: branch head is `4e1506160f74cfca0701af861716fdff640bb38a`; path-scoped commit history confirms `c221546829699ec48e1f1ba09d3bacf559dd97c2` remains the latest commit touching `scripts/openclaw-phone-call.mjs`; newer commits only changed/removed one-shot Call2Me helper workflows. No inbound support response was found from `support@call2me.app`, and a broader recent `Call2Me` mail search also found no support reply.
- RESULT: P-04 remains DONE; P-05/P-06 remain blocked only by the explicit paid-action authorization already identified in J-017.
- STATUS: DONE / AWAITING EXPLICIT PAYMENT AUTHORIZATION.

## NEXT MICRO STEP

**P-06:** After explicit authorization to spend, initiate Call2Me wallet funding with a target of `$7` (or the provider's smallest permitted amount at or above the required budget), provision one available local US production number with an upfront charge not exceeding `$5`, bind it to `agent_f2949915a3f2`, verify wallet + owned number, then run the authorized self-test to `+12133611700` and retrieve the sanitized result. Do not enable recording. Do not make any other purchase.

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

`CHAT REQUEST -> PHONE TASK -> OPENCLAW PHONE WORKFLOW -> CALL2ME -> PHONE RINGS -> HUMAN ANSWERS -> PURPOSE-FIRST INTRO -> TWO-WAY CONVERSATION -> FOLLOW-UP -> CALL ENDS -> RESULT POLLED -> SUMMARY RETURNED`

A provider HTTP 200/201 by itself is not considered success.
