import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { createPsqlQuery } from '../../src/kernel/psql-query.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { persistGitHubIssueIntake } from '../../src/intake/github-issue-postgres-intake.mjs';

const databaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const issueId = Date.now();
const issueNumber = Number(String(issueId).slice(-6)) || 1;
const createdAt = new Date(Date.now() - 1_000).toISOString();
const deadlineAt = new Date(Date.now() + 10 * 60_000).toISOString();
const request = {
  schemaVersion: 1,
  goal: 'Verify concurrent GitHub issue intake into one durable task.',
  maxResults: 3,
  constraints: { requiredDomains: ['github.com'] },
  requiredFields: ['title', 'sourceUrl'],
  budgetLimitUsd: '0.125000',
  tokenBudgetLimit: 12000,
  maxTotalSteps: 6,
  deadlineAt,
};
const event = {
  action: 'opened',
  repository: { id: 1237196115, owner: { id: 237693146, login: 'owner' } },
  sender: { id: 237693146, login: 'owner' },
  issue: {
    id: issueId,
    number: issueNumber,
    title: '[OPENCLAW V2] Concurrent intake E2E',
    created_at: createdAt,
    user: { id: 237693146, login: 'owner' },
    body: `\`\`\`openclaw-v2\n${JSON.stringify(request, null, 2)}\n\`\`\``,
  },
};

const moduleUrls = {
  intake: pathToFileURL(resolve('src/intake/github-issue-postgres-intake.mjs')).href,
  kernel: pathToFileURL(resolve('src/kernel/postgres-kernel-adapter.mjs')).href,
  psql: pathToFileURL(resolve('src/kernel/psql-query.mjs')).href,
};
const childCode = `
const [{ persistGitHubIssueIntake }, { createPostgresKernelAdapter }, { createPsqlQuery }] = await Promise.all([
  import(process.env.INTAKE_MODULE_URL), import(process.env.KERNEL_MODULE_URL), import(process.env.PSQL_MODULE_URL),
]);
const query = createPsqlQuery({ databaseUrl: process.env.DATABASE_URL });
const kernel = createPostgresKernelAdapter({ query });
const result = await persistGitHubIssueIntake({ event: JSON.parse(process.env.EVENT_JSON), kernel });
process.stdout.write(JSON.stringify(result));
`;

const runDeliveryProcess = (payload) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      EVENT_JSON: JSON.stringify(payload),
      INTAKE_MODULE_URL: moduleUrls.intake,
      KERNEL_MODULE_URL: moduleUrls.kernel,
      PSQL_MODULE_URL: moduleUrls.psql,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', rejectPromise);
  child.on('close', (code) => {
    if (code !== 0) return rejectPromise(new Error(`intake child failed with exit ${code}: ${stderr.trim()}`));
    try { resolvePromise(JSON.parse(stdout)); }
    catch (error) { rejectPromise(new Error(`intake child returned invalid JSON: ${stdout}`, { cause: error })); }
  });
});

const query = createPsqlQuery({ databaseUrl });
const kernel = createPostgresKernelAdapter({ query });
const idempotencyKey = `github:issue:1237196115:${issueId}`;
let taskId;
try {
  const first = runDeliveryProcess(event);
  const second = runDeliveryProcess(structuredClone(event));
  const results = await Promise.all([first, second]);
  assert.equal(results[0].taskId, results[1].taskId, 'concurrent duplicate deliveries must converge on one task');
  assert.deepEqual(results.map((item) => item.created).sort(), [false, true]);
  assert.ok(results.every((item) => item.idempotencyKey === idempotencyKey));
  taskId = results[0].taskId;

  const taskRows = (await query('SELECT id,request_payload FROM tasks WHERE idempotency_key=$1', [idempotencyKey])).rows;
  assert.equal(taskRows.length, 1, 'exactly one durable task must exist');
  assert.equal(taskRows[0].id, taskId);
  assert.deepEqual(taskRows[0].request_payload.github, { repositoryId: 1237196115, issueId, issueNumber });

  const nodeCount = (await query('SELECT count(*)::int AS count FROM task_nodes WHERE task_id=$1', [taskId])).rows[0].count;
  const dependencyCount = (await query('SELECT count(*)::int AS count FROM task_node_dependencies WHERE task_id=$1', [taskId])).rows[0].count;
  assert.equal(nodeCount, 2, 'canonical Research -> Data DAG must contain exactly two nodes');
  assert.equal(dependencyCount, 1, 'canonical Research -> Data DAG must contain exactly one edge');

  const replay = await persistGitHubIssueIntake({ event: structuredClone(event), kernel });
  assert.equal(replay.taskId, taskId);
  assert.equal(replay.created, false);

  const changed = structuredClone(event);
  const changedRequest = { ...request, budgetLimitUsd: '0.126000' };
  changed.issue.body = `\`\`\`openclaw-v2\n${JSON.stringify(changedRequest, null, 2)}\n\`\`\``;
  await assert.rejects(persistGitHubIssueIntake({ event: changed, kernel }), (error) => error?.code === 'PSQL_QUERY_FAILED');
  assert.equal((await query('SELECT count(*)::int AS count FROM tasks WHERE idempotency_key=$1', [idempotencyKey])).rows[0].count, 1);

  console.log('github issue postgres intake e2e: PASS');
} finally {
  if (taskId) {
    execFileSync('psql', ['-h','127.0.0.1','-U','openclaw','-d','openclaw_v2_test','-v','ON_ERROR_STOP=1','-c',`DELETE FROM tasks WHERE id='${taskId.replaceAll("'", "''")}';`], {
      env: { ...process.env, PGPASSWORD: 'openclaw' }, stdio: ['ignore','pipe','pipe'],
    });
  }
}
