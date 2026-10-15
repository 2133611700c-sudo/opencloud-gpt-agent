import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPsqlQuery } from '../../src/kernel/psql-query.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { createUserHttpHandler } from '../../src/intake/user-http-handler.mjs';
import { userHttpIdempotencyKey } from '../../src/intake/user-http-intake.mjs';
import { runUserTaskWorker } from '../../src/runtime/user-task-worker.mjs';

// Real local PostgreSQL/concurrent processes; synthetic HTTP, no provider call.
const databaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const query = createPsqlQuery({ databaseUrl });
const principalId = 'ci-operator';
const secret = 'public-disposable-intake-fixture-secret';
const publicBaseUrl = 'https://mobile.openclaw.example';
const handler = createUserHttpHandler({ kernel: createPostgresKernelAdapter({ query }), secret, principalId, publicBaseUrl });
const requestFor = (requestId, body, authorization = `Bearer ${secret}`) => new Request(`${publicBaseUrl}/v1/research/tasks`, {
  method: 'POST', headers: { Authorization: authorization, 'Idempotency-Key': requestId, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (process.env.USER_HTTP_E2E_CHILD === '1') {
  const response = await handler(requestFor(process.env.USER_HTTP_E2E_REQUEST_ID, JSON.parse(process.env.USER_HTTP_E2E_BODY)));
  process.stdout.write(JSON.stringify({ status: response.status, body: await response.json() }));
} else {
  const requestId = randomUUID();
  const key = userHttpIdempotencyKey({ principalId, requestId });
  const body = {
    schemaVersion: 1, goal: 'Verify authenticated user intake', maxResults: 1,
    constraints: {}, requiredFields: ['modelId'], budgetLimitUsd: '0.100000',
    tokenBudgetLimit: 50000, maxTotalSteps: 4, deadlineAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const deliver = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, USER_HTTP_E2E_CHILD: '1', USER_HTTP_E2E_REQUEST_ID: requestId, USER_HTTP_E2E_BODY: JSON.stringify(body) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (text) => { output += text; });
    child.stderr.resume(); child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Local intake child failed: ${code}`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid local intake response')); }
    });
  });
  let taskId;
  try {
    let executions = 0;
    const worker = runUserTaskWorker({
      query, principalId, requestId, pollIntervalMs: 10, maxWaitMs: 30_000,
      runtime: { async runTask(id) { executions++; return { taskId: id, discovered: true }; } },
    });
    const deliveries = await Promise.all([deliver(), deliver()]);
    assert.ok(deliveries.every((r) => r.status === 202));
    assert.deepEqual(deliveries.map((r) => r.body.created).sort(), [false, true]);
    taskId = deliveries[0].body.taskId;
    assert.equal(deliveries[1].body.taskId, taskId);
    assert.deepEqual(await worker, { taskId, discovered: true });
    assert.equal(executions, 1);
    const rows = (await query('SELECT id,goal,request_payload FROM tasks WHERE idempotency_key=$1', [key])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].id, taskId); assert.equal(rows[0].goal, body.goal);
    assert.deepEqual(rows[0].request_payload.source, { type: 'authenticated_http', principalId, requestId });
    assert.equal(Object.hasOwn(rows[0].request_payload, 'github'), false);
    assert.equal((await query('SELECT count(*)::int AS count FROM task_nodes WHERE task_id=$1', [taskId])).rows[0].count, 2);
    assert.equal((await query('SELECT count(*)::int AS count FROM task_node_dependencies WHERE task_id=$1', [taskId])).rows[0].count, 1);
    const unauthorized = await handler(requestFor(requestId, body, 'Bearer invalid'));
    assert.equal(unauthorized.status, 401);
    const changed = await handler(requestFor(requestId, { ...body, goal: 'Conflicting semantics' }));
    assert.notEqual(changed.status, 202);
    assert.equal((await query('SELECT count(*)::int AS count FROM tasks WHERE idempotency_key=$1', [key])).rows[0].count, 1);
    assert.equal((await query('SELECT count(*)::int AS count FROM llm_accounting WHERE task_id=$1', [taskId])).rows[0].count, 0);
    console.log('user HTTP PostgreSQL intake E2E: concurrent duplicate -> one task/DAG, authenticated provenance, prearmed worker discovery and zero model calls');
  } finally {
    if (taskId) execFileSync('psql', ['-h', '127.0.0.1', '-U', 'openclaw', '-d', 'openclaw_v2_test', '-v', 'ON_ERROR_STOP=1', '-c', `DELETE FROM tasks WHERE id='${taskId}';`], {
      env: { ...process.env, PGPASSWORD: 'openclaw' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}
