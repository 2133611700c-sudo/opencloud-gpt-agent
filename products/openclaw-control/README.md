# OpenClaw Control

Phone-first control surface for the OpenCloud supervisor loop.

## What it does

- Reads the current OpenClaw status from `main`
- Uses `ops/agent-control/reports/openclaw-latest.json` when present
- Falls back to the managed OpenClaw block in `ops/agent-control/STATUS.md`
- Lists active and recent OpenClaw workflow runs
- Launches a new task via:
  - dispatch file commit, or
  - `workflow_dispatch`
- Reruns or cancels a workflow run

## Required environment variables

- `OPENCLAW_GITHUB_TOKEN`
  - Fine-grained PAT fallback for one repo only
  - Required scopes: contents write, actions write, metadata read
- `OPENCLAW_CONTROL_SHARED_SECRET`
  - Shared secret required in `X-OpenCloud-Control-Key`
- `OPENCLAW_REPO_OWNER`
  - Optional, defaults to `2133611700c-sudo`
- `OPENCLAW_REPO_NAME`
  - Optional, defaults to `opencloud-gpt-agent`

## Security notes

- No token is exposed to client JavaScript.
- The browser only sends the shared secret to the same-origin API route.
- The client does not persist the shared secret in `localStorage`, `sessionStorage`, or cookies.
- The GitHub token stays server-side in Vercel environment variables.
- Prefer a GitHub App installation token in the future; the current implementation is the documented PAT fallback.
