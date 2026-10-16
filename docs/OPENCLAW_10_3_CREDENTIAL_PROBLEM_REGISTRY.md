# OpenClaw 2026.10.3 credential problems

Observed 2026-10-16 against PR #55 base head `fd3eec621fd6f301b00b10e2db7fe33a68f5ad0b`.
The separate Research acceptance scope is not a deployed GitHub runner.

| ID | Subsystem | Observed / expected | Evidence | Root cause | Classification | Severity / blocking | Fix / status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C01 | Research auth contract | Stored profile rejected while environment key required; target requires stored agent credential | Previous `research-auth-scope.mjs`, runner, production preflight and live CI | Explicit previous architecture conflicts with the new user requirement | SECRET_AUTH | High; blocks target architecture | Replace negative guard with `main` / `deepseek:manual` API-key verification; bootstrap with stdin, exclude direct key from inference; local validation PASS (482 tests, installed config and real bootstrap); GitHub CI PASS on functional head `34eda7ba3f9eed8e99b62938e5fa8c69cbace52f` |
| C02 | GitHub credential provisioning | `gh secret set` cannot obtain the environment public key; expected authorized encrypted secret write | `docs/evidence/openclaw-2026.10.3-stored-auth-20261016.json`, `github_secret_write` | Effective GitHub access returns HTTP 403 `Resource not accessible by integration`; original PAT scopes are not established by this result | SECRET_AUTH | High; blocks GitHub live Kernel | Restore Secrets API access through a supported credential/connection configuration; BLOCKED. Stored secret inventory remains UNKNOWN; fresh prerequisite run38982588772 separately proves both effective runner credentials MISSING |
| C03 | Live catalog refresh | CLI exits 0 but reports `/models` fetch timeout and falls back to published models | Same evidence, both catalog steps | Discovery transport in this execution environment is unresolved; successful stored-auth inference is independently proven | CATALOG_DISCOVERY | Medium; blocks claiming fresh discovery PASS | Reject fallback as refresh proof; retain inference result separately; NOT_PROVEN |
| C04 | Native cleanup | Probe and exec report agent database admission/maintenance warnings | Same evidence, probe and execution stderr | Not established; provider response and process exit are independently successful | CLEANUP_STATE | Medium; blocks full cleanup acceptance | Record cleanup separately from inference; NOT_PROVEN |

Successful direct credential evidence: official stdin installation, saved profile inspection,
live V4 Pro probe with `source=profile`, and exact `agent exec` final with exit 0, all in
`/workspace/audit/v2-research-state`. No direct `DEEPSEEK_API_KEY` was provided to
the probe or execution. This does not establish GitHub-hosted Kernel acceptance.
