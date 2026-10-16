import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DeepSeekCatalogRefreshError,
  refreshDeepSeekModelCatalog,
} from '../../src/providers/deepseek-model-catalog.mjs';

test('refreshes DeepSeek catalog in the current OpenClaw state and proves requested model discovery', () => {
  const calls = [];
  const result = refreshDeepSeekModelCatalog({
    model: 'deepseek/deepseek-flash',
    env: {
      OPENCLAW_STATE_DIR: '/tmp/openclaw-v2-state',
      DEEPSEEK_API_KEY: 'sk-test-secret-boundary-123456',
    },
    spawnSyncImpl(executable, args, options) {
      calls.push({ executable, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({ models: [{ id: 'deepseek-flash', provider: 'deepseek' }] }),
        stderr: '',
      };
    },
  });

  assert.deepEqual(result, {
    provider: 'deepseek',
    model: 'deepseek/deepseek-flash',
    refreshed: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'openclaw');
  assert.deepEqual(calls[0].args, ['models', 'list', '--refresh', '--provider', 'deepseek', '--json']);
  assert.equal(calls[0].options.env.OPENCLAW_STATE_DIR, '/tmp/openclaw-v2-state');
});

test('fails closed when requested DeepSeek model is absent after refresh', () => {
  assert.throws(
    () => refreshDeepSeekModelCatalog({
      spawnSyncImpl() {
        return {
          status: 0,
          stdout: JSON.stringify({ models: [{ id: 'deepseek-v4-pro', provider: 'deepseek' }] }),
          stderr: '',
        };
      },
    }),
    (error) => error instanceof DeepSeekCatalogRefreshError
      && error.code === 'DEEPSEEK_MODEL_NOT_DISCOVERED',
  );
});

test('redacts DeepSeek credential from catalog refresh process failures', () => {
  const secret = 'sk-test-secret-boundary-abcdef';
  assert.throws(
    () => refreshDeepSeekModelCatalog({
      env: { DEEPSEEK_API_KEY: secret },
      spawnSyncImpl() {
        return {
          status: 9,
          stdout: '',
          stderr: `provider rejected ${secret}`,
        };
      },
    }),
    (error) => error instanceof DeepSeekCatalogRefreshError
      && error.code === 'DEEPSEEK_CATALOG_REFRESH_NONZERO'
      && !error.message.includes(secret)
      && error.message.includes('[REDACTED]'),
  );
});
