import assert from 'node:assert/strict';
import test from 'node:test';
import { createResearchWorker, toResearchRequest } from '../../src/research/research-worker.mjs';

const noTerminalFailure = async () => {
  throw new Error('failTerminal must not be called');
};

test('research worker claims only researcher and executes canonical request', async () => {
  const calls=[];
  const lease={ taskId:'t',nodeId:'n',workerId:'worker-1',leaseToken:1,agentId:'researcher',inputPayload:{goal:'Find facts',request:{maxResults:3,constraints:{country:'US'}}} };
  const kernel={ claimNextNodeForAgent:async (x)=>(calls.push(['claim',x]),lease), failTerminal:noTerminalFailure };
  const executeResearch=async (x)=>(calls.push(['execute',x]),{status:'SUCCESS'});
  const worker=createResearchWorker({kernel,executeResearch,workerId:'worker-1',leaseSeconds:45});
  const out=await worker.runOnce();
  assert.equal(out.status,'EXECUTED');
  assert.deepEqual(calls[0][1],{workerId:'worker-1',agentId:'researcher',leaseSeconds:45});
  assert.deepEqual(calls[1][1].request,{goal:'Find facts',maxResults:3,constraints:{country:'US'}});
  assert.equal(calls[1][1].claim,lease);
});

test('research worker returns IDLE without paid execution when no researcher is claimable', async () => {
  let executed=false;
  const worker=createResearchWorker({
    kernel:{claimNextNodeForAgent:async()=>null,failTerminal:noTerminalFailure},
    executeResearch:async()=>{executed=true;},
    workerId:'w',
  });
  assert.deepEqual(await worker.runOnce(),{status:'IDLE'});
  assert.equal(executed,false);
});

test('research worker fails closed if scoped claim violates agent contract', async () => {
  const worker=createResearchWorker({
    kernel:{claimNextNodeForAgent:async()=>({agentId:'data',inputPayload:{}}),failTerminal:noTerminalFailure},
    executeResearch:async()=>{},
    workerId:'w',
  });
  await assert.rejects(()=>worker.runOnce(),e=>e.code==='AGENT_SCOPE_VIOLATION');
});

test('research worker terminalizes invalid claimed input under the same fence before any paid execution', async () => {
  let executed=false;
  const terminalCalls=[];
  const lease={taskId:'t',nodeId:'n',workerId:'worker-1',leaseToken:'lease-token',agentId:'researcher',inputPayload:{goal:'   '}};
  const worker=createResearchWorker({
    kernel:{
      claimNextNodeForAgent:async()=>lease,
      failTerminal:async(input)=>(terminalCalls.push(input),true),
    },
    executeResearch:async()=>{executed=true;},
    workerId:'worker-1',
  });
  await assert.rejects(()=>worker.runOnce(),e=>e.code==='INVALID_RESEARCH_NODE_INPUT');
  assert.equal(executed,false);
  assert.deepEqual(terminalCalls,[{
    nodeId:'n',
    workerId:'worker-1',
    leaseToken:'lease-token',
    error:{code:'INVALID_RESEARCH_NODE_INPUT',message:'Research node input_payload.goal is required'},
  }]);
});

test('research worker fails closed when invalid-input terminalization loses the fence', async () => {
  let executed=false;
  const worker=createResearchWorker({
    kernel:{
      claimNextNodeForAgent:async()=>({taskId:'t',nodeId:'n',workerId:'worker-1',leaseToken:'lease-token',agentId:'researcher',inputPayload:null}),
      failTerminal:async()=>false,
    },
    executeResearch:async()=>{executed=true;},
    workerId:'worker-1',
  });
  await assert.rejects(()=>worker.runOnce(),e=>e.code==='INVALID_RESEARCH_INPUT_FENCE_REJECTED');
  assert.equal(executed,false);
});

test('research request keeps DAG goal authoritative over payload goal', () => {
  assert.deepEqual(toResearchRequest({goal:'authoritative',request:{goal:'untrusted',maxResults:2}}),{goal:'authoritative',maxResults:2});
});
