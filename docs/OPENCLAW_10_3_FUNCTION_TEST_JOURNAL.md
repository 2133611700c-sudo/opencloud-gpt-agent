# OpenClaw 2026.10.3 — Function Acceptance Journal

Scope: first five root functions only, tested one-by-one.

Rules:
- Exact version: `openclaw@2026.10.3`.
- One function is tested and closed before moving to the next.
- Status values: `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE`, `PENDING`.
- No credential value is written to Git, artifacts, logs, or this journal.
- For provider-dependent functions, record whether a valid DeepSeek credential was available to the test runtime and whether a real model request succeeded.
- During the five-function test pass, observed problems are recorded but not repaired.

## Secret / provider tracking

Current verified observations:
- The previously supplied DeepSeek credential was recovered from the user's canonical ChatGPT Library journal dated 2026-10-15.
- The exact value is not copied into this repository.
- An earlier GitHub Actions probe did not receive `DEEPSEEK_API_KEY` from Environment `openclaw-v2-live`.

## Test ledger

| # | Root function | Status | DeepSeek key involved? | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | `acp` | PASS | No | GitHub run `38884163886`, job `116917768975`: 5 test files / 44 tests PASS | Exact upstream `v2026.10.3` built and official ACP client/session/process tests passed. Earlier invalid/inconclusive harness attempts are retained below. |
| 2 | `agent` | PENDING | Yes | — | Real agent run with DeepSeek required. |
| 3 | `agents` | PENDING | Yes for spawned/selected agent execution | — | Agent inventory/routing plus execution required. |
| 4 | `approvals` | PENDING | No model key required | — | Approval lifecycle smoke. |
| 5 | `attach` | PENDING | No for attach/session transport smoke | — | Attach to a live session/runtime and prove transport. |

## Detailed results

### F01 `acp` — FINAL — PASS
- GitHub Actions run: `38884163886`.
- Job: `116917768975`.
- Exact upstream tag: `v2026.10.3` at commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`.
- Node: `24.21.0`.
- `pnpm install --frozen-lockfile`: PASS.
- `pnpm build`: PASS.
- `node openclaw.mjs acp --help`: PASS.
- Official upstream ACP test selection: 5 test files passed, 44 tests passed.
- Covered behavior included child-environment sanitization, permission handling, read/search scope enforcement, prompt/resource/image mapping, session bridge creation, transcript/thinking replay, session rate limiting, completion settlement, partial tool-output streaming, interactive process lifecycle, and CLI initialize/exit behavior.
- DeepSeek credential: NOT USED. This ACP functional acceptance did not require a model request.
- Result: `PASS`.

### F01 `acp` — attempt 1 — HARNESS_INVALID
- GitHub Actions run: `38883528473`.
- Exact upstream tag: `v2026.10.3` at commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`.
- Node: `24.21.0`.
- `pnpm install --frozen-lockfile`: PASS.
- The failure occurred at `node openclaw.mjs acp --help` before ACP protocol execution.
- Exact cause: the source checkout had no built `dist/entry.(m)js`.
- Classification: test-harness defect, not an ACP functional failure.

### F01 `acp` — attempt 2 — INCONCLUSIVE / HARNESS_GATED
- GitHub Actions run: `38885737474`.
- Published `openclaw@2026.10.3` installed successfully.
- `openclaw --version`: PASS, reported `OpenClaw 2026.10.3 (59cb447)`.
- `openclaw acp --help`: PASS.
- `openclaw acp client --help`: PASS.
- Isolated Gateway process started successfully and logged `[gateway] ready`.
- The test step that waited on its health probe exited nonzero even though Gateway logs showed the Gateway was already ready.
- Because that step failed first, `Exercise ACP client-to-bridge lifecycle` was skipped.
- Classification: ACP command surface and Gateway prerequisite are proven callable; this attempt by itself was inconclusive.
- No repair was applied after observing this result.
