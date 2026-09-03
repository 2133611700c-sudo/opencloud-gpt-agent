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
- Correct outbound destination format is E.164 with leading `+`.
- Demo calling has already reached Sergii's real phone; Sergii confirmed the phone rang and the AI spoke.
- Production `/v1/calls` reached Call2Me and returned HTTP 402 `Insufficient balance`.
- Wallet audit: balance `$0.00`, `can_proceed=false`, minimum `$0.01`, configured signup bonus `$5.00`, transactions `0`, total top-up `$0.00`, total usage `$0.00`.
- Call2Me confirmed the account email is already verified.
- Support request for the missing $5 signup credit was sent on 2026-09-03.
- MVP runner exists: `scripts/openclaw-phone-call.mjs`.
- MVP workflow exists: `.github/workflows/openclaw-phone-call.yml`.
- Task template exists: `ops/agent-control/templates/phone-call.example.json`.
- Runtime phone task folder: `ops/agent-control/phone-calls/*.json`.

## CURRENT BLOCKERS

1. **Signup credit missing** — wallet is `$0.00`; production calls return HTTP 402.
2. **Production caller number required** — Call2Me production outbound requires an owned/bound `from_number` or BYOC/SIP number.
3. **Persistent credential not installed in GitHub Actions** — workflow expects `CALL2ME_API_KEY`; the connected GitHub tool cannot create repository Actions Secrets.
4. **Agent greeting needs production cleanup** — current agent began as a self-test agent and must be updated to a purpose-first opening before the next real production call.

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
- RESULT: promised signup credit was not provisioned.
- STATUS: DONE.

### J-005 — Support escalation sent
- ACTION: email sent to `support@call2me.app` with verified account/wallet facts and no credentials.
- RESULT: waiting for provider-side correction; no need to repeat verification or wallet audit unless new provider state appears.
- STATUS: DONE / EXTERNAL WAIT.

### J-006 — Universal OpenClaw phone runner added
- ACTION: added `scripts/openclaw-phone-call.mjs`.
- ACTION: added `.github/workflows/openclaw-phone-call.yml`.
- ACTION: added phone-call task template.
- VERIFIED DESIGN: E.164 validation, explicit approval, wallet check, agent check, caller-number check, call dedupe, no automatic retry of dial POST, safe polling, sanitized public report.
- STATUS: DONE; final runtime validation still pending.

### J-007 — Process error identified
- ERROR: after the above checkpoint, password-reset work was started again even though auth recovery was already marked DONE.
- CORRECTION: reset/login are not to be repeated unless a fresh login test explicitly fails and the journal records that failure.
- STATUS: CORRECTED.

### J-008 — Fresh reset request accidentally triggered during process correction
- VERIFIED: existing `Call2Me Password Reset Request` workflow was re-run and a fresh reset email arrived.
- ACTION: no password change is required from this event because J-002 already proves auth recovery; this reset email is not the next task.
- RESULT: ignore the reset email unless future login verification invalidates J-002.
- STATUS: CLOSED AS UNNECESSARY.

### J-009 — P-01 runner/workflow validation
- VERIFIED: `.github/workflows/openclaw-phone-call.yml` parses successfully as YAML.
- VERIFIED: `scripts/openclaw-phone-call.mjs` contains wallet/agent/from-number checks, task-id dedupe, and no automatic retry of the dial POST.
- FOUND: old `.github/workflows/call2me-multirole-selftest.yml` caused branch validation failure due to ShellCheck SC2034 (`i` unused).
- ACTION: changed only that loop variable from `i` to `_` in commit `ec5268d534d05bb1c0852da2e8aa83b9e6d8fdc1`.
- VERIFIED on code head `9e64c7b9262ae5c7a821446fc07311e914447a4e`: Workflow Self Validation run `33793845124` = success; CodeQL run `33793845103` = success; OpenClaw PR Validation run `33793845128` = success.
- RESULT: P-01 validation is complete.
- STATUS: DONE.

## NEXT MICRO STEP

**P-02:** Read the current live agent configuration for `agent_f2949915a3f2`, then update the actual Call2Me agent (not merely repo text) to a production purpose-first prompt and `begin_message_mode=dynamic`. Verify by reading the agent back from Call2Me. Do not dial yet.

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
