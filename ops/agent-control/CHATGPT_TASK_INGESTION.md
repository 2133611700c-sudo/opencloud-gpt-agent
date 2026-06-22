# ChatGPT Task Ingestion

This is the minimum safe JSON that ChatGPT can create through the GitHub Contents API without requiring `workflow_dispatch`.

## Minimal task JSON

```json
{
  "id": "OC-TEST-001",
  "type": "virtual_browser_audit",
  "requested_by": "ChatGPT",
  "status": "pending",
  "goal": "Read-only official source audit",
  "params": {
    "target_origin": "https://www.bls.gov",
    "routes": ["/", "/ooh/"],
    "max_attempts": 2
  },
  "safety": {
    "customer_action": false,
    "public_posting": false,
    "paid_ads_change": false,
    "destructive_action": false
  },
  "expected_status": "PASS"
}
```

## Minimal dispatch JSON

```json
{
  "task_file": "ops/agent-control/tasks/OC-TEST-001.json",
  "force_rerun": true
}
```

## Hard requirements

- `task_file` must stay under `ops/agent-control/tasks/`.
- `task_file` must end with `.json`.
- `task_file` must not contain `..`.
- Use `"status": "pending"` only when you want direct task-push auto-execution.
- `type` must be `heartbeat`, `virtual_browser_audit`, or `synthetic_fail`.
- `target_origin` must be a bare `https://` origin.
- `routes` must be relative routes for the same origin.
- All four safety flags must stay `false`.
- Do not include emails, phone numbers, tokens, or secrets.
- Do not include outreach, purchase, publication, or customer-action instructions.

## ChatGPT-compatible flow

1. Create the task JSON under `ops/agent-control/tasks/`.
2. Create the dispatch JSON under `ops/agent-control/dispatch/`.
3. Push the branch.
4. Wait for `openclaw-chatgpt-dispatch.yml`.
5. Check `ops/agent-control/STATUS.md`.
6. If present in the repo, also check `ops/agent-control/reports/openclaw-latest.json`.

Notes:
- If the same push includes both the task JSON and a dispatch JSON for that task, only the dispatch workflow should execute it.
- For workflow-dispatch or API-driven launch of an existing task file, the task file itself does not need to change.

## Manual fallback

```bash
gh workflow run openclaw-task-runner.yml \
  --repo 2133611700c-sudo/opencloud-gpt-agent \
  --ref main \
  -f task_file=ops/agent-control/tasks/<TASK>.json \
  -f force_rerun=true \
  -f run_windows_smoke=false
```
