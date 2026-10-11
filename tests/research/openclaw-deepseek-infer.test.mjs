import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeepSeekInferInvocation,
  parseDeepSeekInferEnvelope,
} from '../../src/providers/openclaw-deepseek-infer.mjs';

const envelope = (usage) => ({
  ok: true,
  capability: 'model.run',
  transport: 'local',
  provider: 'deepseek',
  model: 'deepseek-flash',
  outputs: [{ text: 'ok' }],
  usage,
  costUsd: 0.01,
});

test('builds a bounded DeepSeek local infer invocation', () => {
  const invocation = buildDeepSeekInferInvocation({
    model: 'deepseek/deepseek-flash',
    prompt: 'Reply with ok',
    thinking: 'max',
  });
  assert.equal(invocation.executable, 'openclaw');
  assert.ok(invocation.args.includes('--local'));
  assert.ok(invocation.args.includes('deepseek/deepseek-flash'));
  assert.ok(invocation.args.includes('max'));
});

test('preserves and accepts full cache-aware usage totals', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 80,
    output: 20,
    cacheRead: 30,
    cacheWrite: 5,
    total: 135,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.deepEqual(parsed.telemetry.usage, {
    input: 80,
    output: 20,
    total: 135,
    cacheRead: 30,
    cacheWrite: 5,
  });
  assert.equal(parsed.telemetry.cacheSplitInvented, false);
});

test('keeps partial usage when unknown cache buckets could explain the total', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 80,
    output: 20,
    total: 130,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.deepEqual(parsed.telemetry.usage, {
    input: 80,
    output: 20,
    total: 130,
    cacheRead: null,
    cacheWrite: null,
  });
});

test('rejects impossible partial usage when known components exceed total', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 80,
    output: 20,
    cacheRead: 40,
    total: 100,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.equal(parsed.telemetry.usage, null);
  assert.equal(parsed.telemetry.usageFidelity, 'NOT_EXPOSED_BY_ENVELOPE');
});

test('rejects inconsistent full cache-aware usage totals', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 80,
    output: 20,
    cacheRead: 30,
    cacheWrite: 5,
    total: 100,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.equal(parsed.telemetry.usage, null);
});
