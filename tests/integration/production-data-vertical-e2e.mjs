import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPsqlQuery, postgresEnvFromDatabaseUrl } from '../../src/kernel/psql-query.mjs';
import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../../src/data/data-worker.mjs';
import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';
import { runLiveResearchKernelGate } from '../../src/research/research-live-kernel-gate.mjs';
import { normalizeResearchResult } from '../../src/research/research-contract.mjs';
import { transformData } from '../../src/data/data-transformer.mjs';

// This is code/PG evidence with a synthetic Research runtime; it performs no paid call.
// Every connection and cleanup is fixed to the disposable local CI database.
const localDatabaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const database = createPsqlQuery({ databaseUrl: localDatabaseUrl });
const pgEnv = postgresEnvFromDatabaseUrl(localDatabaseUrl);
const fixtures = [];
const query = async (text, values) => {
  const result = await database(text, values);
  if (text.startsWith('SELECT * FROM create_lite_research_task') && result.rows[0]?.created === true) fixtures.push(result.rows[0].task_id);
  return result;
};
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

const researchResult = () => ({
  status: 'SUCCESS', summary: 'Synthetic normalized-runtime fixture.', confidence: 'HIGH', needsBrowser: [],
  sources: [
    { id: 'sa', title: ' Official ', url: ' HTTPS://api-docs.deepseek.com:443/updates/ ', checkedAt: '2026-10-13T00:00:00Z' },
    { id: 'sa-alias', title: 'Official', url: 'https://api-docs.deepseek.com/updates/', checkedAt: '2026-10-13T00:00:00Z' },
    { id: 'sb', title: 'Pricing', url: 'https://api-docs.deepseek.com/quick_start/pricing', checkedAt: '2026-10-13T00:00:00Z' },
  ],
  items: ['iz', 'ia', 'ib'].map((id, index) => ({
    id, title: ' Flash ',
    data: { modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash', price: 0, available: false, ordered: ['b', 'a'], nested: { z: 2, a: 1 } },
    sourceIds: [index === 0 ? 'sa-alias' : index === 1 ? 'sa' : 'sb'],
  })),
});

const runFixture = async (result) => {
  const id = randomUUID();
  let calls = 0;
  const worker = createProductionResearchWorker({
    query, workerId: `production-vertical-research-${id}`, pricingVersion: 'synthetic-d4-v1',
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 1000 }),
    researchEnv: {}, heartbeatIntervalMs: 10_000, leaseSeconds: 60,
    runResearchImpl: async () => {
      calls += 1;
      return {
        result: normalizeResearchResult(structuredClone(result)),
        telemetry: {
          model: 'deepseek-flash', sessionId: `synthetic-d4-${id}`,
          usage: { input: 10, output: 5, cacheRead: 5, cacheWrite: 0, total: 20 },
          costUsd: 0.01, toolSummary: { tools: ['web_search', 'web_fetch'] },
        },
        process: { latencyMs: 1 },
      };
    },
  });
  const dataWorker = createDataWorker({ kernel: createPostgresDataAdapter({ query }), workerId: `production-vertical-data-${id}`, leaseSeconds: 60 });
  return {
    run: () => runLiveResearchKernelGate({ query, worker, dataWorker, idempotencyKey: `production-data-vertical-${id}` }),
    calls: () => calls,
  };
};

assert.equal((await database('SELECT current_database() AS database')).rows[0].database, 'openclaw_v2_test');
try {
  const positive = await runFixture(researchResult());
  const proof = await positive.run();
  assert.equal(positive.calls(), 1);
  assert.equal(proof.task_status, 'SUCCESS');
  assert.equal(proof.data_mode, 'PRODUCTION_DATA');
  assert.equal(proof.data_item_count, 2);
  assert.equal(proof.data_source_count, 2);
  assert.equal(proof.data_accounting_rows, 0);
  assert.equal(proof.data_reservation_rows, 0);
  const taskId = proof.task_id;
  const stored = (await database(`SELECT task.status, task.terminal_reason, task.current_steps,
    task.current_cost_usd, task.current_tokens, task.reserved_cost_usd, task.reserved_tokens,
    task.request_payload, research.id AS research_node_id, research.status AS research_status,
    research.output_data AS research_result, data.id AS data_node_id, data.status AS data_status,
    data.output_data AS data_result
    FROM tasks task JOIN task_nodes research ON research.task_id = task.id AND research.node_key = 'research' AND research.agent_id = 'researcher'
    JOIN task_node_dependencies dependency ON dependency.task_id = task.id AND dependency.parent_node_id = research.id
    JOIN task_nodes data ON data.task_id = dependency.task_id AND data.id = dependency.node_id AND data.node_key = 'data' AND data.agent_id = 'data'
    WHERE task.id = $1`, [taskId])).rows[0];
  assert.equal(stored.status, 'SUCCESS');
  assert.equal(stored.terminal_reason, 'ALL_NODES_SUCCEEDED');
  assert.equal(stored.research_status, 'SUCCESS');
  assert.equal(stored.data_status, 'SUCCESS');
  assert.equal(stored.current_steps, 2);
  assert.equal(Number(stored.current_cost_usd), 0.01);
  assert.equal(Number(stored.current_tokens), 20);
  assert.equal(Number(stored.reserved_cost_usd), 0);
  assert.equal(Number(stored.reserved_tokens), 0);
  assert.deepEqual(stored.research_result, normalizeResearchResult(researchResult()));
  assert.equal(stored.research_result.sources.length, 2);
  assert.equal(stored.research_result.items.length, 3);
  assert.deepEqual(stored.data_result, transformData({ requiredFields: stored.request_payload.requiredFields, researchResult: stored.research_result }));
  assert.deepEqual(stored.data_result.items.map((item) => item.id), ['ia', 'ib']);
  assert.deepEqual(stored.data_result.items.map((item) => item.sourceIds), [['sa'], ['sb']]);
  assert.equal(stored.data_result.items[0].data.price, 0);
  assert.equal(stored.data_result.items[0].data.available, false);
  assert.deepEqual(stored.data_result.items[0].data.ordered, ['b', 'a']);
  assert.equal(stored.data_result.items[0].data.modelId, 'deepseek-flash');
  assert.equal(stored.data_result.items[0].data.modelVersion, 'DeepSeek-V4.1-Flash');
  const ledger = (await database('SELECT node_id, provider, model, accounting_basis, cost_usd, total_tokens FROM llm_accounting WHERE task_id = $1', [taskId])).rows;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].node_id, stored.research_node_id);
  assert.equal(ledger[0].provider, 'deepseek');
  assert.equal(ledger[0].model, 'deepseek-flash');
  assert.equal(ledger[0].accounting_basis, 'OBSERVED_USAGE');
  assert.equal(Number(ledger[0].cost_usd), 0.01);
  assert.equal(Number(ledger[0].total_tokens), 20);
  const reservations = (await database('SELECT node_id, status, actual_cost_usd, actual_tokens FROM budget_reservations WHERE task_id = $1', [taskId])).rows;
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].node_id, stored.research_node_id);
  assert.equal(reservations[0].status, 'RECONCILED');
  assert.equal(Number(reservations[0].actual_cost_usd), 0.01);
  assert.equal(Number(reservations[0].actual_tokens), 20);

  // Research's minimum accepted-item proof cannot silently filter invalid Data input.
  const partial = researchResult();
  delete partial.items[2].data.modelVersion;
  const invalid = await runFixture(partial);
  await assert.rejects(() => invalid.run(), (error) => error.code === 'REQUIRED_FIELD_MISSING');
  assert.equal(invalid.calls(), 1);
  const failedTaskId = fixtures.at(-1);
  const failed = (await database(`SELECT task.status, task.terminal_reason, research.id AS research_node_id,
    research.status AS research_status, data.id AS data_node_id, data.status AS data_status,
    data.output_data, data.last_error, task.reserved_cost_usd, task.reserved_tokens
    FROM tasks task JOIN task_nodes research ON research.task_id = task.id AND research.agent_id = 'researcher'
    JOIN task_nodes data ON data.task_id = task.id AND data.agent_id = 'data'
    WHERE task.id = $1`, [failedTaskId])).rows[0];
  assert.equal(failed.status, 'FAIL_WITH_EVIDENCE');
  assert.equal(failed.terminal_reason, 'NODE_FAILED');
  assert.equal(failed.research_status, 'SUCCESS');
  assert.equal(failed.data_status, 'FAIL_WITH_EVIDENCE');
  assert.equal(failed.output_data, null);
  assert.equal(failed.last_error.code, 'REQUIRED_FIELD_MISSING');
  assert.equal(Number(failed.reserved_cost_usd), 0);
  assert.equal(Number(failed.reserved_tokens), 0);
  const failedLedger = (await database('SELECT node_id FROM llm_accounting WHERE task_id = $1', [failedTaskId])).rows;
  assert.equal(failedLedger.length, 1);
  assert.equal(failedLedger[0].node_id, failed.research_node_id);
  const failedReservations = (await database('SELECT node_id, status FROM budget_reservations WHERE task_id = $1', [failedTaskId])).rows;
  assert.equal(failedReservations.length, 1);
  assert.equal(failedReservations[0].node_id, failed.research_node_id);
  assert.equal(failedReservations[0].status, 'RECONCILED');
  console.log('production Data vertical: local PG + synthetic runtime, one Research call, canonical persistence, zero Data spend and fail-closed validation verified');
} finally {
  if (fixtures.length) execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], {
    input: `DELETE FROM tasks WHERE id IN (${fixtures.map(literal).join(',')});\n`, encoding: 'utf8', env: pgEnv,
  });
}
