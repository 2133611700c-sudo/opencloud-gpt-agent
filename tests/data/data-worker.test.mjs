import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDataWorker, DataWorkerError } from '../../src/data/data-worker.mjs';

const lease = () => ({
  taskId: 'task-1', nodeId: 'node-1', workerId: 'data-worker',
  leaseToken: '12345678-1234-4234-8234-123456789abc', agentId: 'data', attempt: 1,
  inputPayload: { source_node_key: 'research' },
});
const input = () => ({
  requiredFields: ['price'],
  researchResult: {
    status: 'SUCCESS',
    sources: [
      { id: 's2', url: ' HTTPS://Example.COM:443/a ', checkedAt: ' 2026-10-12 ', title: ' Source ' },
      { id: 's1', url: 'https://example.com/a', checkedAt: '2026-10-12', title: 'Source' },
    ],
    items: [
      { id: 'i2', title: ' Result ', data: { price: 0 }, sourceIds: ['s2'] },
      { id: 'i1', title: 'Result', data: { price: 0 }, sourceIds: ['s1'] },
    ],
  },
});
const fixture = (overrides = {}) => {
  const calls = [];
  const kernel = {
    claimNextNodeForAgent: async (args) => { calls.push(['claim', args]); return lease(); },
    claimNodeForTaskAndAgent: async (args) => { calls.push(['claimTask', args]); return lease(); },
    heartbeat: async (args) => { calls.push(['heartbeat', args]); return true; },
    loadInput: async (args) => { calls.push(['load', args]); return input(); },
    completeSuccess: async (args) => { calls.push(['complete', args]); return true; },
    failTerminal: async (args) => { calls.push(['fail', args]); return true; },
    finalizeTask: async (args) => { calls.push(['finalize', args]); return 'SUCCESS'; },
    reserve: async () => { throw new Error('Data cannot reserve model budget'); },
    recordLlmCall: async () => { throw new Error('Data cannot record model calls'); },
    ...overrides,
  };
  const worker = createDataWorker({ kernel, workerId: 'data-worker', heartbeatIntervalMs: 1000 });
  return { worker, kernel, calls };
};

test('Data worker claims only data, loads dependency input, persists transformed output, and explicitly finalizes', async () => {
  const { worker, calls } = fixture();
  const result = await worker.runOnce();
  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.execution.status, 'SUCCESS');
  assert.equal(result.execution.nodeStatus, 'SUCCESS');
  assert.equal(result.execution.taskStatus, 'SUCCESS');
  assert.equal(result.execution.result.items.length, 1);
  assert.deepEqual(result.execution.result.items[0].sourceIds, ['s1']);
  assert.deepEqual(calls.map(([name]) => name), ['claim', 'heartbeat', 'load', 'heartbeat', 'complete', 'finalize']);
  assert.deepEqual(calls[0][1], { workerId: 'data-worker', agentId: 'data', leaseSeconds: 30 });
  assert.deepEqual(calls[1][1], { nodeId: 'node-1', workerId: 'data-worker', leaseToken: lease().leaseToken, leaseSeconds: 30 });
  assert.deepEqual(calls[4][1], { nodeId: 'node-1', workerId: 'data-worker', leaseToken: lease().leaseToken, outputData: result.execution.result });
  assert.equal(calls[5][1], 'task-1');
});

test('Data worker uses exact task-scoped claims and returns IDLE without work', async () => {
  const { worker, calls } = fixture({ claimNodeForTaskAndAgent: async (args) => { calls.push(['claimTask', args]); return null; } });
  assert.deepEqual(await worker.runTask(' task-1 '), { status: 'IDLE' });
  assert.deepEqual(calls, [['claimTask', { taskId: 'task-1', workerId: 'data-worker', agentId: 'data', leaseSeconds: 30 }]]);
  const idle = fixture({ claimNextNodeForAgent: async () => null });
  assert.deepEqual(await idle.worker.runOnce(), { status: 'IDLE' });
  assert.deepEqual(idle.calls, []);
});

test('misrouted agent, task, worker, or invalid fence causes zero execution mutations', async () => {
  for (const [update, code] of [
    [{ agentId: 'researcher' }, 'AGENT_SCOPE_VIOLATION'],
    [{ taskId: 'another-task' }, 'TASK_SCOPE_VIOLATION'],
    [{ workerId: 'another-worker' }, 'WORKER_SCOPE_VIOLATION'],
    [{ leaseToken: 'invalid' }, null],
  ]) {
    const { worker, calls } = fixture({ claimNodeForTaskAndAgent: async () => ({ ...lease(), ...update }) });
    await assert.rejects(() => worker.runTask('task-1'), (error) => code ? error.code === code : error instanceof TypeError);
    assert.deepEqual(calls, []);
  }
});

test('invalid Research output terminalizes Data under the exact fence with safe contract evidence', async () => {
  const invalid = input();
  delete invalid.researchResult.items[0].data.price;
  const { worker, calls } = fixture({ loadInput: async () => invalid });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'REQUIRED_FIELD_MISSING');
  const failures = calls.filter(([name]) => name === 'fail');
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0][1], {
    nodeId: 'node-1', workerId: 'data-worker', leaseToken: lease().leaseToken,
    error: { code: 'REQUIRED_FIELD_MISSING', message: 'Data contract validation failed' },
  });
  assert.equal(calls.some(([name]) => name === 'complete' || name === 'finalize'), false);
});

test('unavailable dependency input is terminalized while an active lease remains', async () => {
  const { worker, calls } = fixture({ loadInput: async () => null });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'DATA_INPUT_UNAVAILABLE');
  assert.equal(calls.filter(([name]) => name === 'fail').length, 1);
  assert.equal(calls.some(([name]) => name === 'complete'), false);
});

test('unknown runtime failures never copy exception messages or arbitrary error codes into durable failure', async () => {
  const { kernel, calls } = fixture();
  const worker = createDataWorker({ kernel, workerId: 'data-worker', transform: () => {
    throw Object.assign(new Error('PRIVATE_ERROR_DETAIL'), { code: 'PRIVATE_ERROR_DETAIL' });
  } });
  await assert.rejects(() => worker.runOnce(), (error) => error instanceof DataWorkerError && error.message === 'Data execution failed');
  const failure = calls.find(([name]) => name === 'fail')[1].error;
  assert.deepEqual(failure, { code: 'DATA_EXECUTION_FAILED', message: 'Data execution failed' });
  assert.equal(JSON.stringify(failure).includes('PRIVATE_ERROR_DETAIL'), false);
});

test('a transformer must produce a valid synchronous Data contract before any completion', async () => {
  const { kernel, calls } = fixture();
  const worker = createDataWorker({ kernel, workerId: 'data-worker', transform: () => ({ schemaVersion: 2, status: 'SUCCESS' }) });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'UNSUPPORTED_DATA_SCHEMA_VERSION');
  assert.equal(calls.some(([name]) => name === 'complete'), false);
  assert.equal(calls.filter(([name]) => name === 'fail').length, 1);
});

test('initial heartbeat rejection or transport failure prevents reads and all terminal mutations', async () => {
  for (const [renew, code] of [
    [async () => false, 'LEASE_LOST'],
    [async () => { throw new Error('PRIVATE_HEARTBEAT_DETAIL'); }, 'HEARTBEAT_RENEWAL_FAILED'],
  ]) {
    const { worker, calls } = fixture({ heartbeat: renew });
    await assert.rejects(() => worker.runOnce(), (error) => error.code === code);
    assert.deepEqual(calls.map(([name]) => name), ['claim']);
  }
});

test('lease loss before completion stops mutation and stops heartbeat timers', async () => {
  let renewals = 0;
  const { worker, calls } = fixture({ heartbeat: async () => (++renewals === 1) });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'LEASE_LOST');
  assert.equal(calls.some(([name]) => name === 'fail' || name === 'complete' || name === 'finalize'), false);
  const count = renewals;
  await delay(10);
  assert.equal(renewals, count);
});

test('periodic heartbeat loss while input I/O is pending prevents transform and all terminal mutations', async () => {
  let renewals = 0;
  let transforms = 0;
  let releaseLoad;
  const load = new Promise((resolve) => { releaseLoad = resolve; });
  const { kernel, calls } = fixture({
    heartbeat: async () => {
      renewals += 1;
      if (renewals === 2) { releaseLoad(input()); return false; }
      return true;
    },
    loadInput: async () => load,
  });
  const worker = createDataWorker({ kernel, workerId: 'data-worker', heartbeatIntervalMs: 2, transform: () => { transforms += 1; return {}; } });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'LEASE_LOST');
  assert.equal(transforms, 0);
  assert.equal(calls.some(([name]) => name === 'fail' || name === 'complete' || name === 'finalize'), false);
  const count = renewals;
  await delay(10);
  assert.equal(renewals, count);
});

test('completion rejection never returns success or attempts another terminal mutation', async () => {
  const { worker, calls } = fixture({ completeSuccess: async () => false });
  await assert.rejects(() => worker.runOnce(), (error) => error.code === 'SUCCESS_FENCE_REJECTED');
  assert.equal(calls.some(([name]) => name === 'fail' || name === 'finalize'), false);
});

test('rejected or uncertain failure persistence cannot be presented as terminalized success', async () => {
  for (const [failTerminal, code] of [
    [async () => false, 'FAILURE_FENCE_REJECTED'],
    [async () => { throw new Error('transport failed'); }, 'DATA_FAILURE_NOT_CONFIRMED'],
  ]) {
    const { worker } = fixture({ loadInput: async () => null, failTerminal });
    await assert.rejects(() => worker.runOnce(), (error) => error.code === code);
  }
});

test('finalizer status remains authoritative when deadline or cancellation wins after node completion', async () => {
  for (const taskStatus of ['FAIL_WITH_EVIDENCE', 'CANCELLED', 'RUNNING']) {
    const { worker, calls } = fixture({ finalizeTask: async () => taskStatus });
    const output = await worker.runOnce();
    assert.equal(output.execution.status, 'SUCCESS');
    assert.equal(output.execution.nodeStatus, 'SUCCESS');
    assert.equal(output.execution.taskStatus, taskStatus);
    assert.equal(calls.some(([name]) => name === 'fail'), false);
  }
});

test('finalizer I/O or invalid status after accepted completion never downgrades the SUCCESS node', async () => {
  for (const finalizeTask of [async () => { throw new Error('finalizer unavailable'); }, async () => null]) {
    let renewals = 0;
    const { worker, calls } = fixture({ finalizeTask, heartbeat: async () => { renewals += 1; return true; } });
    await assert.rejects(() => worker.runOnce());
    assert.equal(calls.filter(([name]) => name === 'complete').length, 1);
    assert.equal(calls.some(([name]) => name === 'fail'), false);
    const count = renewals;
    await delay(10);
    assert.equal(renewals, count);
  }
});

test('post-completion heartbeat rejection is harmless and no timer runs during finalization', async () => {
  let renewals = 0;
  let releaseRenew;
  let announcePending;
  const pending = new Promise((resolve) => { announcePending = resolve; });
  const { kernel, calls } = fixture({
    heartbeat: async () => {
      renewals += 1;
      if (renewals === 3) {
        announcePending();
        return new Promise((resolve) => { releaseRenew = resolve; });
      }
      return true;
    },
    completeSuccess: async () => {
      await pending;
      setTimeout(() => releaseRenew(false), 0);
      return true;
    },
    finalizeTask: async () => {
      const count = renewals;
      await delay(10);
      assert.equal(renewals, count);
      return 'SUCCESS';
    },
  });
  const worker = createDataWorker({ kernel, workerId: 'data-worker', heartbeatIntervalMs: 2 });
  const output = await worker.runOnce();
  assert.equal(output.execution.taskStatus, 'SUCCESS');
  assert.equal(calls.some(([name]) => name === 'fail'), false);
  assert.equal(renewals, 3);
});

test('worker validates lease duration, heartbeat timing, and task-scoped capability', async () => {
  const { kernel } = fixture();
  assert.throws(() => createDataWorker({ kernel, workerId: 'w', leaseSeconds: 1 }), RangeError);
  assert.throws(() => createDataWorker({ kernel, workerId: 'w', leaseSeconds: 5, heartbeatIntervalMs: 5000 }), RangeError);
  const worker = createDataWorker({ kernel: { ...kernel, claimNodeForTaskAndAgent: undefined }, workerId: 'data-worker' });
  await assert.rejects(() => worker.runTask('task-1'), TypeError);
});
