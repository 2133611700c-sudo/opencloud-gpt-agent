import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchKernelExecutor } from '../../src/research/research-kernel-bindings.mjs';

const leaseToken = '22222222-2222-4222-8222-222222222222';
const claim = { taskId:'t', nodeId:'n', workerId:'w', leaseToken, agentId:'researcher' };

const research = {
  result:{ status:'SUCCESS', summary:'ok', sources:[] },
  telemetry:{ usage:{ input:3, output:2, cacheRead:0, cacheWrite:0, total:5 }, costUsd:0.01, sessionId:'s', toolSummary:{ totalToolTimeMs:7 } },
  process:{ latencyMs:9 },
};

const kernelWithCalls = (calls) => ({
  reserve: async (x)=>(calls.push(['reserve',x]),'r'),
  heartbeat: async (x)=>(calls.push(['heartbeat',x]),true),
  recordLlmCall: async (x)=>(calls.push(['account',x]),{accountingId:'a',created:true}),
  recordLlmCallReservationFallback: async (x)=>(calls.push(['fallback',x]),{accountingId:'af',created:true}),
  completeSuccess: async (x)=>(calls.push(['complete',x]),true),
  failTerminal: async (x)=>(calls.push(['fail',x]),true),
  releaseReservation: async (x)=>(calls.push(['release',x]),1),
});

test('binds full observed cache-aware usage and completion to one fence', async () => {
  const calls=[];
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>research, heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','account','complete']);
  assert.equal(calls[1][1].callKey,`research:t:n:${leaseToken}`);
  assert.equal(calls[1][1].promptCacheHitTokens,0);
  assert.equal(calls[1][1].promptCacheMissTokens,3);
  assert.equal(calls[1][1].completionTokens,2);
  assert.equal(calls[1][1].totalTokens,5);
  assert.equal(calls[1][1].actualCostUsd,0.01);
});

test('records observed cache hits instead of inventing zero cache usage', async () => {
  const calls=[];
  const cached={...research,telemetry:{...research.telemetry,usage:{input:3,output:2,cacheRead:7,cacheWrite:1,total:13}}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>cached, heartbeatIntervalMs:60_000 });
  await execute({claim,request:'q'});
  const accounting=calls.find(x=>x[0]==='account')[1];
  assert.equal(accounting.promptCacheHitTokens,7);
  assert.equal(accounting.promptCacheMissTokens,4);
  assert.equal(accounting.completionTokens,2);
  assert.equal(accounting.totalTokens,13);
});

test('uses reservation fallback and still completes when usage telemetry is absent', async () => {
  const calls=[];
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>({...research,telemetry:{...research.telemetry,usage:null}}), heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fallback','complete']);
  assert.equal(calls[1][1].reason,'MISSING_USAGE_TELEMETRY');
  assert.equal(calls[1][1].callKey,`research:t:n:${leaseToken}`);
});

test('uses reservation fallback and still completes when cost telemetry is absent', async () => {
  const calls=[];
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>({...research,telemetry:{...research.telemetry,costUsd:null}}), heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fallback','complete']);
  assert.equal(calls[1][1].reason,'MISSING_COST_TELEMETRY');
});

test('uses reservation fallback when DeepSeek reports zero cost for nonzero usage', async () => {
  const calls=[];
  const zeroCost={...research,telemetry:{...research.telemetry,costUsd:0}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>zeroCost, heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fallback','complete']);
  assert.equal(calls[1][1].reason,'ZERO_COST_WITH_NONZERO_USAGE');
});

test('accepts exact zero cost only when observed total usage is zero', async () => {
  const calls=[];
  const zeroUsage={...research,telemetry:{...research.telemetry,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0},costUsd:0}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0,tokens:0}), runResearch:async()=>zeroUsage, heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','account','complete']);
  assert.equal(calls[1][1].actualCostUsd,0);
  assert.equal(calls[1][1].totalTokens,0);
});

test('uses reservation fallback rather than inventing cache split', async () => {
  const calls=[];
  const partial={...research,telemetry:{...research.telemetry,usage:{input:3,output:2,total:5,cacheRead:null,cacheWrite:null}}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>partial, heartbeatIntervalMs:60_000 });
  const out=await execute({claim,request:'q'});
  assert.equal(out.status,'SUCCESS');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fallback','complete']);
  assert.equal(calls[1][1].reason,'MISSING_CACHE_SPLIT_TELEMETRY');
});

test('malformed observed telemetry fails closed instead of using fallback', async () => {
  const calls=[];
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>({...research,telemetry:{...research.telemetry,costUsd:-1}}), heartbeatIntervalMs:60_000 });
  await assert.rejects(()=>execute({claim,request:'q'}),e=>e.code==='COST_TELEMETRY_INVALID');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fail','release']);
});

test('malformed cost telemetry is not masked by missing cache split', async () => {
  const calls=[];
  const invalid={...research,telemetry:{...research.telemetry,usage:{input:3,output:2,total:5,cacheRead:null,cacheWrite:null},costUsd:-1}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>invalid, heartbeatIntervalMs:60_000 });
  await assert.rejects(()=>execute({claim,request:'q'}),e=>e.code==='COST_TELEMETRY_INVALID');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fail','release']);
});

test('inconsistent cache-aware totals fail closed', async () => {
  const calls=[];
  const invalid={...research,telemetry:{...research.telemetry,usage:{input:3,output:2,cacheRead:7,cacheWrite:1,total:5}}};
  const execute=createResearchKernelExecutor({ kernel:kernelWithCalls(calls), pricingVersion:'p1', estimateReservation:async()=>({costUsd:0.1,tokens:50}), runResearch:async()=>invalid, heartbeatIntervalMs:60_000 });
  await assert.rejects(()=>execute({claim,request:'q'}),e=>e.code==='USAGE_TELEMETRY_INVALID');
  assert.deepEqual(calls.map(x=>x[0]),['reserve','fail','release']);
});
