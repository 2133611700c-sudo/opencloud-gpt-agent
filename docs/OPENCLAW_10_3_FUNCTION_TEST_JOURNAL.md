# OpenClaw 2026.10.3 — Function Acceptance Journal

Scope: first five root functions only, tested one-by-one on GitHub Actions.

Rules:
- Exact version: `openclaw@2026.10.3`.
- One function is tested and closed before moving to the next.
- Status values: `PASS`, `FAIL`, `BLOCKED`, `PENDING`.
- DeepSeek secret values are never written to Git, artifacts, logs, or this journal.
- For provider-dependent functions, record whether `DEEPSEEK_API_KEY` was actually available to the GitHub runner and whether a real model request succeeded.

## Secret / provider tracking

Current observations before the five tests:
- GitHub Environment `openclaw-v2-live`: earlier live probe saw `DEEPSEEK_API_KEY` as empty/unavailable to the runner.
- Vercel project inventory contains historical OpenClaw acceptance/runtime projects, including `openclaw-a8-live-acceptance`, `openclaw-a7-acceptance`, and `openclaw-v2-runtime`.
- Direct Vercel env listing through the connected Vercel API currently returns HTTP 403, so the secret value/location inside that project cannot be read through that connector.
- No secret value is copied into this repository.

## Test ledger

| # | Root function | Status | DeepSeek key involved? | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | `acp` | PENDING | No for protocol smoke; Yes only if prompt/model path is exercised | — | Gateway-backed ACP protocol smoke planned first. |
| 2 | `agent` | PENDING | Yes | — | Real agent run with DeepSeek required. |
| 3 | `agents` | PENDING | Yes for spawned/selected agent execution | — | Agent inventory/routing plus execution required. |
| 4 | `approvals` | PENDING | No model key required for policy/approval lifecycle | — | Approval creation/decision/enforcement smoke. |
| 5 | `attach` | PENDING | No for attach/session transport smoke; model key only if prompt is sent | — | Attach to a live session/runtime and prove transport. |

## Detailed results

No completed tests yet.
