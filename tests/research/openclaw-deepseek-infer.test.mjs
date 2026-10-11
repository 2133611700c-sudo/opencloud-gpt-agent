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

test('infer usage keeps cache counters as prompt-detail metadata, not additive total components', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 100,
    output: 20,
    cacheRead: 25,
    cacheWrite: 5,
    total: 120,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.deepEqual(parsed.telemetry.usage, {
    input: 100,
    output: 20,
    total: 120,
    cacheRead: 25,
    cacheWrite: 5,
  });
  assert.equal(parsed.telemetry.cacheSplitInvented, false);
});

test('infer usage preserves partial cache metadata when input + output matches total', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 100,
    output: 20,
    cacheRead: 25,
    total: 120,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.deepEqual(parsed.telemetry.usage, {
    input: 100,
    output: 20,
    total: 120,
    cacheRead: 25,
    cacheWrite: null,
  });
});

test('infer usage rejects a provider total inconsistent with input + output', () => {
  const parsed = parseDeepSeekInferEnvelope(envelope({
    input: 100,
    output: 20,
    cacheRead: 25,
    total: 145,
  }), { requestedModel: 'deepseek/deepseek-flash' });

  assert.equal(parsed.telemetry.usage, null);
  assert.equal(parsed.telemetry.usageFidelity, 'NOT_EXPOSED_BY_ENVELOPE');
});
