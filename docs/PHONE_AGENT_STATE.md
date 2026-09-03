# PHONE AGENT STATE

Last updated: 2026-09-03

## WORKING RULE

For every phone-agent step, use this loop and do not skip it:

`PLAN STEP -> VERIFY CURRENT STATE -> DO ONE SMALL ACTION -> VERIFY RESULT -> WRITE JOURNAL ENTRY -> MOVE TO NEXT STEP`

Do not repeat a completed step unless the journal explicitly records new evidence that invalidates it. A failed approach is not task completion: find the next safe approach inside the same plan item until the item is actually complete or an external action is genuinely required.

## PLAN

1. Validate the current Call2Me/OpenClaw phone runner and workflow.
2. Fix the universal agent opening so it immediately identifies itself, says it is calling on Sergii's behalf, and states the runtime purpose.
3. Establish persistent Call2Me authentication for the workflow without storing plaintext credentials in Git history or logs.
4. Resolve the missing signup credit / usable wallet balance.
5. Obtain or bind one production caller number (`from_number`).
6. Run the authorized self-test to `+12133611700`.
7. Verify the complete chain: ring -> answer -> purpose-first intro -> two-way conversation -> follow-up -> call completion -> result retrieval.
8. Only after that, perform one safe practical information call to an external business/manager.

## CURRENT CHECKPOINT

- Provider: Call2Me.
- Account email: `2133611700c@gmail.com`.
- Universal agent: `agent_f2949915a3f2` (`Sergii Universal Phone Agent`).
- Account access was already recovered and verified on 2026-09-03: password reset HTTP 200, login HTTP 200, agent creation HTTP 201, later agent lookup HTTP 200.
- Live agent is production purpose-first verified: `begin_message_mode=dynamic`, AI disclosure present, `on behalf of Sergii` present, runtime purpose-first present, inbound-style `Can I help you?` blocked, one-question-at-a-time present, recording disabled, voicemail action `hangup`.
- Correct outbound destination format is E.164 with leading `+`.
- Demo calling has already reached Sergii's real phone; Sergii confirmed the phone rang and the AI spoke.
- Production `/v1/calls` reached Call2Me and returned HTTP 402 `Insufficient balance`.
- Wallet audit: balance `$0.00`, `can_proceed=false`, minimum `$0.01`, configured signup bonus `$5.00`, transactions `0`, total top-up `$0.00`, total usage `$0.00`.
- Call2Me confirmed the account email is already verified.
- Support request for the missing $5 signup credit was sent on 2026-09-03.
- Dedicated Call2Me API key was created on 2026-09-03: key id `key_6ab5960f19cb52ed`, expiration `2027-03-02T18:37:47.029095`. The key value is not stored in Git.
- MVP runner exists: `scripts/openclaw-phone-call.mjs`.
- MVP workflow exists: `.github/workflows/openclaw-phone-call.yml`.
- Task template exists: `ops/agent-control/templates/phone-call.example.json`.
- Runtime phone task folder: `ops/agent-control/phone-calls/*.json`.

## CURRENT BLOCKERS

1. **Signup credit / usable balance must be re-verified** — last verified wallet was `$0.00`; production calls returned HTTP 402.
2. **Production caller number must be obtained/bound** — last verified owned phone-number list was empty.
3. **GitHub Actions persistent credential must be verified** — dedicated API key exists, but current `CALL2ME_API_KEY` Actions-secret presence/smoke must be checked before declaring P-03 complete.

## JOURNAL — 2026-09-03

### J-001 — Inventory completed
- VERIFIED: repo `2133611700c-sudo/opencloud-gpt-agent`, branch `feat/openclaw-vendor-phone-calls`, PR #39, existing OpenClaw runner, Call2Me/Bland experiments.
- RESULT: Call2Me chosen as the shortest proven path because a real demo call already reached Sergii's phone.
- STATUS: DONE.

### J-002 — Production Call2Me auth recovered
- VERIFIED: password reset HTTP 200.
- VERIFIED: login HTTP 200.
- VERIFIED: universal agent creation HTTP 201.
- VERIFIED: later agent lookup HTTP 200.
- RESULT: account authentication and agent existence are not current blockers.
- STATUS: DONE.

### J-003 — Destination-number bug fixed
- VERIFIED: first production request lost the leading `+` and returned validation error.
- ACTION: corrected number handling to preserve E.164 `+12133611700`.
- VERIFIED: subsequent request reached the wallet gate instead of E.164 validation.
- STATUS: DONE.

### J-004 — Wallet audited
- VERIFIED: balance `$0.00`.
- VERIFIED: minimum required balance `$0.01`.
- VERIFIED: configured signup bonus `$5.00`.
- VERIFIED: transactions `0`, total top-up `$0.00`, total usage `$0.00`.
- VERIFIED: server says `Email already verified`.
- RESULT: promised signup credit was not provisioned at that checkpoint.
- STATUS: DONE.

### J-005 — Support escalation sent
- ACTION: email sent to `support@call2me.app` with verified account/wallet facts and no credentials.
- RESULT: provider was asked to correct missing signup credit.
- STATUS: DONE.

### J-006 — Universal OpenClaw phone runner added
- ACTION: added `scripts/openclaw-phone-call.mjs`.
- ACTION: added `.github/workflows/openclaw-phone-call.yml`.
- ACTION: added phone-call task template.
- VERIFIED DESIGN: E.164 validation, explicit approval, wallet check, agent check, caller-number check, call dedupe, no automatic retry of dial POST, safe polling, sanitized public report.
- STATUS: DONE; final runtime call validation still pending.

### J-007 — Process error identified
- ERROR: password-reset work was started again even though auth recovery was already marked DONE.
- CORRECTION: do not repeat reset/login unless new verified evidence invalidates existing auth.
- STATUS: CORRECTED.

### J-008 — Fresh reset request accidentally triggered during process correction
- VERIFIED: existing `Call2Me Password Reset Request` workflow was re-run and a fresh reset email arrived.
- RESULT: reset email was not needed for the next task and was closed as unnecessary.
- STATUS: CLOSED.

### J-009 — P-01 runner/workflow validation
- VERIFIED: `.github/workflows/openclaw-phone-call.yml` parses successfully as YAML.
- VERIFIED: `scripts/openclaw-phone-call.mjs` contains wallet/agent/from-number checks, task-id dedupe, and no automatic retry of the dial POST.
- FOUND: old `.github/workflows/call2me-multirole-selftest.yml` caused branch validation failure due to ShellCheck SC2034 (`i` unused).
- ACTION: changed only that loop variable from `i` to `_` in commit `ec5268d534d05bb1c0852da2e8aa83b9e6d8fdc1`.
- VERIFIED on code head `9e64c7b9262ae5c7a821446fc07311e914447a4e`: Workflow Self Validation run `33793845124` = success; CodeQL run `33793845103` = success; OpenClaw PR Validation run `33793845128` = success.
- RESULT: P-01 validation is complete.
- STATUS: DONE.

### J-010 — P-02A historical finalize check
- VERIFIED: historical `Call2Me Finalize Login` run `33792197023` failed at login with HTTP 401.
- VERIFIED: that historical run did not patch the agent and did not create its API key.
- RESULT: historical failure is not counted as completion.
- STATUS: DONE.

### J-011 — P-02 live purpose-first agent verified
- FOUND: later evidence existed outside the journal and had to be reconciled before repeating work.
- VERIFIED: commit `f123f67b5a503946d634b0a60d4abd1ff79d9bad` created `Call2Me Live Agent Config`.
- VERIFIED: GitHub Actions run `33794652077` completed successfully.
- VERIFIED steps: encrypted API key received; live agent read before; purpose-first production config enforced; live agent read after; assertions passed; sanitized evidence uploaded.
- VERIFIED read-back: `begin_message_mode=dynamic`, recording=false, voicemail=`hangup`, max duration=300000 ms, AI disclosure=true, on-behalf-of-Sergii=true, purpose-first=true, inbound greeting blocked=true, one-question-at-a-time=true.
- RESULT: P-02 is complete on the actual Call2Me live agent, not merely in repository text.
- STATUS: DONE.

## NEXT MICRO STEP

**P-03:** Verify whether GitHub Actions currently has `CALL2ME_API_KEY` and whether it authenticates successfully to Call2Me. Use existing `call2me-secret-presence-check.yml` and `call2me-secret-smoke.yml`; do not create another credential unless the existing dedicated key is proven unusable.

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

At the beginning of every outbound call the agent must immediately communicate three things:

1. it is an AI phone assistant;
2. it is calling on behalf of Sergii;
3. the concrete purpose of this call.

It must not start with `Can I help you?` or `How can I help you?`.

Then it asks one question at a time, listens, adapts follow-ups to the actual answer, asks for clarification when critical details are ambiguous, and ends when the success condition is met or cannot be met.

## DEFINITION OF DONE

`CHAT REQUEST -> PHONE TASK -> OPENCLAW PHONE WORKFLOW -> CALL2ME -> PHONE RINGS -> HUMAN ANSWERS -> PURPOSE-FIRST INTRO -> TWO-WAY CONVERSATION -> FOLLOW-UP -> CALL ENDS -> RESULT POLLED -> SUMMARY RETURNED`

A provider HTTP 200/201 by itself is not considered success.
