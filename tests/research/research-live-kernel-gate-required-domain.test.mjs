import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiveResearchKernelGate } from '../../src/research/research-live-kernel-gate.mjs';

const researchFrom = (url) => ({
  status: 'EXECUTED',
  claim: { taskId: 'task-1', nodeId: 'research-1' },
  execution: {
    status: 'SUCCESS',
    research: {
      result: {
        status: 'SUCCESS',
        sources: [{ id: 's1', url, checkedAt: '2026-10-11T21:00:00Z' }],
        items: [{
          id: 'model-1',
          data: { modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash' },
          sourceIds: ['s1'],
        }],
      },
      telemetry: {
        model: 'deepseek-flash',
        toolSummary: { tools: ['web_search', 'web_fetch'] },
      },
    },
  },
});

const kernel = {
  claimNodeForTaskAndAgent: async () => null,
  completeSuccess: async () => false,
};

test('live gate rejects official DeepSeek evidence outside request.requiredDomains', async () => {
  const calls = [];
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('AS active_count')) return { rows: [{ active_count: 0 }] };
    if (text.startsWith('SELECT * FROM create_lite_research_task')) return { rows: [{ task_id: 'task-1', created: true }] };
    if (text.startsWith('SELECT cancel_task')) return { rows: [{ cancelled: true }] };
    throw new Error(`unexpected query: ${text}`);
  };

  await assert.rejects(() => runLiveResearchKernelGate({
    query,
    worker: { runTask: async () => researchFrom('https://www.deepseek.com/news') },
    kernel,
    idempotencyKey: 'required-domain-proof-test',
  }), (error) => error?.code === 'LIVE_REQUIRED_DOMAIN_SOURCE_NOT_PROVEN');

  const cleanup = calls.find((call) => call.text.startsWith('SELECT cancel_task'));
  assert.ok(cleanup);
  assert.equal(JSON.parse(cleanup.values[2]).originalCode, 'LIVE_REQUIRED_DOMAIN_SOURCE_NOT_PROVEN');
});

test('live gate rejects malformed requiredDomains before touching the queue', async () => {
  let queried = false;
  await assert.rejects(() => runLiveResearchKernelGate({
    query: async () => { queried = true; return { rows: [] }; },
    worker: { runTask: async () => researchFrom('https://api-docs.deepseek.com/updates/') },
    kernel,
    idempotencyKey: 'invalid-required-domain-test',
    request: {
      requiredFields: ['modelId', 'modelVersion'],
      constraints: { requiredDomains: ['https://api-docs.deepseek.com/'] },
    },
  }), TypeError);
  assert.equal(queried, false);
});
