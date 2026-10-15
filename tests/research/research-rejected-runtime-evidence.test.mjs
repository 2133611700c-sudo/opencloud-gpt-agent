import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { createResearchKernelExecutor } from '../../src/research/research-kernel-bindings.mjs';
import { getRejectedResearchBilling, runResearchAgent } from '../../src/research/research-agent-runner.mjs';

const claim = Object.freeze({
  taskId: 'task-safe-error',
  nodeId: 'node-safe-error',
  workerId: 'worker-safe-error',
  leaseToken: '33333333-3333-4333-8333-333333333333',
  agentId: 'researcher',
});

const stateRoot = mkdtempSync(join(tmpdir(), 'research-safe-error-test-'));
after(() => rmSync(stateRoot, { recursive: true, force: true }));

const nativeRejection = async (overrides = {}) => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;

  const envelope = {
    ok: true,
    status: 'ok',
    provider: 'deepseek',
    model: 'deepseek-flash',
    codeModeEngaged: false,
    final: JSON.stringify({
      status: 'SUCCESS',
      summary: 'Synthetic result.',
      confidence: 'HIGH',
      needsBrowser: [],
      sources: [{ id: 's', url: 'https://example.com', checkedAt: '2026-10-14T00:00:00Z' }],
      items: [{ id: 'i', title: 'Item', data: { price: 0 }, sourceIds: ['s'] }],
    }),
    usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 0, total: 9 },
    costUsd: 0.000003,
    sessionId: 'synthetic-rejected-session',
    toolSummary: {
      calls: 2,
      tools: ['web_search', 'web_fetch'],
      failures: 1,
      unresolvedError: { toolName: 'web_fetch' },
    },
    ...overrides,
  };

  let samples = 0;
  try {
    await runResearchAgent({
      request: { goal: 'Synthetic rejected Research' },
      env: { DEEPSEEK_API_KEY: 'test-only-key', OPENCLAW_STATE_DIR: stateRoot },
      tempRoot: stateRoot,
      nowMs: () => ++samples === 1 ? 0 : 37.25,
      spawnImpl: () => {
        queueMicrotask(() => {
          child.stdout.end(JSON.stringify(envelope));
          child.emit('close', 0, null);
        });
        return child;
      },
    });
    assert.fail('native rejected fixture unexpectedly succeeded');
  } catch (error) {
    assert.equal(error.code, 'INVALID_SUCCESS_ENVELOPE');
    assert.ok(getRejectedResearchBilling(error));
    return error;
  }
};

const executeRejected = async (failure) => {
  const receipts = [];
  const accountingPaths = [];
  const kernel = {
    reserve: async () => 'reservation-safe-error',
    heartbeat: async () => true,
    recordLlmCallWithRuntimeReceipt: async (input) => {
      accountingPaths.push('observed');
      receipts.push(input.runtimeReceipt);
      return { accountingId: 'accounting-safe-error', created: true, runtimeReceiptId: 'receipt-safe-error', runtimeReceiptCreated: true };
    },
    recordLlmCallReservationFallbackWithRuntimeReceipt: async (input) => {
      accountingPaths.push('fallback');
      receipts.push(input.runtimeReceipt);
      return { accountingId: 'accounting-safe-error', created: true, runtimeReceiptId: 'receipt-safe-error', runtimeReceiptCreated: true };
    },
    completeSuccess: async () => assert.fail('rejected runtime must not complete successfully'),
    failTerminal: async () => true,
    releaseReservation: async () => assert.fail('accounted rejected runtime must not release a reconciled reservation'),
  };
  const execute = createResearchKernelExecutor({
    kernel,
    pricingVersion: 'safe-error-v1',
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 50 }),
    runResearch: async () => { throw failure; },
    heartbeatIntervalMs: 60_000,
  });

  await assert.rejects(() => execute({ claim, request: 'q' }), (error) => error === failure);
  assert.equal(receipts.length, 1);
  return { receipt: receipts[0], accountingPath: accountingPaths[0] };
};

test('trusted billable rejected Research stores only bounded safe error metadata on observed and fallback accounting', async () => {
  const cases = [
    { overrides: {}, expectedPath: 'observed' },
    { overrides: { usage: { input: -1, output: 4, total: 3 } }, expectedPath: 'fallback' },
  ];

  for (const { overrides, expectedPath } of cases) {
    const failure = await nativeRejection(overrides);
    const billing = getRejectedResearchBilling(failure);
    const { receipt, accountingPath } = await executeRejected(failure);

    assert.equal(accountingPath, expectedPath);
    assert.deepEqual(receipt.error, {
      code: billing.originalCode,
      reason: 'REJECTED_RESEARCH_OUTPUT',
    });
    assert.match(receipt.error.code, /^[A-Z][A-Z0-9_]{0,127}$/);
    assert.deepEqual(Object.keys(receipt.error).sort(), ['code', 'reason']);

    const serialized = JSON.stringify(receipt);
    for (const forbidden of ['Invalid OpenClaw', 'Synthetic result.', 'stdout', 'stderr', 'reasoning', 'test-only-key']) {
      assert.equal(serialized.includes(forbidden), false, `receipt leaked ${forbidden}`);
    }
  }
});
