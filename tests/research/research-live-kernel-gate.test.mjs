import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiveResearchKernelGate } from '../../src/research/research-live-kernel-gate.mjs';

const liveResearch = {
  status: 'EXECUTED',
  claim: { taskId: 'task-1', nodeId: 'research-1' },
  execution: {
    status: 'SUCCESS',
    research: {
      result: {
        status: 'SUCCESS',
        sources: [{ id: 's1', url: 'https://api-docs.deepseek.com/', checkedAt: '2026-10-11T21:00:00Z' }],
      },
      telemetry: {
        model: 'deepseek-flash',
        toolSummary: { tools: ['web_search', 'web_fetch'] },
      },
    },
  },
};

const makeQuery = ({ isolated = true } = {}) => {
  const calls = [];
  let claimChecks = 0;
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('AS claimable_count')) {
      claimChecks += 1;
      return { rows: [{ claimable_count: isolated ? 0 : (claimChecks === 1 ? 1 : 0) }] };
    }
    if (text.startsWith('SELECT * FROM create_lite_research_task')) return { rows: [{ task_id: 'task-1', created: true }] };
    if (text.startsWith('SELECT count(*)::int AS accounting_rows')) return { rows: [{ accounting_rows: 1, accounting_basis: 'OBSERVED_USAGE' }] };
    if (text.startsWith("SELECT count(*) FILTER (WHERE status='RESERVED')")) return { rows: [{ unresolved_reservations: 0 }] };
    if (text.startsWith('SELECT finalize_task')) return { rows: [{ status: 'SUCCESS' }] };
    throw new Error(`unexpected query: ${text}`);
  };
  return { query, calls };
};

test('live Research gate proves web tools, accounting, Data release and terminal SUCCESS', async () => {
  const db = makeQuery();
  const workerCalls = [];
  const kernelCalls = [];
  const worker = { runOnce: async () => (workerCalls.push('run'), liveResearch) };
  const kernel = {
    claimNextNodeForAgent: async (input) => {
      kernelCalls.push(['claim', input]);
      return { taskId: 'task-1', nodeId: 'data-1', workerId: input.workerId, leaseToken: '44444444-4444-4444-8444-444444444444', agentId: 'data' };
    },
    completeSuccess: async (input) => (kernelCalls.push(['complete', input]), true),
  };

  const evidence = await runLiveResearchKernelGate({
    query: db.query,
    worker,
    kernel,
    idempotencyKey: 'live-test-key',
    now: () => new Date('2026-10-11T21:00:00Z'),
  });

  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.task_status, 'SUCCESS');
  assert.equal(evidence.research_status, 'SUCCESS');
  assert.equal(evidence.source_count, 1);
  assert.deepEqual(evidence.tools, ['web_search', 'web_fetch']);
  assert.equal(evidence.accounting_rows, 1);
  assert.equal(evidence.accounting_basis, 'OBSERVED_USAGE');
  assert.equal(evidence.unresolved_reservations, 0);
  assert.equal(evidence.data_mode, 'DETERMINISTIC_LIVE_GATE_COMPLETION');
  assert.equal(workerCalls.length, 1);
  assert.deepEqual(kernelCalls[0][1], { workerId: 'live-research-gate-data', agentId: 'data', leaseSeconds: 30 });
  assert.equal(kernelCalls[1][1].outputData.mode, 'DETERMINISTIC_LIVE_GATE_COMPLETION');

  const createCall = db.calls.find((call) => call.text.startsWith('SELECT * FROM create_lite_research_task'));
  assert.ok(createCall);
  assert.equal(createCall.values[0], 'live-test-key');
  assert.equal(createCall.values[4], 100_000);
  assert.equal(createCall.values[5], 4);
  assert.equal(createCall.values[6], '2026-10-11T21:10:00.000Z');
});

test('live gate refuses a non-isolated queue before creating or claiming anything', async () => {
  const db = makeQuery({ isolated: false });
  let ran = false;
  await assert.rejects(() => runLiveResearchKernelGate({
    query: db.query,
    worker: { runOnce: async () => { ran = true; return liveResearch; } },
    kernel: { claimNextNodeForAgent: async () => null, completeSuccess: async () => false },
    idempotencyKey: 'live-test-key',
  }), (error) => error?.code === 'LIVE_QUEUE_NOT_ISOLATED');
  assert.equal(ran, false);
  assert.equal(db.calls.some((call) => call.text.startsWith('SELECT * FROM create_lite_research_task')), false);
});

test('live gate rejects Research SUCCESS without both web_search and web_fetch evidence', async () => {
  const db = makeQuery();
  const incomplete = structuredClone(liveResearch);
  incomplete.execution.research.telemetry.toolSummary.tools = ['web_search'];
  await assert.rejects(() => runLiveResearchKernelGate({
    query: db.query,
    worker: { runOnce: async () => incomplete },
    kernel: { claimNextNodeForAgent: async () => null, completeSuccess: async () => false },
    idempotencyKey: 'live-test-key',
  }), (error) => error?.code === 'LIVE_WEB_TOOLS_NOT_PROVEN');
});
