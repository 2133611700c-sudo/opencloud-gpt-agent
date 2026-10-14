import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ResearchAgentEnvelopeError,
  parseResearchAgentEnvelope,
  parseRejectedResearchBilling,
} from '../../src/research/research-agent-envelope.mjs';

const researchFinal = (overrides = {}) => ({
  status: 'SUCCESS',
  summary: 'Verified listing.',
  confidence: 'HIGH',
  sources: [{
    id: 's1',
    url: 'https://example.com/listing',
    checkedAt: '2026-10-11T17:40:00-05:00',
  }],
  items: [{
    id: 'i1',
    title: 'Listing',
    data: { price: 42000 },
    sourceIds: ['s1'],
  }],
  needsBrowser: [],
  ...overrides,
});

const envelope = (overrides = {}) => ({
  ok: true,
  status: 'ok',
  final: JSON.stringify(researchFinal()),
  payloads: [{ text: 'omitted' }],
  usage: { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, total: 130 },
  costUsd: 0.0012,
  codeModeEngaged: false,
  assistantTurns: 2,
  toolSummary: {
    calls: 3,
    tools: ['web_search', 'web_fetch'],
    totalToolTimeMs: 250,
  },
  model: 'deepseek-chat',
  provider: 'deepseek',
  sessionId: 'session-123',
  ...overrides,
});

const parse = (value) => parseResearchAgentEnvelope(JSON.stringify(value), {
  requestedModel: 'deepseek/deepseek-chat',
});

test('accepts a sourced DeepSeek research envelope with full usage/cache evidence', () => {
  const parsed = parse(envelope());

  assert.equal(parsed.result.status, 'SUCCESS');
  assert.equal(parsed.result.sources[0].url, 'https://example.com/listing');
  assert.deepEqual(parsed.telemetry.toolSummary.tools, ['web_search', 'web_fetch']);
  assert.deepEqual(parsed.telemetry.usage, { input: 100, output: 30, total: 130, cacheRead: 0, cacheWrite: 0 });
  assert.equal(parsed.telemetry.telemetryStatus, 'AVAILABLE_FULL');
  assert.equal(parsed.telemetry.costUsd, 0.0012);
});

test('includes observed cache counters in OpenClaw total tokens', () => {
  const parsed = parse(envelope({ usage: { input: 80, output: 30, cacheRead: 20, cacheWrite: 5, total: 135 } }));
  assert.deepEqual(parsed.telemetry.usage, { input: 80, output: 30, total: 135, cacheRead: 20, cacheWrite: 5 });
  assert.equal(parsed.telemetry.telemetryStatus, 'AVAILABLE_FULL');
});

test('rejects total that omits nonzero OpenClaw cache counters', () => {
  assert.throws(
    () => parse(envelope({ usage: { input: 100, output: 30, cacheRead: 10, cacheWrite: 0, total: 130 } })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_TELEMETRY',
  );
});

test('marks usage without cache split as partial instead of inventing zeros', () => {
  const parsed = parse(envelope({ usage: { input: 100, output: 30, total: 130 } }));
  assert.deepEqual(parsed.telemetry.usage, { input: 100, output: 30, total: 130, cacheRead: null, cacheWrite: null });
  assert.equal(parsed.telemetry.telemetryStatus, 'AVAILABLE_NO_CACHE_SPLIT');
});

test('does not invent usage telemetry when OpenClaw omits it', () => {
  const value = envelope();
  delete value.usage;
  const parsed = parse(value);
  assert.equal(parsed.telemetry.usage, null);
  assert.equal(parsed.telemetry.telemetryStatus, 'NOT_EXPOSED');
});

test('rejects inconsistent or malformed usage telemetry', () => {
  assert.throws(
    () => parse(envelope({ usage: { input: 100, output: 30, cacheRead: 10, cacheWrite: 0, total: 141 } })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_TELEMETRY',
  );
  assert.throws(
    () => parse(envelope({ usage: { input: 100, output: -1, cacheRead: 0, cacheWrite: 0, total: 99 } })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_TELEMETRY',
  );
});

test('rejects provider or model mismatch', () => {
  assert.throws(
    () => parse(envelope({ provider: 'openai' })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'PROVIDER_MISMATCH',
  );
  assert.throws(
    () => parse(envelope({ model: 'deepseek-reasoner' })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'MODEL_MISMATCH',
  );
});

test('rejects code mode engagement or missing direct-mode evidence', () => {
  assert.throws(
    () => parse(envelope({ codeModeEngaged: true })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'CODE_MODE_NOT_DIRECT',
  );
  const missing = envelope();
  delete missing.codeModeEngaged;
  assert.throws(
    () => parse(missing),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'CODE_MODE_NOT_DIRECT',
  );
});

test('rejects any tool outside the research allowlist', () => {
  assert.throws(
    () => parse(envelope({
      toolSummary: { calls: 3, tools: ['web_search', 'exec'], totalToolTimeMs: 1 },
    })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'DISALLOWED_TOOL_USED',
  );
});

test('rejects memory-only answer with no web_search evidence', () => {
  assert.throws(
    () => parse(envelope({
      toolSummary: { calls: 1, tools: ['web_fetch'], totalToolTimeMs: 1 },
    })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'NO_WEB_SEARCH_EVIDENCE',
  );
});

test('rejects SUCCESS without web_fetch evidence', () => {
  assert.throws(
    () => parse(envelope({
      toolSummary: { calls: 1, tools: ['web_search'], totalToolTimeMs: 1 },
    })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'NO_WEB_FETCH_EVIDENCE',
  );
});

test('rejects malformed final JSON', () => {
  assert.throws(
    () => parse(envelope({ final: '```json {bad} ```' })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_RESEARCH_JSON',
  );
});

test('rejects final JSON that violates the sourced result contract', () => {
  assert.throws(
    () => parse(envelope({
      final: JSON.stringify(researchFinal({
        items: [{ id: 'i1', title: 'Unsourced', data: {}, sourceIds: [] }],
      })),
    })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_RESEARCH_RESULT',
  );
});

test('rejects successful-looking envelope with failed run status', () => {
  assert.throws(
    () => parse(envelope({ ok: false, status: 'error' })),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'AGENT_RUN_FAILED',
  );
});

const rejectedBilling = (value, options = {}) => parseRejectedResearchBilling(JSON.stringify(value), {
  requestedModel: 'deepseek/deepseek-chat', ...options,
});

test('billing survives rejected web evidence without retaining result, tools or private fields', () => {
  const value = envelope({ toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 1,
    unresolvedError: { toolName: 'web_fetch', message: 'private tool detail sentinel' } }, reasoning: 'private reasoning sentinel' });
  assert.throws(() => parse(value), (error) => error.code === 'UNRESOLVED_WEB_TOOL_FAILURE');
  const billing = rejectedBilling(value);
  assert.equal(billing.provider, 'deepseek'); assert.equal(billing.model, 'deepseek-chat');
  assert.deepEqual(billing.usage, { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, total: 130 });
  assert.equal(billing.costUsd, 0.0012); assert.equal(billing.sessionId, 'session-123');
  assert.equal(Object.isFrozen(billing), true); assert.equal(Object.isFrozen(billing.usage), true);
  for (const key of ['result', 'final', 'toolSummary', 'reasoning', 'payloads', 'stdout', 'stderr']) assert.equal(Object.hasOwn(billing, key), false);
  assert.ok(!JSON.stringify(billing).includes('private'));
});

test('missing or malformed rejected-run billing selects conservative fallback instead of throwing', () => {
  for (const overrides of [
    { usage: null }, { costUsd: null }, { usage: {} }, { usage: { input: 100, output: -1, total: 99 } },
    { usage: { input: 100, output: 30, cacheRead: 1, cacheWrite: 0, total: 130 } },
    { usage: { input: 100, output: 0.5, total: 100.5 } }, { costUsd: -1 }, { costUsd: '0.0012' },
  ]) {
    const billing = rejectedBilling(envelope(overrides));
    assert.equal(billing.accountingFallbackReason, 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY');
    assert.equal(billing.usage, null); assert.equal(billing.costUsd, null);
  }
});

test('rejected-run partial cache telemetry remains explicit for conservative accounting', () => {
  const billing = rejectedBilling(envelope({ usage: { input: 100, output: 30, total: 130 } }));
  assert.deepEqual(billing.usage, { input: 100, output: 30, total: 130, cacheRead: null, cacheWrite: null });
  assert.equal(billing.costUsd, 0.0012);
  assert.equal(billing.accountingFallbackReason, 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY');
});

test('rejected billing requires string stdout without coercing objects or invoking getters', () => {
  let reads = 0;
  const coercible = { toString() { reads += 1; return JSON.stringify(envelope()); } };
  Object.defineProperty(coercible, Symbol.toPrimitive, { get() { reads += 1; throw new Error('private coercion sentinel'); } });
  for (const stdout of [coercible, {}, null, undefined, 1, true, '', '   ']) {
    const billing = parseRejectedResearchBilling(stdout, { requestedModel: 'deepseek/deepseek-chat' });
    assert.equal(billing.usage, null); assert.equal(billing.costUsd, null);
    assert.equal(billing.accountingFallbackReason, 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY');
  }
  assert.equal(reads, 0);
});

test('unverified rejected-run identity and malformed JSON cannot create observed billing claims', () => {
  for (const value of [envelope({ provider: 'other' }), envelope({ model: 'other' }), envelope({ provider: null }), {}]) {
    const billing = rejectedBilling(value);
    for (const key of ['provider', 'model', 'sessionId', 'usage', 'costUsd']) assert.equal(billing[key], null);
    assert.equal(billing.accountingFallbackReason, 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY');
  }
  const billing = parseRejectedResearchBilling('not JSON private sentinel', { requestedModel: 'deepseek/deepseek-chat' });
  assert.equal(billing.usage, null); assert.equal(billing.costUsd, null);
  assert.ok(!JSON.stringify(billing).includes('private'));
});

test('rejected billing omits supplied secrets and unsafe session identities', () => {
  const supplied = 'synthetic-private-session';
  for (const sessionId of [supplied, ['sk', 'syntheticcredentialabcdef123456'].join('-'), 'Bearer private session', 'x'.repeat(257), 'https://example.com/?token=private']) {
    const billing = rejectedBilling(envelope({ sessionId }), { sensitiveValues: [supplied] });
    assert.equal(billing.sessionId, null);
    assert.ok(!JSON.stringify(billing).includes(sessionId));
  }
});
