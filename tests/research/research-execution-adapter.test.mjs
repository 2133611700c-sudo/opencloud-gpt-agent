import assert from 'node:assert/strict';
import test from 'node:test';

import { executeClaimedResearchNode } from '../../src/research/research-execution-adapter.mjs';

const claim = Object.freeze({
  taskId: 'task-1', nodeId: 'node-research', workerId: 'worker-1', leaseToken: '11111111-1111-4111-8111-111111111111', agentId: 'researcher',
});

const successResearch = Object.freeze({
  result: Object.freeze({ status: 'SUCCESS', summary: 'verified result', sources: [] }),
  telemetry: Object.freeze({ provider: 'deepseek', model: 'deepseek-flash', usage: { input: 10, output: 5, total: 15 } }),
});

test('claimed Research node follows reserve -> run -> account -> fenced success', async () => {
  const events = [];
  const result = await executeClaimedResearchNode({
    claim,
    request: 'research this',
    reservation: async (received) => { assert.equal(received, claim); events.push('reserve'); return 'reservation-1'; },
    heartbeat: async () => true,
    runResearch: async ({ request, claim: received, signal }) => {
      assert.equal(request, 'research this');
      assert.equal(received, claim);
      assert.equal(signal.aborted, false);
      events.push('run');
      return successResearch;
    },
    accountUsage: async ({ reservationId, research }) => {
      assert.equal(reservationId, 'reservation-1');
      assert.equal(research, successResearch);
      events.push('account');
    },
    completeSuccess: async ({ result: researchResult }) => {
      assert.equal(researchResult, successResearch.result);
      events.push('complete');
      return true;
    },
    failTerminal: async () => { events.push('fail'); return true; },
    releaseReservation: async () => { events.push('release'); },
    heartbeatIntervalMs: 50,
  });

  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(events, ['reserve', 'run', 'account', 'complete']);
});

test('Research claim rejects non-UUID fencing tokens', async () => {
  await assert.rejects(() => executeClaimedResearchNode({
    claim: { ...claim, leaseToken: 7 },
  }), /claim\.leaseToken must be a UUID fencing token/);
});

test('Research failure is terminalized and unreconciled reservation is released', async () => {
  const events = [];
  const failure = Object.assign(new Error('provider failed'), { code: 'PROVIDER_FAILED' });

  await assert.rejects(() => executeClaimedResearchNode({
    claim,
    request: 'research this',
    reservation: async () => { events.push('reserve'); return 'reservation-2'; },
    heartbeat: async () => true,
    runResearch: async () => { events.push('run'); throw failure; },
    accountUsage: async () => { events.push('account'); },
    completeSuccess: async () => { events.push('complete'); return true; },
    failTerminal: async ({ error }) => {
      assert.equal(error.code, 'PROVIDER_FAILED');
      events.push('fail');
      return true;
    },
    releaseReservation: async ({ reservationId }) => {
      assert.equal(reservationId, 'reservation-2');
      events.push('release');
    },
    heartbeatIntervalMs: 50,
  }), failure);

  assert.deepEqual(events, ['reserve', 'run', 'fail', 'release']);
});

test('lost heartbeat aborts Research and never accounts or completes stale lease', async () => {
  const events = [];

  await assert.rejects(() => executeClaimedResearchNode({
    claim,
    request: 'slow research',
    reservation: async () => { events.push('reserve'); return 'reservation-3'; },
    heartbeat: async () => { events.push('heartbeat-lost'); return false; },
    runResearch: ({ signal }) => new Promise((resolve, reject) => {
      events.push('run');
      signal.addEventListener('abort', () => {
        events.push('aborted');
        reject(signal.reason);
      }, { once: true });
    }),
    accountUsage: async () => { events.push('account'); },
    completeSuccess: async () => { events.push('complete'); return true; },
    failTerminal: async () => { events.push('fail'); return false; },
    releaseReservation: async () => { events.push('release'); },
    heartbeatIntervalMs: 5,
  }), (error) => error?.code === 'LEASE_LOST');

  assert.equal(events.includes('heartbeat-lost'), true);
  assert.equal(events.includes('aborted'), true);
  assert.equal(events.includes('account'), false);
  assert.equal(events.includes('complete'), false);
  assert.equal(events.includes('release'), true);
});

test('rejected fenced success does not report success', async () => {
  const events = [];
  await assert.rejects(() => executeClaimedResearchNode({
    claim,
    request: 'research this',
    reservation: async () => 'reservation-4',
    heartbeat: async () => true,
    runResearch: async () => successResearch,
    accountUsage: async () => { events.push('account'); },
    completeSuccess: async () => { events.push('complete-rejected'); return false; },
    failTerminal: async () => { events.push('fail'); return false; },
    releaseReservation: async () => { events.push('release'); },
    heartbeatIntervalMs: 50,
  }), (error) => error?.code === 'SUCCESS_FENCE_REJECTED');

  assert.deepEqual(events, ['account', 'complete-rejected', 'fail']);
});
