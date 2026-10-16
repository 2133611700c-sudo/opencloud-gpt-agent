# V2 Research credential architecture — OpenClaw 2026.10.3 candidate

## Contract and scope

This is the credential contract for the separately authorized OpenClaw 2026.10.3 / PR #55 cutover candidate. It supersedes the candidate Research lane's historical requirement that no stored DeepSeek profile exist. It does not rewrite the 2026.9.8 Walking Skeleton acceptance history or declare the new cutover complete.

The durable credential source is GitHub Environment `openclaw-v2-live`. A GitHub-hosted job materializes its `DEEPSEEK_API_KEY` once through the official OpenClaw stdin onboarding command into the job's isolated per-agent auth store:

```text
GitHub Environment openclaw-v2-live
  -> DEEPSEEK_API_KEY available only to bootstrap and credential presence/leak checks
  -> OPENCLAW_STATE_DIR=$RUNNER_TEMP/openclaw-v2-state
  -> openclaw models auth paste-api-key --provider deepseek --agent main
     credential supplied through stdin, never an argv value
  -> profile deepseek:manual, provider deepseek, agent main
  -> Research auth preflight / catalog / provider probe / agent exec
     with DEEPSEEK_API_KEY and other direct DeepSeek credential overrides absent
```

The bootstrap must not echo the key, include it in command arguments, copy it into a config file, or publish the auth store as an artifact. The official auth store itself is credential storage and remains private to the runner. Runtime code uses the same state/agent scope that bootstrap configured. A secret being present in the job environment alone is not evidence that OpenClaw stored or used it.

`researcher` is the Kernel's logical Research node agent id. `main` is the OpenClaw execution/auth agent inside the isolated runtime. These are separate namespaces; using the per-agent OpenClaw `main` profile does not rename the Kernel node or weaken its task/agent-scoped claim and fencing.

PostgreSQL remains the durable source of task, lease, reservation, accounting, runtime-receipt and Evidence truth. OpenClaw's runner-local profile, native SQLite/session state, config and plugin cache are ephemeral. Each new runner bootstraps its profile again from GitHub. The design requires no always-on local machine, daemon or external project-owned execution host. A temporary audit installation demonstrates package/provider behavior only and is not a production execution dependency.

## Runtime and failure contract

The candidate Research lane must:

1. Install exact OpenClaw `2026.10.3` and matching official provider/tool plugins in an isolated private state scope.
2. Bootstrap and inspect the official `deepseek:manual` profile for OpenClaw agent `main` without printing the credential.
3. Verify the expected stored profile before every durable Research claim. Missing, malformed, unreadable or wrong-scope auth must fail before claim, reservation or paid Research execution.
4. Remove direct DeepSeek credential environment variables from catalog, probe and Research child environments, while preserving the selected state scope and required network/CA settings. Do not forward the full ambient GitHub/DB environment to these children.
5. Resolve the requested model, run a profile-specific provider probe where required, then execute the bounded native Research primitive. Keep the selected model and pricing metadata consistent; the strongest V4 Pro acceptance is separate from the existing Flash production default/pricing.
6. Preserve existing Kernel fencing, budget, heartbeat, accounting, Data admission and durable Evidence behavior.

The deterministic foundation/sidecar jobs receive no paid credentials. Their fresh empty auth scopes may still be checked for zero stored profiles. That invariant must not be reused to reject the deliberately bootstrapped profile in the live Research scope.

An optional independent environment-auth provider smoke is a separate diagnostic. It must be labelled as such and cannot substitute for a stored-profile Research proof or the composed GitHub/PostgreSQL Kernel acceptance.

## Acceptance evidence acquired on 2026-10-16

Root executed the installed published OpenClaw `2026.10.3` package in isolated acceptance scope `/workspace/audit/v2-research-state`. This is a local audit acceptance scope, not a deployed GitHub runner or the production PostgreSQL task path. The following post-bootstrap commands ran without a direct DeepSeek API key in their process environment.

| Test | Result | Evidence |
|---|---|---|
| Stored auth inspection | PASS: provider `deepseek`, agent `main`, profile `deepseek:manual`, type `api_key`; exit 0 | `v2-research-agent-auth-stored.{meta.json,stdout.txt,stderr.txt}` |
| V4 Pro profile probe | Provider connection PASS: requested `deepseek/deepseek-v4-pro`, source `profile`, profile `deepseek:manual`, status `ok`, provider latency 8857ms, process exit 0 | `v2-research-stored-pro-probe.*` |
| Catalog refresh | NOT_PROVEN: process exit 0, but DeepSeek `/models` fetch timed out and OpenClaw returned the available published list | `v2-research-pro-catalog.*` |
| Deterministic native agent exec | PASS: exit 0, `ok=true`, provider `deepseek`, returned model `deepseek-v4-pro`, exact final `OPENCLAW_V2_STORED_AUTH_OK`; requested direct Code Mode, thinking `max` | `v2-research-stored-pro-exec.*` |

Exec process duration was 15.106s, total usage 2571 tokens, observed cost USD0.00113796. Session id: `3e676b0d-079f-4f83-a97c-db8e3ac283ff`. The returned short model id is the envelope's representation of requested `deepseek/deepseek-v4-pro`; it is not a provider mismatch. This deterministic response requested no research tools and proves no `web_search` / `web_fetch` effect, PostgreSQL task, accounting ledger row or operator delivery.

Probe stderr reported `Auth probe cleanup failed: Agent database execution admission is closed`. Provider connectivity remains evidenced by the explicit profile result; cleanup/state ownership is separately NOT_PROVEN. Exec stderr also reported memory watcher/vector-recall degradation and SQLite maintenance rejection. They do not erase the exit-0 deterministic model response and do not establish that native memory or cleanup is fully healthy.

Full sanitized command/output/exit/hash evidence is retained in [the committed acceptance record](evidence/openclaw-2026.10.3-stored-auth-20261016.json); original files are in `/workspace/audit/evidence/` in this workspace. These are not GitHub-hosted run artifacts. Recorded stdout SHA256 values:

- Auth inspection: `82957f4dbbf53c30086d8938d540a2bbe63b98edaa802bdf5c0653b7d7fa2259`.
- Probe: `9d1b2dd1693cc75b38e72fc95988ea90a7e23e3bbe8d480c4437af20a55a749a`.
- Exec: `cd2f3cbe8f80ebb0adf79a415edffc084b5b6b4a61c653a60cbe6c03de896e16`.

## Open gates

The last observed GitHub live job reported both required credentials missing. Current GitHub secret presence is UNKNOWN: root's configuration attempts using the supplied explicit PAT through `gh` returned HTTP403. This establishes an access/configuration blocker, not proof that the key is absent or invalid.

At documentation baseline `fd3eec621fd6f301b00b10e2db7fe33a68f5ad0b`, candidate credential implementation passed 482/482 local tests, foundation/route/health, installed config validation and the real bootstrap helper. New exact GitHub CI is pending. No new GitHub-hosted stored-profile Research/Kernel PASS, full application E2E or PR #55 cutover readiness is claimed.

Next route: finish the smallest credential-contract implementation and regression checks; obtain exact GitHub CI evidence; establish usable GitHub secret plumbing; run bounded stored-profile validation in a fresh GitHub job; then verify the required composed Kernel path and record its exact run/task/receipt/artifact identities. Preserve the historical 48H checkpoint and frozen `main`. Do not repeat paid attempts automatically or promote skipped gates.
