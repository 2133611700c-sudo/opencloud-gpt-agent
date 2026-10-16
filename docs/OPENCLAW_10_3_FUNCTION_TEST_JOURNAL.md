# OpenClaw 2026.10.3 — Function Acceptance Journal

Scope: first five root functions only, tested one-by-one.

Rules:
- Exact version: `openclaw@2026.10.3`.
- One function is tested and closed before moving to the next.
- Status values: `PASS`, `FAIL`, `BLOCKED`, `PENDING`.
- No credential value is written to Git, artifacts, logs, or this journal.
- For provider-dependent functions, record whether a valid DeepSeek credential was available to the test runtime and whether a real model request succeeded.

## Secret / provider tracking

Current verified observations:
- The previously supplied DeepSeek credential was recovered from the user's canonical ChatGPT Library journal dated 2026-10-15.
- The exact value is not copied into this repository.
- An earlier GitHub Actions probe did not receive `DEEPSEEK_API_KEY` from Environment `openclaw-v2-live`.

## Test ledger

| # | Root function | Status | DeepSeek key involved? | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | `acp` | PENDING | No for protocol smoke | GitHub run `38883528473` = HARNESS_INVALID | First attempt never reached ACP because the source tree was not built. |
| 2 | `agent` | PENDING | Yes | — | Real agent run with DeepSeek required. |
| 3 | `agents` | PENDING | Yes for spawned/selected agent execution | — | Agent inventory/routing plus execution required. |
| 4 | `approvals` | PENDING | No model key required | — | Approval lifecycle smoke. |
| 5 | `attach` | PENDING | No for attach/session transport smoke | — | Attach to a live session/runtime and prove transport. |

## Detailed results

### F01 `acp` — attempt 1 — HARNESS_INVALID
- GitHub Actions run: `38883528473`.
- Exact upstream tag: `v2026.10.3` at commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`.
- Node: `24.21.0`.
- `pnpm install --frozen-lockfile`: PASS.
- The failure occurred at `node openclaw.mjs acp --help` before ACP protocol execution.
- Exact cause: the source checkout had no built `dist/entry.(m)js`; upstream instructed running `pnpm build` or installing a built package.
- Classification: test-harness defect, not an ACP functional failure.
- Next action: add the build step and rerun only F01.
