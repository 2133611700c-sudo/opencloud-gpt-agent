import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { runDeepSeekInferSmoke } from '../src/providers/deepseek-smoke-runner.mjs';

const model = process.env.OPENCLAW_DEEPSEEK_MODEL || 'deepseek/deepseek-v4-flash';
const expected = 'smoke-ok';
const started = performance.now();

try {
  const result = await runDeepSeekInferSmoke({
    model,
    prompt: `Reply with exactly: ${expected}`,
    thinking: 'off',
    timeoutMs: 60_000,
    maxStdoutBytes: 1_000_000,
    maxStderrBytes: 200_000,
  });

  if (result.text.trim() !== expected) {
    throw new Error('DeepSeek live smoke returned unexpected text');
  }

  const wallLatencyMs = Math.round(performance.now() - started);
  const outputSha256 = createHash('sha256').update(result.text).digest('hex');

  const safeEvidence = {
    status: 'PASS',
    provider: result.provider,
    model: result.model,
    transport: result.transport,
    wall_latency_ms: wallLatencyMs,
    output_sha256: outputSha256,
    telemetry: {
      usage_fidelity: result.telemetry?.usageFidelity ?? 'NOT_EXPOSED_BY_ENVELOPE',
      cost_fidelity: result.telemetry?.costFidelity ?? 'NOT_EXPOSED_BY_ENVELOPE',
      cache_split_invented: result.telemetry?.cacheSplitInvented ?? false,
    },
  };

  process.stdout.write(`${JSON.stringify(safeEvidence)}\n`);
} catch (error) {
  const safeFailure = {
    status: 'FAIL',
    code: typeof error?.code === 'string' ? error.code : 'LIVE_SMOKE_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'DeepSeek live smoke failed',
  };
  process.stderr.write(`${JSON.stringify(safeFailure)}\n`);
  process.exitCode = 1;
}
