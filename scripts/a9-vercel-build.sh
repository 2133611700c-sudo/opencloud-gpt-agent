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

# Official per-agent API-key path. The key is read by OpenClaw from piped stdin;
# it is never written to Git or printed to logs.
printf '%s\n' "$DEEPSEEK_API_KEY" | \
  openclaw models auth paste-api-key \
    --provider deepseek \
    --agent main \
    --profile-id deepseek:manual >/tmp/openclaw-auth-write.log

echo 'OPENCLAW_AUTH_WRITE_OK'

# Verify that the credential now belongs to the main agent.
openclaw models auth list --provider deepseek --agent main --json >/tmp/openclaw-auth-list.json
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const value = JSON.parse(readFileSync('/tmp/openclaw-auth-list.json', 'utf8'));
const text = JSON.stringify(value);
if (!text.includes('deepseek')) throw new Error('DeepSeek auth profile not visible for main agent');
if (!text.includes('deepseek:manual')) throw new Error('Expected deepseek:manual profile missing');
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_PROFILE_OK');
NODE

# Live provider probe through OpenClaw using the main agent's saved auth profile.
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
const text = JSON.stringify(value);
if (!text.includes('deepseek:manual')) throw new Error('Probe output does not reference deepseek:manual');
if (!/\"status\"\s*:\s*\"ok\"/.test(text)) throw new Error('DeepSeek live probe did not report status=ok');
console.log('OPENCLAW_MAIN_AGENT_DEEPSEEK_LIVE_PROBE_OK');
NODE

mkdir -p a9-output
printf '%s\n' '<!doctype html><meta charset="utf-8"><title>OpenClaw DeepSeek auth PASS</title><h1>OpenClaw main-agent DeepSeek auth PASS</h1>' > a9-output/index.html
