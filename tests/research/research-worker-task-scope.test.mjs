import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchWorker } from '../../src/research/research-worker.mjs';

const lease = Object.freeze({
  taskId: 'task-target',
  nodeId: 'node-research',
  workerId: 'worker-1',
  leaseToken: '66666666-6666-4666-8666-666666666666',
  agentId: 'researcher',
  inputPayload: { goal: 'Verify target task only', request: { maxResults: 1 } },
});

test('runTask claims Research only from the requested task and never uses the agent-wide claim', async () => {
  const calls = [];
  let agentWideClaimed = false;
  const worker = createResearchWorker({
    kernel: {
      claimNextNodeForAgent: async () => { agentWideClaimed = true; return null; },
      claimNodeForTaskAndAgent: async (input) => { calls.push(['claimTask', input]); return lease; },
      failTerminal: async () => true,
    },
    executeResearch: async ({ claim, request }) => {
      calls.push(['execute', { claim, request }]);
      return { status: 'SUCCESS' };
    },
    workerId: 'worker-1',
    leaseSeconds: 30,
  });

  const result = await worker.runTask('task-target');

  assert.equal(agentWideClaimed, false);
  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.claim.taskId, 'task-target');
  assert.deepEqual(calls[0], ['claimTask', {
    taskId: 'task-target',
    workerId: 'worker-1',
    agentId: 'researcher',
    leaseSeconds: 30,
  }]);
  assert.deepEqual(calls[1][1].request, { maxResults: 1, goal: 'Verify target task only' });
});

test('runTask returns IDLE when the requested task has no claimable Research node', async () => {
  const worker = createResearchWorker({
    kernel: {
      claimNextNodeForAgent: async () => { throw new Error('must not use agent-wide claim'); },
      claimNodeForTaskAndAgent: async () => null,
      failTerminal: async () => true,
    },
    executeResearch: async () => { throw new Error('must not execute'); },
    workerId: 'worker-1',
  });

  assert.deepEqual(await worker.runTask('task-target'), { status: 'IDLE' });
});
