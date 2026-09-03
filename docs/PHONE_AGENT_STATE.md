# PHONE AGENT STATE

Last updated: 2026-09-03

## CURRENT WORKING PATH

- Provider: Call2Me.
- Account email: `2133611700c@gmail.com`.
- Universal agent exists: `agent_f2949915a3f2` (`Sergii Universal Phone Agent`).
- Verified auth recovery on 2026-09-03: password reset HTTP 200, login HTTP 200, agent creation HTTP 201, later agent lookup HTTP 200.
- Correct outbound destination format was verified as E.164, including leading `+`.
- New MVP runner: `scripts/openclaw-phone-call.mjs`.
- New MVP workflow: `.github/workflows/openclaw-phone-call.yml`.
- Task template: `ops/agent-control/templates/phone-call.example.json`.
- Runtime task folder: `ops/agent-control/phone-calls/*.json`.

## LAST VERIFIED CALL STATE

- Call2Me demo calling has previously reached Sergii's real phone; Sergii confirmed the phone rang and the AI spoke.
- Production `/v1/calls` was tested again on 2026-09-03 with destination `+12133611700`.
- Production request reached Call2Me and returned HTTP 402 `Insufficient balance`.
- Therefore a successful production two-way call through the new universal agent is NOT yet verified.

## VERIFIED ACCOUNT / WALLET STATE

Verified on 2026-09-03 through Call2Me API:

- email verification: server returned `Email already verified`
- wallet balance: `$0.00`
- `can_proceed`: `false`
- minimum required balance: `$0.01`
- configured signup bonus: `$5.00`
- wallet transactions: `0`
- total top-up: `$0.00`
- total usage: `$0.00`

Call2Me sent an email stating that the verified account should receive a $5 signup credit. The credit was not provisioned. A support email was sent to `support@call2me.app` on 2026-09-03 requesting correction.

## CURRENT BLOCKERS

1. **Signup credit missing** — wallet is $0.00, so production calls return HTTP 402.
2. **Production caller number required** — Call2Me production outbound requires an owned/bound `from_number` or BYOC/SIP number. The free demo caller does not satisfy production `/v1/calls`.
3. **Persistent credential not installed** — the new workflow expects GitHub Actions secret `CALL2ME_API_KEY`. The connected GitHub tool cannot create repository Actions Secrets. No API key value is stored in this repository.
4. **Agent greeting still needs production cleanup** — the current agent was initially created for the self-test and contains a self-test-oriented opening. Before the first business call it must be updated so every outbound call immediately identifies the AI assistant, states it is calling on Sergii's behalf, and states the runtime objective.

## PHONE CALL TASK CONTRACT

Minimal runtime task:

```json
{
  "id": "phone-call-unique-id",
  "type": "phone_call",
  "status": "pending",
  "requested_by": "Sergii",
  "goal": "Obtain factual information by phone.",
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

## RUNNER BEHAVIOR

The MVP runner currently:

- requires E.164 phone numbers;
- requires explicit approval;
- blocks purchases, payments, reservations and recording;
- checks wallet before dialing;
- verifies the configured agent;
- verifies/chooses an owned Call2Me caller number;
- checks previous Call2Me calls for the same `openclaw_task_id` before creating a new call;
- never automatically retries the call-creation POST;
- polls only safe GET call-status endpoints;
- retrieves status, duration, transcript availability/provider response fields and post-call analysis when Call2Me supplies them;
- commits only a sanitized Markdown summary to the public repository;
- does not commit passwords, API keys or full transcripts.

## TARGET OUTBOUND BEHAVIOR

At the beginning of every outbound call the agent must immediately communicate three things:

1. it is an AI phone assistant;
2. it is calling on behalf of Sergii;
3. the concrete purpose of this call.

It must not start with `Can I help you?` or `How can I help you?`.

Then it asks one question at a time, listens, adapts follow-ups to the actual answer, asks for clarification when critical details are ambiguous, and ends when the success condition is met or cannot be met.

## DEFINITION OF DONE

`CHAT REQUEST → PHONE TASK → OPENCLAW PHONE WORKFLOW → CALL2ME → PHONE RINGS → HUMAN ANSWERS → PURPOSE-FIRST INTRO → TWO-WAY CONVERSATION → FOLLOW-UP → CALL ENDS → RESULT POLLED → SUMMARY RETURNED`

A provider HTTP 200/201 by itself is not considered success.

## NEXT ACTION

1. Verify repository workflow/code validation for the new Call2Me runner.
2. Fix the universal agent's production greeting/system prompt.
3. Obtain and install a dedicated Call2Me API key as `CALL2ME_API_KEY` without exposing it in Git history/logs.
4. Get the promised $5 signup credit restored (support request already sent).
5. Obtain or bind one production caller number.
6. Run the authorized self-test to `+12133611700` and verify full two-way conversation plus retrieved result.
7. Only after the verified self-test, perform one safe practical business-information call.

## CHANGELOG

- 2026-09-03 — Real Call2Me demo call previously confirmed by Sergii.
- 2026-09-03 — Call2Me account access recovered securely.
- 2026-09-03 — Universal agent `agent_f2949915a3f2` created and verified by API.
- 2026-09-03 — E.164 leading-plus bug found and corrected.
- 2026-09-03 — Production call reached wallet gate and returned HTTP 402.
- 2026-09-03 — Wallet audited: $0 balance, zero transactions, configured $5 signup bonus.
- 2026-09-03 — Server confirmed email is already verified.
- 2026-09-03 — Support request sent for missing $5 credit.
- 2026-09-03 — Universal Call2Me OpenClaw phone runner and workflow added on `feat/openclaw-vendor-phone-calls`.
