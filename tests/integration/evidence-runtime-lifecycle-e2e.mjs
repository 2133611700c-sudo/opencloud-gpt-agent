import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../../src/data/data-worker.mjs';
import { assertLiveRuntimeEvidenceProof } from '../../src/evidence/live-runtime-evidence-gate.mjs';
import { createPostgresTerminalEvidenceFinalizer } from '../../src/evidence/postgres-terminal-evidence-finalizer.mjs';
import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';
import { createPsqlQuery } from '../../src/kernel/psql-query.mjs';
import { normalizeResearchResult } from '../../src/research/research-contract.mjs';
import {
  createProductionResearchWorker,
  DEFAULT_PRODUCTION_RESEARCH_MODEL,
} from '../../src/research/research-production-wiring.mjs';

const databaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const model = DEFAULT_PRODUCTION_RESEARCH_MODEL;
const self = fileURLToPath(import.meta.url);

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const queryFor = () => createPsqlQuery({ databaseUrl });

const syntheticResearch = ({ id, mode }) => ({
  result: normalizeResearchResult({
    status: 'SUCCESS',
    summary: `Synthetic E3 lifecycle ${mode} fixture; no paid model call.`,
    confidence: 'HIGH',
    needsBrowser: [],
    sources: [{
      id: 'synthetic-runtime-source',
      title: 'Synthetic runtime lifecycle source',
      url: 'https://api-docs.deepseek.com/',
      checkedAt: '2026-10-14T00:00:00Z',
    }],
    items: [{
      id: 'synthetic-runtime-item',
      title: 'Synthetic runtime lifecycle item',
      data: mode === 'failure' ? { price: 0 } : { active: false, price: 0 },
      sourceIds: ['synthetic-runtime-source'],
    }],
  }),
  telemetry: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    sessionId: `synthetic-e3-${mode}-${id}`,
    usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 0, total: 9 },
    costUsd: 0.000003,
    toolSummary: {
      calls: 2,
      failures: 0,
      tools: ['web_search', 'web_fetch'],
      totalToolTimeMs: 5,
    },
  },
  process: { latencyMs: 7 },
});

async function producerMain() {
  const mode = process.env.E3_MODE;
  if (mode !== 'success' && mode !== 'failure') throw new Error('E3_MODE must be success or failure');
  const query = queryFor();
  const id = randomUUID();
  const requiredFields = mode === 'failure' ? ['price', 'missing'] : ['price', 'active'];
  const created = await query(
    'SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)',
    [
      `synthetic-e3-lifecycle-${mode}-${id}`,
      `Synthetic E3 lifecycle ${mode} task`,
      JSON.stringify({ requiredFields }),
      1,
      1000,
      4,
      new Date(Date.now() + 600_000).toISOString(),
    ],
  );
  const taskId = created?.rows?.[0]?.task_id;
  assert.equal(typeof taskId, 'string');

  const researchWorker = createProductionResearchWorker({
    query,
    workerId: `synthetic-e3-research-${id}`,
    pricingVersion: 'synthetic-e3-lifecycle-v1',
    model,
    leaseSeconds: 60,
    heartbeatIntervalMs: 10_000,
    researchEnv: {},
    estimateReservation: async () => ({ costUsd: 0.10, tokens: 100 }),
    runResearchImpl: async () => syntheticResearch({ id, mode }),
  });
  const researchExecution = await researchWorker.runTask(taskId);
  assert.equal(researchExecution.status, 'EXECUTED');
  assert.equal(researchExecution.execution.status, 'SUCCESS');

  const dataWorker = createDataWorker({
    kernel: createPostgresDataAdapter({ query }),
    workerId: `synthetic-e3-data-${id}`,
    leaseSeconds: 60,
    heartbeatIntervalMs: 10_000,
  });
  if (mode === 'failure') {
    await assert.rejects(
      () => dataWorker.runTask(taskId),
      (error) => error?.code === 'REQUIRED_FIELD_MISSING',
    );
  } else {
    const dataExecution = await dataWorker.runTask(taskId);
    assert.equal(dataExecution.status, 'EXECUTED');
    assert.equal(dataExecution.execution.taskStatus, 'SUCCESS');
  }

  const state = await query(
    `SELECT status::text AS status, terminal_reason,
      (SELECT count(*)::int FROM runtime_receipts WHERE task_id=$1) AS runtime_receipt_rows,
      (SELECT count(*)::int FROM llm_accounting WHERE task_id=$1) AS accounting_rows,
      (SELECT count(*)::int FROM budget_reservations WHERE task_id=$1 AND status='RESERVED') AS unresolved_reservations
     FROM tasks WHERE id=$1`,
    [taskId],
  );
  const task = state.rows[0];
  assert.equal(task.status, mode === 'failure' ? 'FAIL_WITH_EVIDENCE' : 'SUCCESS');
  assert.equal(task.runtime_receipt_rows, 1);
  assert.equal(task.accounting_rows, 1);
  assert.equal(task.unresolved_reservations, 0);

  const finalizer = createPostgresTerminalEvidenceFinalizer({ query });
  const receipt = await finalizer.finalize(taskId);
  const runtimeProof = assertLiveRuntimeEvidenceProof({ receipt, taskId, model });
  assert.equal(receipt.bundle.runtimeReceipts.length, 1);
  assert.equal(receipt.bundle.coverage.runtimeReceiptsPresent, true);
  assert.equal(receipt.bundle.coverage.toolMetadataPresent, true);

  emit({
    taskId,
    taskStatus: task.status,
    terminalReason: task.terminal_reason,
    artifactId: receipt.artifactId,
    sha256: receipt.sha256,
    sizeBytes: receipt.sizeBytes,
    runtimeReceiptId: runtimeProof.runtimeReceiptId,
  });
}

async function retrieverMain() {
  const taskId = process.env.E3_TASK_ID;
  if (!taskId) throw new Error('E3_TASK_ID is required');
  const store = createPostgresEvidenceStoreV2({ query: queryFor() });
  const receipt = await store.read(taskId);
  assert.ok(receipt);
  const runtime = receipt.bundle.runtimeReceipts[0];
  emit({
    taskId,
    taskStatus: receipt.bundle.task.status,
    artifactId: receipt.artifactId,
    sha256: receipt.sha256,
    sizeBytes: receipt.sizeBytes,
    runtimeReceiptRows: receipt.bundle.runtimeReceipts.length,
    runtimeReceiptsPresent: receipt.bundle.coverage.runtimeReceiptsPresent,
    toolMetadataPresent: receipt.bundle.coverage.toolMetadataPresent,
    provider: runtime?.observed?.provider ?? null,
    model: runtime?.observed?.model ?? null,
    runtimeVersion: runtime?.configured?.runtimeVersion ?? null,
    tools: runtime?.observed?.toolSummary?.tools ?? [],
  });
}

async function conflictMain() {
  const taskId = process.env.E3_TASK_ID;
  if (!taskId) throw new Error('E3_TASK_ID is required');
  const query = queryFor();
  const changed = await query(
    `UPDATE artifacts SET sha256=$2
     WHERE task_id=$1 AND artifact_type='EVIDENCE_BUNDLE_V1'
     RETURNING id`,
    [taskId, 'b'.repeat(64)],
  );
  assert.equal(changed.rows.length, 1);
  const finalizer = createPostgresTerminalEvidenceFinalizer({ query });
  let rejected = null;
  try {
    await finalizer.finalize(taskId);
  } catch (error) {
    rejected = { name: error?.name ?? null, code: error?.code ?? null };
  }
  assert.deepEqual(rejected, { name: 'PostgresEvidenceStoreError', code: 'EVIDENCE_STORE_QUERY_FAILED' });
  emit({ taskId, rejected });
}

const childRole = process.env.E3_CHILD_ROLE;
if (childRole === 'producer') {
  await producerMain();
} else if (childRole === 'retriever') {
  await retrieverMain();
} else if (childRole === 'conflict') {
  await conflictMain();
} else {
  const query = queryFor();
  const taskIds = [];
  const runChild = (role, extras = {}) => JSON.parse(execFileSync(
    process.execPath,
    [self],
    {
      cwd: process.cwd(),
      env: { ...process.env, E3_CHILD_ROLE: role, ...extras },
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim());

  try {
    const successProducer = runChild('producer', { E3_MODE: 'success' });
    taskIds.push(successProducer.taskId);
    const failureProducer = runChild('producer', { E3_MODE: 'failure' });
    taskIds.push(failureProducer.taskId);

    assert.equal(successProducer.taskStatus, 'SUCCESS');
    assert.equal(failureProducer.taskStatus, 'FAIL_WITH_EVIDENCE');

    // Each producer process has exited before a new process retrieves its artifact.
    const successRead = runChild('retriever', { E3_TASK_ID: successProducer.taskId });
    const failureRead = runChild('retriever', { E3_TASK_ID: failureProducer.taskId });
    for (const [produced, retrieved] of [
      [successProducer, successRead],
      [failureProducer, failureRead],
    ]) {
      assert.equal(retrieved.artifactId, produced.artifactId);
      assert.equal(retrieved.sha256, produced.sha256);
      assert.equal(retrieved.sizeBytes, produced.sizeBytes);
      assert.equal(retrieved.taskStatus, produced.taskStatus);
      assert.equal(retrieved.runtimeReceiptRows, 1);
      assert.equal(retrieved.runtimeReceiptsPresent, true);
      assert.equal(retrieved.toolMetadataPresent, true);
      assert.equal(retrieved.provider, 'deepseek');
      assert.equal(retrieved.model, 'deepseek-flash');
      assert.equal(retrieved.runtimeVersion, '2026.9.8');
      assert.ok(retrieved.tools.includes('web_search'));
      assert.ok(retrieved.tools.includes('web_fetch'));
    }

    // Corrupt one local fixture after successful retrieval; the production finalizer
    // must fail closed instead of overwriting or blessing conflicting durable bytes.
    const conflict = runChild('conflict', { E3_TASK_ID: successProducer.taskId });
    assert.equal(conflict.rejected.code, 'EVIDENCE_STORE_QUERY_FAILED');

    const cleanliness = await query(
      `SELECT
        count(*) FILTER (WHERE n.status='RUNNING')::int AS running_nodes,
        count(*) FILTER (WHERE r.status='RESERVED')::int AS unresolved_reservations
       FROM tasks t
       LEFT JOIN task_nodes n ON n.task_id=t.id
       LEFT JOIN budget_reservations r ON r.task_id=t.id
       WHERE t.id=$1 OR t.id=$2`,
      taskIds,
    );
    assert.equal(cleanliness.rows[0].running_nodes, 0);
    assert.equal(cleanliness.rows[0].unresolved_reservations, 0);

    console.log('runtime Evidence lifecycle E2E: SUCCESS + FAIL_WITH_EVIDENCE persisted by producer processes, independently retrieved after producer exit, receipt linkage verified, persistence conflict fails closed');
  } finally {
    if (taskIds.length === 2) {
      await query('DELETE FROM tasks WHERE id=$1 OR id=$2', taskIds);
    } else if (taskIds.length === 1) {
      await query('DELETE FROM tasks WHERE id=$1', taskIds);
    }
  }
}
