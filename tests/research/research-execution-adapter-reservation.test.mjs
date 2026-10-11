import assert from 'node:assert/strict';
import test from 'node:test';

import { executeClaimedResearchNode } from '../../src/research/research-execution-adapter.mjs';

const claim = Object.freeze({
  taskId: 'task-1',
  nodeId: 'node-research',
  workerId: 'worker-1',
  leaseToken: '11111111-1111-4111-8111-111111111111',
  agentId: 'researcher',
});

const base = (events) => ({
  claim,
  request: 'research this',
  heartbeat: async () => true,
  runResearch: async () => { events.push('run'); return { result: { status: 'SUCCESS' } }; },
  accountUsage: async () => { events.push('account'); },
  completeSuccess: async () => { events.push('complete'); return true; },
  failTerminal: async ({ error }) => { events.push(['fail', error.code]); return true; },
  releaseReservation: async () => { events.push('release'); },
  heartbeatIntervalMs: 50,
});

test('reservation callback failure terminalizes the claimed node and does not release a nonexistent reservation', async () => {
  const events = [];
  const failure = Object.assign(new Error('estimator failed'), { code: 'ESTIMATE_FAILED' });

  await assert.rejects(() => executeClaimedResearchNode({
    ...base(events),
    reservation: async () => { events.push('reserve'); throw failure; },
  }), failure);

  assert.deepEqual(events, ['reserve', ['fail', 'ESTIMATE_FAILED']]);
});

test('rejected reservation terminalizes the claimed node and does not run paid work or release', async () => {
  const events = [];

  await assert.rejects(() => executeClaimedResearchNode({
    ...base(events),
    reservation: async () => { events.push('reserve'); return null; },
  }), (error) => error?.code === 'RESERVATION_REJECTED');

  assert.deepEqual(events, ['reserve', ['fail', 'RESERVATION_REJECTED']]);
});
