import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  runDeepSeekInferSmoke,
  MissingDeepSeekCredentialError,
  DeepSeekSmokeProcessError,
  redactSensitiveText,
} from '../../src/providers/deepseek-smoke-runner.mjs';

function makeFakeChild() {
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
}

function successfulSpawn(capture, envelope) {
  return (executable, args, options) => {
    capture.executable = executable;
    capture.args = args;
    capture.options = options;
    const child = makeFakeChild();
    queueMicrotask(() => {
      child.stdout.end(JSON.stringify(envelope));
      child.emit('close', 0, null);
    });
    return child;
  };
}

test('fails before spawn when DEEPSEEK_API_KEY is missing', async () => {
  let spawned = false;
  await assert.rejects(
    runDeepSeekInferSmoke({
      model: 'deepseek/deepseek-flash',
      env: {},
      spawnImpl: () => {
        spawned = true;
        return makeFakeChild();
      },
    }),
    (error) => error instanceof MissingDeepSeekCredentialError
      && error.code === 'MISSING_DEEPSEEK_API_KEY',
  );
  assert.equal(spawned, false);
});

test('spawns OpenClaw without a shell and returns parsed success', async () => {
  const capture = {};
  const result = await runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: 'test-only-key', SAFE: '1' },
    spawnImpl: successfulSpawn(capture, {
      ok: true,
      capability: 'model.run',
      transport: 'local',
      provider: 'deepseek',
      model: 'deepseek-flash',
      outputs: [{ text: 'smoke-ok' }],
    }),
  });

  assert.equal(capture.executable, 'openclaw');
  assert.equal(capture.options.shell, false);
  assert.deepEqual(capture.options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(capture.options.env.DEEPSEEK_API_KEY, 'test-only-key');
  assert.equal(result.text, 'smoke-ok');
  assert.equal(result.process.exitCode, 0);
});

test('redacts supplied secret and sk-shaped tokens from nonzero stderr', async () => {
  const secret = 'test-secret-value';
  const child = makeFakeChild();
  const promise = runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: secret },
    spawnImpl: () => child,
  });

  queueMicrotask(() => {
    child.stderr.end(`auth failed ${secret} and sk-abcdefghijk12345`);
    child.emit('close', 1, null);
  });

  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DeepSeekSmokeProcessError);
    assert.equal(error.code, 'NONZERO_EXIT');
    assert.equal(error.exitCode, 1);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes('sk-abcdefghijk12345'), false);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});

test('kills the child and fails on stdout byte limit', async () => {
  const child = makeFakeChild();
  const promise = runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: 'test-only-key' },
    maxStdoutBytes: 10,
    spawnImpl: () => child,
  });

  queueMicrotask(() => child.stdout.write('01234567890'));

  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'STDOUT_LIMIT_EXCEEDED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
    return true;
  });
});

test('kills the child and fails on stderr byte limit', async () => {
  const child = makeFakeChild();
  const promise = runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: 'test-only-key' },
    maxStderrBytes: 5,
    spawnImpl: () => child,
  });

  queueMicrotask(() => child.stderr.write('123456'));

  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'STDERR_LIMIT_EXCEEDED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
    return true;
  });
});

test('kills the child and fails on timeout', async () => {
  const child = makeFakeChild();
  await assert.rejects(
    runDeepSeekInferSmoke({
      model: 'deepseek/deepseek-flash',
      env: { DEEPSEEK_API_KEY: 'test-only-key' },
      timeoutMs: 5,
      spawnImpl: () => child,
    }),
    (error) => error.code === 'TIMEOUT',
  );
  assert.deepEqual(child.killSignals, ['SIGKILL']);
});

test('kills the child and fails on AbortSignal', async () => {
  const child = makeFakeChild();
  const controller = new AbortController();
  const promise = runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: 'test-only-key' },
    signal: controller.signal,
    spawnImpl: () => child,
  });

  controller.abort();
  await assert.rejects(promise, (error) => error.code === 'ABORTED');
  assert.deepEqual(child.killSignals, ['SIGKILL']);
});

test('rejects invalid success envelopes after a zero exit', async () => {
  const child = makeFakeChild();
  const promise = runDeepSeekInferSmoke({
    model: 'deepseek/deepseek-flash',
    env: { DEEPSEEK_API_KEY: 'test-only-key' },
    spawnImpl: () => child,
  });

  queueMicrotask(() => {
    child.stdout.end('{bad json');
    child.emit('close', 0, null);
  });

  await assert.rejects(promise, (error) => error.code === 'INVALID_SUCCESS_ENVELOPE');
});

test('redaction helper handles exact secrets and real sk- prefix only', () => {
  const raw = 'token=secret-value other=sk-abcdefghijk123 not-a-secret skill-name';
  const clean = redactSensitiveText(raw, ['secret-value']);
  assert.equal(clean.includes('secret-value'), false);
  assert.equal(clean.includes('sk-abcdefghijk123'), false);
  assert.equal(clean.includes('skill-name'), true);
});
