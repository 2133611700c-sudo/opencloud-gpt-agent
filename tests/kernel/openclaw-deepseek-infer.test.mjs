import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeepSeekInferInvocation,
  parseDeepSeekInferEnvelope,
  validateDeepSeekModelRef,
} from '../../src/providers/openclaw-deepseek-infer.mjs';

test('builds the documented local OpenClaw infer model command as an argv array', () => {
  const invocation = buildDeepSeekInferInvocation({
    model: 'deepseek/deepseek-flash',
    prompt: 'Reply with exactly: smoke-ok',
    thinking: 'off',
  });

  assert.equal(invocation.executable, 'openclaw');
  assert.deepEqual(invocation.args, [
    'infer', 'model', 'run',
    '--local',
    '--model', 'deepseek/deepseek-flash',
    '--prompt', 'Reply with exactly: smoke-ok',
    '--thinking', 'off',
    '--json',
  ]);
  assert.deepEqual(invocation.envRequirements, ['DEEPSEEK_API_KEY']);
  assert.equal(invocation.expectedProvider, 'deepseek');
  assert.equal(invocation.transport, 'local');
});

test('prompt remains one argv value and is never shell-interpolated by the adapter', () => {
  const prompt = 'hello; rm -rf / && $(echo unsafe)';
  const invocation = buildDeepSeekInferInvocation({
    model: 'deepseek/deepseek-v4-pro',
    prompt,
    thinking: 'high',
  });

  const promptIndex = invocation.args.indexOf('--prompt');
  assert.equal(invocation.args[promptIndex + 1], prompt);
  assert.equal(invocation.args.filter((arg) => arg === prompt).length, 1);
});

test('rejects non-DeepSeek model refs, whitespace refs, empty prompts, and unsupported thinking', () => {
  assert.throws(() => validateDeepSeekModelRef('openai/gpt-5'), /deepseek\/<model>/);
  assert.throws(() => validateDeepSeekModelRef('deepseek/'), /deepseek\/<model>/);
  assert.throws(() => validateDeepSeekModelRef('deepseek/bad model'), /whitespace/);
  assert.throws(() => buildDeepSeekInferInvocation({
    model: 'deepseek/deepseek-flash',
    prompt: '   ',
  }), /prompt must be a nonblank string/);
  assert.throws(() => buildDeepSeekInferInvocation({
    model: 'deepseek/deepseek-flash',
    prompt: 'ok',
    thinking: 'turbo',
  }), /unsupported thinking level/);
});

test('parses a successful documented model.run envelope and normalizes bare model id', () => {
  const result = parseDeepSeekInferEnvelope({
    ok: true,
    capability: 'model.run',
    transport: 'local',
    provider: 'deepseek',
    model: 'deepseek-flash',
    attempts: [],
    outputs: [{ text: 'smoke-ok', mediaUrl: null }],
  }, { requestedModel: 'deepseek/deepseek-flash' });

  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek/deepseek-flash');
  assert.equal(result.text, 'smoke-ok');
  assert.equal(result.telemetry.usage, null);
  assert.equal(result.telemetry.costUsd, null);
  assert.equal(result.telemetry.cacheSplitInvented, false);
  assert.equal(result.telemetry.usageFidelity, 'NOT_EXPOSED_BY_ENVELOPE');
});

test('accepts a fully qualified model in the envelope and preserves optional observed telemetry', () => {
  const result = parseDeepSeekInferEnvelope(JSON.stringify({
    ok: true,
    capability: 'model.run',
    transport: 'local',
    provider: 'deepseek',
    model: 'deepseek/deepseek-v4-pro',
    attempts: [{ provider: 'deepseek' }],
    outputs: [{ text: 'first' }, { text: 'second' }],
    usage: { input: 100, output: 20, total: 120, cacheRead: 25 },
    costUsd: 0.001234,
  }), { requestedModel: 'deepseek/deepseek-v4-pro' });

  assert.equal(result.text, 'first\nsecond');
  assert.deepEqual(result.telemetry.usage, {
    input: 100,
    output: 20,
    total: 120,
    cacheRead: 25,
    cacheWrite: null,
  });
  assert.equal(result.telemetry.costUsd, 0.001234);
  assert.equal(result.telemetry.usageFidelity, 'OBSERVED_PARTIAL_OR_FULL');
  assert.equal(result.telemetry.costFidelity, 'OBSERVED');
  assert.equal(result.telemetry.cacheSplitInvented, false);
});

test('fails closed on provider/model/transport/capability mismatch and empty output', () => {
  const base = {
    ok: true,
    capability: 'model.run',
    transport: 'local',
    provider: 'deepseek',
    model: 'deepseek-flash',
    attempts: [],
    outputs: [{ text: 'ok' }],
  };
  const opts = { requestedModel: 'deepseek/deepseek-flash' };

  assert.throws(() => parseDeepSeekInferEnvelope({ ...base, provider: 'openai' }, opts), /unexpected provider/);
  assert.throws(() => parseDeepSeekInferEnvelope({ ...base, model: 'deepseek-v4-pro' }, opts), /model mismatch/);
  assert.throws(() => parseDeepSeekInferEnvelope({ ...base, transport: 'gateway' }, opts), /unexpected transport/);
  assert.throws(() => parseDeepSeekInferEnvelope({ ...base, capability: 'image.generate' }, opts), /unexpected capability/);
  assert.throws(() => parseDeepSeekInferEnvelope({ ...base, outputs: [{ text: '   ' }] }, opts), /no nonempty text output/);
});

test('fails closed when OpenClaw infer reports failure or JSON is invalid', () => {
  assert.throws(() => parseDeepSeekInferEnvelope({
    ok: false,
    capability: 'model.run',
    transport: 'local',
    provider: 'deepseek',
    model: 'deepseek-flash',
    error: { message: 'auth failed' },
    outputs: [],
  }, { requestedModel: 'deepseek/deepseek-flash' }), /OpenClaw infer failed/);

  assert.throws(() => parseDeepSeekInferEnvelope('{not json}', {
    requestedModel: 'deepseek/deepseek-flash',
  }), /not valid JSON/);
});

test('does not invent malformed telemetry', () => {
  const result = parseDeepSeekInferEnvelope({
    ok: true,
    capability: 'model.run',
    transport: 'local',
    provider: 'deepseek',
    model: 'deepseek-flash',
    outputs: [{ text: 'ok' }],
    usage: { input: -1, output: '20', total: 19 },
    costUsd: -5,
  }, { requestedModel: 'deepseek/deepseek-flash' });

  assert.equal(result.telemetry.usage, null);
  assert.equal(result.telemetry.costUsd, null);
  assert.equal(result.telemetry.cacheSplitInvented, false);
});
