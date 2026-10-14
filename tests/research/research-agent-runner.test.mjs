import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  MissingResearchCredentialError,
  ResearchAgentProcessError,
  ResearchTrustRootError,
  buildResearchChildEnv,
  getRejectedResearchBilling,
  runResearchAgent,
} from '../../src/research/research-agent-runner.mjs';

const request = { goal: 'Find five current listings', maxResults: 5, requiredFields: ['price', 'dealer'] };
const finalResult = {
  status: 'SUCCESS', summary: 'Verified result.', confidence: 'HIGH',
  sources: [{ id: 's1', url: 'https://example.com/item', checkedAt: '2026-10-11T17:45:00-05:00' }],
  items: [{ id: 'i1', title: 'Item', data: { price: 42000 }, sourceIds: ['s1'] }], needsBrowser: [],
};
const agentEnvelope = (overrides = {}) => ({
  ok: true, status: 'ok', final: JSON.stringify(finalResult),
  usage: { input: 100, output: 30, total: 130 }, costUsd: 0.001, assistantTurns: 2,
  codeModeEngaged: false,
  toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], totalToolTimeMs: 50 },
  model: 'deepseek-flash', provider: 'deepseek', sessionId: 'session-1', ...overrides,
});

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.killed = false; child.killSignals = [];
  child.kill = (signal) => { child.killed = true; child.killSignals.push(signal); return true; };
  return child;
}
function isolatedRoot() { return mkdtempSync(join(tmpdir(), 'openclaw-v2-runner-test-')); }
const runnerStateRoot = isolatedRoot();
after(() => rmSync(runnerStateRoot, { recursive: true, force: true }));

function successfulSpawn(capture, root, envelope = agentEnvelope()) {
  return (executable, args, options) => {
    capture.executable = executable; capture.args = args; capture.options = options;
    const child = makeFakeChild(); capture.child = child; capture.stdin = '';
    child.stdin.on('data', (chunk) => { capture.stdin += chunk.toString('utf8'); });
    const configPath = args[args.indexOf('--config') + 1];
    capture.configPath = configPath; capture.configMode = statSync(configPath).mode & 0o777;
    capture.rootEntriesDuringSpawn = readdirSync(root);
    queueMicrotask(() => { child.stdout.end(JSON.stringify(envelope)); child.emit('close', 0, null); });
    return child;
  };
}
const baseEnv = () => ({
  DEEPSEEK_API_KEY: 'test-only-key', PATH: '/usr/bin', HOME: '/home/test',
  OPENCLAW_STATE_DIR: runnerStateRoot,
});

test('fails before temp config and spawn when DEEPSEEK_API_KEY is missing', async () => {
  const root = isolatedRoot(); let spawned = false;
  try {
    await assert.rejects(runResearchAgent({ request, env: {}, tempRoot: root, spawnImpl: () => { spawned = true; return makeFakeChild(); } }),
      (error) => error instanceof MissingResearchCredentialError && error.code === 'MISSING_DEEPSEEK_API_KEY');
    assert.equal(spawned, false); assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fails before temp config and spawn when isolated OPENCLAW_STATE_DIR is missing or relative', async () => {
  for (const stateDir of [undefined, 'relative/openclaw-state']) {
    const root = isolatedRoot(); let spawned = false;
    try {
      const env = { DEEPSEEK_API_KEY: 'test-only-key' };
      if (stateDir !== undefined) env.OPENCLAW_STATE_DIR = stateDir;
      await assert.rejects(
        runResearchAgent({
          request,
          env,
          tempRoot: root,
          spawnImpl: () => { spawned = true; return makeFakeChild(); },
        }),
        (error) => error instanceof ResearchTrustRootError && error.code === 'INVALID_OPENCLAW_STATE_DIR',
      );
      assert.equal(spawned, false);
      assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('direct runner rejects group/world-accessible trust root before temp config and spawn', async () => {
  const root = isolatedRoot();
  const insecureStateRoot = isolatedRoot();
  let spawned = false;
  try {
    chmodSync(insecureStateRoot, 0o755);
    await assert.rejects(
      runResearchAgent({
        request,
        env: { ...baseEnv(), OPENCLAW_STATE_DIR: insecureStateRoot },
        tempRoot: root,
        spawnImpl: () => { spawned = true; return makeFakeChild(); },
      }),
      (error) => error instanceof ResearchTrustRootError && error.code === 'INVALID_OPENCLAW_STATE_DIR',
    );
    assert.equal(spawned, false);
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(insecureStateRoot, { recursive: true, force: true });
  }
});

test('child env preserves operator plugin root and excludes unrelated credentials', () => {
  const env = buildResearchChildEnv({
    ...baseEnv(), DATABASE_URL: 'postgres://must-not-leak', GITHUB_TOKEN: 'must-not-leak', AWS_SECRET_ACCESS_KEY: 'must-not-leak',
  });
  assert.equal(env.PATH, '/usr/bin'); assert.equal(env.HOME, '/home/test');
  assert.equal(env.DEEPSEEK_API_KEY, 'test-only-key');
  assert.equal(env.OPENCLAW_STATE_DIR, runnerStateRoot);
  assert.equal(env.OPENCLAW_CONFIG_READONLY, '1'); assert.equal(env.OPENCLAW_EXEC_SHELL_SNAPSHOT, '0');
  assert.equal('OPENCLAW_CONFIG_PATH' in env, false);
  assert.equal('DATABASE_URL' in env, false); assert.equal('GITHUB_TOKEN' in env, false); assert.equal('AWS_SECRET_ACCESS_KEY' in env, false);
});

test('runs shell-free with pinned 0600 config and native ephemeral OpenClaw run state', async () => {
  const root = isolatedRoot(); const capture = {};
  try {
    const result = await runResearchAgent({
      request, env: { ...baseEnv(), DATABASE_URL: 'must-not-leak' }, tempRoot: root,
      spawnImpl: successfulSpawn(capture, root),
    });
    assert.equal(capture.executable, 'openclaw'); assert.equal(capture.options.shell, false);
    assert.deepEqual(capture.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(capture.options.env.OPENCLAW_STATE_DIR, runnerStateRoot);
    assert.equal('DATABASE_URL' in capture.options.env, false);
    assert.equal(capture.args.includes('--state-dir'), false); assert.equal(capture.args.includes('--auth-env-only'), false);
    assert.equal(capture.args[capture.args.indexOf('--code-mode') + 1], 'direct');
    assert.equal(capture.args[capture.args.indexOf('--timeout') + 1], '115');
    assert.equal(capture.configMode, 0o600); assert.match(capture.stdin, /UNTRUSTED DATA/);
    assert.equal(result.result.status, 'SUCCESS'); assert.equal(result.process.exitCode, 0);
    assert.ok(Number.isInteger(result.process.latencyMs) && result.process.latencyMs >= 1 && result.process.latencyMs <= 2_147_483_647);
    assert.equal(existsSync(capture.configPath), false); assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('redacts key material from nonzero process error and removes temp config', async () => {
  const root = isolatedRoot(); const secret = 'test-secret-value'; let configPath; const child = makeFakeChild();
  try {
    const promise = runResearchAgent({ request, env: { ...baseEnv(), DEEPSEEK_API_KEY: secret }, tempRoot: root,
      spawnImpl: (_exe, args) => { configPath = args[args.indexOf('--config') + 1]; queueMicrotask(() => { child.stderr.end(`auth failed ${secret} and sk-abcdefghijk12345`); child.emit('close', 1, null); }); return child; } });
    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof ResearchAgentProcessError); assert.equal(error.code, 'NONZERO_EXIT');
      assert.equal(error.message.includes(secret), false); assert.equal(error.message.includes('sk-abcdefghijk12345'), false);
      assert.match(error.message, /\[REDACTED\]/); return true;
    });
    assert.equal(existsSync(configPath), false); assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maps OpenClaw exit code 2 to AGENT_TIMEOUT', async () => {
  const root = isolatedRoot(); const child = makeFakeChild();
  try {
    const promise = runResearchAgent({ request, env: baseEnv(), tempRoot: root,
      spawnImpl: () => { queueMicrotask(() => child.emit('close', 2, null)); return child; } });
    await assert.rejects(promise, (error) => error.code === 'AGENT_TIMEOUT'); assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('kills child on local timeout, AbortSignal and stdout overflow', async (t) => {
  await t.test('timeout', async () => {
    const root = isolatedRoot(); const child = makeFakeChild();
    try {
      await assert.rejects(runResearchAgent({ request, env: baseEnv(), tempRoot: root, timeoutMs: 10, spawnImpl: () => child }), (e) => e.code === 'TIMEOUT');
      assert.deepEqual(child.killSignals, ['SIGKILL']); assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  await t.test('abort', async () => {
    const root = isolatedRoot(); const child = makeFakeChild(); const controller = new AbortController(); let markSpawned;
    const spawned = new Promise((resolve) => { markSpawned = resolve; });
    try {
      const promise = runResearchAgent({ request, env: baseEnv(), tempRoot: root, signal: controller.signal,
        spawnImpl: () => { markSpawned(); return child; } });
      await spawned; controller.abort(); await assert.rejects(promise, (e) => e.code === 'ABORTED');
      assert.deepEqual(child.killSignals, ['SIGKILL']); assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  await t.test('stdout overflow', async () => {
    const root = isolatedRoot(); const child = makeFakeChild();
    try {
      const promise = runResearchAgent({ request, env: baseEnv(), tempRoot: root, maxStdoutBytes: 10,
        spawnImpl: () => { queueMicrotask(() => child.stdout.write('01234567890')); return child; } });
      await assert.rejects(promise, (e) => e.code === 'STDOUT_LIMIT_EXCEEDED');
      assert.deepEqual(child.killSignals, ['SIGKILL']); assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

test('zero exit still fails closed on invalid Research envelope', async () => {
  const root = isolatedRoot(); const capture = {};
  try {
    await assert.rejects(runResearchAgent({ request, env: baseEnv(), tempRoot: root,
      spawnImpl: successfulSpawn(capture, root, agentEnvelope({ toolSummary: { calls: 1, tools: ['web_search'], totalToolTimeMs: 1 } })) }),
      (error) => error instanceof ResearchAgentProcessError && error.code === 'INVALID_SUCCESS_ENVELOPE');
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('records measured native process duration with rounding and SQL INTEGER bounds', async (t) => {
  for (const [name, start, end, expected] of [
    ['fraction rounds up', 0, 37.25, 38], ['exact milliseconds', 10, 47, 37],
    ['submillisecond minimum', 10, 10.25, 1], ['equal timestamps minimum', 10, 10, 1],
    ['negative clock origin', -10, -9.25, 1],
    ['SQL INTEGER maximum', 0, 2_147_483_647, 2_147_483_647],
    ['fraction below maximum', 0, 2_147_483_646.25, 2_147_483_647],
  ]) await t.test(name, async () => {
    const root = isolatedRoot(); const capture = {}; let samples = 0;
    try {
      const result = await runResearchAgent({ request, env: baseEnv(), tempRoot: root,
        spawnImpl: successfulSpawn(capture, root), nowMs: () => {
          samples += 1;
          if (samples === 1) { assert.equal(capture.child, undefined, 'first sample precedes native spawn'); return start; }
          assert.ok(capture.child, 'second sample follows native runtime'); return end;
        },
      });
      assert.equal(samples, 2); assert.equal(result.process.latencyMs, expected);
      assert.equal(result.telemetry.toolSummary.totalToolTimeMs, 50, 'tool duration remains separate telemetry');
      assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

const assertInvalidLatency = (error) => {
  assert.ok(error instanceof ResearchAgentProcessError);
  assert.equal(error.code, 'INVALID_PROCESS_LATENCY');
  assert.equal(error.message, 'Research process latency measurement is invalid');
  assert.equal(error.cause, undefined);
  return true;
};

test('invalid clock configuration or start sample blocks spawn and cleans config', async (t) => {
  const secret = 'private clock failure sentinel';
  const cases = [
    ['nonfunction clock', 1], ['null clock', null],
    ['undefined sample', () => undefined], ['string sample', () => '0'],
    ['NaN sample', () => NaN], ['infinite sample', () => Infinity],
    ['throwing clock', () => { throw new Error(secret, { cause: new Error(secret) }); }],
  ];
  for (const [name, nowMs] of cases) await t.test(name, async () => {
    const root = isolatedRoot(); let spawned = false;
    try {
      await assert.rejects(runResearchAgent({ request, env: baseEnv(), tempRoot: root, nowMs,
        spawnImpl: () => { spawned = true; return makeFakeChild(); },
      }), assertInvalidLatency);
      assert.equal(spawned, false); assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

test('invalid end samples fail after runtime without leaking clock errors or retaining config', async (t) => {
  for (const [name, end] of [
    ['undefined', undefined], ['null', null], ['string', '37'], ['boolean', true],
    ['backwards', -1], ['NaN', NaN], ['infinity', Infinity],
    ['overflow', 2_147_483_648], ['rounding overflow', 2_147_483_647.25],
    ['throwing', () => { throw new Error('private clock failure', { cause: new Error('private cause') }); }],
  ]) await t.test(name, async () => {
    const root = isolatedRoot(); const capture = {}; let samples = 0;
    try {
      await assert.rejects(runResearchAgent({ request, env: baseEnv(), tempRoot: root,
        spawnImpl: successfulSpawn(capture, root), nowMs: () => {
          samples += 1; return samples === 1 ? 0 : typeof end === 'function' ? end() : end;
        },
      }), assertInvalidLatency);
      assert.ok(capture.child, 'the runtime did execute before invalid end telemetry');
      assert.equal(samples, 2); assert.equal(existsSync(capture.configPath), false);
      assert.deepEqual(readdirSync(root), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

test('duplicate close events do not resample or change settled process latency', async () => {
  const root = isolatedRoot(); const capture = {}; let samples = 0;
  try {
    const result = await runResearchAgent({ request, env: baseEnv(), tempRoot: root,
      spawnImpl: successfulSpawn(capture, root), nowMs: () => {
        samples += 1; if (samples > 2) throw new Error('unexpected third clock sample'); return samples === 1 ? 0 : 37.25;
      },
    });
    capture.child.emit('close', 0, null); capture.child.emit('close', 1, null);
    assert.equal(samples, 2); assert.equal(result.process.latencyMs, 38);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native rejected envelope exposes only branded immutable billing and measured latency', async () => {
  const root = isolatedRoot(); const capture = {}; let samples = 0;
  const rejected = agentEnvelope({ usage: { input: 100, output: 30, cacheRead: 0, cacheWrite: 0, total: 130 },
    toolSummary: { calls: 2, tools: ['web_search', 'web_fetch'], failures: 1,
      unresolvedError: { toolName: 'web_fetch', message: 'private tool sentinel' } }, reasoning: 'private reasoning sentinel' });
  try {
    await assert.rejects(runResearchAgent({ request, env: baseEnv(), tempRoot: root,
      spawnImpl: successfulSpawn(capture, root, rejected), nowMs: () => ++samples === 1 ? 0 : 37.25,
    }), (error) => {
      assert.equal(error.code, 'INVALID_SUCCESS_ENVELOPE'); assert.equal(error.cause, undefined);
      assert.match(error.message, /UNRESOLVED_WEB_TOOL_FAILURE/); assert.ok(!error.message.includes('private'));
      const capsule = getRejectedResearchBilling(error);
      assert.equal(capsule.originalCode, 'UNRESOLVED_WEB_TOOL_FAILURE');
      assert.equal(capsule.research.process.latencyMs, 38);
      assert.equal(capsule.research.telemetry.costUsd, 0.001);
      assert.equal(capsule.research.telemetry.usage.total, 130);
      assert.equal(Object.isFrozen(capsule), true); assert.equal(Object.isFrozen(capsule.research), true);
      assert.equal(Object.isFrozen(capsule.research.telemetry), true); assert.equal(Object.isFrozen(capsule.research.process), true);
      const serialized = JSON.stringify(capsule);
      for (const key of ['final', 'result', 'stdout', 'stderr', 'reasoning', 'toolSummary', 'cause']) assert.equal(serialized.includes(`"${key}"`), false);
      assert.equal(serialized.includes('private'), false);
      assert.equal(getRejectedResearchBilling(Object.assign(new Error('copied failure'), error)), null);
      return true;
    });
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native billing lookup does not read forged error properties or getters', () => {
  let reads = 0; const fake = {};
  for (const key of ['code', 'name', 'accountingResearch', 'rejectedResearchBilling', 'research', 'billing']) {
    Object.defineProperty(fake, key, { get() { reads += 1; throw new Error('forged getter detail'); } });
  }
  assert.equal(getRejectedResearchBilling(fake), null); assert.equal(reads, 0);
  assert.equal(getRejectedResearchBilling(new Proxy(fake, { get() { reads += 1; throw new Error('private proxy detail'); } })), null);
  assert.equal(getRejectedResearchBilling(new ResearchAgentProcessError('fake', { code: 'INVALID_SUCCESS_ENVELOPE' })), null);
  assert.equal(reads, 0);
});
