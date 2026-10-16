#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo 'DeepSeek credential missing' >&2
  exit 1
fi

state_dir="$PWD/.deepseek-model-discovery-state"
install -d -m 700 "$state_dir"
export OPENCLAW_STATE_DIR="$state_dir"
export OPENCLAW_CONFIG_PATH="$state_dir/openclaw.json"
export OPENCLAW_EXEC_SHELL_SNAPSHOT=0
export OPENCLAW_SKIP_CHANNELS=1

npm install -g openclaw@2026.10.3 --allow-scripts=openclaw
openclaw --version
openclaw setup --baseline --skip-bootstrap --workspace "$PWD" --json > /tmp/openclaw-baseline.json
openclaw plugins install @openclaw/deepseek-provider@2026.10.3
openclaw config validate --json > /tmp/openclaw-config.json

openclaw models list --refresh --provider deepseek --json > /tmp/deepseek-models.json
MODELS_JSON="$(cat /tmp/deepseek-models.json)" node --input-type=module -e '
const value = JSON.parse(process.env.MODELS_JSON);
const rows = Array.isArray(value?.models) ? value.models : [];
const out = rows.map((m) => ({
  key: m?.key ?? null,
  name: m?.name ?? null,
  available: m?.available ?? null,
  reasoning: m?.reasoning ?? null,
  input: m?.input ?? null,
  contextWindow: m?.contextWindow ?? null,
  maxTokens: m?.maxTokens ?? null,
}));
console.log(`OPENCLAW_DEEPSEEK_MODELS ${JSON.stringify(out)}`);
if (!out.some((m) => m.available === true)) process.exit(2);
'

mkdir -p a9-output
printf '%s\n' '<!doctype html><meta charset="utf-8"><title>OpenClaw model discovery</title><h1>OpenClaw model discovery complete</h1>' > a9-output/index.html
