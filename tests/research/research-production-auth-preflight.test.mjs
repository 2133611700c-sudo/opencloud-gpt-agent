import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';

const withStateRoot = async (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-v2-production-auth-'));
  chmodSync(root, 0o700);
  try { return await fn(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

const createNativeWorker = ({ root, query, verifyAuthScopeImpl }) => createProductionResearchWorker({
  query,
  workerId: 'research-auth-preflight',
  pricingVersion: 'pricing-v1',
  estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
  researchEnv: {
    PATH: process.env.PATH,
    DEEPSEEK_API_KEY: 'test-secret',
    OPENCLAW_STATE_DIR: root,
  },
  verifyAuthScopeImpl,
});

test('native runOnce rejects semantic stored-auth failure before any durable claim', async () => withStateRoot(async (root) => {
  const events = [];
  const failure = Object.assign(new Error('stored auth present'), { code: 'STORED_DEEPSEEK_AUTH_PRESENT' });
  const worker = createNativeWorker({
    root,
    query: async () => { events.push('query'); return { rows: [] }; },
    verifyAuthScopeImpl: async () => { events.push('verify'); throw failure; },
  });

  await assert.rejects(() => worker.runOnce(), failure);
  assert.deepEqual(events, ['verify']);
}));

test('native task-scoped Research verifies auth before task-scoped claim', async () => withStateRoot(async (root) => {
  const events = [];
  const worker = createNativeWorker({
    root,
    query: async (text, values) => {
      events.push(['query', text, values]);
      return { rows: [] };
    },
    verifyAuthScopeImpl: async ({ env }) => {
      events.push(['verify', env.OPENCLAW_STATE_DIR]);
      return { provider: 'deepseek', profileCount: 0 };
    },
  });

  const result = await worker.runTask('task-expected');
  assert.equal(result.status, 'IDLE');
  assert.deepEqual(events[0], ['verify', root]);
  assert.match(events[1][1], /^SELECT \* FROM claim_node_for_task_and_agent/);
  assert.deepEqual(events[1][2], ['task-expected', 'research-auth-preflight', 'researcher', 30]);
}));
