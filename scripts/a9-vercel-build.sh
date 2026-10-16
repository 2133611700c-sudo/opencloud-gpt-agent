#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo 'DEEPSEEK_API_KEY is missing from trusted runtime environment' >&2
  exit 1
fi

export OPENCLAW_STATE_DIR="$PWD/.openclaw-direct-key-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
export OPENCLAW_SKIP_CHANNELS=1
install -d -m 700 "$OPENCLAW_STATE_DIR"

npm install -g openclaw@2026.10.3 --allow-scripts=openclaw >/tmp/openclaw-install.log 2>&1
openclaw --version
openclaw setup --baseline --skip-bootstrap --workspace "$PWD" --json >/tmp/openclaw-setup.json
openclaw plugins install @openclaw/deepseek-provider@2026.10.3 >/tmp/openclaw-deepseek-plugin.log 2>&1
openclaw config validate --json

# Official per-agent API-key path: OpenClaw reads the secret from piped stdin.
printf '%s\n' "$DEEPSEEK_API_KEY" | \
  openclaw models auth paste-api-key \
    --provider deepseek \
    --agent main \
    --profile-id deepseek:manual >/tmp/openclaw-auth-write.log

echo 'OPENCLAW_AUTH_WRITE_OK'

openclaw models auth list --provider deepseek --agent main --json >/tmp/openclaw-auth-list.json
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync('/tmp/openclaw-auth-list.json', 'utf8'));
const text = JSON.stringify(value);
if (!text.includes('deepseek:manual')) throw new Error('Expected deepseek:manual profile missing for main');
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_PROFILE_OK');
NODE

# Official DeepSeek docs: discover provider catalog, then bind V4 Pro to the agent.
openclaw models list --agent main --provider deepseek --refresh --json >/tmp/openclaw-deepseek-models.json
openclaw config set agents.entries.main.model '"deepseek/deepseek-v4-pro"' --strict-json
openclaw config validate --json >/tmp/openclaw-config-after-model.json
MODEL="$(openclaw config get agents.entries.main.model)"
printf 'OPENCLAW_MAIN_AGENT_MODEL=%s\n' "$MODEL"

# Live auth/model call through OpenClaw, scoped to main + deepseek:manual.
openclaw models status \
  --agent main \
  --probe \
  --probe-provider deepseek \
  --probe-profile deepseek:manual \
  --probe-timeout 30000 \
  --probe-max-tokens 16 \
  --json >/tmp/openclaw-deepseek-probe.json

node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync('/tmp/openclaw-deepseek-probe.json', 'utf8'));
const rows = [];
const walk = (v, path = '$') => {
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) {
    const provider = typeof v.provider === 'string' ? v.provider : null;
    const profileId = typeof v.profileId === 'string' ? v.profileId : (typeof v.id === 'string' && v.id.includes(':') ? v.id : null);
    const status = typeof v.status === 'string' ? v.status : null;
    if (provider === 'deepseek' || profileId === 'deepseek:manual') rows.push({ path, provider, profileId, status, reason: v.reason ?? v.detail ?? null });
  }
  for (const [k, child] of Object.entries(v)) {
    if (/key|secret|token|credential/i.test(k)) continue;
    if (child && typeof child === 'object') walk(child, `${path}.${k}`);
  }
};
walk(value);
console.log(`OPENCLAW_DEEPSEEK_PROBE_SUMMARY ${JSON.stringify(rows)}`);
if (!rows.some((r) => r.profileId === 'deepseek:manual' && r.status === 'ok')) {
  throw new Error('DeepSeek live probe for deepseek:manual did not report status=ok');
}
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_LIVE_PROBE_OK');
NODE

mkdir -p a9-output
printf '%s\n' '<!doctype html><meta charset="utf-8"><title>OpenClaw DeepSeek auth PASS</title><h1>OpenClaw main-agent DeepSeek auth PASS</h1>' > a9-output/index.html
