import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchKernelExecutor } from '../../src/research/research-kernel-bindings.mjs';

const claim = Object.freeze({
  taskId: 'task-1',
  nodeId: 'node-1',
  workerId: 'worker-1',
  leaseToken: '55555555-5555-4555-8555-555555555555',
  agentId: 'researcher',
});

const kernel = (events) => ({
  reserve: async () => { events.push('reserve'); return 'reservation-1'; },
  heartbeat: async () => true,
  recordLlmCall: async () => { events.push('account'); return { accountingId: 'a', created: true }; },
  recordLlmCallReservationFallback: async () => { events.push('fallback'); return { accountingId: 'af', created: true }; },
  completeSuccess: async () => { events.push('complete'); return true; },
  failTerminal: async ({ error }) => { events.push(['fail', error.code]); return true; },
  releaseReservation: async () => { events.push('release'); return 1; },
});

test('estimator exception is terminalized inside claimed-node lifecycle before reserve or paid Research', async () => {
  const events = [];
  const failure = Object.assign(new Error('pricing service failed'), { code: 'ESTIMATOR_FAILED' });
  let ranResearch = false;
  const execute = createResearchKernelExecutor({
    kernel: kernel(events),
    pricingVersion: 'pricing-v1',
    heartbeatIntervalMs: 60_000,
    estimateReservation: async () => { events.push('estimate'); throw failure; },
    runResearch: async () => { ranResearch = true; throw new Error('must not run'); },
  });

  await assert.rejects(() => execute({ claim, request: { goal: 'x' } }), failure);
  assert.equal(ranResearch, false);
  assert.deepEqual(events, ['estimate', ['fail', 'ESTIMATOR_FAILED']]);
});

test('invalid estimator result becomes explicit terminal failure before reserve or paid Research', async () => {
  const events = [];
  let ranResearch = false;
  const execute = createResearchKernelExecutor({
    kernel: kernel(events),
    pricingVersion: 'pricing-v1',
    heartbeatIntervalMs: 60_000,
    estimateReservation: async () => { events.push('estimate'); return { costUsd: -1, tokens: 100 }; },
    runResearch: async () => { ranResearch = true; throw new Error('must not run'); },
  });

  await assert.rejects(
    () => execute({ claim, request: { goal: 'x' } }),
    (error) => error?.code === 'INVALID_RESERVATION_ESTIMATE',
  );
  assert.equal(ranResearch, false);
  assert.deepEqual(events, ['estimate', ['fail', 'INVALID_RESERVATION_ESTIMATE']]);
});
