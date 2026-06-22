# OpenCloud GPT Agent

This repository is the OpenClaw execution layer for ChatGPT-driven, read-only task dispatch with evidence-first closure.

## Supported flow

`ChatGPT supervisor -> GitHub task JSON -> GitHub Actions -> OpenClaw runner -> evidence report -> STATUS.md`

Primary task path:

1. Create a safe task JSON in `ops/agent-control/tasks/`.
2. Create a dispatch JSON in `ops/agent-control/dispatch/`.
3. Push the branch.
4. `openclaw-chatgpt-dispatch.yml` validates the request and calls `openclaw-task-runner.yml`.
5. `openclaw-task-runner.yml` validates the exact task file, uploads artifacts, writes `openclaw-latest.json`, updates the managed OpenClaw section in `STATUS.md`, and commits evidence as `github-actions[bot]`.

Secondary paths:

- Direct task push to `ops/agent-control/tasks/*.json` triggers `openclaw-task-runner.yml`.
- Manual dispatch is available through GitHub CLI:

```bash
gh workflow run openclaw-task-runner.yml \
  --repo 2133611700c-sudo/opencloud-gpt-agent \
  --ref main \
  -f task_file=ops/agent-control/tasks/<TASK>.json \
  -f force_rerun=true \
  -f run_windows_smoke=false
```

## Runtime policy

- This project is intentionally separate from Handyment, messageinfo, and USCIS Helper.
- Node.js baseline: `22.x` for local and CI execution.
- Package manager: `npm` with committed `package-lock.json`; use `npm ci` in automation.
- Browser automation: Playwright (`^1.60.0`).

## OpenClaw scope boundary

- OpenClaw: browser automation, evidence generation, workflow-driven monitoring tasks.
- OpenCV/OpenCL: not installed or supported by default in this repository.
- Add OpenCV/OpenCL only when there is a direct runtime import/use case committed in code and approved by task contract.

## Windows operation

- Prefer native Windows PowerShell for local runs when WSL is also installed.
- Primary runbook: `ops/agent-control/WINDOWS_RUNBOOK.md`.

## Local verification

```bash
npm ci
npm test
npm run verify:openclaw
npm run verify:openclaw:acceptance
```

## Task creation

```bash
node scripts/create-openclaw-task.mjs \
  --id OC-TEST-001 \
  --origin https://www.bls.gov \
  --routes "/,/ooh/" \
  --goal "Read-only official source audit"
```

## Evidence files

- `ops/agent-control/reports/openclaw-latest.json`
- `ops/agent-control/reports/<task-type>/<timestamp>.md`
- `ops/agent-control/STATUS.md`

## Safety defaults

- No customer actions.
- No public posting.
- No paid ads changes.
- No destructive actions.
- No workflow path may select tasks by last-modified time.
