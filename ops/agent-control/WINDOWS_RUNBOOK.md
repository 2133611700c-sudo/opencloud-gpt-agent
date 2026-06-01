# OpenClaw Windows Runbook

## Baseline
- OS: Windows 11 (native)
- Shell: PowerShell 7 (`pwsh`)
- Node.js: 22.x LTS baseline
- Repo path recommendation: ASCII-only path (for example `C:\Users\<user>\source\opencloud-gpt-agent`)

## Required binaries
- `node`
- `npm`
- `git`
- `gh`
- `pwsh`

## Coexistence with WSL
- WSL2 may be installed, but local OpenClaw validation should run from native Windows shell first.
- Use WSL only for explicit Linux-specific checks.

## Local smoke sequence (native PowerShell)
```powershell
npm ci
$env:TASK_FILE='ops/agent-control/tasks/OC-OPENCLAW-HEARTBEAT-001.json'
$env:FORCE_RERUN='true'
$env:OPENCLAW_LATEST_FILE="$pwd\\ops\\agent-control\\reports\\openclaw-latest.json"
node scripts/openclaw-task-runner.mjs
```

## One-command acceptance check
```powershell
npm run verify:openclaw
```
- Runs acceptance checks sequentially and prints JSON summary with report file paths.

## Safety defaults
- Monitoring is read-only by default.
- Telegram checks must stay within authorized channels/APIs/exports.
- Never perform customer actions, public posting, or destructive tasks unless explicitly approved in task safety flags.
