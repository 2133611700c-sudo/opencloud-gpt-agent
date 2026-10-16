#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo 'A9 DeepSeek credential missing' >&2
  exit 1
fi

state_dir="$PWD/.a9-install-state"
install -d -m 700 "$state_dir"
export OPENCLAW_STATE_DIR="$state_dir"
export OPENCLAW_CONFIG_PATH="$state_dir/openclaw.json"
export OPENCLAW_EXEC_SHELL_SNAPSHOT=0

npm install -g openclaw@2026.10.3 --allow-scripts=openclaw
version_output="$(openclaw --version | tail -n 1 | tr -d '\r')"
printf '%s\n' "$version_output"
version_token="$(printf '%s\n' "$version_output" | awk '{print $2}')"
test "$version_token" = '2026.10.3'

openclaw setup --baseline --skip-bootstrap --workspace "$PWD" --json > /tmp/a9-baseline.json
openclaw plugins install @openclaw/deepseek-provider@2026.10.3
openclaw config validate --json > /tmp/a9-install-config.json

openclaw models list --refresh --provider deepseek --json > /tmp/a9-models.json
MODELS_JSON="$(cat /tmp/a9-models.json)" node --input-type=module -e '
const value = JSON.parse(process.env.MODELS_JSON);
if (!Array.isArray(value?.models)) throw new Error("DeepSeek discovery returned no models array");
const model = value.models.find((entry) => entry?.key === "deepseek/deepseek-flash");
if (!model || model.available !== true) throw new Error("deepseek/deepseek-flash is not available");
'

node scripts/a9-vercel-acceptance.mjs
