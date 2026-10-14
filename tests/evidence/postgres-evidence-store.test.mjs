import test from 'node:test';
import assert from 'node:assert/strict';

import { transformData } from '../../src/data/data-transformer.mjs';
import { createEvidenceArtifact } from '../../src/evidence/evidence-contract.mjs';
import { createPostgresEvidenceStore, PostgresEvidenceStoreError } from '../../src/evidence/postgres-evidence-store.mjs';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const at = '2026-10-14T10:00:00.123456Z';

const snapshot = () => {
  const taskId = uuid(1); const researchId = uuid(2); const dataId = uuid(3); const lease = uuid(4);
  const result = {
    status: 'SUCCESS', summary: 'Verified model', confidence: 'HIGH', needsBrowser: [],
    sources: [{ id: 's1', title: 'Source', url: 'https://example.com/docs', checkedAt: at }],
    items: [{ id: 'i1', title: 'Model', data: { price: 0, active: false }, sourceIds: ['s1'] }],
  };
  const task = {
    id: taskId, goal: 'Research a model',
    request_payload: { requiredFields: ['price', 'active'], maxResults: 3, constraints: { requiredDomains: ['example.com'] } },
    status: 'SUCCESS', terminal_reason: 'ALL_NODES_SUCCEEDED', terminal_detail: {},
    budget_limit_usd: '1.000000', current_cost_usd: '0.000003', reserved_cost_usd: '0',
    token_budget_limit: '100', current_tokens: '9', reserved_tokens: '0',
    max_total_steps: 10, current_steps: 2,
    created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00Z',
  };
  const node = (id, nodeKey, agentId, output) => ({
    id, task_id: taskId, node_key: nodeKey, agent_id: agentId, status: 'SUCCESS', attempt: 1, max_attempts: 3,
    output_data: output, last_error: null, reserved_cost_usd: '0', reserved_tokens: '0',
    created_at: at, updated_at: at, started_at: at, finished_at: at,
  });
  return {
    task,
    nodes: [
      node(researchId, 'research', 'researcher', result),
      node(dataId, 'data', 'data', transformData({ requiredFields: task.request_payload.requiredFields, researchResult: result })),
    ],
    dependencies: [{ task_id: taskId, node_id: dataId, parent_node_id: researchId }],
    accounting: [{
      id: uuid(5), task_id: taskId, node_id: researchId, lease_token: lease, call_key: 'research:fixture',
      provider: 'deepseek', model: 'deepseek-flash', pricing_version: 'fixture-v1', provider_request_id: 'session-1',
      prompt_cache_hit_tokens: '2', prompt_cache_miss_tokens: '3', completion_tokens: '4', total_tokens: '9',
      reserved_cost_usd: '0.100000', cost_usd: '0.000003', latency_ms: 0, created_at: at, accounting_basis: 'OBSERVED_USAGE',
    }],
    reservations: [{
      id: uuid(6), task_id: taskId, node_id: researchId, lease_token: lease, reservation_key: 'research:fixture',
      status: 'RECONCILED', reserved_cost_usd: '0.100000', reserved_tokens: '100', actual_cost_usd: '0.000003', actual_tokens: '9',
      reconciliation_basis: 'OBSERVED_USAGE', created_at: at, reconciled_at: at, released_at: null, release_reason: null,
    }],
  };
};

const makeStore = ({ artifact, persistCreated = true, readRow = true } = {}) => {
  const calls = [];
  const artifactId = uuid(7);
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT * FROM persist_task_evidence_v1')) {
      return { rows: [{ artifact_id: artifactId, created: persistCreated, uri: `artifact://postgres/${artifactId}`, sha256: artifact.sha256, size_bytes: artifact.sizeBytes }] };
    }
    if (sql.startsWith('SELECT * FROM read_task_evidence_snapshot_v1')) {
      if (!readRow) return { rows: [] };
      return { rows: [{ artifact_id: artifactId, task_id: artifact.bundle.task.id, uri: `artifact://postgres/${artifactId}`, serialized: artifact.serialized, sha256: artifact.sha256, size_bytes: artifact.sizeBytes, created_at: at }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { store: createPostgresEvidenceStore({ query }), calls, artifactId };
};

test('persist validates canonical artifact before SQL and returns durable receipt', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const { store, calls, artifactId } = makeStore({ artifact });
  const receipt = await store.persist({ taskId: artifact.bundle.task.id, artifact });
  assert.equal(receipt.artifactId, artifactId);
  assert.equal(receipt.created, true);
  assert.equal(receipt.sha256, artifact.sha256);
  assert.equal(receipt.sizeBytes, artifact.sizeBytes);
  assert.equal(receipt.serialized, artifact.serialized);
  assert.deepEqual(receipt.bundle, artifact.bundle);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [artifact.bundle.task.id, artifact.serialized, artifact.sha256]);
});

test('repeat persistence receipt may be idempotent without changing identity', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const { store, artifactId } = makeStore({ artifact, persistCreated: false });
  const receipt = await store.persist({ taskId: artifact.bundle.task.id, artifact });
  assert.equal(receipt.created, false);
  assert.equal(receipt.artifactId, artifactId);
});

test('read revalidates stored hash, size, task linkage and public evidence contract', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const { store } = makeStore({ artifact });
  const receipt = await store.read(artifact.bundle.task.id);
  assert.equal(receipt.sha256, artifact.sha256);
  assert.equal(receipt.serialized, artifact.serialized);
  assert.deepEqual(receipt.bundle, artifact.bundle);
});

test('read returns null when task has no durable evidence artifact', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const { store } = makeStore({ artifact, readRow: false });
  assert.equal(await store.read(artifact.bundle.task.id), null);
});

test('persistence rejects task mismatch, bad hash and bad byte length before query', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const { store, calls } = makeStore({ artifact });
  await assert.rejects(
    () => store.persist({ taskId: uuid(99), artifact }),
    (error) => error instanceof PostgresEvidenceStoreError && error.code === 'EVIDENCE_TASK_MISMATCH',
  );
  await assert.rejects(
    () => store.persist({ taskId: artifact.bundle.task.id, artifact: { ...artifact, sha256: '0'.repeat(64) } }),
    (error) => error instanceof PostgresEvidenceStoreError && error.code === 'EVIDENCE_HASH_MISMATCH',
  );
  await assert.rejects(
    () => store.persist({ taskId: artifact.bundle.task.id, artifact: { ...artifact, sizeBytes: artifact.sizeBytes + 1 } }),
    (error) => error instanceof PostgresEvidenceStoreError && error.code === 'EVIDENCE_SIZE_MISMATCH',
  );
  assert.equal(calls.length, 0);
});

test('read fails closed on corrupt stored hash or task linkage', async () => {
  const artifact = createEvidenceArtifact(snapshot());
  const artifactId = uuid(7);
  for (const row of [
    { artifact_id: artifactId, task_id: artifact.bundle.task.id, uri: `artifact://postgres/${artifactId}`, serialized: artifact.serialized, sha256: '0'.repeat(64), size_bytes: artifact.sizeBytes, created_at: at },
    { artifact_id: artifactId, task_id: uuid(99), uri: `artifact://postgres/${artifactId}`, serialized: artifact.serialized, sha256: artifact.sha256, size_bytes: artifact.sizeBytes, created_at: at },
  ]) {
    const query = async () => ({ rows: [row] });
    const store = createPostgresEvidenceStore({ query });
    await assert.rejects(
      () => store.read(artifact.bundle.task.id),
      (error) => error instanceof PostgresEvidenceStoreError && ['EVIDENCE_HASH_MISMATCH', 'EVIDENCE_TASK_MISMATCH'].includes(error.code),
    );
  }
});
