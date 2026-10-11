import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';

const leaseToken = '33333333-3333-4333-8333-333333333333';

const makeQuery = () => {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT * FROM claim_next_node_for_agent')) {
      return { rows: [{
        node_id: 'node-1',
        task_id: 'task-1',
        lease_token: leaseToken,
        agent_id: 'researcher',
        input_payload: { goal: 'Find verified facts', request: { maxResults: 2 } },
        attempt: 1,
      }] };
    }
    if (text.startsWith('SELECT reserve_node_budget')) return { rows: [{ reservation_id: 'reservation-1' }] };
    if (text.startsWith('SELECT * FROM record_llm_call(')) return { rows: [{ accounting_id: 'accounting-1', created: true }] };
    if (text.startsWith('SELECT complete_node_success')) return { rows: [{ accepted: true }] };
    if (text.startsWith('SELECT heartbeat_node')) return { rows: [{ accepted: true }] };
    throw new Error(`unexpected SQL: ${text}`);
  };
  return { query, calls };
};

test('production wiring traverses scoped Postgres claim -> native Research -> accounting -> fenced success', async () => {
  const db = makeQuery();
  const researchCalls = [];
  const estimateCalls = [];
  const worker = createProductionResearchWorker({
    query: db.query,
    workerId: 'research-production-1',
    pricingVersion: 'pricing-v1',
    estimateReservation: async (input) => {
      estimateCalls.push(input);
      return { costUsd: 0.10, tokens: 100 };
    },
    runResearchImpl: async (input) => {
      researchCalls.push(input);
      return {
        result: { status: 'SUCCESS', summary: 'verified', sources: [{ id: 's1', url: 'https://example.com', checkedAt: '2026-10-11T21:00:00Z' }], items: [], needsBrowser: [], confidence: 'HIGH' },
        telemetry: { usage: { input: 10, output: 5, total: 15 }, costUsd: 0.01, sessionId: 'provider-session-1' },
        process: { latencyMs: 9 },
      };
    },
    heartbeatIntervalMs: 60_000,
    researchTimeoutMs: 30_000,
  });

  const out = await worker.runOnce();
  assert.equal(out.status, 'EXECUTED');
  assert.equal(out.execution.status, 'SUCCESS');
  assert.equal(worker.model, 'deepseek/deepseek-flash');

  assert.deepEqual(db.calls[0].values, ['research-production-1', 'researcher', 30]);
  assert.equal(researchCalls.length, 1);
  assert.deepEqual(researchCalls[0].request, { goal: 'Find verified facts', maxResults: 2 });
  assert.equal(researchCalls[0].model, 'deepseek/deepseek-flash');
  assert.equal(researchCalls[0].timeoutMs, 30_000);
  assert.equal(estimateCalls.length, 1);
  assert.equal(estimateCalls[0].model, 'deepseek/deepseek-flash');

  const reserve = db.calls.find((call) => call.text.startsWith('SELECT reserve_node_budget'));
  assert.ok(reserve);
  assert.equal(reserve.values[0], `research:task-1:node-1:${leaseToken}`);

  const accounting = db.calls.find((call) => call.text.startsWith('SELECT * FROM record_llm_call('));
  assert.ok(accounting);
  assert.equal(accounting.values[1], `research:task-1:node-1:${leaseToken}`);
  assert.equal(accounting.values[5], 'deepseek');
  assert.equal(accounting.values[6], 'deepseek-flash');
  assert.equal(accounting.values[7], 'pricing-v1');

  const completion = db.calls.find((call) => call.text.startsWith('SELECT complete_node_success'));
  assert.ok(completion);
  assert.deepEqual(JSON.parse(completion.values[3]), {
    status: 'SUCCESS',
    summary: 'verified',
    sources: [{ id: 's1', url: 'https://example.com', checkedAt: '2026-10-11T21:00:00Z' }],
    items: [],
    needsBrowser: [],
    confidence: 'HIGH',
  });
});

test('native production wiring refuses missing DeepSeek credential before any claim', () => {
  let queried = false;
  assert.throws(() => createProductionResearchWorker({
    query: async () => { queried = true; return { rows: [] }; },
    workerId: 'research-production-1',
    pricingVersion: 'pricing-v1',
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
    researchEnv: { OPENCLAW_STATE_DIR: '/tmp/openclaw-v2' },
  }), (error) => error?.code === 'MISSING_DEEPSEEK_API_KEY');
  assert.equal(queried, false);
});

test('native production wiring refuses invalid OpenClaw trust root before any claim', () => {
  let queried = false;
  assert.throws(() => createProductionResearchWorker({
    query: async () => { queried = true; return { rows: [] }; },
    workerId: 'research-production-1',
    pricingVersion: 'pricing-v1',
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
    researchEnv: { DEEPSEEK_API_KEY: 'test-secret', OPENCLAW_STATE_DIR: 'relative/path' },
  }), (error) => error?.code === 'INVALID_OPENCLAW_STATE_DIR');
  assert.equal(queried, false);
});
