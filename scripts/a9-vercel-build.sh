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
    const secrets = [process.env.DEEPSEEK_API_KEY ?? ""];
    try {
      const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
      if (typeof cfg?.gateway?.auth?.token === "string") secrets.push(cfg.gateway.auth.token);
    } catch {}
    const redact = (input) => {
      let body = String(input ?? "");
      for (const secret of secrets) if (secret) body = body.split(secret).join("[REDACTED]");
      body = body.replace(/([?&](?:token|key)=)[^&\s]+/gi, "$1[REDACTED]");
      return body.length > 32000 ? `${body.slice(0, 32000)}\n...[truncated]` : body;
    };
    for (const file of [
      "/tmp/a9-agent-stdout.json",
      "/tmp/a9-agent-stderr.txt",
      "/tmp/a9-gateway-stdout.txt",
      "/tmp/a9-gateway-stderr.txt",
    ]) {
      try {
        console.error(`--- ${file} ---\n${redact(readFileSync(file, "utf8"))}`);
      } catch {}
    }
  '
  echo '--- A9 state file inventory ---' >&2
  find "$state_dir" -maxdepth 7 -type f -printf '%p %s bytes\n' 2>/dev/null | sed "s#$PWD#.#g" | tail -n 200 >&2 || true
  echo '--- A9 sessions snapshot ---' >&2
  openclaw sessions --all-agents --json 2>/dev/null | head -c 32000 >&2 || true
  printf '\n' >&2
  exit 1
fi
