import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth } from '../src/health.mjs';

test('foundation health contract is stable', () => {
  assert.deepEqual(buildHealth(), {
    system: 'openclaw-v2',
    phase: 1,
    phase_name: 'foundation',
    status: 'PASS',
    schema_version: 1
  });
});
