import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDeepLogMarkdown } from '../../src/phone/deep-log-markdown.mjs';

const artifactId = 'fa56c478-8d11-46cb-9686-bd518b04b887';
const snapshotSha256 = '6e3afbbddc893a9f03e5b673881f16dfb539686db5a4d73b41cff648596c7756';

const evidence = (status = 'SUCCESS') => ({
  task: {
    id: '00166732-6a5d-46fc-9a73-69ad3792955a',
    status,
    terminalReason: status === 'SUCCESS' ? 'ALL_NODES_SUCCEEDED' : 'NODE_FAILED',
    currentCostUsd: '0.000003',
    currentSteps: 2,
    currentTokens: '9',
  },
  nodes: [
    {
      nodeKey: 'research',
      status: status === 'SUCCESS' ? 'SUCCESS' : 'FAIL_WITH_EVIDENCE',
      error: status === 'SUCCESS' ? null : { code: 'UNRESOLVED_WEB_TOOL_FAILURE', message: 'must never render' },
      result: {
        status: 'SUCCESS',
        sources: [{
          id: 'source-1',
          title: 'DeepSeek [docs]',
          url: 'https://api-docs.deepseek.com/',
          checkedAt: '2026-10-15T00:00:00Z',
          secret: 'must-never-render',
        }],
      },
    },
    {
      nodeKey: 'data',
      status: status === 'SUCCESS' ? 'SUCCESS' : 'BLOCKED',
      error: null,
      result: status === 'SUCCESS' ? {
        status: 'SUCCESS',
        items: [{
          id: 'item-1',
          title: 'Model *result*',
          data: {
            modelId: 'deepseek-flash',
            modelVersion: 'V4.1',
            price: 1.25,
            apiKey: 'must-never-render',
            nested: { prompt: 'must-never-render' },
          },
        }],
        sources: [{ url: 'https://api-docs.deepseek.com/' }],
      } : null,
    },
  ],
  accounting: [{
    provider: 'deepseek',
    model: 'deepseek-flash',
    totalTokens: '9',
    completionTokens: '4',
    promptCacheHitTokens: '2',
    promptCacheMissTokens: '3',
    latencyMs: 12,
    costUsd: '0.000003',
    pricingVersion: 'deepseek-v4.1-flash-2026-09-10',
    providerRequestId: 'not-rendered',
  }],
  runtimeReceipts: [{
    configured: {
      runtimeVersion: '2026.10.3',
      requestedModel: 'deepseek/deepseek-flash',
      thinkingLevel: 'max',
    },
    observed: {
      provider: 'deepseek',
      model: 'deepseek-flash',
      sessionId: 'must-never-render',
      toolSummary: { tools: ['web_search', 'web_fetch'], calls: 2, failures: 0 },
    },
    trace: [{ event: 'ACCOUNTING_RECONCILED', raw: 'must-never-render' }],
    error: status === 'SUCCESS' ? null : { code: 'UNRESOLVED_WEB_TOOL_FAILURE', reason: 'REJECTED_RESEARCH_OUTPUT', message: 'must-never-render' },
  }],
  attemptCounters: { totalAttempts: '2' },
  privateReasoning: 'must-never-render',
  prompt: 'must-never-render',
});

test('renders a bounded SUCCESS deep log with result, accounting, runtime and sources', () => {
  const rendered = renderDeepLogMarkdown({ evidence: evidence(), artifactId, snapshotSha256 });
  assert.equal(rendered.taskId, '00166732-6a5d-46fc-9a73-69ad3792955a');
  assert.match(rendered.markdown, /Status: \*\*SUCCESS\*\*/);
  assert.ok(rendered.markdown.includes('Model \\*result\\*'));
  assert.ok(rendered.markdown.includes('modelId=deepseek\\-flash'));
  assert.match(rendered.markdown, /tokens 9 \(hit 2, miss 3, completion 4\)/);
  assert.ok(rendered.markdown.includes('web\\_search'));
  assert.ok(rendered.markdown.includes('ACCOUNTING\\_RECONCILED'));
  assert.match(rendered.markdown, /api-docs\.deepseek\.com/);
  assert.ok(rendered.markdown.length < 30_000);
});

test('renders FAIL_WITH_EVIDENCE using bounded error codes only', () => {
  const rendered = renderDeepLogMarkdown({ evidence: evidence('FAIL_WITH_EVIDENCE'), artifactId, snapshotSha256 });
  assert.match(rendered.markdown, /FAIL\\_WITH\\_EVIDENCE/);
  assert.match(rendered.markdown, /UNRESOLVED\\_WEB\\_TOOL\\_FAILURE/);
  assert.doesNotMatch(rendered.markdown, /must never render/);
});

test('does not serialize secrets, prompts, session ids, provider request ids or private reasoning', () => {
  const rendered = renderDeepLogMarkdown({ evidence: evidence(), artifactId, snapshotSha256 });
  for (const forbidden of ['must-never-render', 'privateReasoning', 'providerRequestId', 'sessionId', 'apiKey']) {
    assert.doesNotMatch(rendered.markdown, new RegExp(forbidden));
  }
  assert.match(rendered.markdown, /private reasoning are intentionally excluded/);
});

test('omits private or credential-bearing source URLs', () => {
  const sample = evidence();
  sample.nodes[0].result.sources.push({ url: 'https://user:pass@example.com/private' });
  sample.nodes[0].result.sources.push({ url: 'http://127.0.0.1/internal' });
  const rendered = renderDeepLogMarkdown({ evidence: sample, artifactId, snapshotSha256 });
  assert.doesNotMatch(rendered.markdown, /user:pass/);
  assert.doesNotMatch(rendered.markdown, /127\.0\.0\.1/);
});

test('rejects non-terminal Evidence and invalid durable identity', () => {
  const running = evidence();
  running.task.status = 'RUNNING';
  assert.throws(() => renderDeepLogMarkdown({ evidence: running, artifactId, snapshotSha256 }), /terminal SUCCESS or FAIL_WITH_EVIDENCE/);
  assert.throws(() => renderDeepLogMarkdown({ evidence: evidence(), artifactId: 'bad id with spaces', snapshotSha256 }), /invalid format/);
  assert.throws(() => renderDeepLogMarkdown({ evidence: evidence(), artifactId, snapshotSha256: 'abc' }), /SHA-256/);
});
