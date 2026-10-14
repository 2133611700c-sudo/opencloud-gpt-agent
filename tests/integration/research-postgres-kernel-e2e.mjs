import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createPsqlQuery } from '../../src/kernel/psql-query.mjs';
import { runResearchAgent } from '../../src/research/research-agent-runner.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { createResearchKernelExecutor } from '../../src/research/research-kernel-bindings.mjs';

const connection = ['-h','127.0.0.1','-U','openclaw','-d','openclaw_v2_test','-v','ON_ERROR_STOP=1','-At','-F','\t'];
const query = async (text, values=[]) => {
  let sql=text;
  values.forEach((value,index)=>{
    const encoded = value === null ? 'NULL' : `'${String(value).replaceAll("'","''")}'`;
    sql=sql.replace(`$${index+1}`, encoded);
  });
  const stdout=execFileSync('psql',[...connection,'-c',sql],{encoding:'utf8',env:{...process.env,PGPASSWORD:'openclaw'}}).trim();
  if (!stdout) return {rows:[]};
  const cols=(text.match(/SELECT \* FROM ([a-z_]+)/i)?.[1] === 'claim_next_node_for_agent')
    ? ['node_id','task_id','lease_token','agent_id','input_payload','attempt'] : null;
  if (cols) {
    const values=stdout.split('\t');
    return {rows:[Object.fromEntries(cols.map((c,i)=>[c,c==='input_payload'?JSON.parse(values[i]):c==='attempt'?Number(values[i]):values[i]]))]};
  }
  const alias=text.match(/ AS ([a-z_]+)/i)?.[1];
  return {rows:[{[alias]: stdout === 't' ? true : stdout === 'f' ? false : /^\d+$/.test(stdout) ? Number(stdout) : stdout}]};
};

execFileSync('psql',[...connection,'-c','TRUNCATE TABLE tasks CASCADE;'],{env:{...process.env,PGPASSWORD:'openclaw'}});
const taskRow=execFileSync('psql',[...connection,'-c',`SELECT task_id FROM create_lite_research_task('research-e2e','integration','{}'::jsonb,1.0,10000,10,NOW()+INTERVAL '10 minutes');`],{encoding:'utf8',env:{...process.env,PGPASSWORD:'openclaw'}}).trim();
try {
const kernel=createPostgresKernelAdapter({query});
const claim=await kernel.claimNextNodeForAgent({workerId:'research-e2e-worker',agentId:'researcher',leaseSeconds:60});
assert.ok(claim);
assert.equal(claim.taskId,taskRow);

const execute=createResearchKernelExecutor({
  kernel,
  pricingVersion:'integration-v1',
  estimateReservation:async()=>({costUsd:0.05,tokens:100}),
  runResearch:async()=>({
    result:{status:'SUCCESS',summary:'deterministic integration result',sources:[{url:'https://example.com',title:'Example'}]},
    telemetry:{usage:{input:10,output:5,cacheRead:0,cacheWrite:0,total:15},costUsd:0.01,sessionId:'integration-request'},
    process:{latencyMs:1},
  }),
  heartbeatIntervalMs:60_000,
});
await execute({claim,request:'integration'});

const dataClaim=await kernel.claimNextNodeForAgent({workerId:'data-e2e-worker',agentId:'data',leaseSeconds:60});
assert.ok(dataClaim,'Data must become claimable only after Research SUCCESS');
assert.equal(dataClaim.taskId,claim.taskId);
const reserved=execFileSync('psql',[...connection,'-c',`SELECT count(*) FROM budget_reservations WHERE task_id='${claim.taskId}' AND status='RESERVED';`],{encoding:'utf8',env:{...process.env,PGPASSWORD:'openclaw'}}).trim();
assert.equal(reserved,'0','Research completion must leave zero unresolved reservations');
const accounting=execFileSync('psql',[...connection,'-c',`SELECT count(*) FROM llm_accounting WHERE task_id='${claim.taskId}' AND accounting_basis='OBSERVED_USAGE';`],{encoding:'utf8',env:{...process.env,PGPASSWORD:'openclaw'}}).trim();
assert.equal(accounting,'1','Research execution with full cache split must persist exactly one observed accounting row');
console.log('research postgres kernel e2e: PASS');
} finally {
  // Delete only this test's fixture in its fixed disposable local database.
  execFileSync('psql',[...connection,'-c',`DELETE FROM tasks WHERE id='${taskRow.replaceAll("'","''")}';`],{env:{...process.env,PGPASSWORD:'openclaw'}});
}

// Actual fenced PostgreSQL accounting for native-parser failures; no external model.
const rejectedDb = createPsqlQuery({ databaseUrl: 'postgresql://openclaw:openclaw@127.0.0.1:5432/openclaw_v2_test' });
const rejectedKernel = createPostgresKernelAdapter({ query: rejectedDb });
const stateRoot = mkdtempSync(join(tmpdir(), 'openclaw-rejected-billing-pg-'));
const rejectedFixtures = [];
try {
  for (const mode of ['observed', 'fallback', 'stale']) {
    const id = randomUUID(); const workerId = `rejected-billing-${id}`;
    const deadline = new Date(Date.now() + 600_000).toISOString();
    const args = [`rejected-billing-${id}`, 'Rejected Research accounting fixture', '{}', 1, 1000, 4, deadline];
    const createSql = 'SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)';
    const taskId = (await rejectedDb(createSql, args)).rows[0].task_id;
    rejectedFixtures.push(taskId);
    const lease = await rejectedKernel.claimNodeForTaskAndAgent({ taskId, workerId, agentId: 'researcher', leaseSeconds: 60 });
    assert.ok(lease);
    let runtimeCalls = 0; let replacement = null;
    const executeRejected = createResearchKernelExecutor({
      kernel: rejectedKernel, pricingVersion: 'rejected-billing-fixture-v1',
      estimateReservation: async () => ({ costUsd: 0.05, tokens: 100 }), heartbeatIntervalMs: 60_000,
      runResearch: async () => {
        runtimeCalls += 1; let sample = 0; let nativeFailure;
        try {
          await runResearchAgent({ request: { goal: 'Rejected fixture' },
            env: { DEEPSEEK_API_KEY: 'test-only-key', OPENCLAW_STATE_DIR: stateRoot }, tempRoot: stateRoot,
            nowMs: () => sample++ === 0 ? 0 : 37.25,
            spawnImpl: () => {
              const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
              const envelope = { ok: true, status: 'ok', provider: 'deepseek', model: 'deepseek-flash', codeModeEngaged: false,
                sessionId: `rejected-${id}`, costUsd: 0.01,
                usage: { input: 10, output: 5, cacheRead: 5, cacheWrite: 0, total: mode === 'fallback' ? 21 : 20 },
                toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 1, unresolvedError: { toolName: 'web_fetch' }, totalToolTimeMs: 7 },
                final: JSON.stringify({ status: 'SUCCESS', summary: 'Rejected unresolved fetch.', confidence: 'HIGH', sources: [{ id: 's1', url: 'https://api-docs.deepseek.com/', checkedAt: '2026-10-14T00:00:00Z' }], items: [{ id: 'i1', title: 'Fixture', data: {}, sourceIds: ['s1'] }], needsBrowser: [] }) };
              queueMicrotask(() => { child.stdout.end(JSON.stringify(envelope)); child.emit('close', 0, null); }); return child;
            },
          });
        } catch (error) { nativeFailure = error; }
        assert.equal(nativeFailure?.code, 'INVALID_SUCCESS_ENVELOPE');
        if (mode === 'stale') {
          execFileSync('psql', [...connection, '-c', `UPDATE task_nodes SET lease_until=NOW()-INTERVAL '1 second' WHERE id='${lease.nodeId.replaceAll("'", "''")}';`], {env:{...process.env,PGPASSWORD:'openclaw'},stdio:['ignore','pipe','pipe']});
          replacement = await rejectedKernel.claimNodeForTaskAndAgent({ taskId, workerId: `replacement-${id}`, agentId: 'researcher', leaseSeconds: 60 });
          assert.ok(replacement); assert.notEqual(replacement.leaseToken, lease.leaseToken);
        }
        throw nativeFailure;
      },
    });
    await assert.rejects(executeRejected({ claim: lease, request: 'fixture' }), error => error.code === (mode === 'stale' ? 'REJECTED_RESEARCH_ACCOUNTING_FAILED' : 'INVALID_SUCCESS_ENVELOPE'));
    assert.equal(runtimeCalls, 1);
    const ledger = (await rejectedDb('SELECT accounting_basis,latency_ms,total_tokens::text,cost_usd::text FROM llm_accounting WHERE task_id=$1', [taskId])).rows;
    if (mode === 'stale') {
      assert.equal(ledger.length, 0, 'stale failure capsule cannot bypass fencing to record a charge');
      const node = (await rejectedDb('SELECT status,lease_token,lease_owner FROM task_nodes WHERE id=$1', [lease.nodeId])).rows[0];
      assert.equal(node.status, 'RUNNING'); assert.equal(node.lease_token, replacement.leaseToken); assert.equal(node.lease_owner, replacement.workerId);
      await rejectedDb("SELECT cancel_task($1,'LOCAL_STALE_FIXTURE_CLEANUP','{}'::jsonb)", [taskId]);
    } else {
      assert.equal(ledger.length, 1); assert.equal(ledger[0].latency_ms, 38);
      assert.equal(ledger[0].accounting_basis, mode === 'observed' ? 'OBSERVED_USAGE' : 'RESERVATION_FALLBACK');
      assert.equal(Number(ledger[0].cost_usd), mode === 'observed' ? 0.01 : 0.05);
      assert.equal(Number(ledger[0].total_tokens), mode === 'observed' ? 20 : 100);
      const terminal = (await rejectedDb('SELECT status,terminal_reason FROM tasks WHERE id=$1', [taskId])).rows[0];
      assert.equal(terminal.status, 'FAIL_WITH_EVIDENCE'); assert.equal(terminal.terminal_reason, 'NODE_FAILED');
      const nodes = (await rejectedDb('SELECT node_key,status FROM task_nodes WHERE task_id=$1 ORDER BY node_key', [taskId])).rows;
      assert.deepEqual(nodes, [{node_key:'data',status:'BLOCKED'},{node_key:'research',status:'FAIL_WITH_EVIDENCE'}]);
      const repeated = (await rejectedDb(createSql, args)).rows[0]; assert.equal(repeated.task_id, taskId); assert.equal(repeated.created, false);
      assert.equal(await rejectedKernel.claimNodeForTaskAndAgent({ taskId, workerId, agentId: 'researcher', leaseSeconds: 60 }), null);
      assert.equal((await rejectedDb('SELECT count(*)::int AS count FROM llm_accounting WHERE task_id=$1', [taskId])).rows[0].count, 1);
    }
    assert.equal((await rejectedDb("SELECT count(*)::int AS count FROM budget_reservations WHERE task_id=$1 AND status='RESERVED'", [taskId])).rows[0].count, 0);
  }
  console.log('rejected Research billing: observed/fallback charge retained, failure cascade, duplicate intake and stale fence verified');
} finally {
  for (const taskId of rejectedFixtures) execFileSync('psql', [...connection, '-c', `DELETE FROM tasks WHERE id='${taskId.replaceAll("'", "''")}';`], {env:{...process.env,PGPASSWORD:'openclaw'},stdio:['ignore','pipe','pipe']});
  rmSync(stateRoot, {recursive:true,force:true});
}
