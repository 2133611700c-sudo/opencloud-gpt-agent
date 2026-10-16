#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo 'DEEPSEEK_API_KEY is missing from trusted runtime environment' >&2
  exit 1
fi

export OPENCLAW_STATE_DIR="$PWD/.openclaw-direct-onboard-state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
export OPENCLAW_SKIP_CHANNELS=1
install -d -m 700 "$OPENCLAW_STATE_DIR"

npm install -g openclaw@2026.10.3 --allow-scripts=openclaw >/tmp/openclaw-install.log 2>&1
openclaw --version
openclaw setup --baseline --skip-bootstrap --workspace "$PWD" --json >/tmp/openclaw-setup.json
openclaw plugins install @openclaw/deepseek-provider@2026.10.3 >/tmp/openclaw-deepseek-plugin.log 2>&1

# Official DeepSeek v2026.10.3 non-interactive onboarding path.
# The credential comes from the trusted process environment and is not written to Git/logs.
openclaw onboard \
  --non-interactive \
  --mode local \
  --auth-choice deepseek-api-key \
  --deepseek-api-key "$DEEPSEEK_API_KEY" \
  --skip-health \
  --accept-risk >/tmp/openclaw-deepseek-onboard.log

echo 'OPENCLAW_DEEPSEEK_ONBOARD_OK'
openclaw config validate --json

# Verify main owns a DeepSeek credential profile.
openclaw models auth list --provider deepseek --agent main --json >/tmp/openclaw-auth-list.json
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync('/tmp/openclaw-auth-list.json', 'utf8'));
const text = JSON.stringify(value);
if (!text.includes('deepseek')) throw new Error('No DeepSeek auth profile found for main');
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_PROFILE_OK');
NODE

# Verify onboarding selected DeepSeek V4 Pro for inference.
DEFAULT_MODEL="$(openclaw config get agents.defaults.model --json)"
printf 'OPENCLAW_DEFAULT_MODEL=%s\n' "$DEFAULT_MODEL"
if [[ "$DEFAULT_MODEL" != *"deepseek/deepseek-v4-pro"* ]]; then
  echo 'DeepSeek onboarding did not select deepseek/deepseek-v4-pro' >&2
  exit 1
fi

# Perform a real model/auth probe through OpenClaw for the main agent.
openclaw models status \
  --agent main \
  --probe \
  --probe-provider deepseek \
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
    if (provider === 'deepseek' || profileId?.startsWith('deepseek:')) rows.push({ path, provider, profileId, status, reason: v.reason ?? v.detail ?? null });
  }
  for (const [k, child] of Object.entries(v)) {
    if (/key|secret|token|credential/i.test(k)) continue;
    if (child && typeof child === 'object') walk(child, `${path}.${k}`);
  }
};
walk(value);
console.log(`OPENCLAW_DEEPSEEK_PROBE_SUMMARY ${JSON.stringify(rows)}`);
if (!rows.some((r) => r.status === 'ok' && (r.provider === 'deepseek' || r.profileId?.startsWith('deepseek:')))) {
  throw new Error('DeepSeek live probe did not report status=ok');
}
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_LIVE_PROBE_OK');
NODE

mkdir -p a9-output
printf '%s\n' '<!doctype html><meta charset="utf-8"><title>OpenClaw DeepSeek onboarding PASS</title><h1>OpenClaw main-agent DeepSeek onboarding PASS</h1>' > a9-output/index.html
