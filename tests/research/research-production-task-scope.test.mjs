import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';

const leaseToken = '77777777-7777-4777-8777-777777777777';

test('production runTask uses task-scoped PostgreSQL claim and never agent-wide claim', async () => {
  const calls = [];
  const estimatorFailure = Object.assign(new Error('stop after claim'), { code: 'TEST_ESTIMATOR_STOP' });
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.startsWith('SELECT * FROM claim_node_for_task_and_agent')) {
      return { rows: [{
        node_id: 'research-node',
        task_id: 'task-target',
        lease_token: leaseToken,
        agent_id: 'researcher',
        input_payload: { goal: 'Target task only', request: { maxResults: 1 } },
        attempt: 1,
      }] };
    }
    if (text.startsWith('SELECT fail_node_terminal')) return { rows: [{ accepted: true }] };
    throw new Error(`unexpected SQL: ${text}`);
  };

  const worker = createProductionResearchWorker({
    query,
    workerId: 'research-production-task-scope',
    pricingVersion: 'pricing-v1',
    estimateReservation: async () => { throw estimatorFailure; },
    runResearchImpl: async () => { throw new Error('paid Research must not run in this regression'); },
    heartbeatIntervalMs: 10_000,
    leaseSeconds: 30,
  });

  await assert.rejects(() => worker.runTask('task-target'), estimatorFailure);

  const scopedClaim = calls.find((call) => call.text.startsWith('SELECT * FROM claim_node_for_task_and_agent'));
  assert.ok(scopedClaim);
  assert.deepEqual(scopedClaim.values, ['task-target', 'research-production-task-scope', 'researcher', 30]);
  assert.equal(calls.some((call) => call.text.startsWith('SELECT * FROM claim_next_node_for_agent')), false);
  assert.ok(calls.some((call) => call.text.startsWith('SELECT fail_node_terminal')));
  assert.equal(typeof worker.runOnce, 'function');
  assert.equal(typeof worker.runTask, 'function');
});
