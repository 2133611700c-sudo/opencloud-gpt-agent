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
4. Resolve usable wallet balance. — EXTERNAL BLOCKER
5. Obtain or bind one production caller number (`from_number`). — REQUIRES PAID ACTION OR BYOC
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
- Support request for the missing $5 signup credit was sent on 2026-09-03; latest Gmail check found no reply.
- Dedicated Call2Me API key exists: key id `key_6ab5960f19cb52ed`, expiration `2027-03-02T18:37:47Z`. The key value is not stored in Git.
- GitHub Actions persistent secrets are absent: `CALL2ME_API_KEY=false`, `OPENCLAW_CONTROL_SHARED_SECRET=false`, `OPENCLAW_GITHUB_TOKEN=false`.
- This absence is not a blocker for the current session: the dedicated Call2Me key was successfully reused through the existing RSA-encrypted one-time payload workflow; the consumed ciphertext was removed from the branch.
- `/v1/phone-numbers` returned HTTP 200 with an empty owned-number list.
- Read-only LA number search succeeded. At the verified search time, multiple 213-area candidates were available at `$5.00 upfront / $5.00 monthly`. Recheck availability only immediately before an authorized purchase.
- MVP runner: `scripts/openclaw-phone-call.mjs`.
- MVP workflow: `.github/workflows/openclaw-phone-call.yml`.
- Task template: `ops/agent-control/templates/phone-call.example.json`.
- Runtime phone task folder: `ops/agent-control/phone-calls/*.json`.

## CURRENT BLOCKERS

1. **Usable wallet balance** — last verified balance is `$0.00`; production calls return HTTP 402. The promised $5 was not provisioned despite verified account/claim.
2. **Production caller number** — owned number list is empty. A Call2Me number is a paid action; BYOC/SIP is the alternative.

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
- Read-only LA number discovery, except immediately before a real purchase.

## JOURNAL — 2026-09-03

### J-001 — Inventory completed
- VERIFIED: repo `2133611700c-sudo/opencloud-gpt-agent`, branch `feat/openclaw-vendor-phone-calls`, PR #39, existing OpenClaw runner, Call2Me/Bland experiments.
- RESULT: Call2Me selected as the shortest proven path because a real demo call already reached Sergii's phone.
- STATUS: DONE.

### J-002 — Production Call2Me auth recovered
- VERIFIED: password reset HTTP 200, login HTTP 200, universal agent creation HTTP 201, later agent lookup HTTP 200.
- RESULT: account authentication and agent existence are not current blockers.
- STATUS: DONE.

### J-003 — Destination-number bug fixed
- VERIFIED: first production request lost the leading `+` and returned validation error.
- ACTION: corrected E.164 handling to preserve `+12133611700`.
- VERIFIED: subsequent request reached the wallet gate instead of number validation.
- STATUS: DONE.

### J-004 — Wallet audited
- VERIFIED: balance `$0.00`; minimum `$0.01`; configured signup bonus `$5.00`; transactions `0`; top-up `$0.00`; usage `$0.00`; account already verified.
- RESULT: promised signup credit was not provisioned.
- STATUS: DONE.

### J-005 — Support escalation sent
- ACTION: email sent to `support@call2me.app` with wallet/account facts and no credentials.
- VERIFIED latest Gmail check: no support reply yet.
- STATUS: DONE / EXTERNAL WAIT.

### J-006 — Universal OpenClaw phone runner added
- ACTION: added `scripts/openclaw-phone-call.mjs`, `.github/workflows/openclaw-phone-call.yml`, and phone-call task template.
- VERIFIED DESIGN: E.164 validation, explicit approval, wallet/agent/caller checks, task-id dedupe, no automatic retry of dial POST, safe polling, sanitized public report.
- STATUS: DONE; final runtime call validation still pending.

### J-007 — Process error identified
- ERROR: password-reset work was started again after auth recovery was already DONE.
- CORRECTION: do not repeat reset/login unless new verified evidence invalidates auth.
- STATUS: CORRECTED.

### J-008 — Unnecessary fresh reset closed
- VERIFIED: reset email was generated during process correction.
- RESULT: no password change was needed; event closed.
- STATUS: CLOSED.

### J-009 — P-01 runner/workflow validation
- VERIFIED: phone workflow parses; runner includes wallet/agent/from-number checks, task-id dedupe, and no automatic dial-POST retry.
- ACTION: fixed unrelated old ShellCheck SC2034 in `call2me-multirole-selftest.yml`.
- VERIFIED: Workflow Self Validation, CodeQL, and OpenClaw PR Validation succeeded on corrected code head.
- STATUS: DONE.

### J-010 — Historical failed finalize classified
- VERIFIED: old finalize run `33792197023` failed login HTTP 401 and did not patch agent/create key.
- RESULT: superseded by later successful live configuration.
- STATUS: CLOSED / SUPERSEDED.

### J-011 — P-02 live purpose-first agent verified
- VERIFIED: `Call2Me Live Agent Config` run `33794652077` succeeded.
- VERIFIED read-back: `begin_message_mode=dynamic`, recording=false, voicemail=`hangup`, max duration=300000 ms, AI disclosure=true, on-behalf-of-Sergii=true, purpose-first=true, inbound greeting blocked=true, one-question-at-a-time=true.
- RESULT: live agent is production-purpose-first configured.
- STATUS: DONE.

### J-012 — Dedicated API key / readiness artifact reconciled
- VERIFIED artifact timestamp `2026-09-03T18:37:49Z`.
- VERIFIED: dedicated API key `key_6ab5960f19cb52ed` exists and expires `2027-03-02T18:37:47Z`.
- VERIFIED: wallet remained `$0.00` / `can_proceed=false`.
- VERIFIED: `/v1/phone-numbers` HTTP 200 with `phone_numbers=[]`.
- STATUS: DONE.

### J-013 — Signup-credit claim conclusively checked
- VERIFIED: later `/v1/auth/verify-email` attempt returned HTTP 200 with `Email already verified`.
- VERIFIED afterward: wallet `$0.00`, `credit_available=false`.
- RESULT: do not repeat claim unless Call2Me state changes.
- STATUS: DONE / PROVIDER PROVISIONING ISSUE.

### J-014 — Caller-number discovery completed
- VERIFIED read-only search at `2026-09-03T18:59:42Z`: multiple 213-area candidates available.
- VERIFIED listed price: `$5.00` upfront and `$5.00/month`.
- RESULT: production number can be obtained, but purchase requires explicit payment authorization.
- STATUS: DISCOVERY DONE / PURCHASE NOT AUTHORIZED.

### J-015 — P-03 persistent-secret audit closed
- VERIFIED `Call2Me Secret Presence Check` run `33794282765`: `CALL2ME_API_KEY=MISSING`, `OPENAI_API_KEY=MISSING`, `RESEND_API_KEY=MISSING`.
- VERIFIED `OpenClaw Persistent Secret Audit` run `33795091596`: `call2me_api_key_present=false`, `openclaw_control_shared_secret_present=false`, `openclaw_github_token_present=false`, `stable_wrapping_secret_available=false`.
- VERIFIED alternative: existing Call2Me API key was passed via one-time RSA-OAEP/SHA-256 encrypted payload; rerun job `100779827257` completed SUCCESS.
- ACTION: consumed ciphertext removed in commit `b815ebba8489523e71708c6a17aa455ad1154ac6`.
- RESULT: no persistent GitHub secret exists, but this session has a proven secure execution path; do not repeat secret discovery.
- STATUS: DONE.

### J-016 — P-04 security/review checkpoint
- VERIFIED: all four PR review threads that referenced `scripts/openclaw-phone-call.mjs` are now marked `outdated`; no current active review thread points at the current universal phone runner.
- VERIFIED current hardened runner commit `c221546829699ec48e1f1ba09d3bacf559dd97c2` (`fix(phone): harden Call2Me runner data handling`).
- VERIFIED current code uses `O_NOFOLLOW` + a single opened file descriptor for the task file, validates provider `call_id`/phone/status/duration, restricts Call2Me endpoint shapes, and does not persist transcript/provider response bodies/summary content to disk.
- VERIFIED Workflow Self Validation run `33795557371` = success.
- VERIFIED OpenClaw PR Validation run `33795557050` = success; all regression/safety steps completed successfully.
- PENDING: CodeQL run `33795557092` is still executing `Analyze` on this same hardened head.
- STATUS: IN PROGRESS until current CodeQL completes.

## NEXT MICRO STEP

**P-04A:** Wait only for CodeQL run `33795557092` on head `c221546829699ec48e1f1ba09d3bacf559dd97c2`. If it succeeds with no new current phone-runner finding, close P-04. If it produces a new current finding, fix only that finding and repeat validation. Do not change unrelated phone-agent state.

After P-04, the operational production gates remain usable wallet balance and one production caller number. No paid purchase/top-up is performed without explicit payment authorization.

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
