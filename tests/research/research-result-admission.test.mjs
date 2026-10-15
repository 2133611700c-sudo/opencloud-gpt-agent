import assert from 'node:assert/strict';
import test from 'node:test';

import { transformData } from '../../src/data/data-transformer.mjs';
import { executeClaimedResearchNode } from '../../src/research/research-execution-adapter.mjs';
import { admitResearchResultForData } from '../../src/research/research-result-admission.mjs';

const request = Object.freeze({
  goal: 'Using official DeepSeek API documentation, identify the current release served by API model id deepseek-flash.',
  maxResults: 3,
  constraints: Object.freeze({ requiredDomains: Object.freeze(['api-docs.deepseek.com']) }),
  requiredFields: Object.freeze(['modelId', 'modelVersion']),
});

const paidFailureShape = Object.freeze({
  status: 'SUCCESS',
  summary: 'Official DeepSeek API docs identify the current release and also mention legacy ids.',
  confidence: 'HIGH',
  sources: Object.freeze([
    Object.freeze({
      id: 'ds-pricing',
      url: 'https://api-docs.deepseek.com/quick_start/pricing',
      checkedAt: '2026-10-14T22:06:28.000Z',
    }),
    Object.freeze({
      id: 'ds-changelog',
      url: 'https://api-docs.deepseek.com/updates/',
      checkedAt: '2026-10-14T22:07:15.000Z',
    }),
  ]),
  items: Object.freeze([
    Object.freeze({
      id: 'deepseek-flash-current',
      title: 'deepseek-flash serves DeepSeek-V4.1-Flash',
      data: Object.freeze({ modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash' }),
      sourceIds: Object.freeze(['ds-pricing', 'ds-changelog']),
    }),
    Object.freeze({
      id: 'legacy-ids',
      title: 'Retired legacy model ids routed to the current release',
      data: Object.freeze({ retiredIds: Object.freeze(['deepseek-v4-flash']) }),
      sourceIds: Object.freeze(['ds-pricing', 'ds-changelog']),
    }),
  ]),
  needsBrowser: Object.freeze([]),
});

const claim = Object.freeze({
  taskId: 'task-1',
  nodeId: 'research-1',
  workerId: 'worker-1',
  leaseToken: '11111111-1111-4111-8111-111111111111',
  agentId: 'researcher',
});

const paidResearch = Object.freeze({
  result: paidFailureShape,
  telemetry: Object.freeze({
    provider: 'deepseek',
    model: 'deepseek-flash',
    usage: Object.freeze({ input: 10, output: 5, total: 15 }),
  }),
});

test('paid failure shape is narrowed to Data-compatible items without weakening Data', () => {
  const admitted = admitResearchResultForData({ request, result: paidFailureShape });
  assert.deepEqual(admitted.items.map(({ id }) => id), ['deepseek-flash-current']);

  const data = transformData({ requiredFields: request.requiredFields, researchResult: admitted });
  assert.deepEqual(data.items.map(({ id }) => id), ['deepseek-flash-current']);
  assert.equal(admitted.sources.length, 2, 'source provenance is retained');
});

test('zero, false and string zero remain valid required values while blank/null/missing are excluded', () => {
  const result = {
    ...paidFailureShape,
    items: [
      { id: 'valid', title: 'Valid false/zero', data: { modelId: 0, modelVersion: false }, sourceIds: ['ds-pricing'] },
      { id: 'string-zero', title: 'Valid string zero', data: { modelId: '0', modelVersion: '0' }, sourceIds: ['ds-pricing'] },
      { id: 'blank', title: 'Blank', data: { modelId: 'x', modelVersion: '   ' }, sourceIds: ['ds-pricing'] },
      { id: 'null', title: 'Null', data: { modelId: 'x', modelVersion: null }, sourceIds: ['ds-pricing'] },
      { id: 'missing', title: 'Missing', data: { modelId: 'x' }, sourceIds: ['ds-pricing'] },
    ],
  };
  const admitted = admitResearchResultForData({ request, result });
  assert.deepEqual(admitted.items.map(({ id }) => id), ['valid', 'string-zero']);
});

test('SUCCESS with no admissible item fails with a stable Research contract code', () => {
  assert.throws(
    () => admitResearchResultForData({
      request,
      result: {
        ...paidFailureShape,
        items: [{ id: 'aux-only', title: 'Auxiliary', data: { note: 'context' }, sourceIds: ['ds-pricing'] }],
      },
    }),
    (error) => error?.name === 'ResearchContractError'
      && error?.code === 'REQUIRED_FIELDS_NOT_PROVEN'
      && error?.path === 'result.items',
  );
});

test('production adapter accounts original paid execution before admission and persists only admitted output', async () => {
  const events = [];
  let persisted = null;
  const execution = await executeClaimedResearchNode({
    claim,
    request,
    reservation: async () => { events.push('reserve'); return 'reservation-1'; },
    heartbeat: async () => true,
    runResearch: async () => { events.push('run'); return paidResearch; },
    accountUsage: async ({ research }) => {
      assert.equal(research, paidResearch);
      events.push('account');
    },
    completeSuccess: async ({ result }) => {
      persisted = result;
      events.push('complete');
      return true;
    },
    failTerminal: async () => { throw new Error('unexpected failTerminal'); },
    releaseReservation: async () => { throw new Error('unexpected releaseReservation'); },
    heartbeatIntervalMs: 60_000,
  });

  assert.deepEqual(events, ['reserve', 'run', 'account', 'complete']);
  assert.deepEqual(persisted.items.map(({ id }) => id), ['deepseek-flash-current']);
  assert.deepEqual(execution.research.result.items.map(({ id }) => id), ['deepseek-flash-current']);
  assert.equal(execution.research.telemetry, paidResearch.telemetry);
});

test('admission rejection happens after accounting and does not complete or release twice', async () => {
  const events = [];
  const invalidResearch = Object.freeze({
    ...paidResearch,
    result: Object.freeze({
      ...paidFailureShape,
      items: Object.freeze([
        Object.freeze({ id: 'aux-only', title: 'Auxiliary', data: Object.freeze({ note: 'context' }), sourceIds: Object.freeze(['ds-pricing']) }),
      ]),
    }),
  });

  await assert.rejects(
    () => executeClaimedResearchNode({
      claim,
      request,
      reservation: async () => { events.push('reserve'); return 'reservation-2'; },
      heartbeat: async () => true,
      runResearch: async () => { events.push('run'); return invalidResearch; },
      accountUsage: async () => { events.push('account'); },
      completeSuccess: async () => { events.push('complete'); return true; },
      failTerminal: async ({ error }) => { events.push(`fail:${error.code}`); return true; },
      releaseReservation: async () => { events.push('release'); return true; },
      heartbeatIntervalMs: 60_000,
    }),
    (error) => error?.code === 'REQUIRED_FIELDS_NOT_PROVEN',
  );

  assert.deepEqual(events, ['reserve', 'run', 'account', 'fail:REQUIRED_FIELDS_NOT_PROVEN']);
});
