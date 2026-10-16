import test from 'node:test';
import assert from 'node:assert/strict';

import { DeepSeekCatalogRefreshError, refreshDeepSeekModelCatalog } from '../../src/providers/deepseek-model-catalog.mjs';

const stateEnv = { OPENCLAW_STATE_DIR: '/tmp/openclaw-v2-state' };
const published = { status: 0, stdout: JSON.stringify({ models: [{ id: 'deepseek-flash', provider: 'deepseek' }] }), stderr: '' };

test('stored-agent catalog refresh selects main and excludes every ambient credential/config surface', () => {
  let invocation;
  const result = refreshDeepSeekModelCatalog({
    model: 'deepseek/deepseek-flash',
    env: { ...stateEnv, PATH: '/usr/bin', NODE_USE_ENV_PROXY: '1', DEEPSEEK_API_KEY: 'must-not-pass',
      DATABASE_URL: 'must-not-pass', GITHUB_TOKEN: 'must-not-pass', OPENAI_API_KEY: 'must-not-pass',
      OPENCLAW_CONFIG_PATH: '/untrusted/config' },
    spawnSyncImpl(executable, args, options) { invocation = { executable, args, options }; return published; },
  });
  assert.deepEqual(result, { provider: 'deepseek', model: 'deepseek/deepseek-flash', refreshed: true });
  assert.equal(invocation.executable, 'openclaw');
  assert.deepEqual(invocation.args, ['models', 'list', '--refresh', '--provider', 'deepseek', '--agent', 'main', '--json']);
  assert.deepEqual(invocation.options.env, { PATH: '/usr/bin', NODE_USE_ENV_PROXY: '1', ...stateEnv });
});

test('explicit environment mode supports independent provider smoke with only the DeepSeek credential', () => {
  let childEnv;
  refreshDeepSeekModelCatalog({
    credentialMode: 'environment',
    env: { DEEPSEEK_API_KEY: 'provider-smoke-fixture', OPENAI_API_KEY: 'must-not-pass', DATABASE_URL: 'must-not-pass', PATH: '/usr/bin' },
    spawnSyncImpl(_executable, _args, options) { childEnv = options.env; return published; },
  });
  assert.deepEqual(childEnv, { PATH: '/usr/bin', DEEPSEEK_API_KEY: 'provider-smoke-fixture' });
});

test('missing credentials or trust scope and unsupported credential modes fail before catalog execution', () => {
  for (const options of [
    { env: {} }, { env: { OPENCLAW_STATE_DIR: 'relative' } },
    { credentialMode: 'environment', env: {} }, { credentialMode: 'unknown', env: stateEnv },
  ]) {
    let spawned = false;
    assert.throws(() => refreshDeepSeekModelCatalog({ ...options, spawnSyncImpl() { spawned = true; return published; } }), TypeError);
    assert.equal(spawned, false);
  }
});

test('published fallback is not live discovery even when CLI exits zero and model is listed', () => {
  for (const stderr of [
    'fetch timeout. Model discovery could not refresh all providers. Showing available published model list.',
    'Model discovery could not refresh all providers.',
    'Failed to refresh model catalog',
  ]) assert.throws(() => refreshDeepSeekModelCatalog({ env: stateEnv, spawnSyncImpl: () => ({ ...published, stderr }) }),
    (error) => error instanceof DeepSeekCatalogRefreshError && error.code === 'DEEPSEEK_CATALOG_DISCOVERY_FAILED');
});

test('fails closed when requested DeepSeek model is absent after refresh', () => {
  assert.throws(() => refreshDeepSeekModelCatalog({ env: stateEnv,
    spawnSyncImpl: () => ({ ...published, stdout: JSON.stringify({ models: [{ id: 'deepseek-v4-pro', provider: 'deepseek' }] }) }),
  }), (error) => error instanceof DeepSeekCatalogRefreshError && error.code === 'DEEPSEEK_MODEL_NOT_DISCOVERED');
});

test('accepts only an available DeepSeek model record in the CLI models array', () => {
  for (const record of [
    { key: 'deepseek/deepseek-flash', provider: 'deepseek', available: true },
    { id: 'deepseek-flash' },
    { model: 'deepseek/deepseek-flash', available: true },
  ]) {
    const result = refreshDeepSeekModelCatalog({ env: stateEnv,
      spawnSyncImpl: () => ({ ...published, stdout: JSON.stringify({ models: [record] }) }),
    });
    assert.equal(result.refreshed, true);
  }
});

test('model names in metadata, wrong-provider records and unavailable records do not prove discovery', () => {
  for (const catalog of [
    { error: 'deepseek-flash' },
    { models: [], metadata: { model: 'deepseek/deepseek-flash' } },
    { models: [{ name: 'deepseek-flash' }] },
    { models: [{ metadata: { id: 'deepseek-flash' } }] },
    { models: { 'deepseek/deepseek-flash': { available: true } } },
    { models: [{ key: 'deepseek/deepseek-flash', provider: 'openai' }] },
    { models: [{ id: 'deepseek-flash', provider: null }] },
    { models: [{ model: 'deepseek-flash', provider: 'deepseek', available: false }] },
  ]) assert.throws(() => refreshDeepSeekModelCatalog({ env: stateEnv,
    spawnSyncImpl: () => ({ ...published, stdout: JSON.stringify(catalog) }),
  }), (error) => error instanceof DeepSeekCatalogRefreshError && error.code === 'DEEPSEEK_MODEL_NOT_DISCOVERED');
});

test('redacts API key material from catalog refresh process failures', () => {
  const secret = 'nonstandard-provider-fixture-value';
  assert.throws(() => refreshDeepSeekModelCatalog({ credentialMode: 'environment', env: { DEEPSEEK_API_KEY: secret },
    spawnSyncImpl: () => ({ status: 9, stdout: '', stderr: `provider rejected ${secret} and sk-catalog-secret-1234` }),
  }), (error) => error instanceof DeepSeekCatalogRefreshError && error.code === 'DEEPSEEK_CATALOG_REFRESH_NONZERO'
    && !error.message.includes(secret) && !error.message.includes('sk-catalog-secret-1234') && error.message.includes('[REDACTED]'));
});
