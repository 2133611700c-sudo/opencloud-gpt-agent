import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresDataAdapter } from '../../src/data/postgres-data-adapter.mjs';

const claim = { nodeId: 'node', taskId: 'task', workerId: 'worker', leaseToken: 'lease' };

test('Data adapter loads authoritative dependency output and task fields under the exact claim', async () => {
  const calls = [];
  const researchResult = { status: 'SUCCESS', items: [], sources: [] };
  const kernel = createPostgresDataAdapter({ query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [{ required_fields: ['price'], research_result: researchResult }] };
  } });
  assert.deepEqual(await kernel.loadInput(claim), { requiredFields: ['price'], researchResult });
  assert.deepEqual(calls[0].values, ['node', 'task', 'worker', 'lease']);
  assert.match(calls[0].text, /task\.request_payload -> 'requiredFields'/);
  assert.match(calls[0].text, /parent\.output_data AS research_result/);
  assert.match(calls[0].text, /parent\.task_id = dependency\.task_id AND parent\.id = dependency\.parent_node_id/);
  assert.match(calls[0].text, /child\.lease_token = \$4::uuid AND child\.lease_until > NOW\(\)/);
  assert.match(calls[0].text, /task\.deadline_at > NOW\(\)/);
});

test('Data adapter refuses absent or ambiguous dependency results', async () => {
  for (const rows of [[], [{}, {}]]) {
    const kernel = createPostgresDataAdapter({ query: async () => ({ rows }) });
    assert.equal(await kernel.loadInput(claim), null);
  }
});

test('Data adapter defaults only nullish required fields and preserves malformed types for validation', async () => {
  for (const fields of [undefined, null, false, 'price', { field: 'price' }, []]) {
    const kernel = createPostgresDataAdapter({ query: async () => ({ rows: [{ required_fields: fields, research_result: {} }] }) });
    const result = await kernel.loadInput(claim);
    assert.deepEqual(result.requiredFields, fields ?? []);
  }
});

test('Data adapter delegates explicit task finalization and fails closed on missing status', async () => {
  const calls = [];
  const kernel = createPostgresDataAdapter({ query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [{ task_status: 'FAIL_WITH_EVIDENCE' }] };
  } });
  assert.equal(await kernel.finalizeTask('task'), 'FAIL_WITH_EVIDENCE');
  assert.deepEqual(calls, [{ text: 'SELECT finalize_task($1) AS task_status', values: ['task'] }]);
  const empty = createPostgresDataAdapter({ query: async () => ({ rows: [] }) });
  assert.equal(await empty.finalizeTask('task'), null);
});

test('Data adapter exposes fenced execution capabilities without model accounting or budget reservation', () => {
  const kernel = createPostgresDataAdapter({ query: async () => ({ rows: [] }) });
  assert.deepEqual(Object.keys(kernel).sort(), [
    'claimNextNodeForAgent', 'claimNodeForTaskAndAgent', 'completeSuccess', 'failTerminal',
    'finalizeTask', 'heartbeat', 'loadInput',
  ]);
  assert.throws(() => createPostgresDataAdapter(), TypeError);
});
