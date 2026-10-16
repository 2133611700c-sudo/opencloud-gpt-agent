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
export OPENCLAW_SKIP_CHANNELS=1

node --check scripts/a9-vercel-acceptance.mjs
npm install -g openclaw@2026.10.3 --allow-scripts=openclaw
version_output="$(openclaw --version | tail -n 1 | tr -d '\r')"
printf '%s\n' "$version_output"
version_token="$(printf '%s\n' "$version_output" | awk '{print $2}')"
test "$version_token" = '2026.10.3'

openclaw setup --baseline --skip-bootstrap --workspace "$PWD" --json > /tmp/a9-baseline.json
openclaw config set tools.toolSearch false
openclaw plugins install @openclaw/deepseek-provider@2026.10.3
openclaw config validate --json > /tmp/a9-install-config.json

if ! node scripts/a9-vercel-acceptance.mjs; then
  echo '=== A9 SAFE FAILURE DIAGNOSTICS ===' >&2
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const secret = process.env.DEEPSEEK_API_KEY ?? "";
    for (const file of ["/tmp/a9-agent-stdout.json", "/tmp/a9-agent-stderr.txt"]) {
      try {
        let body = readFileSync(file, "utf8");
        if (secret) body = body.split(secret).join("[REDACTED]");
        if (body.length > 16000) body = `${body.slice(0, 16000)}\n...[truncated]`;
        console.error(`--- ${file} ---\n${body}`);
      } catch {}
    }
  '
  exit 1
fi
