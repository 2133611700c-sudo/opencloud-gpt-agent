import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProductionResearchWorker } from '../../src/research/research-production-wiring.mjs';

const optionsFor = (stateDir, queriedRef) => ({
  query: async () => { queriedRef.value = true; return { rows: [] }; },
  workerId: 'trust-root-worker',
  pricingVersion: 'pricing-v1',
  estimateReservation: async () => ({ costUsd: 0.1, tokens: 100 }),
  researchEnv: { DEEPSEEK_API_KEY: 'test-secret', OPENCLAW_STATE_DIR: stateDir },
});

test('production native preflight accepts an existing private trust root before any claim', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-v2-secure-root-'));
  const queried = { value: false };
  try {
    const worker = createProductionResearchWorker(optionsFor(root, queried));
    assert.equal(worker.workerId, 'trust-root-worker');
    assert.equal(queried.value, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production native preflight rejects missing absolute trust root before any claim', () => {
  const parent = mkdtempSync(join(tmpdir(), 'openclaw-v2-missing-root-'));
  const queried = { value: false };
  try {
    const missing = join(parent, 'does-not-exist');
    assert.throws(
      () => createProductionResearchWorker(optionsFor(missing, queried)),
      (error) => error?.code === 'INVALID_OPENCLAW_STATE_DIR',
    );
    assert.equal(queried.value, false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('production native preflight rejects group/world-accessible trust root before any claim', () => {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-v2-insecure-root-'));
  const queried = { value: false };
  try {
    chmodSync(root, 0o755);
    assert.throws(
      () => createProductionResearchWorker(optionsFor(root, queried)),
      (error) => error?.code === 'INVALID_OPENCLAW_STATE_DIR',
    );
    assert.equal(queried.value, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
