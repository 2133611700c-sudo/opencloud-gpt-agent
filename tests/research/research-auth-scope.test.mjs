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
  verifyStoredDeepSeekAuth,
} from '../../src/research/research-auth-scope.mjs';

const storedAuth = () => ({
  agentId: 'main',
  provider: 'deepseek',
  profiles: [{ id: 'deepseek:manual', type: 'api_key', provider: 'deepseek' }],
});

test('parses the native stored DeepSeek API key profile for agent main', () => {
  const input = storedAuth();
  input.profiles[0].credentialHint = 'private profile hint';
  input.authPath = '/private/auth-store';
  const result = parseStoredDeepSeekAuth(JSON.stringify(input));
  assert.deepEqual(
    result,
    { agentId: 'main', provider: 'deepseek', profileId: 'deepseek:manual', type: 'api_key', profileCount: 1 },
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('rejects missing stored DeepSeek credentials', () => {
  assert.throws(
    () => parseStoredDeepSeekAuth(JSON.stringify({ ...storedAuth(), profiles: [] })),
    (error) => error instanceof ResearchAuthScopeError && error.code === 'STORED_DEEPSEEK_AUTH_MISSING',
  );
});

test('rejects malformed auth-list output', () => {
  for (const stdout of ['', '{bad', 'null', '[]', JSON.stringify({ agentId: 'main', provider: 'deepseek' }),
    JSON.stringify({ ...storedAuth(), profiles: {} })]) {
    assert.throws(
      () => parseStoredDeepSeekAuth(stdout),
      (error) => error instanceof ResearchAuthScopeError && error.code === 'AUTH_SCOPE_INVALID_OUTPUT',
    );
  }
});

test('rejects wrong agent, provider, profile identity or ambiguous stored profiles', () => {
  const cases = [
    [{ ...storedAuth(), agentId: 'researcher' }, 'AUTH_SCOPE_AGENT_MISMATCH'],
    [{ ...storedAuth(), agentId: undefined }, 'AUTH_SCOPE_AGENT_MISMATCH'],
    [{ ...storedAuth(), provider: 'openai' }, 'AUTH_SCOPE_PROVIDER_MISMATCH'],
    [{ ...storedAuth(), profiles: [{ id: 'deepseek:manual', type: 'api_key', provider: 'openai' }] }, 'AUTH_SCOPE_PROVIDER_MISMATCH'],
    [{ ...storedAuth(), profiles: [null] }, 'AUTH_SCOPE_PROFILE_MISMATCH'],
    [{ ...storedAuth(), profiles: [{}] }, 'AUTH_SCOPE_PROFILE_MISMATCH'],
    [{ ...storedAuth(), profiles: [{ id: 'deepseek:default', type: 'api_key', provider: 'deepseek' }] }, 'AUTH_SCOPE_PROFILE_MISMATCH'],
    [{ ...storedAuth(), profiles: [{ id: 'deepseek:manual', type: 'oauth', provider: 'deepseek' }] }, 'AUTH_SCOPE_PROFILE_MISMATCH'],
    [{ ...storedAuth(), profiles: [...storedAuth().profiles, ...storedAuth().profiles] }, 'AUTH_SCOPE_AMBIGUOUS_PROFILES'],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => parseStoredDeepSeekAuth(JSON.stringify(input)),
      (error) => error instanceof ResearchAuthScopeError && error.code === code,
    );
  }
});

test('auth probe child env is an allowlist and excludes every ambient credential/config surface', () => {
  const childEnv = buildResearchAuthProbeEnv({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    NODE_USE_ENV_PROXY: '1',
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
    NODE_USE_ENV_PROXY: '1',
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
      child.stdout.write(JSON.stringify(storedAuth()));
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0, null);
    });
    return child;
  };

  const result = await runOpenClawAuthProbe({
    env: {
      PATH: '/usr/bin',
      NODE_USE_ENV_PROXY: '1',
      OPENCLAW_STATE_DIR: '/tmp/state',
      DEEPSEEK_API_KEY: 'must-not-propagate',
      OPENAI_API_KEY: 'must-not-propagate',
    },
    spawnImpl,
  });
  assert.deepEqual(JSON.parse(result.stdout), storedAuth());
  assert.equal(invocation.executable, 'openclaw');
  const expectedArgs = ['models', 'auth', 'list', '--provider', 'deepseek', '--agent', 'main', '--json'];
  assert.deepEqual([...RESEARCH_AUTH_PROBE_ARGS], expectedArgs);
  assert.deepEqual(invocation.args, expectedArgs);
  assert.deepEqual(invocation.options.env, {
    PATH: '/usr/bin',
    NODE_USE_ENV_PROXY: '1',
    OPENCLAW_STATE_DIR: '/tmp/state',
  });
  assert.equal(invocation.options.stdio[0], 'ignore');
});

test('verifyStoredDeepSeekAuth fails closed when the command layer fails', async () => {
  await assert.rejects(
    () => verifyStoredDeepSeekAuth({
      env: { OPENCLAW_STATE_DIR: '/tmp/state' },
      runCommand: async () => { throw new Error('transport failed'); },
    }),
    (error) => error instanceof ResearchAuthScopeError && error.code === 'AUTH_SCOPE_CHECK_FAILED',
  );
});
