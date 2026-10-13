import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPsqlQuery, postgresEnvFromDatabaseUrl } from '../../src/kernel/psql-query.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../../src/data/data-worker.mjs';
import { validateDataOutput } from '../../src/data/data-contract.mjs';
import { transformData } from '../../src/data/data-transformer.mjs';

// This script always targets the disposable local CI database, never DATABASE_URL.
const localDatabaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const query = createPsqlQuery({ databaseUrl: localDatabaseUrl });
const pgEnv = postgresEnvFromDatabaseUrl(localDatabaseUrl);
const localSql = (sql) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t'], {
  input: `${sql}\n`, encoding: 'utf8', env: pgEnv,
});
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const kernel = createPostgresKernelAdapter({ query });
const data = createPostgresDataAdapter({ query });
const fixtures = [];
const worker = (overrides = {}, options = {}) => createDataWorker({
  kernel: { ...data, ...overrides }, workerId: 'data-postgres-worker', ...options,
});

const researchResult = () => ({
  status: 'SUCCESS',
  sources: [
    { id: 's2', title: ' Source ', url: ' HTTPS://Example.COM:443/a ', checkedAt: ' 2026-10-12 ' },
    { id: 's1', title: 'Source', url: 'https://example.com/a', checkedAt: '2026-10-12' },
  ],
  items: [
    { id: 'i2', title: ' Result ', data: { price: 0, active: false }, sourceIds: ['s2', 's1'] },
    { id: 'i1', title: 'Result', data: { active: false, price: 0 }, sourceIds: ['s1'] },
  ],
});

const createFixture = async ({ requestPayload = { requiredFields: ['price', 'active'] }, result = researchResult(), completeResearch = true } = {}) => {
  const response = await query('SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)', [
    `data-e2e-${randomUUID()}`, 'Data integration fixture', JSON.stringify(requestPayload),
    1, 10000, 10, new Date(Date.now() + 600_000).toISOString(),
  ]);
  const taskId = response.rows[0].task_id;
  fixtures.push(taskId);
  if (completeResearch) {
    const claim = await kernel.claimNodeForTaskAndAgent({ taskId, workerId: 'data-e2e-research-fixture', agentId: 'researcher', leaseSeconds: 60 });
    assert.ok(claim);
    assert.equal(await kernel.completeSuccess({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, outputData: result }), true);
  }
  return taskId;
};

const task = async (taskId) => (await query('SELECT status, terminal_reason, current_steps, current_cost_usd, reserved_cost_usd, current_tokens, reserved_tokens FROM tasks WHERE id = $1', [taskId])).rows[0];
const node = async (taskId, agentId = 'data') => (await query('SELECT id, status, output_data, last_error, attempt, lease_owner, lease_token, lease_until FROM task_nodes WHERE task_id = $1 AND agent_id = $2', [taskId, agentId])).rows[0];
const assertNoDataSpend = async (taskId) => {
  const counts = (await query(`SELECT
    (SELECT count(*) FROM llm_accounting WHERE task_id = $1) AS accounting,
    (SELECT count(*) FROM budget_reservations WHERE task_id = $1) AS reservations`, [taskId])).rows[0];
  assert.equal(Number(counts.accounting), 0);
  assert.equal(Number(counts.reservations), 0);
  const state = await task(taskId);
  assert.equal(Number(state.current_cost_usd), 0);
  assert.equal(Number(state.reserved_cost_usd), 0);
  assert.equal(Number(state.current_tokens), 0);
  assert.equal(Number(state.reserved_tokens), 0);
};

assert.equal((await query('SELECT current_database() AS database')).rows[0].database, 'openclaw_v2_test');

try {
  const positive = await createFixture({ completeResearch: false });
  assert.deepEqual(await worker().runTask(positive), { status: 'IDLE' }, 'Data cannot claim before Research SUCCESS');
  assert.equal((await node(positive)).attempt, 0);
  assert.equal((await task(positive)).current_steps, 0);
  const researchClaim = await kernel.claimNodeForTaskAndAgent({ taskId: positive, workerId: 'positive-research-fixture', agentId: 'researcher', leaseSeconds: 60 });
  assert.equal(await kernel.completeSuccess({ nodeId: researchClaim.nodeId, workerId: researchClaim.workerId, leaseToken: researchClaim.leaseToken, outputData: researchResult() }), true);
  localSql(`UPDATE task_nodes SET input_payload = '{"source_node_key":"research","requiredFields":[]}'::jsonb WHERE task_id = ${literal(positive)} AND agent_id = 'data';`);
  const completed = await worker().runTask(positive);
  assert.equal(completed.execution.nodeStatus, 'SUCCESS');
  assert.equal(completed.execution.taskStatus, 'SUCCESS');
  const persisted = await node(positive);
  assert.equal(persisted.status, 'SUCCESS');
  assert.equal(persisted.attempt, 1);
  assert.equal(persisted.output_data.schemaVersion, 1);
  assert.equal(persisted.output_data.items.length, 1);
  assert.equal(persisted.output_data.sources.length, 1);
  assert.deepEqual(persisted.output_data.items[0].sourceIds, ['s1']);
  assert.deepEqual(persisted.output_data.requiredFields, ['active', 'price']);
  assert.deepEqual(validateDataOutput(persisted.output_data), validateDataOutput(transformData({ requiredFields: ['price', 'active'], researchResult: researchResult() })));
  assert.equal((await task(positive)).status, 'SUCCESS');
  assert.equal((await task(positive)).terminal_reason, 'ALL_NODES_SUCCEEDED');
  assert.deepEqual(await worker().runTask(positive), { status: 'IDLE' });

  for (const [requestPayload, result, code] of [
    [{ requiredFields: ['missing'] }, researchResult(), 'REQUIRED_FIELD_MISSING'],
    [{ requiredFields: 'price' }, researchResult(), 'INVALID_REQUIRED_FIELDS'],
    [{ requiredFields: ['price', ' price '] }, researchResult(), 'DUPLICATE_REQUIRED_FIELD'],
    [{ requiredFields: ['price'] }, { ...researchResult(), status: 'NO_RESULTS' }, 'RESEARCH_NOT_SUCCESS'],
    [{ requiredFields: ['price'] }, { ...researchResult(), sources: [] }, 'SOURCES_REQUIRED'],
  ]) {
    const invalid = await createFixture({ requestPayload, result });
    localSql(`UPDATE task_nodes SET input_payload = '{"source_node_key":"research","requiredFields":[]}'::jsonb WHERE task_id = ${literal(invalid)} AND agent_id = 'data';`);
    await assert.rejects(() => worker().runTask(invalid), (error) => error.code === code);
    const failed = await node(invalid);
    assert.equal(failed.status, 'FAIL_WITH_EVIDENCE');
    assert.equal(failed.output_data, null);
    assert.deepEqual(failed.last_error, { code, message: 'Data contract validation failed' });
    assert.equal((await task(invalid)).status, 'FAIL_WITH_EVIDENCE');
    assert.equal((await task(invalid)).terminal_reason, 'NODE_FAILED');
  }

  for (const requestPayload of [{}, { requiredFields: null }, null]) {
    const nullable = await createFixture({ requestPayload });
    assert.equal((await worker().runTask(nullable)).execution.taskStatus, 'SUCCESS');
    assert.deepEqual((await node(nullable)).output_data.requiredFields, []);
  }

  for (const requestPayload of [[], ['price'], 'price', 0, false]) {
    const malformed = await createFixture({ requestPayload });
    await assert.rejects(() => worker().runTask(malformed), (error) => error.code === 'DATA_INPUT_UNAVAILABLE');
    assert.equal((await node(malformed)).output_data, null);
    assert.deepEqual((await node(malformed)).last_error, { code: 'DATA_INPUT_UNAVAILABLE', message: 'Data execution failed' });
    assert.equal((await task(malformed)).status, 'FAIL_WITH_EVIDENCE');
  }

  const wrongSource = await createFixture();
  localSql(`UPDATE task_nodes SET input_payload = '{"source_node_key":"another-node"}'::jsonb WHERE task_id = ${literal(wrongSource)} AND agent_id = 'data';`);
  await assert.rejects(() => worker().runTask(wrongSource), (error) => error.code === 'DATA_INPUT_UNAVAILABLE');
  assert.equal((await node(wrongSource)).output_data, null);
  assert.equal((await task(wrongSource)).status, 'FAIL_WITH_EVIDENCE');

  const missingDependency = await createFixture();
  localSql(`DELETE FROM task_node_dependencies WHERE task_id = ${literal(missingDependency)};`);
  await assert.rejects(() => worker().runTask(missingDependency), (error) => error.code === 'DATA_INPUT_UNAVAILABLE');
  assert.equal((await node(missingDependency)).output_data, null);
  assert.equal((await task(missingDependency)).status, 'FAIL_WITH_EVIDENCE');

  const reclaim = await createFixture();
  const old = await data.claimNodeForTaskAndAgent({ taskId: reclaim, workerId: 'crashed-data-worker', agentId: 'data', leaseSeconds: 60 });
  assert.ok(await data.loadInput(old));
  const beforeGuardChecks = await node(reclaim);
  assert.equal(await data.loadInput({ ...old, taskId: positive }), null);
  assert.equal(await data.loadInput({ ...old, workerId: 'wrong-owner' }), null);
  assert.equal(await data.loadInput({ ...old, leaseToken: randomUUID() }), null);
  assert.deepEqual(await node(reclaim), beforeGuardChecks, 'guarded reads cannot mutate another task or the claimed node');
  localSql(`UPDATE task_nodes SET lease_until = NOW() - INTERVAL '1 second' WHERE id = ${literal(old.nodeId)};`);
  const expired = await node(reclaim);
  assert.equal(await data.loadInput(old), null);
  assert.equal(await data.heartbeat({ nodeId: old.nodeId, workerId: old.workerId, leaseToken: old.leaseToken }), false);
  assert.equal(await data.completeSuccess({ nodeId: old.nodeId, workerId: old.workerId, leaseToken: old.leaseToken, outputData: { stale: true } }), false);
  assert.equal(await data.failTerminal({ nodeId: old.nodeId, workerId: old.workerId, leaseToken: old.leaseToken, error: { stale: true } }), false);
  assert.deepEqual(await node(reclaim), expired, 'expired fencing token must cause zero node mutation');
  const reclaimed = await worker().runTask(reclaim);
  assert.equal(reclaimed.execution.taskStatus, 'SUCCESS');
  assert.equal(reclaimed.claim.attempt, 2);
  assert.notEqual(reclaimed.claim.leaseToken, old.leaseToken);
  const afterReclaim = await node(reclaim);
  assert.equal(await data.completeSuccess({ nodeId: old.nodeId, workerId: old.workerId, leaseToken: old.leaseToken, outputData: { stale: true } }), false);
  assert.deepEqual(await node(reclaim), afterReclaim);

  const deadline = await createFixture();
  const deadlineClaim = await data.claimNodeForTaskAndAgent({ taskId: deadline, workerId: 'data-postgres-worker', agentId: 'data', leaseSeconds: 60 });
  localSql(`UPDATE tasks SET deadline_at = NOW() - INTERVAL '1 second' WHERE id = ${literal(deadline)};`);
  await assert.rejects(() => worker({ claimNodeForTaskAndAgent: async () => deadlineClaim }).runTask(deadline), (error) => error.code === 'LEASE_LOST');
  assert.equal((await node(deadline)).output_data, null);
  assert.equal(await data.loadInput(deadlineClaim), null);
  assert.equal(await data.finalizeTask(deadline), 'FAIL_WITH_EVIDENCE');
  assert.equal((await task(deadline)).terminal_reason, 'DEADLINE_EXCEEDED');
  assert.equal((await node(deadline)).status, 'BLOCKED');

  const deadlineAfterCompletion = await createFixture();
  let postCompletionFailures = 0;
  const racing = await worker({
    completeSuccess: async (args) => {
      const accepted = await data.completeSuccess(args);
      if (accepted) localSql(`UPDATE tasks SET deadline_at = NOW() - INTERVAL '1 second' WHERE id = ${literal(deadlineAfterCompletion)};`);
      return accepted;
    },
    failTerminal: async () => { postCompletionFailures += 1; throw new Error('cannot downgrade completed node'); },
  }).runTask(deadlineAfterCompletion);
  assert.equal(racing.execution.status, 'SUCCESS');
  assert.equal(racing.execution.nodeStatus, 'SUCCESS');
  assert.equal(racing.execution.taskStatus, 'FAIL_WITH_EVIDENCE');
  assert.equal((await node(deadlineAfterCompletion)).status, 'SUCCESS');
  assert.equal((await task(deadlineAfterCompletion)).terminal_reason, 'DEADLINE_EXCEEDED');
  assert.equal(postCompletionFailures, 0);

  const runtimeFailure = await createFixture();
  await assert.rejects(() => worker({}, { transform: () => { throw new Error('PRIVATE_RUNTIME_DETAIL'); } }).runTask(runtimeFailure), (error) => error.code === 'DATA_EXECUTION_FAILED');
  assert.deepEqual((await node(runtimeFailure)).last_error, { code: 'DATA_EXECUTION_FAILED', message: 'Data execution failed' });
  assert.equal((await task(runtimeFailure)).status, 'FAIL_WITH_EVIDENCE');

  const upstreamFailure = await createFixture({ completeResearch: false });
  const upstreamClaim = await kernel.claimNodeForTaskAndAgent({ taskId: upstreamFailure, workerId: 'failed-research-fixture', agentId: 'researcher', leaseSeconds: 60 });
  assert.equal(await kernel.failTerminal({ nodeId: upstreamClaim.nodeId, workerId: upstreamClaim.workerId, leaseToken: upstreamClaim.leaseToken, error: { code: 'FIXTURE_RESEARCH_FAILURE' } }), true);
  assert.deepEqual(await worker().runTask(upstreamFailure), { status: 'IDLE' });
  assert.equal((await node(upstreamFailure)).status, 'BLOCKED');
  assert.equal((await node(upstreamFailure)).attempt, 0);
  assert.equal((await task(upstreamFailure)).status, 'FAIL_WITH_EVIDENCE');

  for (const taskId of fixtures) await assertNoDataSpend(taskId);
  console.log('data postgres kernel e2e: deterministic success, validation failure, dependency, fencing/reclaim, deadline and zero Data spend verified');
} finally {
  // Remove only fixture tasks created by this invocation in the fixed local DB.
  if (fixtures.length) localSql(`DELETE FROM tasks WHERE id IN (${fixtures.map(literal).join(',')});`);
}
