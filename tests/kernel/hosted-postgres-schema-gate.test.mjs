import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyHostedPostgresSchema } from '../../src/kernel/hosted-postgres-schema-gate.mjs';

test('hosted schema gate passes only the complete Kernel + fallback contract', async () => {
  const calls = [];
  const result = await verifyHostedPostgresSchema({
    query: async (text, values = []) => {
      calls.push({ text, values });
      return { rows: [{ core_tables: 10, core_functions: 21, accounting_fallback_columns: 4 }] };
    },
  });
  assert.deepEqual(result, { status: 'PASS', core_tables: 10, core_functions: 21, accounting_fallback_columns: 4 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, []);
  assert.match(calls[0].text, /claim_node_for_task_and_agent/);
  assert.match(calls[0].text, /record_llm_call_reservation_fallback/);
  assert.match(calls[0].text, /runtime_receipts/);
  assert.match(calls[0].text, /record_runtime_receipt_v1/);
  assert.match(calls[0].text, /record_llm_call_with_runtime_receipt_v1/);
  assert.match(calls[0].text, /load_terminal_evidence_input_v2/);
  assert.match(calls[0].text, /accounting_basis/);
  assert.match(calls[0].text, /reconciliation_reason/);
});

test('hosted schema gate exposes exact counts on drift', async () => {
  await assert.rejects(() => verifyHostedPostgresSchema({
    query: async () => ({ rows: [{ core_tables: 10, core_functions: 20, accounting_fallback_columns: 2 }] }),
  }), (error) => {
    assert.equal(error?.code, 'HOSTED_POSTGRES_SCHEMA_MISMATCH');
    assert.deepEqual(error?.counts, { core_tables: 10, core_functions: 20, accounting_fallback_columns: 2 });
    return true;
  });
});
