import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskPhoneRuntime } from '../../src/runtime/task-phone-runtime.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const fixture = (initial = 'PENDING') => {
  let status = initial;
  const calls = [];
  let publicationFails = false;
  const receipt = Object.freeze({ taskId, status: initial, published: true, text: 'phone' });
  const researchWorker = { async runTask(id) { calls.push(['research', id]); status = 'RUNNING'; } };
  const dataWorker = { async runTask(id) { calls.push(['data', id]); status = 'SUCCESS'; } };
  const runtime = createTaskPhoneRuntime({
    readTaskStatus: async () => status,
    researchWorker, dataWorker,
    publisher: { async publish(id) {
      calls.push(['publish', id]);
      if (publicationFails) throw new Error('publication unavailable');
      return receipt;
    } },
  });
  return { runtime, calls, receipt, researchWorker, dataWorker,
    setStatus(value) { status = value; }, failPublication(value) { publicationFails = value; } };
};

test('existing durable task automatically runs Research, Data, then publication on the same id', async () => {
  const f = fixture();
  assert.equal(await f.runtime.runTask(taskId), f.receipt);
  assert.deepEqual(f.calls, [['research', taskId], ['data', taskId], ['publish', taskId]]);
});

test('confirmed Research failure automatically publishes Evidence and never runs Data', async () => {
  const f = fixture();
  f.researchWorker.runTask = async () => { f.setStatus('FAIL_WITH_EVIDENCE'); throw new Error('paid admission rejected'); };
  await f.runtime.runTask(taskId);
  assert.deepEqual(f.calls, [['publish', taskId]]);
});

test('unconfirmed execution failure stops without publishing or invoking the next worker', async () => {
  const f = fixture();
  f.researchWorker.runTask = async () => { throw new Error('transport failed'); };
  await assert.rejects(f.runtime.runTask(taskId), { code: 'TASK_EXECUTION_NOT_TERMINAL' });
  assert.deepEqual(f.calls, []);
});

test('publication-only retry of terminal task cannot repeat paid Research', async () => {
  const f = fixture('SUCCESS'); f.failPublication(true);
  await assert.rejects(f.runtime.runTask(taskId), /publication unavailable/);
  f.failPublication(false);
  await Promise.all([f.runtime.runTask(taskId), f.runtime.runTask(taskId)]);
  assert.deepEqual(f.calls, Array.from({ length: 3 }, () => ['publish', taskId]));
});

test('both preexisting terminal forms publish directly, cancellation remains distinct', async () => {
  for (const status of ['SUCCESS', 'FAIL_WITH_EVIDENCE']) {
    const f = fixture(status); await f.runtime.runTask(taskId);
    assert.deepEqual(f.calls, [['publish', taskId]]);
  }
  const f = fixture('CANCELLED');
  assert.deepEqual(await f.runtime.runTask(taskId), { status: 'CANCELLED', taskId, published: false });
  assert.deepEqual(f.calls, []);
});

test('active lease held by another worker stays unpublished and recoverable', async () => {
  const f = fixture('RUNNING');
  f.researchWorker.runTask = async () => {}; f.dataWorker.runTask = async () => {};
  assert.deepEqual(await f.runtime.runTask(taskId), { status: 'RUNNING', taskId, published: false });
  assert.deepEqual(f.calls, []);
});

test('invalid id or unknown task state rejects before any worker or publication', async () => {
  const f = fixture(null);
  await assert.rejects(f.runtime.runTask('invalid'), /UUID/);
  await assert.rejects(f.runtime.runTask(taskId), { code: 'TASK_STATE_UNAVAILABLE' });
  assert.deepEqual(f.calls, []);
});
