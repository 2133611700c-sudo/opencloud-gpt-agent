import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';

const scripted = (rows) => {
  const calls = [];
  const query = async (text, values) => {
    calls.push({ text, values });
    return { rows: [rows.shift()].filter(Boolean) };
  };
  return { query, calls };
};

test('claim maps SQL row into canonical lease claim', async () => {
  const db = scripted([{ node_id:'n', task_id:'t', lease_token:'l', agent_id:'researcher', input_payload:{q:'x'}, attempt:2 }]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  assert.deepEqual(await kernel.claimNextNode({ workerId:'w', leaseSeconds:30 }), { nodeId:'n', taskId:'t', leaseToken:'l', agentId:'researcher', inputPayload:{q:'x'}, attempt:2, workerId:'w' });
  assert.deepEqual(db.calls[0].values, ['w', 30]);
});

test('agent-scoped claim binds worker to requested agent id', async () => {
  const db = scripted([{ node_id:'n', task_id:'t', lease_token:'l', agent_id:'researcher', input_payload:{q:'x'}, attempt:1 }]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  assert.deepEqual(await kernel.claimNextNodeForAgent({ workerId:'w', agentId:'researcher', leaseSeconds:45 }), { nodeId:'n', taskId:'t', leaseToken:'l', agentId:'researcher', inputPayload:{q:'x'}, attempt:1, workerId:'w' });
  assert.equal(db.calls[0].text, 'SELECT * FROM claim_next_node_for_agent($1, $2, $3)');
  assert.deepEqual(db.calls[0].values, ['w', 'researcher', 45]);
});

test('task-scoped agent claim binds target task, worker and agent exactly', async () => {
  const db = scripted([{ node_id:'n2', task_id:'task-2', lease_token:'lease-2', agent_id:'data', input_payload:{source:'research'}, attempt:1 }]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  assert.deepEqual(
    await kernel.claimNodeForTaskAndAgent({ taskId:'task-2', workerId:'data-worker', agentId:'data', leaseSeconds:60 }),
    { nodeId:'n2', taskId:'task-2', leaseToken:'lease-2', agentId:'data', inputPayload:{source:'research'}, attempt:1, workerId:'data-worker' },
  );
  assert.equal(db.calls[0].text, 'SELECT * FROM claim_node_for_task_and_agent($1, $2, $3, $4)');
  assert.deepEqual(db.calls[0].values, ['task-2', 'data-worker', 'data', 60]);
});

test('fenced boolean operations fail closed on missing rows', async () => {
  const db = scripted([null, null, null]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  const claim = { nodeId:'n', workerId:'w', leaseToken:'l' };
  assert.equal(await kernel.heartbeat(claim), false);
  assert.equal(await kernel.completeSuccess({ ...claim, outputData:{} }), false);
  assert.equal(await kernel.failTerminal({ ...claim, error:{} }), false);
});

test('reservation and accounting preserve exact identifiers', async () => {
  const db = scripted([{ reservation_id:'r' }, { accounting_id:'a', created:true }, { released:1 }]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  assert.equal(await kernel.reserve({ reservationKey:'call', nodeId:'n', workerId:'w', leaseToken:'l', reservedCostUsd:'0.1', reservedTokens:100 }), 'r');
  assert.deepEqual(await kernel.recordLlmCall({ reservationId:'r', callKey:'call', nodeId:'n', workerId:'w', leaseToken:'l', provider:'deepseek', model:'m', pricingVersion:'v', promptCacheMissTokens:10, completionTokens:5, totalTokens:15, actualCostUsd:'0.01', latencyMs:50 }), { accountingId:'a', created:true });
  assert.equal(await kernel.releaseReservation({ taskId:'t', nodeId:'n', leaseToken:'l', reason:'ABORT' }), 1);
});

test('reservation fallback accounting uses canonical SQL function and identifiers', async () => {
  const db = scripted([{ accounting_id:'a-fallback', created:true }]);
  const kernel = createPostgresKernelAdapter({ query: db.query });
  const result = await kernel.recordLlmCallReservationFallback({
    reservationId:'r', callKey:'call', nodeId:'n', workerId:'w', leaseToken:'l',
    provider:'deepseek', model:'m', pricingVersion:'v', providerRequestId:'request-1',
    latencyMs:50, reason:'MISSING_USAGE_TELEMETRY',
  });
  assert.deepEqual(result, { accountingId:'a-fallback', created:true });
  assert.equal(db.calls[0].text, 'SELECT * FROM record_llm_call_reservation_fallback($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)');
  assert.deepEqual(db.calls[0].values, ['r','call','n','w','l','deepseek','m','v','request-1',50,'MISSING_USAGE_TELEMETRY']);
});

test('constructor rejects missing query capability', () => {
  assert.throws(() => createPostgresKernelAdapter(), TypeError);
});
