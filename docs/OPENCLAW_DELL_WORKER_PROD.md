# OpenClaw Dell Worker — Optional Legacy/Fallback Worker

> **Not the primary production path.** The authoritative production control plane is documented in `ops/agent-control/MOBILE_CLOUD_CONTROL_PLANE.md` and runs on GitHub-hosted Actions from iPhone/ChatGPT + GitHub. This Windows worker is optional only and may remain disabled.

## Primary production path

`iPhone / ChatGPT -> GitHub task + dispatch -> GitHub Actions -> ECC/OpenClaw router -> bounded agents + skills -> core runner -> evidence -> ChatGPT verification`

No Dell/Windows machine is required for this path.

## Optional Dell prerequisites (Windows)
- Install Git: `winget install --id Git.Git`
- Install Node LTS: `winget install --id OpenJS.NodeJS.LTS`
- Install GitHub CLI: `winget install --id GitHub.cli`
- Optional Codex CLI: `npm install -g @openai/codex`

## Optional clone and auth
```powershell
cd C:\OpenClaw
git clone https://github.com/2133611700c-sudo/opencloud-gpt-agent.git
cd opencloud-gpt-agent
gh auth login
```

## Optional install
```powershell
npm ci
npx playwright install chromium
```

## Manual fallback worker run
```powershell
cd C:\OpenClaw\opencloud-gpt-agent
$env:OPENCLAW_REPO="2133611700c-sudo/opencloud-gpt-agent"
$env:OPENCLAW_TASK_INBOX_MODE="files+issues"
node scripts/openclaw-worker.mjs
```

## Scheduled fallback worker
Only configure this if a persistent local worker is intentionally restored. It is not required for normal ChatGPT/mobile dispatch.

Create `C:\OpenClaw\run-openclaw-worker.ps1`:
```powershell
cd C:\OpenClaw\opencloud-gpt-agent
git pull origin main
npm ci
node scripts/openclaw-worker.mjs
```

Register:
```powershell
schtasks /Create /SC MINUTE /MO 15 /TN "OpenClawWorker" /TR "pwsh -NoProfile -ExecutionPolicy Bypass -File C:\OpenClaw\run-openclaw-worker.ps1" /F
schtasks /Run /TN "OpenClawWorker"
```

## Evidence locations
- Task reports: `ops/agent-control/reports/`
- Latest summary: `ops/agent-control/reports/openclaw-latest.json`
- Status log: `ops/agent-control/STATUS.md`
- Orchestration plans: `ops/agent-control/reports/orchestration/`

## Verification rule
No local-worker result is trusted merely because the process ran. ChatGPT must verify the same terminal evidence contract used by the cloud path: status, task/run IDs, report file, artifact/evidence handles, and next action.

## Safe stop
```powershell
schtasks /End /TN "OpenClawWorker"
schtasks /Change /TN "OpenClawWorker" /DISABLE
```
