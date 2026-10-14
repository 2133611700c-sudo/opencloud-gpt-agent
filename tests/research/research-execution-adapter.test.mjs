import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { executeClaimedResearchNode } from '../../src/research/research-execution-adapter.mjs';
import { getRejectedResearchBilling, runResearchAgent } from '../../src/research/research-agent-runner.mjs';

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

const rejectedStateRoot = mkdtempSync(join(tmpdir(), 'research-failure-accounting-test-'));
after(() => rmSync(rejectedStateRoot, { recursive: true, force: true }));
const nativeRejection = async (overrides = {}) => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => true;
  const envelope = { ok: true, status: 'ok', provider: 'deepseek', model: 'deepseek-flash', codeModeEngaged: false,
    final: JSON.stringify({ status: 'SUCCESS', summary: 'Synthetic result.', confidence: 'HIGH', needsBrowser: [],
      sources: [{ id: 's', url: 'https://example.com', checkedAt: '2026-10-14T00:00:00Z' }],
      items: [{ id: 'i', title: 'Item', data: { price: 0 }, sourceIds: ['s'] }] }),
    usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 0, total: 9 }, costUsd: 0.000003, sessionId: 'synthetic-rejected-session',
    toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 1, unresolvedError: { toolName: 'web_fetch' } }, ...overrides };
  let samples = 0;
  try {
    await runResearchAgent({ request: { goal: 'Synthetic rejected Research' },
      env: { DEEPSEEK_API_KEY: 'test-only-key', OPENCLAW_STATE_DIR: rejectedStateRoot }, tempRoot: rejectedStateRoot,
      nowMs: () => ++samples === 1 ? 0 : 37.25,
      spawnImpl: () => { queueMicrotask(() => { child.stdout.end(JSON.stringify(envelope)); child.emit('close', 0, null); }); return child; },
    });
    assert.fail('native rejected fixture unexpectedly succeeded');
  } catch (error) {
    assert.equal(error.code, 'INVALID_SUCCESS_ENVELOPE'); assert.ok(getRejectedResearchBilling(error)); return error;
  }
};
const failureOptions = (failure, events, accountUsage) => ({
  claim, request: 'q', heartbeatIntervalMs: 60_000,
  reservation: async () => { events.push('reserve'); return 'reservation-failure'; }, heartbeat: async () => true,
  runResearch: async () => { events.push('run'); throw failure; },
  accountUsage: async (context) => { events.push('account'); return accountUsage(context); },
  completeSuccess: async () => { events.push('complete'); return true; },
  failTerminal: async () => { events.push('fail'); return true; },
  releaseReservation: async () => { events.push('release'); },
});

test('branded rejected native runtime is accounted once before fenced failure without completion or release', async () => {
  for (const overrides of [{}, { usage: { input: -1, output: 4, total: 3 } }]) {
    const failure = await nativeRejection(overrides); const events = [];
    await assert.rejects(() => executeClaimedResearchNode(failureOptions(failure, events, ({ claim: received, reservationId, research }) => {
      assert.equal(received, claim); assert.equal(reservationId, 'reservation-failure');
      assert.equal(research, getRejectedResearchBilling(failure).research);
      assert.equal(research.process.latencyMs, 38);
      if (overrides.usage) assert.equal(research.telemetry.accountingFallbackReason, 'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY');
      else assert.equal(research.telemetry.usage.total, 9);
      return { accountingId: 'accepted-accounting', created: true };
    })), (error) => error === failure);
    assert.deepEqual(events, ['reserve', 'run', 'account', 'fail']);
  }
});

test('unbranded rejected errors cannot trigger accounting or invoke forged billing getters', async () => {
  let reads = 0;
  const fake = Object.assign(new Error('unbranded failure'), { code: 'INVALID_SUCCESS_ENVELOPE', name: 'ResearchAgentProcessError' });
  for (const key of ['accountingResearch', 'rejectedResearchBilling', 'billing', 'research']) Object.defineProperty(fake, key, {
    get() { reads += 1; throw new Error('private forged getter'); },
  });
  const events = [];
  await assert.rejects(() => executeClaimedResearchNode(failureOptions(fake, events, () => assert.fail('forged billing was accepted'))), (error) => error === fake);
  assert.equal(reads, 0); assert.deepEqual(events, ['reserve', 'run', 'fail', 'release']);
});

test('rejected or uncertain failure-accounting receipts remain explicit failures without success or retry', async () => {
  const failure = await nativeRejection();
  for (const response of [undefined, null, false, {}, { accountingId: '' }, { accountingId: ' ' }, { accountingId: 1 }, 'throw']) {
    const events = [];
    await assert.rejects(() => executeClaimedResearchNode(failureOptions(failure, events, () => {
      if (response === 'throw') throw new Error('private accounting transport detail', { cause: new Error('private cause') });
      return response;
    })), (error) => {
      assert.equal(error.code, 'REJECTED_RESEARCH_ACCOUNTING_FAILED'); assert.equal(error.cause, undefined);
      assert.match(error.message, /UNRESOLVED_WEB_TOOL_FAILURE/); assert.equal(error.message.includes('private'), false); return true;
    });
    assert.deepEqual(events, ['reserve', 'run', 'account', 'fail', 'release']);
  }
});
