# ACCESS REGISTRY

Status: ACTIVE
Purpose: canonical inventory of credential references and important runtime environment variables used by OpenClaw V2. Secret values are not duplicated here; this file records the exact variable name, purpose, native storage location, consumers, and verified status.

## Credential references

| Variable | Purpose | Native storage / source | Consumers | Verified state |
|---|---|---|---|---|
| `DEEPSEEK_API_KEY` | Authenticate DeepSeek provider used by OpenClaw Research | GitHub Actions Secrets when CI/live jobs use it; runtime secret environment for direct live execution | OpenClaw DeepSeek provider, Research runtime, live smoke/gates | Live provider path verified; continuous GitHub Actions availability remained not proven at final 48h checkpoint |
| `DATABASE_URL` | Connect V2 runtime to hosted PostgreSQL/Neon | GitHub Actions Secrets for hosted/live CI; production runtime secret environment for hosted function/workers | Kernel, Research/Data, Evidence, Phone, hosted checks | Hosted/runtime database path verified; continuous GitHub Actions availability remained not proven at final 48h checkpoint |
| `OPENCLAW_USER_INTAKE_SECRET` | Bearer credential for `POST /v1/research/tasks` | Hosted Neon Function/runtime secret environment | USER HTTP intake handler | Live authenticated external USER HTTP path verified |
| `GH_TOKEN` / `${{ github.token }}` | GitHub Actions machine identity/status API | Ephemeral token issued automatically per GitHub Actions run | V2 CI GitHub API step | Platform-managed; no static user value required |

## Important non-secret runtime variables

| Variable | Purpose | Verified rule/value |
|---|---|---|
| `OPENCLAW_USER_INTAKE_PRINCIPAL` | Principal bound to authenticated USER HTTP intake | Final live proof used `operator` |
| `OPENCLAW_PUBLIC_BASE_URL` | Public origin used for Phone/deep-log URLs | Must match deployed public function origin |
| `OPENCLAW_DEEPSEEK_MODEL` | Requested DeepSeek model | Final 48h runtime used `deepseek/deepseek-flash` |
| `OPENCLAW_DEEPSEEK_PRICING_VERSION` | Accounting pricing identifier | Final 48h runtime used `deepseek-v4.1-flash-2026-09-10` |
| `OPENCLAW_WEB_FETCH_TRUSTED_ENV_PROXY` | Explicit trusted proxy opt-in | Optional boolean; only `true`/`false`; absent means direct networking |
| `OPENCLAW_STATE_DIR` | Isolated OpenClaw state directory | CI creates an ephemeral private runner directory |
| `OPENCLAW_V2_STATE_DIR` | V2 alias for isolated state directory | Same ephemeral CI directory as `OPENCLAW_STATE_DIR` |
| `OPENCLAW_CONFIG_PATH` | Generated OpenClaw config path | CI uses `/tmp/openclaw-v2-research.json` during validation |
| `OPENCLAW_CONFIG_READONLY` | Prevent runtime mutation during config validation | CI uses `1` |

## Verified source map

- `.github/workflows/v2-ci.yml`: `DATABASE_URL`, `DEEPSEEK_API_KEY`, model/pricing settings, isolated state/config variables.
- `.github/workflows/v2-live-prerequisites.yml`: presence checks for `DATABASE_URL` and `DEEPSEEK_API_KEY` without exposing values.
- `src/providers/openclaw-deepseek-infer.mjs`: `DEEPSEEK_API_KEY` is a required provider environment variable.
- `functions/phone/index.mjs`: `DATABASE_URL`, `OPENCLAW_USER_INTAKE_SECRET`, `OPENCLAW_USER_INTAKE_PRINCIPAL`, `OPENCLAW_PUBLIC_BASE_URL`.
- `scripts/live-research-kernel-vertical.mjs`: `DATABASE_URL`, `DEEPSEEK_API_KEY`, model/pricing and optional trusted-proxy configuration.
- `docs/48H_FINAL_VERIFICATION_2026-10-15.md`: direct live proof of the authenticated USER HTTP + paid DeepSeek + hosted PostgreSQL chain, while continuous GitHub Actions secret plumbing remained not proven.

## Maintenance rule

Update this registry in the same work cycle whenever a credential reference or protected runtime variable is introduced, moved, rotated, revoked, replaced, becomes obsolete, changes consumer, or changes verified status. Never infer that a credential is present merely because code references its name; presence/working status requires direct secret-store/runtime/provider evidence.
