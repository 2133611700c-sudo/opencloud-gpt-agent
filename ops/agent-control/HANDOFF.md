# OpenClaw Handoff

## What changed

- `openclaw-task-runner.yml` now validates and runs exact task files instead of picking the latest file by mtime.
- `openclaw-chatgpt-dispatch.yml` adds a push-based ChatGPT-compatible dispatch path via `ops/agent-control/dispatch/*.json`.
- `OPENCLAW_TASK_SCHEMA.v1.json` is now strict and backed by Ajv validation in the runner and helper scripts.
- `openclaw-latest.json` and `STATUS.md` are written through controlled scripts instead of append-only shell redirection.
- Evidence commit logic now retries rebase-plus-push up to three times and records the evidence commit SHA.

## Operator commands

```bash
npm ci
npm test
node scripts/verify-openclaw-integration.mjs
```

```bash
gh workflow run openclaw-task-runner.yml \
  --repo 2133611700c-sudo/opencloud-gpt-agent \
  --ref main \
  -f task_file=ops/agent-control/tasks/<TASK>.json \
  -f force_rerun=true \
  -f run_windows_smoke=false
```

## ChatGPT-compatible path

1. Create a task JSON.
2. Create a dispatch JSON.
3. Push.
4. Review `ops/agent-control/reports/openclaw-latest.json`.
5. Review `ops/agent-control/STATUS.md`.

## Verified runs

- Heartbeat via dispatch succeeded on run `27923731780` with artifact `openclaw-27923731780`, report `ops/agent-control/reports/heartbeat/20260622T011707Z.md`, and evidence commit `9fcedf995939cd41cc87fffa0af72cdc9e7d2267`.
- BLS virtual browser audit executed on run `27923773505`, produced artifact `openclaw-27923773505-0` and report `ops/agent-control/reports/virtual_browser_audit/20260622T011842Z.md`, and truthfully failed because all audited BLS routes returned `403`.

## Current blockers to watch

- Evidence metadata still requires a second bot commit because the evidence commit SHA is only known after the first evidence push.
- If branch protection is later enabled against Actions pushes, the safe fallback is an evidence PR or dedicated evidence branch, not silent protection changes.
