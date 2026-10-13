import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
