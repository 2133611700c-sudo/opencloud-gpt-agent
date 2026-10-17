# OpenClaw 2026.10.3 credential problems

Observed 2026-10-16/17 on PR #55 (`v2/openclaw-10-3-cutover`).
The separate Research acceptance scope is not a deployed GitHub runner. Historical 2026.9.8 Walking Skeleton evidence remains unchanged.

| ID | Subsystem | Observed / expected | Evidence | Root cause | Classification | Severity / blocking | Fix / status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | Research auth contract | Stored profile rejected while environment key required; target requires stored agent credential | Previous `research-auth-scope.mjs`, runner, production preflight and live CI | Explicit previous architecture conflicted with the newly authorized stored-auth contract | SECRET_AUTH | High; target architecture blocker | FIXED IN CANDIDATE. `main` / `deepseek:manual` API-key verification, stdin-only bootstrap, and no direct key in inference child env are implemented. Local installed-product acceptance PASS; deterministic GitHub CI PASS. |
| C02 | GitHub credential provisioning | `openclaw-v2-live` must provide `DATABASE_URL` and `DEEPSEEK_API_KEY`, but no available automation credential can currently write those GitHub Environment secrets | Environment prerequisite run `38982588772` / job `117246640352`: both required fields MISSING. Repository-secret probe run `38984711552` / job `117253361773`: both names MISSING at repository scope. Admin-token probe run `38985354361` / job `117255426803`: `OPENCLAW_GITHUB_TOKEN=MISSING`, unauthenticated environment public-key request HTTP 401. Earlier explicit secret-write attempt recorded in `docs/evidence/openclaw-2026.10.3-stored-auth-20261016.json`: HTTP 403 `Resource not accessible by integration`. Temporary probes were removed after evidence capture. | The current automation boundary has no usable GitHub secret-administration transport. Runner `GITHUB_TOKEN`/connected GitHub integration does not provide the required Secrets/Environments administration path, and no repository `OPENCLAW_GITHUB_TOKEN` fallback is stored. The prior supplied PAT write attempt returned HTTP 403; that result does **not** prove the PAT or DeepSeek key invalid. | SECRET_AUTH / GITHUB_ADMIN_TRANSPORT | High; blocks GitHub-hosted stored-auth and live Kernel acceptance | BLOCKED EXTERNALLY AT GITHUB SECRET WRITE. Do not rerun OpenClaw/model paid gates until secret plumbing exists. `DATABASE_URL` remains recoverable from the connected canonical Neon project without committing it. DeepSeek stored-auth/provider/exec validity is already positively proven in the isolated acceptance scope. Next valid action is an authorized GitHub Environments secret write for both required names, then the presence gate and one bounded live Kernel acceptance. |
| C03 | Live catalog refresh | CLI exits 0 but reports `/models` fetch timeout and falls back to published models | `docs/evidence/openclaw-2026.10.3-stored-auth-20261016.json`, catalog steps | Discovery transport in the isolated acceptance environment is unresolved; successful stored-auth inference is independently proven | CATALOG_DISCOVERY | Medium; blocks claiming fresh discovery PASS | Reject fallback as refresh proof; retain inference result separately; NOT_PROVEN. Re-evaluate only in the fresh GitHub live acceptance after C02 is cleared. |
| C04 | Native cleanup | Probe and exec report agent database admission/maintenance warnings | Same evidence, probe and execution stderr | Not established; provider response and process exit are independently successful | CLEANUP_STATE | Medium; blocks full cleanup acceptance | Record cleanup separately from inference; NOT_PROVEN. Re-evaluate only after C02 is cleared and the bounded GitHub live run exists. |

Successful direct credential evidence: official stdin installation, saved profile inspection,
live V4 Pro probe with `source=profile`, and exact `agent exec` final with exit 0, all in
`/workspace/audit/v2-research-state`. No direct `DEEPSEEK_API_KEY` was provided to
the probe or execution. This proves the OpenClaw credential path itself works, but does not establish GitHub-hosted Kernel acceptance.

## Current cutover boundary

- Canonical V2 remains `v2/openclaw-clean-20261011`; `main` remains frozen.
- PR #55 is the only active 2026.10.3 cutover route.
- The candidate installs OpenClaw `2026.10.3`, the matching official DeepSeek provider and DuckDuckGo plugin, and validates the generated Research config in GitHub CI.
- The latest probe-cleanup head before this documentation update was `b60ef3da4793a235593bcbb3b7e22539fbb05c2d`; run `38985466643` foundation completed SUCCESS. Conditional live jobs were SKIPPED and are not live proof.
- PR #57 is closed and unmerged; do not revive the legacy `main` route.
- No further paid/model diagnostic is justified until C02 is cleared.

## Risks and control

- **Secret leakage:** never place API keys, PATs, PostgreSQL connection strings, auth SQLite state, or reversible secret payloads in Git, PR text, workflow logs or artifacts. Only presence/status evidence is durable.
- **False diagnosis:** HTTP 403/401 and MISSING probes classify the GitHub administration path; they do not establish that the user-supplied DeepSeek credential is invalid. DeepSeek stored-auth execution already has positive proof.
- **Repeated diagnostics:** do not recreate repository/environment presence probes unless the secret-administration configuration has actually changed.
- **Premature promotion:** do not mark PR #55 ready or merge it until a fresh GitHub-hosted stored-profile acceptance and required live Kernel composition pass on the authorized cutover route.
- **State drift:** after C02 changes, run the prerequisite presence gate first, then exactly one bounded live acceptance; record exact head/run/job/task/receipt/artifact identifiers before any promotion claim.
