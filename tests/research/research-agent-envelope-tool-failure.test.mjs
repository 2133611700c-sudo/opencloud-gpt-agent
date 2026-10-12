import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ResearchAgentEnvelopeError,
  parseResearchAgentEnvelope,
} from '../../src/research/research-agent-envelope.mjs';

const finalResult = {
  status: 'SUCCESS',
  summary: 'Verified from fetched source.',
  confidence: 'HIGH',
  sources: [{ id: 's1', url: 'https://api-docs.deepseek.com/news/', checkedAt: '2026-10-11T23:00:00Z' }],
  items: [{ id: 'i1', title: 'Model', data: { modelId: 'deepseek-flash' }, sourceIds: ['s1'] }],
  needsBrowser: [],
};

const makeEnvelope = (toolSummary) => ({
  ok: true,
  status: 'ok',
  final: JSON.stringify(finalResult),
  usage: { input: 100, output: 20, total: 120 },
  costUsd: 0.001,
  codeModeEngaged: false,
  toolSummary,
  model: 'deepseek-flash',
  provider: 'deepseek',
  sessionId: 'session-tool-failure-test',
});

const parse = (toolSummary) => parseResearchAgentEnvelope(JSON.stringify(makeEnvelope(toolSummary)), {
  requestedModel: 'deepseek/deepseek-flash',
});

test('SUCCESS rejects an unresolved web_fetch failure even when web_fetch appears in the tool name list', () => {
  assert.throws(
    () => parse({
      calls: 3,
      tools: ['web_search', 'web_fetch'],
      failures: 1,
      unresolvedError: { toolName: 'web_fetch' },
      totalToolTimeMs: 250,
    }),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'UNRESOLVED_WEB_TOOL_FAILURE',
  );
});

test('SUCCESS accepts a recovered transient tool failure when OpenClaw reports no unresolved error', () => {
  const parsed = parse({
    calls: 4,
    tools: ['web_search', 'web_fetch'],
    failures: 1,
    totalToolTimeMs: 300,
  });
  assert.equal(parsed.result.status, 'SUCCESS');
  assert.equal(parsed.telemetry.toolSummary.failures, 1);
  assert.equal(parsed.telemetry.toolSummary.unresolvedError, null);
});

test('tool evidence rejects impossible unresolved-error telemetry', () => {
  assert.throws(
    () => parse({
      calls: 2,
      tools: ['web_search', 'web_fetch'],
      failures: 0,
      unresolvedError: { toolName: 'web_fetch' },
    }),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_TOOL_EVIDENCE',
  );

  assert.throws(
    () => parse({
      calls: 1,
      tools: ['web_search'],
      failures: 2,
    }),
    (error) => error instanceof ResearchAgentEnvelopeError && error.code === 'INVALID_TOOL_EVIDENCE',
  );
});
