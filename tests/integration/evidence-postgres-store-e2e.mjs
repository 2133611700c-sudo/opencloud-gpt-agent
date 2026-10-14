import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createEvidenceArtifact, serializeEvidenceBundle } from '../../src/evidence/evidence-contract.mjs';
import { createPostgresEvidenceStore } from '../../src/evidence/postgres-evidence-store.mjs';
import { bindPsqlParameters, createPsqlQuery, postgresEnvFromDatabaseUrl } from '../../src/kernel/psql-query.mjs';
import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../../src/data/data-worker.mjs';
import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';
import { normalizeResearchResult } from '../../src/research/research-contract.mjs';

// All mutations and cleanup are restricted to the disposable local CI database.
// Structured Research is synthetic; this script never invokes a paid model.
const localDatabaseUrl = 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test';
const query = createPsqlQuery({ databaseUrl: localDatabaseUrl });
const pgEnv = postgresEnvFromDatabaseUrl(localDatabaseUrl);
const store = createPostgresEvidenceStore({ query });
const fixtures = [];
const sessions = new Set();
const sessionNames = [];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = (text) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: `${text}\n`, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
}).trim();
const rehash = (bundle) => {
  const serialized = serializeEvidenceBundle(bundle);
  return { bundle, serialized, sha256: createHash('sha256').update(serialized).digest('hex'), sizeBytes: Buffer.byteLength(serialized) };
};
const boundSql = (taskId, artifact, fingerprint) => bindPsqlParameters(
  'SELECT row_to_json(receipt) FROM persist_task_evidence_v1($1,$2,$3,$4) receipt',
  [taskId, artifact.serialized, artifact.sha256, fingerprint],
);

// execFileSync-backed query + Promise.all would still execute serially. Spawn
// independent psql clients and confirm real lock waits before releasing them.
const session = (input, { keepOpen = false, marker = null } = {}) => {
  const name = `evidence-e3a-${randomUUID()}`;
  sessionNames.push(name);
  const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...pgEnv, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  sessions.add(child);
  let stdout = ''; let stderr = ''; let readyResolve; let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.stdin.destroy(); child.kill('SIGKILL'); }, 15_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (marker && stdout.includes(marker)) readyResolve();
      if (stdout.length > 2_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => { clearTimeout(timer); sessions.delete(child); readyReject(error); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer); sessions.delete(child);
      if (code === 0) { readyResolve(); resolve(stdout.trim()); }
      else { const error = new Error(`local Evidence psql failed: ${stderr.trim() || 'session terminated'}`); readyReject(error); reject(error); }
    });
  });
  done.catch(() => {});
  const text = `SET statement_timeout='12s'; SET lock_timeout='10s'; SET idle_in_transaction_session_timeout='15s';\n${input}\n`;
  if (keepOpen) child.stdin.write(text); else child.stdin.end(text);
  return { child, name, ready, done };
};
const holdTask = async (taskId) => {
  const holder = session(`BEGIN; SELECT id FROM tasks WHERE id=${literal(taskId)} FOR UPDATE;\n\\echo EVIDENCE_LOCK_HELD`, { keepOpen: true, marker: 'EVIDENCE_LOCK_HELD' });
  await holder.ready;
  return holder;
};
const waitForBlocked = async (waiters) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await query(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE application_name = ANY($1::text[]) AND wait_event_type='Lock'`, [`{${waiters.map((waiter) => waiter.name).join(',')}}`]);
    if (result.rows[0].count === waiters.length) return;
    await delay(30);
  }
  throw new Error('Evidence concurrency fixture did not establish the expected lock waits');
};
const countArtifacts = async (taskId) => (await query("SELECT count(*)::int AS count FROM artifacts WHERE task_id=$1 AND artifact_type='EVIDENCE_BUNDLE_V1'", [taskId])).rows[0].count;
const load = async (taskId, sensitiveValues = []) => {
  const input = await store.loadInput(taskId);
  return { ...input, artifact: createEvidenceArtifact(input.snapshot, { sensitiveValues }) };
};
const persist = (taskId, input, sensitiveValues = []) => store.persist({
  taskId, artifact: input.artifact, expectedSnapshotFingerprint: input.snapshotSha256, sensitiveValues,
});
const emptyTerminal = async ({ payload = {}, goal = 'Empty cancelled evidence fixture', status = 'CANCELLED', detail = {}, tokenBudget = '100' } = {}) => {
  const taskId = randomUUID(); fixtures.push(taskId);
  sql(`INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,
    token_budget_limit,max_total_steps,current_steps,deadline_at,terminal_at,terminal_reason,terminal_detail)
    VALUES(${literal(taskId)},${literal(`e3a-empty-${taskId}`)},${literal(goal)},${literal(JSON.stringify(payload))}::jsonb,
    ${literal(status)},1,${literal(tokenBudget)}::bigint,4,0,NOW()+INTERVAL '1 hour',NOW(),'USER_CANCELLED',${literal(JSON.stringify(detail))}::jsonb);`);
  return taskId;
};
let syntheticRuns = 0;
const vertical = async ({ payload = { requiredFields: ['price', 'active'] } } = {}) => {
  const id = randomUUID();
  const created = await query('SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)', [
    `e3a-vertical-${id}`, 'Система 🦞 with sourced zero and false', JSON.stringify(payload),
    1, 1000, 4, new Date(Date.now() + 600_000).toISOString(),
  ]);
  const taskId = created.rows[0].task_id; fixtures.push(taskId);
  const researchWorker = createProductionResearchWorker({
    query, workerId: `e3a-research-${id}`, pricingVersion: 'synthetic-e3a-v1', researchEnv: {}, leaseSeconds: 60,
    estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
    runResearchImpl: async () => {
      syntheticRuns += 1;
      return {
        result: normalizeResearchResult({ status: 'SUCCESS', summary: 'Synthetic sourced fixture.', confidence: 'HIGH', needsBrowser: [],
          sources: [{ id: 'source', title: 'Verified fixture', url: 'https://example.com/docs', checkedAt: '2026-10-14T00:00:00Z' }],
          items: [{ id: 'item', title: 'Система 🦞', data: { price: 0, active: false }, sourceIds: ['source'] }],
        }),
        telemetry: { provider: 'deepseek', model: 'deepseek-flash', sessionId: `synthetic-e3a-${id}`,
          usage: { input: 3, output: 4, cacheRead: 2, cacheWrite: 0, total: 9 }, costUsd: 0.000003,
          toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 0, totalToolTimeMs: 1 } },
        process: { latencyMs: 1 },
      };
    },
  });
  await researchWorker.runTask(taskId);
  const dataWorker = createDataWorker({ kernel: createPostgresDataAdapter({ query }), workerId: `e3a-data-${id}`, leaseSeconds: 60 });
  if (Array.isArray(payload?.requiredFields) && payload.requiredFields.includes('missing')) {
    await assert.rejects(() => dataWorker.runTask(taskId), (error) => error.code === 'REQUIRED_FIELD_MISSING');
  } else assert.equal((await dataWorker.runTask(taskId)).execution.taskStatus, 'SUCCESS');
  return taskId;
};

assert.equal((await query('SELECT current_database() AS database')).rows[0].database, 'openclaw_v2_test');
try {
  const positive = await vertical();
  const input = await load(positive);
  assert.equal(input.snapshot.task.current_cost_usd, '0.000003');
  assert.equal(input.snapshot.task.current_tokens, '9');
  assert.equal(input.snapshot.accounting.length, 1);
  assert.equal(input.snapshot.reservations[0].status, 'RECONCILED');
  assert.deepEqual(input.snapshot.runtimeReceipts, []);
  const first = await persist(positive, input);
  assert.equal(first.created, true);
  const retrieved = await store.read(positive);
  assert.equal(retrieved.serialized, input.artifact.serialized);
  assert.equal(retrieved.artifactId, first.artifactId);
  assert.equal(retrieved.bundle.task.status, 'SUCCESS');
  assert.equal(retrieved.bundle.nodes.find((node) => node.nodeKey === 'data').result.items[0].data.price, 0);
  assert.equal(retrieved.bundle.nodes.find((node) => node.nodeKey === 'data').result.items[0].data.active, false);
  assert.equal(retrieved.bundle.coverage.runtimeVerification, 'NOT_PROVEN');
  assert.equal(retrieved.bundle.coverage.runtimeReceiptsPresent, false);
  assert.ok(input.artifact.sizeBytes > input.artifact.serialized.length, 'UTF8 size counts bytes, not JS code units');
  assert.equal((await persist(positive, input)).artifactId, first.artifactId);
  assert.equal((await store.persist({ taskId: positive, artifact: input.artifact })).created, false, 'legacy API permits identical already-bound retry');
  assert.equal(await countArtifacts(positive), 1);
  assert.deepEqual(await store.loadInput(positive), { snapshot: input.snapshot, snapshotSha256: input.snapshotSha256 }, 'persist/read must not enter the raw snapshot or mutate it');

  const forged = structuredClone(input.artifact.bundle);
  forged.nodes.find((node) => node.nodeKey === 'research').result.summary = 'Different but contract-valid invented summary';
  await assert.rejects(() => store.persist({ taskId: positive, artifact: rehash(forged), expectedSnapshotFingerprint: input.snapshotSha256 }));
  assert.equal((await store.read(positive)).serialized, first.serialized);

  const failed = await vertical({ payload: { requiredFields: ['missing'] } });
  const failedReceipt = await persist(failed, await load(failed));
  assert.equal(failedReceipt.bundle.task.status, 'FAIL_WITH_EVIDENCE');
  assert.equal(failedReceipt.bundle.nodes.find((node) => node.nodeKey === 'data').result, null);
  assert.equal(failedReceipt.bundle.accounting.length, 1);

  // Contract-parity cases previously rejected by SQL's duplicated normalization.
  for (const payload of [null, {}, { requiredFields: null }, { maxResults: null }, { constraints: null }, { requiredFields: [' price '] }, false, []]) {
    const taskId = await emptyTerminal({ payload, detail: 'scalar terminal detail' });
    const context = await load(taskId);
    const result = await persist(taskId, context);
    assert.equal((await store.read(taskId)).serialized, result.serialized);
    assert.equal(result.bundle.acceptanceCriteria.valid, payload !== false && !Array.isArray(payload));
  }
  const sensitive = 'synthetic privacy sentinel';
  const redacted = await emptyTerminal({ goal: `Private ${sensitive} goal` });
  const redactedInput = await load(redacted, [sensitive]);
  assert.equal(redactedInput.artifact.bundle.redaction.applied, true);
  assert.ok(!redactedInput.artifact.serialized.includes(sensitive));
  await persist(redacted, redactedInput, [sensitive]);
  assert.equal((await store.read(redacted)).serialized, redactedInput.artifact.serialized);
  assert.ok((await store.loadInput(redacted)).snapshot.task.goal.includes(sensitive), 'safe projection must not change original task');

  const exact = await emptyTerminal({ tokenBudget: '9007199254740993' });
  sql(`UPDATE tasks SET created_at='2026-10-14T10:00:00.123456Z',updated_at='2026-10-14T10:01:00.234567Z',terminal_at='2026-10-14T10:01:00.234567Z' WHERE id=${literal(exact)};`);
  const timezones = ['UTC', 'Pacific/Honolulu', 'Asia/Kathmandu'].map((timezone) => JSON.parse(sql(
    `SET TIME ZONE ${literal(timezone)}; SELECT row_to_json(input) FROM load_terminal_evidence_input_v1(${literal(exact)}) input;`,
  )));
  assert.deepEqual(timezones[1], timezones[0]); assert.deepEqual(timezones[2], timezones[0]);
  assert.equal(timezones[0].snapshot.task.created_at, '2026-10-14T10:00:00.123456Z');
  assert.equal(timezones[0].snapshot.task.token_budget_limit, '9007199254740993');
  assert.equal((await persist(exact, await load(exact))).bundle.task.tokenBudgetLimit, '9007199254740993');

  const stale = await emptyTerminal(); const old = await load(stale);
  await assert.rejects(() => store.persist({ taskId: stale, artifact: old.artifact }));
  sql(`UPDATE tasks SET goal='Changed after loading' WHERE id=${literal(stale)};`);
  await assert.rejects(() => persist(stale, old));
  assert.equal(await countArtifacts(stale), 0);
  await assert.rejects(() => persist(redacted, old));

  const unavailable = await emptyTerminal();
  for (const change of ["reserved_cost_usd=0.1", 'reserved_tokens=1', "status='RUNNING',terminal_at=NULL"]) {
    sql(`UPDATE tasks SET ${change} WHERE id=${literal(unavailable)};`);
    await assert.rejects(() => store.loadInput(unavailable), (error) => error.code === 'EVIDENCE_INPUT_UNAVAILABLE');
    sql(`UPDATE tasks SET reserved_cost_usd=0,reserved_tokens=0,status='CANCELLED',terminal_at=NOW() WHERE id=${literal(unavailable)};`);
  }
  await assert.rejects(() => store.loadInput(randomUUID()), (error) => error.code === 'EVIDENCE_INPUT_UNAVAILABLE');
  const guarded = await vertical();
  for (const change of ['reserved_cost_usd=0.1', 'reserved_tokens=1']) {
    sql(`UPDATE task_nodes SET ${change} WHERE task_id=${literal(guarded)} AND agent_id='data';`);
    await assert.rejects(() => store.loadInput(guarded), (error) => error.code === 'EVIDENCE_INPUT_UNAVAILABLE');
    sql(`UPDATE task_nodes SET reserved_cost_usd=0,reserved_tokens=0 WHERE task_id=${literal(guarded)} AND agent_id='data';`);
  }
  sql(`UPDATE budget_reservations SET status='RESERVED' WHERE task_id=${literal(guarded)};`);
  await assert.rejects(() => store.loadInput(guarded), (error) => error.code === 'EVIDENCE_INPUT_UNAVAILABLE');
  sql(`UPDATE budget_reservations SET status='RECONCILED' WHERE task_id=${literal(guarded)};`);

  for (const divergent of [false, true]) {
    const taskId = await emptyTerminal({ goal: 'Concurrent synthetic private marker' });
    const context = await load(taskId);
    const alternative = divergent ? createEvidenceArtifact(context.snapshot, { sensitiveValues: ['private marker'] }) : context.artifact;
    const holder = await holdTask(taskId);
    const waiters = [context.artifact, alternative].map((artifact) => session(`${boundSql(taskId, artifact, context.snapshotSha256)};`));
    const completed = Promise.allSettled(waiters.map((waiter) => waiter.done));
    await waitForBlocked(waiters);
    holder.child.stdin.end('COMMIT;\n\\q\n'); await holder.done;
    const outcomes = await completed;
    if (!divergent) {
      assert.ok(outcomes.every((outcome) => outcome.status === 'fulfilled'));
      const receipts = outcomes.map((outcome) => JSON.parse(outcome.value));
      assert.equal(receipts[0].artifact_id, receipts[1].artifact_id);
      assert.deepEqual(receipts.map((row) => row.created).sort(), [false, true]);
    } else {
      assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
      assert.match(outcomes.find((outcome) => outcome.status === 'rejected').reason.message, /EVIDENCE_ARTIFACT_CONFLICT/);
    }
    assert.equal(await countArtifacts(taskId), 1);
    const durable = await store.read(taskId);
    assert.ok([context.artifact.serialized, alternative.serialized].includes(durable.serialized));
  }

  // A waiting outer SELECT must see the preceding lock holder's new committed
  // state when the bound writer recomputes its raw fingerprint after locking.
  const racing = await emptyTerminal(); const beforeRace = await load(racing);
  const holder = await holdTask(racing);
  const waiter = session(`${boundSql(racing, beforeRace.artifact, beforeRace.snapshotSha256)};`);
  const raced = Promise.allSettled([waiter.done]);
  await waitForBlocked([waiter]);
  holder.child.stdin.end(`UPDATE tasks SET goal='Committed while Evidence waited' WHERE id=${literal(racing)}; COMMIT;\n\\q\n`);
  await holder.done;
  const [raceResult] = await raced;
  assert.equal(raceResult.status, 'rejected');
  assert.match(raceResult.reason.message, /EVIDENCE_SNAPSHOT_CHANGED/);
  assert.equal(await countArtifacts(racing), 0);
  assert.equal((await persist(racing, await load(racing))).bundle.acceptanceCriteria.goal, 'Committed while Evidence waited');

  assert.equal(syntheticRuns, 3);
  console.log('bound Evidence E2E: actual PostgreSQL Research/Data/accounting, E1 parity, immutable retries, real concurrent writers and fresh post-lock MVCC verified; no paid model calls');
} finally {
  for (const child of sessions) { child.stdin.destroy(); child.kill('SIGKILL'); }
  if (sessionNames.length) sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN (${sessionNames.map(literal).join(',')}) AND pid<>pg_backend_pid();`);
  if (fixtures.length) sql(`DELETE FROM tasks WHERE id IN (${fixtures.map(literal).join(',')});`);
}
