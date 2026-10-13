import assert from 'node:assert/strict';
import test from 'node:test';
import { transformData } from '../../src/data/data-transformer.mjs';
import { runLiveResearchKernelGate } from '../../src/research/research-live-kernel-gate.mjs';

const request = { maxResults: 3, requiredFields: ['modelId', 'modelVersion'], constraints: { requiredDomains: ['api-docs.deepseek.com'] } };
const liveResearch = {
  status: 'EXECUTED', claim: { taskId: 'task-1', nodeId: 'research-1' },
  execution: {
    status: 'SUCCESS',
    research: {
      result: {
        status: 'SUCCESS',
        sources: [{ id: 's1', url: 'https://api-docs.deepseek.com/updates/', checkedAt: '2026-10-11T21:00:00Z' }],
        items: [{ id: 'model-1', title: 'DeepSeek V4.1 Flash', data: { modelId: 'deepseek-flash', modelVersion: 'DeepSeek-V4.1-Flash' }, sourceIds: ['s1'] }],
      },
      telemetry: { model: 'deepseek-flash', toolSummary: { tools: ['web_search', 'web_fetch'] } },
    },
  },
};
const canonical = () => transformData({ requiredFields: request.requiredFields, researchResult: liveResearch.execution.research.result });
const ledger = () => [{ id: 'accounting-1', node_id: 'research-1', task_id: 'task-1', provider: 'deepseek', model: 'deepseek-flash', cost_usd: 0.01, total_tokens: 20, accounting_basis: 'OBSERVED_USAGE' }];
const dataExecution = () => ({
  status: 'EXECUTED', claim: { taskId: 'task-1', nodeId: 'data-1', agentId: 'data' },
  execution: { status: 'SUCCESS', nodeStatus: 'SUCCESS', taskStatus: 'SUCCESS', result: canonical() },
});
const durableSnapshot = () => ({
  task_status: 'SUCCESS', terminal_reason: 'ALL_NODES_SUCCEEDED', terminal_at: '2026-10-11T21:01:00Z',
  request_payload: structuredClone(request), reserved_cost_usd: 0, reserved_tokens: 0,
  research_reserved_cost_usd: 0, research_reserved_tokens: 0, data_reserved_cost_usd: 0, data_reserved_tokens: 0,
  current_steps: 2, cost_reconciled: true, tokens_reconciled: true,
  research_status: 'SUCCESS', research_result: structuredClone(liveResearch.execution.research.result),
  data_status: 'SUCCESS', data_result: canonical(), node_count: 2, dependency_count: 1,
});
const makeQuery = (options = {}) => {
  const calls = [];
  let isolationChecks = 0;
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (text.includes('AS active_count')) {
      isolationChecks += 1;
      return { rows: [{ active_count: options.isolated === false && isolationChecks === 1 ? 1 : 0 }] };
    }
    if (text.startsWith('SELECT * FROM create_lite_research_task')) return { rows: [{ task_id: 'task-1', created: true }] };
    if (text.includes('task.status AS task_status')) {
      if (values.join(',') !== 'task-1,research-1,data-1') return { rows: [] };
      return { rows: options.snapshotRows ?? [options.snapshot ?? durableSnapshot()] };
    }
    if (text.includes('research_accounting_rows')) return { rows: [options.finalAccounting ?? { accounting_rows: 1, accounting_basis: 'OBSERVED_USAGE', research_accounting_rows: 1, data_accounting_rows: 0, ledger_rows: ledger() }] };
    if (text.startsWith('SELECT count(*)::int AS accounting_rows')) return { rows: [{ accounting_rows: 1, accounting_basis: 'OBSERVED_USAGE', ledger_rows: ledger() }] };
    if (text.includes('AS data_reservations')) return { rows: [options.finalReservations ?? { unresolved_reservations: 0, data_reservations: 0 }] };
    if (text.startsWith("SELECT count(*) FILTER (WHERE status='RESERVED')")) return { rows: [{ unresolved_reservations: 0 }] };
    if (text.startsWith('SELECT cancel_task')) {
      if (options.cleanupFails) throw new Error('cleanup unavailable');
      return { rows: [{ cancelled: !options.cleanupRejected }] };
    }
    if (text.startsWith('SELECT status FROM tasks')) return { rows: [{ status: options.cleanupTaskStatus ?? 'RUNNING' }] };
    throw new Error('unexpected query: ' + text);
  };
  return { query, calls };
};
const run = ({ db = makeQuery(), research = liveResearch, data = dataExecution(), ...options } = {}) => runLiveResearchKernelGate({
  query: db.query, worker: { runTask: async () => research }, dataWorker: { runTask: async () => data },
  idempotencyKey: 'live-test-key', ...options,
});

test('production vertical proves sourced Research, canonical persisted Data, terminal task and zero Data spend', async () => {
  const db = makeQuery();
  const researchCalls = [];
  const dataCalls = [];
  const evidence = await runLiveResearchKernelGate({
    query: db.query,
    worker: { runTask: async (taskId) => { researchCalls.push(taskId); return liveResearch; } },
    dataWorker: { runTask: async (taskId) => { dataCalls.push(taskId); return dataExecution(); } },
    idempotencyKey: 'live-test-key', now: () => new Date('2026-10-11T21:00:00Z'),
  });
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.task_status, 'SUCCESS');
  assert.equal(evidence.research_status, 'SUCCESS');
  assert.equal(evidence.data_status, 'SUCCESS');
  assert.equal(evidence.data_mode, 'PRODUCTION_DATA');
  assert.equal(evidence.data_schema_version, 1);
  assert.equal(evidence.data_item_count, 1);
  assert.equal(evidence.accepted_data_item_count, 1);
  assert.equal(evidence.data_accounting_rows, 0);
  assert.equal(evidence.data_reservation_rows, 0);
  assert.equal(evidence.accounting_rows, 1);
  assert.equal(evidence.accounting_basis, 'OBSERVED_USAGE');
  assert.deepEqual(evidence.tools, ['web_search', 'web_fetch']);
  assert.deepEqual(researchCalls, ['task-1']);
  assert.deepEqual(dataCalls, ['task-1']);
  const persisted = db.calls.find((call) => call.text.includes('task.status AS task_status'));
  assert.deepEqual(persisted.values, ['task-1', 'research-1', 'data-1']);
  assert.match(persisted.text, /dependency\.task_id = task\.id AND dependency\.node_id = data\.id/);
  assert.match(persisted.text, /dependency\.parent_node_id = research\.id/);
  assert.equal(db.calls.some((call) => call.text.startsWith('SELECT cancel_task')), false);
  assert.equal(db.calls.some((call) => call.text.startsWith('SELECT finalize_task')), false);
  assert.equal(Object.hasOwn(evidence, 'ledger_rows'), false);
  const createCall = db.calls.find((call) => call.text.startsWith('SELECT * FROM create_lite_research_task'));
  assert.equal(createCall.values[0], 'live-test-key');
  assert.match(createCall.values[1], /deepseek-flash/);
  assert.doesNotMatch(createCall.values[1], /deepseek-v4-flash/);
  assert.deepEqual(JSON.parse(createCall.values[2]), request);
  assert.equal(createCall.values[4], 100_000);
  assert.equal(createCall.values[5], 4);
  assert.equal(createCall.values[6], '2026-10-11T21:10:00.000Z');
});

test('both task-scoped worker APIs are required before any queue, task, or model operation', async () => {
  for (const workers of [
    { worker: { runOnce: async () => liveResearch }, dataWorker: { runTask: async () => dataExecution() } },
    { worker: { runTask: async () => liveResearch } },
    { worker: { runTask: async () => liveResearch }, dataWorker: { runOnce: async () => dataExecution() } },
  ]) {
    let queries = 0;
    await assert.rejects(() => runLiveResearchKernelGate({ query: async () => { queries += 1; return { rows: [] }; }, ...workers, idempotencyKey: 'test' }), TypeError);
    assert.equal(queries, 0);
  }
});

test('production gate preserves queue isolation before any task creation or worker execution', async () => {
  const db = makeQuery({ isolated: false });
  let workers = 0;
  await assert.rejects(() => runLiveResearchKernelGate({
    query: db.query, worker: { runTask: async () => { workers += 1; } }, dataWorker: { runTask: async () => { workers += 1; } }, idempotencyKey: 'test',
  }), (error) => error.code === 'LIVE_QUEUE_NOT_ISOLATED');
  assert.equal(workers, 0);
  assert.equal(db.calls.some((call) => call.text.startsWith('SELECT * FROM create_lite_research_task')), false);
});

test('upstream source, required-domain, field provenance and real web-tool checks remain fail-closed', async () => {
  for (const [mutate, code] of [
    [(research) => { research.result.sources[0].url = 'https://deepseek.com.example.org/post'; }, 'LIVE_OFFICIAL_SOURCE_NOT_PROVEN'],
    [(research) => { research.result.sources[0].url = 'https://www.deepseek.com/post'; }, 'LIVE_REQUIRED_DOMAIN_SOURCE_NOT_PROVEN'],
    [(research) => { delete research.result.items[0].data.modelVersion; }, 'LIVE_REQUIRED_FIELDS_NOT_PROVEN'],
    [(research) => { research.result.sources.push({ id: 's2', url: 'https://example.org/model', checkedAt: '2026-10-11' }); research.result.items[0].sourceIds = ['s2']; }, 'LIVE_REQUIRED_FIELDS_NOT_PROVEN'],
    [(research) => { research.telemetry.toolSummary.tools = ['web_search']; }, 'LIVE_WEB_TOOLS_NOT_PROVEN'],
  ]) {
    const db = makeQuery();
    const changed = structuredClone(liveResearch);
    mutate(changed.execution.research);
    await assert.rejects(() => run({ db, research: changed }), (error) => error.code === code);
    assert.ok(db.calls.some((call) => call.text.startsWith('SELECT cancel_task')));
  }
});

test('Data IDLE or misrouted task, agent and node cannot certify the production vertical', async () => {
  for (const changed of [
    { status: 'IDLE' },
    { ...dataExecution(), claim: { taskId: 'task-2', nodeId: 'data-1', agentId: 'data' } },
    { ...dataExecution(), claim: { taskId: 'task-1', nodeId: 'data-1', agentId: 'researcher' } },
  ]) await assert.rejects(() => run({ data: changed }), (error) => error.code === 'LIVE_DATA_CLAIM_MISMATCH');
  const wrongNode = dataExecution();
  wrongNode.claim.nodeId = 'another-data-node';
  await assert.rejects(() => run({ data: wrongNode }), (error) => error.code === 'LIVE_DATA_PERSISTENCE_NOT_PROVEN');
});

test('successful Data node with failed task never produces a successful vertical', async () => {
  const changed = dataExecution();
  changed.execution.taskStatus = 'FAIL_WITH_EVIDENCE';
  await assert.rejects(() => run({ data: changed }), (error) => error.code === 'LIVE_TASK_NOT_SUCCESS');
  changed.execution.taskStatus = 'SUCCESS';
  changed.execution.nodeStatus = 'FAIL_WITH_EVIDENCE';
  await assert.rejects(() => run({ data: changed }), (error) => error.code === 'LIVE_DATA_NOT_SUCCESS');
});

test('gate-only stub and unsupported Data schema are rejected before durable proof', async () => {
  for (const result of [{ status: 'SUCCESS', mode: 'DETERMINISTIC_LIVE_GATE_COMPLETION' }, { ...canonical(), schemaVersion: 2 }]) {
    const changed = dataExecution();
    changed.execution.result = result;
    await assert.rejects(() => run({ data: changed }), (error) => error.code === 'LIVE_DATA_OUTPUT_INVALID');
  }
});

test('absent or ambiguous persisted dependency cannot certify Data output', async () => {
  for (const rows of [[], [durableSnapshot(), durableSnapshot()]]) {
    await assert.rejects(() => run({ db: makeQuery({ snapshotRows: rows }) }), (error) => error.code === 'LIVE_DATA_PERSISTENCE_NOT_PROVEN');
  }
});

test('durable task, node states, terminal reason and canonical DAG must all match', async () => {
  for (const update of [
    { task_status: 'RUNNING' }, { terminal_reason: 'DEADLINE_EXCEEDED' }, { terminal_at: null },
    { data_status: 'RUNNING' }, { research_status: 'FAIL_WITH_EVIDENCE' }, { node_count: 3 }, { dependency_count: 0 },
  ]) await assert.rejects(() => run({ db: makeQuery({ snapshot: { ...durableSnapshot(), ...update } }) }), (error) => error.code === 'LIVE_TASK_NOT_SUCCESS');
});

test('raw returned and stored Data must exactly match canonical content without repairing array or record order', async () => {
  const returned = dataExecution();
  returned.execution.result.items[0].data.modelVersion = 'invented';
  await assert.rejects(() => run({ data: returned }), (error) => error.code === 'LIVE_DATA_CANONICAL_MISMATCH');
  for (const mutate of [
    (stored) => { stored.requiredFields.reverse(); },
    (stored) => { stored.items[0].id = ' model-1 '; },
    (stored) => { stored.items.push({ ...structuredClone(stored.items[0]), id: 'duplicate-id' }); },
    (stored) => { stored.mode = 'DETERMINISTIC_LIVE_GATE_COMPLETION'; },
  ]) {
    const snapshot = durableSnapshot();
    mutate(snapshot.data_result);
    const changed = dataExecution();
    changed.execution.result = structuredClone(snapshot.data_result);
    await assert.rejects(() => run({ data: changed, db: makeQuery({ snapshot }) }), (error) => error.code === 'LIVE_DATA_CANONICAL_MISMATCH');
  }
});

test('request weakening or persisted Research replacement cannot certify the executed vertical', async () => {
  const weakened = durableSnapshot();
  weakened.request_payload.requiredFields = ['modelId'];
  weakened.data_result = transformData({ requiredFields: ['modelId'], researchResult: weakened.research_result });
  const changedData = dataExecution();
  changedData.execution.result = weakened.data_result;
  await assert.rejects(() => run({ data: changedData, db: makeQuery({ snapshot: weakened }) }), (error) => error.code === 'LIVE_REQUEST_PERSISTENCE_MISMATCH');
  const replaced = durableSnapshot();
  replaced.research_result.items[0].data.modelVersion = 'replaced';
  replaced.data_result = transformData({ requiredFields: request.requiredFields, researchResult: replaced.research_result });
  changedData.execution.result = replaced.data_result;
  await assert.rejects(() => run({ data: changedData, db: makeQuery({ snapshot: replaced }) }), (error) => error.code === 'LIVE_RESEARCH_PERSISTENCE_MISMATCH');
});

test('malformed persisted Data fails its output schema', async () => {
  const snapshot = durableSnapshot();
  snapshot.data_result.schemaVersion = 2;
  await assert.rejects(() => run({ db: makeQuery({ snapshot }) }), (error) => error.code === 'LIVE_DATA_OUTPUT_INVALID');
});

test('JSONB object-key reordering does not change canonical proof', async () => {
  const reverseKeys = (value) => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(reverseKeys);
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  };
  const result = await run({ db: makeQuery({ snapshot: reverseKeys(durableSnapshot()) }) });
  assert.equal(result.data_mode, 'PRODUCTION_DATA');
});

test('Data cannot add or mutate model ledger rows, including in-place cost changes', async () => {
  const modifiedLedger = ledger();
  modifiedLedger[0].cost_usd = 0.02;
  for (const finalAccounting of [
    { accounting_rows: 2, accounting_basis: 'OBSERVED_USAGE', research_accounting_rows: 1, data_accounting_rows: 1, ledger_rows: ledger() },
    { accounting_rows: 1, accounting_basis: 'OBSERVED_USAGE', research_accounting_rows: 0, data_accounting_rows: 1, ledger_rows: ledger() },
    { accounting_rows: 1, accounting_basis: 'RESERVATION_FALLBACK', research_accounting_rows: 1, data_accounting_rows: 0, ledger_rows: ledger() },
    { accounting_rows: 1, accounting_basis: 'OBSERVED_USAGE', research_accounting_rows: 1, data_accounting_rows: 0, ledger_rows: modifiedLedger },
  ]) await assert.rejects(() => run({ db: makeQuery({ finalAccounting }) }), (error) => error.code === 'LIVE_DATA_ACCOUNTING_INVALID');
  for (const update of [{ cost_reconciled: false }, { tokens_reconciled: false }, { current_steps: 3 }]) {
    await assert.rejects(() => run({ db: makeQuery({ snapshot: { ...durableSnapshot(), ...update } }) }), (error) => error.code === 'LIVE_DATA_ACCOUNTING_INVALID');
  }
});

test('Data budget reservation rows, unresolved reserves and task counters remain zero', async () => {
  for (const finalReservations of [{ unresolved_reservations: 1, data_reservations: 0 }, { unresolved_reservations: 0, data_reservations: 1 }]) {
    await assert.rejects(() => run({ db: makeQuery({ finalReservations }) }), (error) => error.code === 'LIVE_DATA_RESERVATION_INVALID');
  }
  for (const update of [{ reserved_cost_usd: 0.01 }, { reserved_tokens: 1 }, { reserved_cost_usd: null },
    { research_reserved_cost_usd: 0.01 }, { research_reserved_tokens: 1 }, { data_reserved_cost_usd: 0.01 }, { data_reserved_tokens: 1 }]) {
    await assert.rejects(() => run({ db: makeQuery({ snapshot: { ...durableSnapshot(), ...update } }) }), (error) => error.code === 'LIVE_DATA_RESERVATION_INVALID');
  }
});

test('cleanup failures remain visible instead of silently leaving active gate state', async () => {
  for (const options of [{ cleanupFails: true }, { cleanupRejected: true }]) {
    const changed = structuredClone(liveResearch);
    changed.execution.research.telemetry.toolSummary.tools = ['web_search'];
    await assert.rejects(() => run({ db: makeQuery(options), research: changed }), (error) => error.code === 'LIVE_GATE_CLEANUP_FAILED' && error.originalCode === 'LIVE_WEB_TOOLS_NOT_PROVEN');
  }
});
