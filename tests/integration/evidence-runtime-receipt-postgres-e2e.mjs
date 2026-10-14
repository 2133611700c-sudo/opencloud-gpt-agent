import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';
import { persistTerminalEvidence } from '../../src/evidence/terminal-evidence-producer.mjs';
import { createPsqlQuery } from '../../src/kernel/psql-query.mjs';
import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../../src/data/data-worker.mjs';
import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';
import { normalizeResearchResult } from '../../src/research/research-contract.mjs';

// Disposable GitHub CI PostgreSQL only. Research output is synthetic and never invokes a paid model.
const databaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const query = createPsqlQuery({ databaseUrl });
const id = randomUUID();
let taskId = null;

try {
  const created = await query(
    'SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)',
    [
      `e3b-receipt-evidence-${id}`,
      'Persist receipt-bound terminal Evidence',
      JSON.stringify({ requiredFields: ['price', 'active'] }),
      1,
      1000,
      4,
      new Date(Date.now() + 600_000).toISOString(),
    ],
  );
  taskId = created.rows[0].task_id;

  const researchWorker = createProductionResearchWorker({
    query,
    workerId: `e3b-research-${id}`,
    pricingVersion: 'synthetic-e3b-v1',
    researchEnv: {},
    leaseSeconds: 60,
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
    runResearchImpl: async () => ({
      result: normalizeResearchResult({
        status: 'SUCCESS',
        summary: 'Synthetic sourced receipt fixture.',
        confidence: 'HIGH',
        needsBrowser: [],
        sources: [{
          id: 'source',
          title: 'Synthetic source',
          url: 'https://example.com/docs',
          checkedAt: '2026-10-14T00:00:00Z',
        }],
        items: [{
          id: 'item',
          title: 'Synthetic record',
          data: { price: 0, active: false },
          sourceIds: ['source'],
        }],
      }),
      telemetry: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        sessionId: `synthetic-e3b-${id}`,
        usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 0, total: 9 },
        costUsd: 0.000003,
        toolSummary: {
          calls: 2,
          tools: ['web_search', 'web_fetch'],
          failures: 0,
          totalToolTimeMs: 1,
        },
      },
      process: { latencyMs: 7 },
    }),
  });

  const researchExecution = await researchWorker.runTask(taskId);
  assert.equal(researchExecution.status, 'EXECUTED');
  assert.equal(researchExecution.execution.status, 'SUCCESS');

  const dataWorker = createDataWorker({
    kernel: createPostgresDataAdapter({ query }),
    workerId: `e3b-data-${id}`,
    leaseSeconds: 60,
  });
  const dataExecution = await dataWorker.runTask(taskId);
  assert.equal(dataExecution.status, 'EXECUTED');
  assert.equal(dataExecution.execution.taskStatus, 'SUCCESS');

  const ledger = await query(`SELECT
    (SELECT count(*)::int FROM llm_accounting WHERE task_id=$1) AS accounting_rows,
    (SELECT count(*)::int FROM runtime_receipts WHERE task_id=$1) AS runtime_receipt_rows,
    (SELECT count(*)::int FROM budget_reservations WHERE task_id=$1 AND status='RESERVED') AS unresolved_reservations,
    (SELECT latency_ms FROM llm_accounting WHERE task_id=$1 LIMIT 1) AS latency_ms`, [taskId]);
  assert.deepEqual(ledger.rows[0], {
    accounting_rows: 1,
    runtime_receipt_rows: 1,
    unresolved_reservations: 0,
    latency_ms: 7,
  });

  const store = createPostgresEvidenceStoreV2({ query });
  const durable = await persistTerminalEvidence({ store, taskId });
  assert.equal(durable.created, true);
  assert.equal(durable.bundle.task.status, 'SUCCESS');
  assert.equal(durable.bundle.coverage.runtimeReceiptsPresent, true);
  assert.equal(durable.bundle.coverage.toolMetadataPresent, true);
  assert.equal(durable.bundle.runtimeReceipts.length, 1);

  const receipt = durable.bundle.runtimeReceipts[0];
  assert.equal(receipt.observed.provider, 'deepseek');
  assert.equal(receipt.observed.model, 'deepseek-flash');
  assert.equal(receipt.observed.sessionId, `synthetic-e3b-${id}`);
  assert.deepEqual([...receipt.observed.toolSummary.tools].sort(), ['web_fetch', 'web_search']);
  assert.equal(receipt.configured.runtimeVersion, '2026.9.8');
  assert.equal(receipt.configured.requestedModel, 'deepseek/deepseek-flash');
  assert.equal(receipt.configured.thinkingLevel, 'max');

  const readBack = await store.read(taskId);
  assert.equal(readBack.artifactId, durable.artifactId);
  assert.equal(readBack.sha256, durable.sha256);
  assert.equal(readBack.serialized, durable.serialized);
  assert.equal(readBack.bundle.runtimeReceipts.length, 1);

  const persistedRows = await query("SELECT count(*)::int AS count FROM artifacts WHERE task_id=$1 AND artifact_type='EVIDENCE_BUNDLE_V1'", [taskId]);
  assert.equal(persistedRows.rows[0].count, 1);

  console.log('runtime receipt Evidence E2E: atomic accounting receipt -> Production Data -> v2 snapshot -> durable artifact read-back verified; no paid model calls');
} finally {
  if (taskId) await query('DELETE FROM tasks WHERE id=$1', [taskId]);
}
