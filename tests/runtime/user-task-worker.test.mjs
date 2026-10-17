import assert from 'node:assert/strict';
import test from 'node:test';
import { runUserTaskWorker } from '../../src/runtime/user-task-worker.mjs';

const requestId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const config = { principalId: 'operator', requestId, pollIntervalMs: 1, maxWaitMs: 100 };

test('prearmed worker discovers authenticated external request and executes the same durable task once', async () => {
  const calls = []; let queries = 0;
  const expected = Object.freeze({ published: true, taskId, text: 'phone' });
  const actual = await runUserTaskWorker({
    ...config,
    query: async (sql, values) => {
      assert.match(sql, /authenticated_http/);
      assert.deepEqual(values, [`user:http:operator:${requestId}`, 'operator', requestId]);
      queries++;
      return { rows: queries < 2 ? [] : [{ task_id: taskId }] };
    },
    runtime: { async runTask(id) { calls.push(id); return expected; } },
  });
  assert.equal(actual, expected); assert.equal(queries, 2); assert.deepEqual(calls, [taskId]);
});

test('execution failure is not an automatic paid retry loop', async () => {
  let executions = 0;
  await assert.rejects(runUserTaskWorker({
    ...config, query: async () => ({ rows: [{ task_id: taskId }] }),
    runtime: { async runTask() { executions++; throw new Error('stop'); } },
  }), /stop/);
  assert.equal(executions, 1);
});

test('duplicate identity, malformed task or discovery error causes zero execution', async () => {
  for (const query of [
    async () => ({ rows: [{ task_id: taskId }, { task_id: taskId }] }),
    async () => ({ rows: [{ task_id: 'invalid' }] }),
    async () => { throw new Error('private transport diagnostic'); },
  ]) {
    let calls = 0;
    await assert.rejects(runUserTaskWorker({ ...config, query, runtime: { async runTask() { calls++; } } }),
      (error) => error.code?.startsWith('USER_WORKER_') && !error.message.includes('private'));
    assert.equal(calls, 0);
  }
});

test('missing request times out, aborted worker never queries', async () => {
  let calls = 0;
  const runtime = { async runTask() { calls++; } };
  await assert.rejects(runUserTaskWorker({ ...config, maxWaitMs: 5, query: async () => ({ rows: [] }), runtime }),
    // maxWaitMs is 5ms: on a loaded machine the deadline guard may fire first.
    // Both outcomes are the correct fail-closed result; the invariant is no paid work.
    { code: /^USER_WORKER_(REQUEST_NOT_FOUND|DISCOVERY_TIMEOUT)$/ });
  await assert.rejects(runUserTaskWorker({ ...config, query: async () => { calls++; }, runtime, signal: AbortSignal.abort() }),
    { code: 'USER_WORKER_ABORTED' });
  assert.equal(calls, 0);
});

test('a stalled discovery transport cannot outlive the bounded request wait', async () => {
  let executions = 0;
  await assert.rejects(runUserTaskWorker({
    ...config, maxWaitMs: 5, query: () => new Promise(() => {}),
    runtime: { async runTask() { executions++; } },
  }), { code: 'USER_WORKER_DISCOVERY_TIMEOUT' });
  assert.equal(executions, 0);
});

test('a synchronous transport returning after deadline cannot start paid work', async () => {
  let executions = 0;
  await assert.rejects(runUserTaskWorker({
    ...config, maxWaitMs: 5,
    query: async () => {
      const until = performance.now() + 20;
      while (performance.now() < until) { /* simulate a blocking child */ }
      return { rows: [{ task_id: taskId }] };
    },
    runtime: { async runTask() { executions++; } },
  }), { code: 'USER_WORKER_DISCOVERY_TIMEOUT' });
  assert.equal(executions, 0);
});
