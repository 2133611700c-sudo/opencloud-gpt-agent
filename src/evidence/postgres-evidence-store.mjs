import { createHash } from 'node:crypto';

import { validateEvidenceBundle } from './evidence-contract.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export class PostgresEvidenceStoreError extends Error {
  constructor(message, { code = 'EVIDENCE_STORE_INVALID', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PostgresEvidenceStoreError';
    this.code = code;
  }
}

const requireQuery = (query) => {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  return query;
};

const requireTaskId = (taskId) => {
  if (typeof taskId !== 'string' || !UUID.test(taskId)) throw new TypeError('taskId must be a UUID');
  return taskId.toLowerCase();
};

const digest = (serialized) => createHash('sha256').update(serialized, 'utf8').digest('hex');

const validateArtifact = (taskId, artifact) => {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new TypeError('artifact must be an object');
  }
  if (typeof artifact.serialized !== 'string' || artifact.serialized.length === 0) {
    throw new TypeError('artifact.serialized is required');
  }
  if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) {
    throw new TypeError('artifact.sha256 must be lowercase hex');
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1) {
    throw new TypeError('artifact.sizeBytes must be a positive safe integer');
  }
  const actualSize = Buffer.byteLength(artifact.serialized, 'utf8');
  if (actualSize !== artifact.sizeBytes) {
    throw new PostgresEvidenceStoreError('Evidence byte length does not match artifact metadata', { code: 'EVIDENCE_SIZE_MISMATCH' });
  }
  if (digest(artifact.serialized) !== artifact.sha256) {
    throw new PostgresEvidenceStoreError('Evidence hash does not match artifact metadata', { code: 'EVIDENCE_HASH_MISMATCH' });
  }
  let parsed;
  try {
    parsed = JSON.parse(artifact.serialized);
  } catch (cause) {
    throw new PostgresEvidenceStoreError('Evidence serialized payload is not valid JSON', { code: 'EVIDENCE_JSON_INVALID', cause });
  }
  const bundle = validateEvidenceBundle(parsed);
  if (bundle.task.id !== taskId) {
    throw new PostgresEvidenceStoreError('Evidence task id does not match persistence target', { code: 'EVIDENCE_TASK_MISMATCH' });
  }
  return bundle;
};

const receipt = (row, bundle, serialized, { created = null } = {}) => Object.freeze({
  artifactId: row.artifact_id,
  taskId: row.task_id ?? bundle.task.id,
  uri: row.uri,
  sha256: row.sha256,
  sizeBytes: Number(row.size_bytes),
  created,
  createdAt: row.created_at ?? null,
  serialized,
  bundle,
});

const validateStoredRow = (taskId, row) => {
  if (!row) return null;
  if (typeof row.artifact_id !== 'string' || !UUID.test(row.artifact_id)) {
    throw new PostgresEvidenceStoreError('Stored evidence artifact id is invalid', { code: 'EVIDENCE_RECEIPT_INVALID' });
  }
  if (row.task_id != null && String(row.task_id).toLowerCase() !== taskId) {
    throw new PostgresEvidenceStoreError('Stored evidence task linkage is invalid', { code: 'EVIDENCE_TASK_MISMATCH' });
  }
  if (typeof row.serialized !== 'string' || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
    throw new PostgresEvidenceStoreError('Stored evidence payload metadata is invalid', { code: 'EVIDENCE_RECEIPT_INVALID' });
  }
  const sizeBytes = Number(row.size_bytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || Buffer.byteLength(row.serialized, 'utf8') !== sizeBytes) {
    throw new PostgresEvidenceStoreError('Stored evidence byte length is invalid', { code: 'EVIDENCE_SIZE_MISMATCH' });
  }
  if (digest(row.serialized) !== row.sha256) {
    throw new PostgresEvidenceStoreError('Stored evidence hash is invalid', { code: 'EVIDENCE_HASH_MISMATCH' });
  }
  let parsed;
  try { parsed = JSON.parse(row.serialized); }
  catch (cause) {
    throw new PostgresEvidenceStoreError('Stored evidence is not valid JSON', { code: 'EVIDENCE_JSON_INVALID', cause });
  }
  const bundle = validateEvidenceBundle(parsed);
  if (bundle.task.id !== taskId) {
    throw new PostgresEvidenceStoreError('Stored evidence bundle references another task', { code: 'EVIDENCE_TASK_MISMATCH' });
  }
  return { bundle, sizeBytes };
};

export function createPostgresEvidenceStore({ query } = {}) {
  const q = requireQuery(query);

  return Object.freeze({
    async persist({ taskId, artifact } = {}) {
      const normalizedTaskId = requireTaskId(taskId);
      const bundle = validateArtifact(normalizedTaskId, artifact);
      const result = await q(
        'SELECT * FROM persist_task_evidence_v1($1,$2,$3)',
        [normalizedTaskId, artifact.serialized, artifact.sha256],
      );
      const row = result?.rows?.[0];
      if (!row) {
        throw new PostgresEvidenceStoreError('PostgreSQL did not return an evidence persistence receipt', { code: 'EVIDENCE_PERSIST_RECEIPT_MISSING' });
      }
      if (row.sha256 !== artifact.sha256 || Number(row.size_bytes) !== artifact.sizeBytes) {
        throw new PostgresEvidenceStoreError('PostgreSQL evidence receipt does not match the canonical artifact', { code: 'EVIDENCE_PERSIST_RECEIPT_MISMATCH' });
      }
      return receipt(row, bundle, artifact.serialized, { created: row.created === true });
    },

    async read(taskId) {
      const normalizedTaskId = requireTaskId(taskId);
      const result = await q('SELECT * FROM read_task_evidence_snapshot_v1($1)', [normalizedTaskId]);
      const row = result?.rows?.[0] ?? null;
      if (!row) return null;
      const verified = validateStoredRow(normalizedTaskId, row);
      return receipt(row, verified.bundle, row.serialized);
    },
  });
}
