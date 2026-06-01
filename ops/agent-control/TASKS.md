# Tasks

## Supported task types
- `heartbeat`
- `virtual_browser_audit`
- `synthetic_fail`
- `job_lead_audit`

## OC-001-openclaw-heartbeat
- Goal: prove independent cloud runner can read repo and write evidence report.
- No production code changes.
- Output:
  - `ops/agent-control/reports/openclaw-heartbeat/<UTC_TIMESTAMP>.md`
  - commit message: `ops(agent): add OpenClaw cloud heartbeat`

## Fast acceptance verification
- Single command:
  - `npm run verify:openclaw`
- Verifies in deterministic order:
  - `npm ci`
  - heartbeat sample run
  - `job_lead_audit` sample run
  - `openclaw-latest.json` points to `job_lead_audit` after sequence
