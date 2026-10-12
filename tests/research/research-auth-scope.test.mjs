import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  RESEARCH_AUTH_PROBE_ARGS,
  ResearchAuthScopeError,
  buildResearchAuthProbeEnv,
  parseStoredDeepSeekAuth,
  runOpenClawAuthProbe,
  verifyNoStoredDeepSeekAuth,
} from '../../src/research/research-auth-scope.mjs';

test('parses an empty stored DeepSeek profile set', () => {
  assert.deepEqual(
    parseStoredDeepSeekAuth(JSON.stringify({ provider: 'deepseek', profiles: [] })),
    { provider: 'deepseek', profileCount: 0 },
  );
});

test('rejects any stored DeepSeek profile', () => {
  assert.throws(
    () => parseStoredDeepSeekAuth(JSON.stringify({
      provider: 'deepseek',
      profiles: [{ id: 'deepseek:default', provider: 'deepseek', type: 'api_key' }],
    })),
    (error) => error instanceof ResearchAuthScopeError && error.code === 'STORED_DEEPSEEK_AUTH_PRESENT',
  );
});

test('rejects malformed or ambiguous auth-list output', () => {
  for (const stdout of ['', '{bad', JSON.stringify({ provider: 'deepseek' }), JSON.stringify({ provider: 'openai', profiles: [] })]) {
    assert.throws(
      () => parseStoredDeepSeekAuth(stdout),
      (error) => error instanceof ResearchAuthScopeError && [
        'AUTH_SCOPE_INVALID_OUTPUT',
        'AUTH_SCOPE_PROVIDER_MISMATCH',
      ].includes(error.code),
    );
  }
});

test('auth probe child env is an allowlist and excludes every ambient credential/config surface', () => {
  const childEnv = buildResearchAuthProbeEnv({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    OPENCLAW_STATE_DIR: '/tmp/state',
    DEEPSEEK_API_KEY: 'must-not-propagate',
    OPENAI_API_KEY: 'must-not-propagate',
    AWS_SECRET_ACCESS_KEY: 'must-not-propagate',
    DATABASE_URL: 'must-not-propagate',
    OPENCLAW_CONFIG_PATH: '/tmp/untrusted-config.json',
  });
  assert.deepEqual(childEnv, {
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    OPENCLAW_STATE_DIR: '/tmp/state',
  });
});

test('auth probe refuses to fall back to an ambient/default OpenClaw state root', () => {
  assert.throws(
    () => buildResearchAuthProbeEnv({ PATH: '/usr/bin' }),
    /OPENCLAW_STATE_DIR must be an absolute path/,
  );
  assert.throws(
    () => buildResearchAuthProbeEnv({ PATH: '/usr/bin', OPENCLAW_STATE_DIR: 'relative/state' }),
    /OPENCLAW_STATE_DIR must be an absolute path/,
  );
});

const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.killSignals = [];
  child.kill = (signal) => {
    child.killed = true;
    child.killSignals.push(signal);
    return true;
  };
  return child;
};

test('runs the exact official OpenClaw stored-auth query without exposing ambient secrets', async () => {
  const child = fakeChild();
  let invocation = null;
  const spawnImpl = (executable, args, options) => {
    invocation = { executable, args: [...args], options };
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({ provider: 'deepseek', profiles: [] }));
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0, null);
    });
    return child;
  };

  const result = await runOpenClawAuthProbe({
    env: {
      PATH: '/usr/bin',
      OPENCLAW_STATE_DIR: '/tmp/state',
      DEEPSEEK_API_KEY: 'must-not-propagate',
      OPENAI_API_KEY: 'must-not-propagate',
    },
    spawnImpl,
  });
  assert.match(result.stdout, /"profiles":\[\]/);
  assert.equal(invocation.executable, 'openclaw');
  assert.deepEqual(invocation.args, [...RESEARCH_AUTH_PROBE_ARGS]);
  assert.deepEqual(invocation.options.env, {
    PATH: '/usr/bin',
    OPENCLAW_STATE_DIR: '/tmp/state',
  });
  assert.equal(invocation.options.stdio[0], 'ignore');
});

test('verifyNoStoredDeepSeekAuth fails closed when the command layer fails', async () => {
  await assert.rejects(
    () => verifyNoStoredDeepSeekAuth({
      env: { OPENCLAW_STATE_DIR: '/tmp/state' },
      runCommand: async () => { throw new Error('transport failed'); },
    }),
    (error) => error instanceof ResearchAuthScopeError && error.code === 'AUTH_SCOPE_CHECK_FAILED',
  );
});
