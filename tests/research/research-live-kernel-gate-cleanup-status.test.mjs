import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiveResearchKernelGate } from '../../src/research/research-live-kernel-gate.mjs';

const incompleteResearch = {
  status: 'EXECUTED',
  claim: { taskId: 'task-1', nodeId: 'research-1' },
  execution: {
    status: 'SUCCESS',
    research: {
      result: {
        status: 'SUCCESS',
        sources: [{ id: 's1', url: 'https://api-docs.deepseek.com/updates/', checkedAt: '2026-10-11T21:00:00Z' }],
        items: [{
          id: 'model-1',
          data: { modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash' },
          sourceIds: ['s1'],
        }],
      },
      telemetry: { toolSummary: { tools: ['web_search'] } },
    },
  },
};

const makeQuery = (taskStatus) => {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('AS active_count')) return { rows: [{ active_count: 0 }] };
    if (text.startsWith('SELECT * FROM create_lite_research_task')) return { rows: [{ task_id: 'task-1', created: true }] };
    if (text.startsWith('SELECT cancel_task')) return { rows: [{ cancelled: false }] };
    if (text.startsWith('SELECT status FROM tasks WHERE id=$1')) return { rows: [{ status: taskStatus }] };
    throw new Error(`unexpected query: ${text}`);
  };
  return { query, calls };
};

const kernel = { claimNodeForTaskAndAgent: async () => null, completeSuccess: async () => false };

test('live gate treats cancelled=false as cleanup failure while task remains active', async () => {
  const db = makeQuery('RUNNING');
  await assert.rejects(() => runLiveResearchKernelGate({
    query: db.query,
    worker: { runOnce: async () => incompleteResearch },
    kernel,
    idempotencyKey: 'cleanup-active-test',
  }), (error) => error?.code === 'LIVE_GATE_CLEANUP_FAILED'
    && error?.originalCode === 'LIVE_WEB_TOOLS_NOT_PROVEN'
    && error?.taskStatus === 'RUNNING');
  assert.ok(db.calls.some((call) => call.text.startsWith('SELECT status FROM tasks WHERE id=$1')));
});

test('live gate preserves original failure when task was already terminalized by another fenced path', async () => {
  const db = makeQuery('FAIL_WITH_EVIDENCE');
  await assert.rejects(() => runLiveResearchKernelGate({
    query: db.query,
    worker: { runOnce: async () => incompleteResearch },
    kernel,
    idempotencyKey: 'cleanup-terminal-test',
  }), (error) => error?.code === 'LIVE_WEB_TOOLS_NOT_PROVEN');
  assert.ok(db.calls.some((call) => call.text.startsWith('SELECT status FROM tasks WHERE id=$1')));
});
