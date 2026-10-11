import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchKernelExecutor } from '../../src/research/research-kernel-bindings.mjs';

const claim = { taskId:'t', nodeId:'n', workerId:'w', leaseToken:1, agentId:'researcher' };

const research = {
  result:{ status:'SUCCESS', summary:'ok', sources:[] },
  telemetry:{ usage:{ input:3, output:2, total:5 }, costUsd:0.01, sessionId:'s', toolSummary:{ totalToolTimeMs:7 } },
  process:{ latencyMs:9 },
};

test('binds reservation heartbeat accounting and completion to one fence', async () => {
  const calls=[];
  const kernel={
    reserve: async (x)=>(calls.push(['reserve',x]),'r'),
    heartbeat: async (x)=>(calls.push(['heartbeat',x]),true),
    recordLlmCall: async (x)=>(calls.push(['account',x]),{accountingId:'a',created:true}),
    completeSuccess: async (x)=>(calls.push(['complete',x]),true),
    failTerminal: async (x)=>(calls.push(['fail',x]),true),
    releaseReservation: async (x)=>(calls.push(['release',x]),1),
  };
  const execute=createResearchKernelExecutor({ kernel, pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>research, heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','account','complete']);
  assert.equal(calls[1][1].callKey,'research:t:n:1');
  assert.equal(calls[1][1].totalTokens,5);
  assert.equal(calls[1][1].actualCostUsd,0.01);
});

test('fails closed when usage telemetry is absent', async () => {
  let failed=false;
  const kernel={ reserve:async()=> 'r', heartbeat:async()=>true, recordLlmCall:async()=>{throw new Error('must not account');}, completeSuccess:async()=>{throw new Error('must not complete');}, failTerminal:async()=>{failed=true;return true;}, releaseReservation:async()=>1 };
  const execute=createResearchKernelExecutor({ kernel, pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>({...research,telemetry:{...research.telemetry,usage:null}}), heartbeatIntervalMs:60_000 });
  await assert.rejects(()=>execute({claim,request:'q'}),e=>e.code==='USAGE_TELEMETRY_REQUIRED');
  assert.equal(failed,true);
});
