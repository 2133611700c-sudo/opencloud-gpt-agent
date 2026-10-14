import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLiveRuntimeEvidenceProof,
  finalizeLiveRuntimeEvidence,
  LiveRuntimeEvidenceGateError,
} from '../../src/evidence/live-runtime-evidence-gate.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000007';
const runtimeReceiptId = '00000000-0000-4000-8000-000000000008';
const model = 'deepseek/deepseek-flash';

const durableReceipt = () => ({
  artifactId,
  taskId,
  uri: `artifact://postgres/${artifactId}`,
  sha256: 'a'.repeat(64),
  bundle: {
    task: { id: taskId },
    coverage: { runtimeReceiptsPresent: true, toolMetadataPresent: true },
    runtimeReceipts: [{
      id: runtimeReceiptId,
      observed: {
        provider: 'deepseek', model: 'deepseek-flash', sessionId: 'session-1',
        toolSummary: { calls: 2, failures: 0, tools: ['web_search', 'web_fetch'], totalToolTimeMs: 10 },
      },
      configured: { runtimeVersion: '2026.9.8', requestedModel: model, thinkingLevel: 'max' },
      error: null,
    }],
  },
});

test('live runtime Evidence proof requires pinned DeepSeek plus web_search and web_fetch', () => {
  const proof = assertLiveRuntimeEvidenceProof({ receipt: durableReceipt(), taskId, model });
  assert.equal(proof.artifactId, artifactId);
  assert.equal(proof.runtimeReceiptId, runtimeReceiptId);
  assert.equal(proof.runtimeReceiptCount, 1);
  assert.equal(proof.runtimeSessionId, 'session-1');
  assert.deepEqual(proof.tools, ['web_search', 'web_fetch']);
});

test('live runtime Evidence proof fails closed when durable tool/runtime metadata is incomplete', () => {
  for (const mutate of [
    (row) => { row.bundle.coverage.runtimeReceiptsPresent = false; },
    (row) => { row.bundle.runtimeReceipts[0].observed.model = 'other-model'; },
    (row) => { row.bundle.runtimeReceipts[0].configured.runtimeVersion = 'other-version'; },
    (row) => { row.bundle.runtimeReceipts[0].observed.toolSummary.tools = ['web_search']; },
    (row) => { row.bundle.runtimeReceipts[0].observed.toolSummary.failures = 1; },
  ]) {
    const receipt = durableReceipt(); mutate(receipt);
    assert.throws(
      () => assertLiveRuntimeEvidenceProof({ receipt, taskId, model }),
      (error) => error instanceof LiveRuntimeEvidenceGateError && error.code === 'LIVE_RUNTIME_EVIDENCE_NOT_PROVEN',
    );
  }
});

test('live finalizer persists the terminal task before proving the durable receipt', async () => {
  const calls = [];
  const finalizer = {
    async finalize(id, options) {
      calls.push({ id, options });
      return durableReceipt();
    },
  };
  const proof = await finalizeLiveRuntimeEvidence({
    finalizer,
    evidence: { task_id: taskId },
    model,
    sensitiveValues: ['secret-sentinel'],
  });
  assert.equal(proof.sha256, 'a'.repeat(64));
  assert.deepEqual(calls, [{ id: taskId, options: { sensitiveValues: ['secret-sentinel'] } }]);
});
