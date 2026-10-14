import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import { createEvidenceArtifact, serializeEvidenceBundle, validateEvidenceBundle } from './evidence-contract.mjs';

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
const receiptTimestamp = (value) => {
  if (typeof value === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalidReceipt();
    return value;
  }
  // PostgreSQL drivers may decode the artifact header as a native Date. Raw
  // snapshot timestamps remain explicit SQL UTC6 strings and are never changed.
  if (value === null || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Date.prototype || Reflect.ownKeys(value).length !== 0) invalidReceipt();
  try {
    if (!Number.isFinite(Date.prototype.getTime.call(value))) invalidReceipt();
    return Date.prototype.toISOString.call(value);
  } catch { invalidReceipt(); }
};
const receiptIdentity = (taskId, row, persisted = false) => {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.artifact_id !== 'string' || !UUID.test(row.artifact_id) || row.artifact_id !== row.artifact_id.toLowerCase()) invalidReceipt();
  if ((!persisted || Object.hasOwn(row, 'task_id')) && row.task_id !== taskId) throw new PostgresEvidenceStoreError('Stored evidence task linkage is invalid', { code: 'EVIDENCE_TASK_MISMATCH' });
  if (row.uri !== `artifact://postgres/${row.artifact_id}`) invalidReceipt();
  if (persisted && typeof row.created !== 'boolean') invalidReceipt();
  if (!persisted || Object.hasOwn(row, 'created_at')) receiptTimestamp(row.created_at);
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
  createdAt: Object.hasOwn(row, 'created_at') ? receiptTimestamp(row.created_at) : null,
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
  const loadInput = async (taskId) => {
    const normalizedTaskId = requireTaskId(taskId);
    const result = await safeQuery('SELECT * FROM load_terminal_evidence_input_v1($1)', [normalizedTaskId]);
    if (!Array.isArray(result?.rows) || result.rows.length > 1) invalidReceipt();
    if (result.rows.length === 0) throw new PostgresEvidenceStoreError('Terminal evidence input is unavailable', { code: 'EVIDENCE_INPUT_UNAVAILABLE' });
    const row = result.rows[0];
    if (!row || typeof row.snapshot_sha256 !== 'string' || !SHA256.test(row.snapshot_sha256) || !row.snapshot || typeof row.snapshot !== 'object' || Array.isArray(row.snapshot)) invalidReceipt();
    if (row.snapshot.task?.id !== normalizedTaskId) throw new PostgresEvidenceStoreError('Evidence input references another task', { code: 'EVIDENCE_TASK_MISMATCH' });
    // Validate the server document before handing it to a producer. The raw
    // snapshot/fingerprint remain internal and never enter the public receipt.
    createEvidenceArtifact(row.snapshot);
    return Object.freeze({ snapshot: row.snapshot, snapshotSha256: row.snapshot_sha256 });
  };
  const read = async (taskId) => {
    const normalizedTaskId = requireTaskId(taskId);
    const result = await safeQuery('SELECT * FROM read_task_evidence_snapshot_v1($1)', [normalizedTaskId]);
    const row = oneRow(result, true);
    if (!row) return null;
    const verified = validateStoredRow(normalizedTaskId, row);
    return receipt(row, verified.bundle, row.serialized);
  };

  return Object.freeze({
    loadInput,

    async persist({ taskId, artifact, expectedSnapshotFingerprint, sensitiveValues = [] } = {}) {
      const normalizedTaskId = requireTaskId(taskId);
      const validated = validateArtifact(normalizedTaskId, artifact);
      if (expectedSnapshotFingerprint == null) {
        const existing = await read(normalizedTaskId);
        if (!existing) throw new PostgresEvidenceStoreError('A terminal snapshot context is required', { code: 'EVIDENCE_SNAPSHOT_REQUIRED' });
        if (existing.serialized !== validated.serialized || existing.sha256 !== validated.sha256) throw new PostgresEvidenceStoreError('Evidence is immutable for this task', { code: 'EVIDENCE_ARTIFACT_CONFLICT' });
        return Object.freeze({ ...existing, created: false });
      }
      if (typeof expectedSnapshotFingerprint !== 'string' || !SHA256.test(expectedSnapshotFingerprint)) throw new PostgresEvidenceStoreError('A terminal snapshot context is required', { code: 'EVIDENCE_SNAPSHOT_REQUIRED' });
      const current = await loadInput(normalizedTaskId);
      if (current.snapshotSha256 !== expectedSnapshotFingerprint) throw new PostgresEvidenceStoreError('Terminal evidence input changed', { code: 'EVIDENCE_SNAPSHOT_CHANGED' });
      const expected = createEvidenceArtifact(current.snapshot, { sensitiveValues });
      if (expected.serialized !== validated.serialized) throw new PostgresEvidenceStoreError('Evidence does not derive from the terminal input', { code: 'EVIDENCE_SNAPSHOT_ARTIFACT_MISMATCH' });
      const result = await safeQuery(
        'SELECT * FROM persist_task_evidence_v1($1,$2,$3,$4)',
        [normalizedTaskId, validated.serialized, validated.sha256, expectedSnapshotFingerprint],
      );
      const row = oneRow(result);
      receiptIdentity(normalizedTaskId, row, true);
      if (row.sha256 !== validated.sha256 || receiptSize(row.size_bytes) !== validated.sizeBytes) {
        throw new PostgresEvidenceStoreError('PostgreSQL evidence receipt does not match the canonical artifact', { code: 'EVIDENCE_PERSIST_RECEIPT_MISMATCH' });
      }
      return receipt(row, validated.bundle, validated.serialized, { created: row.created });
    },

    read,
  });
}
