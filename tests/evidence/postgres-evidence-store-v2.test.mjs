import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { createEvidenceArtifact } from '../../src/evidence/evidence-contract.mjs';
import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000007';
const at = '2026-10-14T10:00:00.123456Z';
const raw = {
  task: {
    id: taskId, goal: 'Evidence v2 routing fixture', request_payload: {}, status: 'CANCELLED',
    terminal_reason: 'USER_CANCELLED', terminal_detail: {}, budget_limit_usd: '1.000000',
    current_cost_usd: '0.000000', reserved_cost_usd: '0.000000', token_budget_limit: '100',
    current_tokens: '0', reserved_tokens: '0', max_total_steps: 4, current_steps: 0,
    created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00.123456Z',
  },
  nodes: [], dependencies: [], accounting: [], reservations: [], runtimeReceipts: [],
};
const fingerprint = createHash('sha256').update(JSON.stringify(raw)).digest('hex');

test('v2 Evidence store routes load, persist and read to receipt-bound SQL functions', async () => {
  const artifact = createEvidenceArtifact(raw);
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM load_terminal_evidence_input_v2')) {
      return { rows: [{ snapshot: structuredClone(raw), snapshot_sha256: fingerprint }] };
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

  const store = createPostgresEvidenceStoreV2({ query });
  const input = await store.loadInput(taskId);
  assert.equal(input.snapshotSha256, fingerprint);
  const persisted = await store.persist({ taskId, artifact, expectedSnapshotFingerprint: fingerprint });
  assert.equal(persisted.created, true);
  assert.equal((await store.read(taskId)).artifactId, artifactId);
  assert.ok(calls.some(({ sql }) => sql.startsWith('SELECT * FROM load_terminal_evidence_input_v2')));
  assert.ok(calls.some(({ sql }) => sql.startsWith('SELECT * FROM persist_task_evidence_v2')));
  assert.ok(calls.some(({ sql }) => sql.startsWith('SELECT * FROM read_task_evidence_snapshot_v2')));
  assert.equal(calls.some(({ sql }) => /_v1\(/.test(sql)), false);
});

test('v2 Evidence store rejects missing query capability before any work', () => {
  assert.throws(() => createPostgresEvidenceStoreV2(), TypeError);
});
