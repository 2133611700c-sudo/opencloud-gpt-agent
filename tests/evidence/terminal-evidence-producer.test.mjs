import assert from 'node:assert/strict';
import test from 'node:test';

import {
  persistTerminalEvidence,
  TerminalEvidenceProducerError,
} from '../../src/evidence/terminal-evidence-producer.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000007';
const at = '2026-10-14T10:00:00.123456Z';
const fingerprint = 'a'.repeat(64);
const snapshot = () => ({
  task: {
    id: taskId, goal: 'Persist terminal Evidence', request_payload: {}, status: 'CANCELLED',
    terminal_reason: 'USER_CANCELLED', terminal_detail: {}, budget_limit_usd: '1.000000',
    current_cost_usd: '0.000000', reserved_cost_usd: '0.000000', token_budget_limit: '100',
    current_tokens: '0', reserved_tokens: '0', max_total_steps: 4, current_steps: 0,
    created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00.123456Z',
  },
  nodes: [], dependencies: [], accounting: [], reservations: [], runtimeReceipts: [],
});

const makeStore = ({ mutateRead } = {}) => {
  const calls = [];
  let receipt = null;
  return {
    calls,
    store: {
      async loadInput(id) {
        calls.push(['load', id]);
        return { snapshot: snapshot(), snapshotSha256: fingerprint };
      },
      async persist(input) {
        calls.push(['persist', input]);
        receipt = {
          artifactId,
          taskId,
          uri: `artifact://postgres/${artifactId}`,
          serialized: input.artifact.serialized,
          sha256: input.artifact.sha256,
          sizeBytes: input.artifact.sizeBytes,
          bundle: input.artifact.bundle,
          createdAt: at,
          created: true,
        };
        return receipt;
      },
      async read(id) {
        calls.push(['read', id]);
        const durable = { ...receipt };
        delete durable.created;
        return mutateRead ? mutateRead(durable) : durable;
      },
    },
  };
};

test('producer derives one canonical artifact from captured snapshot and verifies durable read-back', async () => {
  const fixture = makeStore();
  const result = await persistTerminalEvidence({ store: fixture.store, taskId, sensitiveValues: ['do-not-store'] });
  assert.equal(result.artifactId, artifactId);
  assert.equal(result.created, true);
  assert.equal(result.bundle.task.id, taskId);
  assert.deepEqual(fixture.calls.map(([name]) => name), ['load', 'persist', 'read']);
  const persisted = fixture.calls[1][1];
  assert.equal(persisted.taskId, taskId);
  assert.equal(persisted.expectedSnapshotFingerprint, fingerprint);
  assert.deepEqual(persisted.sensitiveValues, ['do-not-store']);
  assert.equal(persisted.artifact.serialized, result.serialized);
  assert.equal(persisted.artifact.sha256, result.sha256);
});

test('producer fails closed when durable read-back identity or bytes differ', async () => {
  const fixture = makeStore({ mutateRead: (row) => ({ ...row, sha256: 'b'.repeat(64) }) });
  await assert.rejects(
    () => persistTerminalEvidence({ store: fixture.store, taskId }),
    (error) => error instanceof TerminalEvidenceProducerError
      && error.code === 'TERMINAL_EVIDENCE_READBACK_MISMATCH'
      && error.cause === undefined,
  );
  assert.deepEqual(fixture.calls.map(([name]) => name), ['load', 'persist', 'read']);
});

test('producer rejects malformed input and incomplete store capabilities', async () => {
  assert.throws(() => persistTerminalEvidence({ store: {}, taskId }), TypeError);
  const store = {
    loadInput: async () => ({ snapshot: null, snapshotSha256: fingerprint }),
    persist: async () => { throw new Error('must not persist'); },
    read: async () => { throw new Error('must not read'); },
  };
  await assert.rejects(
    () => persistTerminalEvidence({ store, taskId }),
    (error) => error instanceof TerminalEvidenceProducerError && error.code === 'TERMINAL_EVIDENCE_INPUT_INVALID',
  );
});
