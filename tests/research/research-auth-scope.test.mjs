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

test('auth probe child env omits the paid DeepSeek key', () => {
  const childEnv = buildResearchAuthProbeEnv({
    PATH: '/usr/bin',
    OPENCLAW_STATE_DIR: '/tmp/state',
    DEEPSEEK_API_KEY: 'must-not-propagate',
  });
  assert.equal(childEnv.DEEPSEEK_API_KEY, undefined);
  assert.equal(childEnv.OPENCLAW_STATE_DIR, '/tmp/state');
  assert.equal(childEnv.PATH, '/usr/bin');
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

test('runs the exact official OpenClaw stored-auth query without exposing the API key', async () => {
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
    env: { PATH: '/usr/bin', DEEPSEEK_API_KEY: 'must-not-propagate' },
    spawnImpl,
  });
  assert.match(result.stdout, /"profiles":\[\]/);
  assert.equal(invocation.executable, 'openclaw');
  assert.deepEqual(invocation.args, [...RESEARCH_AUTH_PROBE_ARGS]);
  assert.equal(invocation.options.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(invocation.options.stdio[0], 'ignore');
});

test('verifyNoStoredDeepSeekAuth fails closed when the command layer fails', async () => {
  await assert.rejects(
    () => verifyNoStoredDeepSeekAuth({
      runCommand: async () => { throw new Error('transport failed'); },
    }),
    (error) => error instanceof ResearchAuthScopeError && error.code === 'AUTH_SCOPE_CHECK_FAILED',
  );
});
