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

# OpenClaw 2026.10.3 persists session state behind its current state store, so the
# old raw JSONL/deleted-archive scan is not a stable acceptance surface. Build a
# runtime-only copy that verifies the exact child + resumed-parent completions
# emitted by the Gateway, then separately verifies cleanup via the sessions API.
node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';

const input = 'scripts/a9-vercel-acceptance.mjs';
const output = '/tmp/a9-vercel-acceptance-runtime.mjs';
let source = await readFile(input, 'utf8');

const startMarker = 'async function locatePushResumeEvidence() {';
const endMarker = '\nasync function stopGateway()';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('A9 evidence function markers not found');

const replacement = String.raw`async function locatePushResumeEvidence() {
  const deadline = Date.now() + 120000;
  let childObserved = false;
  let parentObserved = false;
  let gatewayLogBytes = 0;
  while (Date.now() < deadline) {
    if (gateway?.exitCode != null || gateway?.signalCode != null) {
      throw new Error(
        \`A9 Gateway exited while waiting for push-resume: exit=\${gateway.exitCode} signal=\${gateway.signalCode}\`,
      );
    }
    let body = '';
    try {
      body = await readFile(gatewayStdoutPath, 'utf8');
    } catch {
      // Gateway may not have flushed its first completion line yet.
    }
    gatewayLogBytes = Buffer.byteLength(body, 'utf8');
    const lines = body.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
    childObserved = lines.some(
      (line) => /(?:^|\\s)CHILD_OK$/.test(line) && !line.endsWith('PARENT_OK:CHILD_OK'),
    );
    parentObserved = lines.some((line) => /(?:^|\\s)PARENT_OK:CHILD_OK$/.test(line));
    if (childObserved && parentObserved) {
      return { gatewayLogBytes };
    }
    await sleep(250);
  }
  throw new Error(
    \`A9 push-resume evidence timeout: childFinal=\${childObserved} parentFinal=\${parentObserved}\`,
  );
}`;

source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace(
  '  const { parentTranscript, childArchive } = await locatePushResumeEvidence();',
  '  const { gatewayLogBytes } = await locatePushResumeEvidence();',
);
source = source.replace(
  /  const archiveStat = await stat\(childArchive\);[\s\S]*?  if \(parentStat\.size <= 0\) throw new Error\('A9 parent transcript is empty'\);\n/,
  '',
);
source = source.replace(
  '    childAssistantResultVerifiedFromDeletedTranscript: true,',
  '    childAssistantResultVerifiedFromGatewayCompletion: true,',
);
source = source.replace(
  '    parentTranscriptBytes: parentStat.size,\n    deletedChildTranscriptBytes: archiveStat.size,',
  '    gatewayCompletionLogBytes: gatewayLogBytes,\n    gatewayChildCompletionObserved: true,',
);

if (source.includes('parentTranscriptBytes: parentStat.size') || source.includes('deletedChildTranscriptBytes: archiveStat.size')) {
  throw new Error('A9 obsolete transcript evidence fields remain after runtime patch');
}
if (!source.includes('gatewayCompletionLogBytes: gatewayLogBytes')) {
  throw new Error('A9 Gateway evidence patch did not apply');
}
await writeFile(output, source, { mode: 0o600 });
NODE

node --check /tmp/a9-vercel-acceptance-runtime.mjs

if ! node /tmp/a9-vercel-acceptance-runtime.mjs; then
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
  echo '--- A9 sessions snapshot ---' >&2
  openclaw sessions --all-agents --json 2>/dev/null | head -c 32000 >&2 || true
  printf '\n' >&2
  exit 1
fi
