# OpenClaw Dell Worker (Production)

## 1) Prerequisites (Windows)
- Install Git: `winget install --id Git.Git`
- Install Node LTS: `winget install --id OpenJS.NodeJS.LTS`
- Install GitHub CLI: `winget install --id GitHub.cli`
- Optional Codex CLI: `npm install -g @openai/codex`

## 2) Clone and auth
```powershell
cd C:\OpenClaw
git clone https://github.com/2133611700c-sudo/opencloud-gpt-agent.git
cd opencloud-gpt-agent
gh auth login
```

## 3) Install dependencies
```powershell
npm ci
npx playwright install chromium
```

## 4) Manual worker run
```powershell
cd C:\OpenClaw\opencloud-gpt-agent
$env:OPENCLAW_REPO="2133611700c-sudo/opencloud-gpt-agent"
$env:OPENCLAW_TASK_INBOX_MODE="files+issues"
node scripts/openclaw-worker.mjs
```

## 5) Scheduled Task (24/7)
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

## 6) Report and evidence locations
- Task reports: `ops/agent-control/reports/`
- Worker heartbeat: `ops/agent-control/reports/openclaw-heartbeat/`
- Lead collect/audit: `ops/agent-control/reports/job-lead-audit/`
- Outreach draft: `ops/agent-control/reports/outreach-draft/`
- Latest summary: `ops/agent-control/reports/openclaw-latest.json`
- Status log: `ops/agent-control/STATUS.md`

## 7) ChatGPT verification flow
1. ChatGPT creates GitHub issue (`openclaw-task`) or task JSON in `ops/agent-control/tasks/`.
2. Worker runs `scripts/openclaw-worker.mjs`.
3. Runner writes report + latest summary.
4. ChatGPT verifies:
- status (`PASS|FAIL|BLOCKED|DEGRADED`)
- `task_id`, `task_type`, `run_id`, `run_url`
- `report_file` and evidence files
- `next_action`

## 8) Safe stop
```powershell
schtasks /End /TN "OpenClawWorker"
schtasks /Change /TN "OpenClawWorker" /DISABLE
```
