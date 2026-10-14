import { createHash } from 'node:crypto';

import { serializeEvidenceBundle, validateEvidenceBundle } from './evidence-contract.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export class PostgresEvidenceStoreError extends Error {
  constructor(message, { code = 'EVIDENCE_STORE_INVALID' } = {}) {
    super(message);
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
const invalidReceipt = () => { throw new PostgresEvidenceStoreError('PostgreSQL evidence receipt is invalid', { code: 'EVIDENCE_RECEIPT_INVALID' }); };
const oneRow = (result, allowEmpty = false) => {
  if (!Array.isArray(result?.rows) || result.rows.length > 1) invalidReceipt();
  if (!result.rows.length && !allowEmpty) throw new PostgresEvidenceStoreError('PostgreSQL did not return an evidence persistence receipt', { code: 'EVIDENCE_PERSIST_RECEIPT_MISSING' });
  return result.rows[0] ?? null;
};
const receiptSize = (value) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^[1-9]\d*$/.test(value))) invalidReceipt();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) invalidReceipt();
  return number;
};
const receiptIdentity = (taskId, row, persisted = false) => {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.artifact_id !== 'string' || !UUID.test(row.artifact_id) || row.artifact_id !== row.artifact_id.toLowerCase()) invalidReceipt();
  if ((!persisted || Object.hasOwn(row, 'task_id')) && row.task_id !== taskId) throw new PostgresEvidenceStoreError('Stored evidence task linkage is invalid', { code: 'EVIDENCE_TASK_MISMATCH' });
  if (row.uri !== `artifact://postgres/${row.artifact_id}`) invalidReceipt();
  if (persisted && typeof row.created !== 'boolean') invalidReceipt();
  if ((!persisted || Object.hasOwn(row, 'created_at')) && (typeof row.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at)))) invalidReceipt();
};

const validateArtifact = (taskId, artifact) => {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new TypeError('artifact must be an object');
  }
  const { serialized, sha256, sizeBytes } = artifact;
  if (typeof serialized !== 'string' || serialized.length === 0) {
    throw new TypeError('artifact.serialized is required');
  }
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    throw new TypeError('artifact.sha256 must be lowercase hex');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new TypeError('artifact.sizeBytes must be a positive safe integer');
  }
  const actualSize = Buffer.byteLength(serialized, 'utf8');
  if (actualSize !== sizeBytes) {
    throw new PostgresEvidenceStoreError('Evidence byte length does not match artifact metadata', { code: 'EVIDENCE_SIZE_MISMATCH' });
  }
  if (digest(serialized) !== sha256) {
    throw new PostgresEvidenceStoreError('Evidence hash does not match artifact metadata', { code: 'EVIDENCE_HASH_MISMATCH' });
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new PostgresEvidenceStoreError('Evidence serialized payload is not valid JSON', { code: 'EVIDENCE_JSON_INVALID' });
  }
  const bundle = validateEvidenceBundle(parsed);
  if (bundle.task.id !== taskId) {
    throw new PostgresEvidenceStoreError('Evidence task id does not match persistence target', { code: 'EVIDENCE_TASK_MISMATCH' });
  }
  if (serializeEvidenceBundle(bundle) !== serialized) throw new PostgresEvidenceStoreError('Evidence payload is not canonical', { code: 'EVIDENCE_NONCANONICAL' });
  return { bundle, serialized, sha256, sizeBytes };
};

const receipt = (row, bundle, serialized, { created = null } = {}) => Object.freeze({
  artifactId: row.artifact_id,
  taskId: row.task_id ?? bundle.task.id,
  uri: row.uri,
  sha256: row.sha256,
  sizeBytes: receiptSize(row.size_bytes),
  created,
  createdAt: row.created_at ?? null,
  serialized,
  bundle,
});

const validateStoredRow = (taskId, row) => {
  if (!row) return null;
  receiptIdentity(taskId, row);
  if (typeof row.serialized !== 'string' || typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
    throw new PostgresEvidenceStoreError('Stored evidence payload metadata is invalid', { code: 'EVIDENCE_RECEIPT_INVALID' });
  }
  const sizeBytes = receiptSize(row.size_bytes);
  if (Buffer.byteLength(row.serialized, 'utf8') !== sizeBytes) {
    throw new PostgresEvidenceStoreError('Stored evidence byte length is invalid', { code: 'EVIDENCE_SIZE_MISMATCH' });
  }
  if (digest(row.serialized) !== row.sha256) {
    throw new PostgresEvidenceStoreError('Stored evidence hash is invalid', { code: 'EVIDENCE_HASH_MISMATCH' });
  }
  let parsed;
  try { parsed = JSON.parse(row.serialized); }
  catch {
    throw new PostgresEvidenceStoreError('Stored evidence is not valid JSON', { code: 'EVIDENCE_JSON_INVALID' });
  }
  const bundle = validateEvidenceBundle(parsed);
  if (bundle.task.id !== taskId) {
    throw new PostgresEvidenceStoreError('Stored evidence bundle references another task', { code: 'EVIDENCE_TASK_MISMATCH' });
  }
  if (serializeEvidenceBundle(bundle) !== row.serialized) throw new PostgresEvidenceStoreError('Stored evidence payload is not canonical', { code: 'EVIDENCE_NONCANONICAL' });
  return { bundle, sizeBytes };
};

export function createPostgresEvidenceStore({ query } = {}) {
  const q = requireQuery(query);
  const safeQuery = async (sql, values) => {
    try { return await q(sql, values); }
    catch { throw new PostgresEvidenceStoreError('PostgreSQL evidence operation failed', { code: 'EVIDENCE_STORE_QUERY_FAILED' }); }
  };

  return Object.freeze({
    async persist({ taskId, artifact } = {}) {
      const normalizedTaskId = requireTaskId(taskId);
      const validated = validateArtifact(normalizedTaskId, artifact);
      const result = await safeQuery(
        'SELECT * FROM persist_task_evidence_v1($1,$2,$3)',
        [normalizedTaskId, validated.serialized, validated.sha256],
      );
      const row = oneRow(result);
      receiptIdentity(normalizedTaskId, row, true);
      if (row.sha256 !== validated.sha256 || receiptSize(row.size_bytes) !== validated.sizeBytes) {
        throw new PostgresEvidenceStoreError('PostgreSQL evidence receipt does not match the canonical artifact', { code: 'EVIDENCE_PERSIST_RECEIPT_MISMATCH' });
      }
      return receipt(row, validated.bundle, validated.serialized, { created: row.created });
    },

    async read(taskId) {
      const normalizedTaskId = requireTaskId(taskId);
      const result = await safeQuery('SELECT * FROM read_task_evidence_snapshot_v1($1)', [normalizedTaskId]);
      const row = oneRow(result, true);
      if (!row) return null;
      const verified = validateStoredRow(normalizedTaskId, row);
      return receipt(row, verified.bundle, row.serialized);
    },
  });
}
