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
- GitHub Environment `openclaw-v2-live` does not currently expose `DEEPSEEK_API_KEY` to the runner: run `38887034597` logged the variable as empty and the explicit presence probe returned `DEEPSEEK_API_KEY=MISSING`.
- Therefore the saved Library credential itself has not yet been live-validated from GitHub Actions.

## Test ledger

| # | Root function | Status | DeepSeek key involved? | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | `acp` | PASS | No | run `38884163886`, job `116917768975`: 5 files / 44 tests PASS | Exact upstream 10.3 ACP suite passed. |
| 2 | `agent` | BLOCKED | Yes | run `38887034597`, job `116927162786` | GitHub runner received empty `DEEPSEEK_API_KEY`; no DeepSeek API call occurred. |
| 3 | `agents` | PASS | No | run `38887274775`, job `116927966115` | Real create/list/identity/team/delete lifecycle passed. |
| 4 | `approvals` | PENDING | No model key required | — | Approval lifecycle smoke next. |
| 5 | `attach` | PENDING | No for attach/session transport smoke | — | Attach to a live session/runtime and prove transport. |

## Detailed results

### F01 `acp` — FINAL — PASS
- Run `38884163886`, job `116917768975`.
- Exact upstream `v2026.10.3`, commit `59cb44796b0f1f0daa0e37af8b1495abb45d9bc1`, Node `24.21.0`.
- Install and build passed; `openclaw acp --help` passed.
- Official upstream ACP selection: 5 test files / 44 tests PASS.
- DeepSeek credential: NOT USED.

### F01 observed earlier attempts
- Run `38883528473`: HARNESS_INVALID because raw source tree had not been built; ACP code was not reached.
- Run `38885737474`: INCONCLUSIVE/HARNESS_GATED; published package and Gateway started, but the health probe gated the ACP lifecycle step.

### F02 `agent` — FINAL FOR THIS TEST PASS — BLOCKED_BY_SECRET_SCOPE
- Run `38887034597`, job `116927162786`.
- Published OpenClaw 10.3 installed successfully.
- Official DeepSeek provider plugin 10.3 installed successfully.
- GitHub runner showed `DEEPSEEK_API_KEY=MISSING`.
- `openclaw agent exec` was invoked with `deepseek/deepseek-flash` and returned exit `1`, JSON `ok=false`, `status=error`, provider/model null, and `Unknown model: deepseek/deepseek-flash` / `model_not_found`.
- No DeepSeek API request occurred, so the recovered Library key itself is not yet live-validated from GitHub.
- Earlier run `38886910739` was HARNESS_INVALID before any job allocation.
- No repair was applied.

### F03 `agents` — FINAL — PASS
- Run `38887274775`, job `116927966115`.
- Published `openclaw@2026.10.3` installed successfully in an isolated state directory.
- Initial roster returned implicit/default `main`.
- `agents add research --role researcher --non-interactive --json`: PASS; created isolated `research` workspace and agent directory.
- Subsequent list showed role identity `Researcher` with its role identity metadata.
- `agents set-identity`: PASS; persisted custom name/theme/emoji for `research`.
- `agents team create --prefix f03 ...`: PASS; created `f03-coordinator`, `f03-researcher`, `f03-writer`, `f03-reviewer` with separate workspaces and agent directories.
- Final roster/list/bindings commands: PASS; team agents were present and no bindings were configured.
- `agents delete research --force --json`: PASS; standalone `research` removed, `failed=[]`; workspace/session cleanup used Trash where available.
- Observation: delete reported `cronCleanupSkipped=true` and warned that cron cleanup was skipped because the Gateway could not be authenticated. This did not fail agent deletion and is retained as an observation, not repaired.
- Final roster confirmed standalone `research` gone while the four-agent team remained.
- DeepSeek credential: NOT USED; `agents` management lifecycle does not require a model call.
