import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createEvidenceArtifact } from '../../src/evidence/evidence-contract.mjs';
import { createPostgresTerminalEvidenceFinalizer } from '../../src/evidence/postgres-terminal-evidence-finalizer.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000007';
const at = '2026-10-14T10:00:00.123456Z';
const snapshot = {
  task: {
    id: taskId, goal: 'Finalize receipt-bound Evidence', request_payload: {}, status: 'CANCELLED',
    terminal_reason: 'USER_CANCELLED', terminal_detail: {}, budget_limit_usd: '1.000000',
    current_cost_usd: '0.000000', reserved_cost_usd: '0.000000', token_budget_limit: '100',
    current_tokens: '0', reserved_tokens: '0', max_total_steps: 4, current_steps: 0,
    created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00.123456Z',
  },
  nodes: [], dependencies: [], accounting: [], reservations: [], runtimeReceipts: [],
};
const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

test('Postgres finalizer uses v2 receipt-bound routes and verifies durable read-back', async () => {
  const artifact = createEvidenceArtifact(snapshot);
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM load_terminal_evidence_input_v2')) {
      return { rows: [{ snapshot: structuredClone(snapshot), snapshot_sha256: fingerprint }] };
    }
    if (sql.startsWith('SELECT * FROM persist_task_evidence_v2')) {
      return { rows: [{ artifact_id: artifactId, created: true, uri: `artifact://postgres/${artifactId}`, sha256: artifact.sha256, size_bytes: artifact.sizeBytes }] };
    }
    if (sql.startsWith('SELECT * FROM read_task_evidence_snapshot_v2')) {
      return { rows: [{ artifact_id: artifactId, task_id: taskId, uri: `artifact://postgres/${artifactId}`,
        serialized: artifact.serialized, sha256: artifact.sha256, size_bytes: artifact.sizeBytes, created_at: at }] };
    }
    throw new Error(`unexpected SQL route: ${sql}`);
  };

  const finalizer = createPostgresTerminalEvidenceFinalizer({ query, sensitiveValues: ['default-secret'] });
  const receipt = await finalizer.finalize(taskId, { sensitiveValues: ['scoped-secret'] });
  assert.equal(receipt.artifactId, artifactId);
  assert.equal(receipt.created, true);
  assert.equal(receipt.bundle.task.id, taskId);
  assert.deepEqual(calls.map(({ sql }) => sql.match(/(?:load_terminal_evidence_input|persist_task_evidence|read_task_evidence_snapshot)_v\d/)?.[0]), [
    'load_terminal_evidence_input_v2',
    'load_terminal_evidence_input_v2',
    'persist_task_evidence_v2',
    'read_task_evidence_snapshot_v2',
  ]);
  assert.equal(calls.some(({ sql }) => /_v1\(/.test(sql)), false);
});

test('Postgres finalizer fails closed on missing capabilities and malformed options', async () => {
  assert.throws(() => createPostgresTerminalEvidenceFinalizer(), TypeError);
  const finalizer = createPostgresTerminalEvidenceFinalizer({ query: async () => ({ rows: [] }) });
  await assert.rejects(() => finalizer.finalize(taskId, null), TypeError);
  await assert.rejects(() => finalizer.finalize(taskId, { sensitiveValues: 'secret' }), TypeError);
});
