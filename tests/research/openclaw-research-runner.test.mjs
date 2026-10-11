import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  ResearchRunnerError,
  buildResearchChildEnv,
  parseResearchAgentEnvelope,
  runResearchAgent,
} from '../../src/research/openclaw-research-runner.mjs';

const request = {
  goal: 'Find one current listing',
  maxResults: 1,
  constraints: { state: 'CA' },
  requiredFields: ['price'],
};

const finalSuccess = () => ({
  status: 'SUCCESS',
  summary: 'One verified listing.',
  confidence: 'HIGH',
  sources: [{
    id: 's1',
    url: 'https://example.com/listing',
    title: 'Listing',
    checkedAt: '2026-10-11T17:45:00Z',
  }],
  items: [{ id: 'i1', title: 'Vehicle', data: { price: 40000 }, sourceIds: ['s1'] }],
  needsBrowser: [],
});

const successEnvelope = (overrides = {}) => ({
  ok: true,
  status: 'ok',
  final: JSON.stringify(finalSuccess()),
  provider: 'deepseek',
  model: 'deepseek-flash',
  usage: { input: 100, output: 25, total: 125 },
  costUsd: 0.0012,
  codeModeEngaged: false,
  toolSummary: {
    calls: 2,
    tools: ['web_search', 'web_fetch'],
    totalToolTimeMs: 50,
  },
  sessionId: 'session-test',
  ...overrides,
});

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
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
}

function successfulSpawn(capture, envelope) {
  return (executable, args, options) => {
    capture.executable = executable;
    capture.args = args;
    capture.options = options;
    const child = makeFakeChild();
    const stdinChunks = [];
    child.stdin.on('data', (chunk) => stdinChunks.push(Buffer.from(chunk)));
    child.stdin.on('end', () => {
      capture.stdin = Buffer.concat(stdinChunks).toString('utf8');
    });
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify(envelope));
      child.emit('close', 0, null);
    });
    return child;
  };
}

test('parses a successful DeepSeek web research envelope and validates final evidence', () => {
  const parsed = parseResearchAgentEnvelope(JSON.stringify(successEnvelope()), {
    requestedModel: 'deepseek/deepseek-flash',
  });

  assert.equal(parsed.provider, 'deepseek');
  assert.equal(parsed.model, 'deepseek/deepseek-flash');
  assert.equal(parsed.result.status, 'SUCCESS');
  assert.deepEqual(parsed.toolSummary.tools, ['web_search', 'web_fetch']);
  assert.deepEqual(parsed.usage, { input: 100, output: 25, total: 125 });
  assert.equal(parsed.costUsd, 0.0012);
});

test('accepts omitted usage without inventing telemetry', () => {
  const envelope = successEnvelope();
  delete envelope.usage;
  const parsed = parseResearchAgentEnvelope(JSON.stringify(envelope), {
    requestedModel: 'deepseek/deepseek-flash',
  });
  assert.equal(parsed.usage, null);
  assert.equal(parsed.telemetryStatus, 'NOT_EXPOSED');
});

test('rejects provider or model mismatch', () => {
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ provider: 'openai' })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error instanceof ResearchRunnerError && error.code === 'PROVIDER_MISMATCH',
  );
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ model: 'other-model' })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error instanceof ResearchRunnerError && error.code === 'MODEL_MISMATCH',
  );
});

test('rejects code mode or any unexpected tool attestation', () => {
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ codeModeEngaged: true })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error.code === 'UNEXPECTED_CODE_MODE',
  );
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({
      toolSummary: { calls: 3, tools: ['web_search', 'web_fetch', 'exec'], totalToolTimeMs: 60 },
    })), { requestedModel: 'deepseek/deepseek-flash' }),
    (error) => error.code === 'UNEXPECTED_TOOL',
  );
});

test('requires web_search for all research and web_fetch for SUCCESS', () => {
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({
      toolSummary: { calls: 1, tools: ['web_fetch'], totalToolTimeMs: 20 },
    })), { requestedModel: 'deepseek/deepseek-flash' }),
    (error) => error.code === 'WEB_SEARCH_NOT_ATTESTED',
  );
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({
      toolSummary: { calls: 1, tools: ['web_search'], totalToolTimeMs: 20 },
    })), { requestedModel: 'deepseek/deepseek-flash' }),
    (error) => error.code === 'WEB_FETCH_NOT_ATTESTED',
  );
});

test('rejects malformed final JSON and unsourced research output', () => {
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ final: '{bad-json' })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error.code === 'INVALID_FINAL_JSON',
  );

  const unsourced = finalSuccess();
  unsourced.items[0].sourceIds = [];
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ final: JSON.stringify(unsourced) })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error.code === 'INVALID_RESEARCH_RESULT',
  );
});

test('rejects inconsistent usage and malformed cost telemetry', () => {
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({
      usage: { input: 10, output: 5, total: 99 },
    })), { requestedModel: 'deepseek/deepseek-flash' }),
    (error) => error.code === 'INVALID_USAGE',
  );
  assert.throws(
    () => parseResearchAgentEnvelope(JSON.stringify(successEnvelope({ costUsd: -1 })), {
      requestedModel: 'deepseek/deepseek-flash',
    }),
    (error) => error.code === 'INVALID_COST',
  );
});

test('child environment is allowlisted and excludes unrelated secrets', () => {
  const env = buildResearchChildEnv({
    PATH: '/usr/bin',
    HOME: '/home/test',
    DEEPSEEK_API_KEY: 'test-key',
    DATABASE_URL: 'postgres://secret',
    GITHUB_TOKEN: 'github-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
  }, '/tmp/openclaw-v2-state');

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/test');
  assert.equal(env.DEEPSEEK_API_KEY, 'test-key');
  assert.equal(env.OPENCLAW_STATE_DIR, '/tmp/openclaw-v2-state');
  assert.equal(env.OPENCLAW_EXEC_SHELL_SNAPSHOT, '0');
  assert.equal('DATABASE_URL' in env, false);
  assert.equal('GITHUB_TOKEN' in env, false);
  assert.equal('AWS_SECRET_ACCESS_KEY' in env, false);
});

test('fails before spawn when DeepSeek credential is missing', async () => {
  let spawned = false;
  await assert.rejects(
    runResearchAgent({
      request,
      configPath: '/tmp/config.json',
      stateDir: '/tmp/state',
      env: {},
      spawnImpl: () => {
        spawned = true;
        return makeFakeChild();
      },
    }),
    (error) => error.code === 'MISSING_DEEPSEEK_API_KEY',
  );
  assert.equal(spawned, false);
});

test('spawns shell-free with sanitized env, exact stdin and parses success', async () => {
  const capture = {};
  const result = await runResearchAgent({
    request,
    configPath: '/tmp/config.json',
    stateDir: '/tmp/state',
    model: 'deepseek/deepseek-flash',
    env: {
      PATH: '/usr/bin',
      HOME: '/home/test',
      DEEPSEEK_API_KEY: 'test-key',
      DATABASE_URL: 'must-not-leak',
    },
    spawnImpl: successfulSpawn(capture, successEnvelope()),
  });

  assert.equal(capture.executable, 'openclaw');
  assert.equal(capture.options.shell, false);
  assert.deepEqual(capture.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(capture.options.env.OPENCLAW_STATE_DIR, '/tmp/state');
  assert.equal(capture.options.env.DEEPSEEK_API_KEY, 'test-key');
  assert.equal('DATABASE_URL' in capture.options.env, false);
  assert.match(capture.stdin, /UNTRUSTED DATA/);
  assert.match(capture.stdin, /Find one current listing/);
  assert.equal(result.result.status, 'SUCCESS');
  assert.equal(result.process.exitCode, 0);
});

test('redacts credential material from nonzero stderr', async () => {
  const secret = 'test-secret-value';
  const child = makeFakeChild();
  const promise = runResearchAgent({
    request,
    configPath: '/tmp/config.json',
    stateDir: '/tmp/state',
    env: { DEEPSEEK_API_KEY: secret },
    spawnImpl: () => child,
  });

  queueMicrotask(() => {
    child.stderr.end(`auth failed ${secret} and sk-abcdefghijk12345`);
    child.emit('close', 1, null);
  });

  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'NONZERO_EXIT');
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes('sk-abcdefghijk12345'), false);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test('classifies OpenClaw exit code 2 as agent timeout', async () => {
  const child = makeFakeChild();
  const promise = runResearchAgent({
    request,
    configPath: '/tmp/config.json',
    stateDir: '/tmp/state',
    env: { DEEPSEEK_API_KEY: 'test-key' },
    spawnImpl: () => child,
  });
  queueMicrotask(() => child.emit('close', 2, null));
  await assert.rejects(promise, (error) => error.code === 'AGENT_TIMEOUT');
});

test('kills process on local timeout, abort and output overflow', async (t) => {
  await t.test('timeout', async () => {
    const child = makeFakeChild();
    await assert.rejects(runResearchAgent({
      request,
      configPath: '/tmp/config.json',
      stateDir: '/tmp/state',
      env: { DEEPSEEK_API_KEY: 'test-key' },
      timeoutMs: 5,
      spawnImpl: () => child,
    }), (error) => error.code === 'TIMEOUT');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
  });

  await t.test('abort', async () => {
    const child = makeFakeChild();
    const controller = new AbortController();
    const promise = runResearchAgent({
      request,
      configPath: '/tmp/config.json',
      stateDir: '/tmp/state',
      env: { DEEPSEEK_API_KEY: 'test-key' },
      signal: controller.signal,
      spawnImpl: () => child,
    });
    controller.abort();
    await assert.rejects(promise, (error) => error.code === 'ABORTED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
  });

  await t.test('stdout overflow', async () => {
    const child = makeFakeChild();
    const promise = runResearchAgent({
      request,
      configPath: '/tmp/config.json',
      stateDir: '/tmp/state',
      env: { DEEPSEEK_API_KEY: 'test-key' },
      maxStdoutBytes: 5,
      spawnImpl: () => child,
    });
    queueMicrotask(() => child.stdout.write('123456'));
    await assert.rejects(promise, (error) => error.code === 'STDOUT_LIMIT_EXCEEDED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
  });
});
