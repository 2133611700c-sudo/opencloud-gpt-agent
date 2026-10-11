import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ResearchAgentEnvelopeError,
  parseResearchAgentEnvelope,
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
  usage: { input: 100, output: 30, total: 130 },
  costUsd: 0.0012,
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

test('accepts a sourced DeepSeek research envelope with real web tool evidence', () => {
  const parsed = parse(envelope());

  assert.equal(parsed.result.status, 'SUCCESS');
  assert.equal(parsed.result.sources[0].url, 'https://example.com/listing');
  assert.deepEqual(parsed.telemetry.toolSummary.tools, ['web_search', 'web_fetch']);
  assert.deepEqual(parsed.telemetry.usage, { input: 100, output: 30, total: 130 });
  assert.equal(parsed.telemetry.costUsd, 0.0012);
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
