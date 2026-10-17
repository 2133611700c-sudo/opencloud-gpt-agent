import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { runResearchAgent } from '../../src/research/research-agent-runner.mjs';

const verifyAuthScopeImpl = async () => ({ agentId: 'main', provider: 'deepseek', profileId: 'deepseek:manual', type: 'api_key', profileCount: 1 });

const request = { goal: 'transport error test' };
const makeRoot = (prefix) => mkdtempSync(join(tmpdir(), prefix));

const makeChild = () => {
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
};

test('runner kills started child when stdin emits a transport error', async () => {
  const tempRoot = makeRoot('openclaw-v2-transport-temp-');
  const stateRoot = makeRoot('openclaw-v2-transport-state-');
  const child = makeChild();
  try {
    const promise = runResearchAgent({ verifyAuthScopeImpl,
      request,
      env: { DEEPSEEK_API_KEY: 'test-secret', OPENCLAW_STATE_DIR: stateRoot },
      tempRoot,
      spawnImpl: () => {
        queueMicrotask(() => child.stdin.emit('error', new Error('broken pipe')));
        return child;
      },
    });
    await assert.rejects(promise, (error) => error?.code === 'STDIN_FAILED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
    assert.deepEqual(readdirSync(tempRoot), []);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test('runner kills started child when sending stdin throws synchronously', async () => {
  const tempRoot = makeRoot('openclaw-v2-transport-temp-');
  const stateRoot = makeRoot('openclaw-v2-transport-state-');
  const child = makeChild();
  child.stdin.end = () => { throw new Error('write failed'); };
  try {
    await assert.rejects(runResearchAgent({ verifyAuthScopeImpl,
      request,
      env: { DEEPSEEK_API_KEY: 'test-secret', OPENCLAW_STATE_DIR: stateRoot },
      tempRoot,
      spawnImpl: () => child,
    }), (error) => error?.code === 'STDIN_FAILED');
    assert.deepEqual(child.killSignals, ['SIGKILL']);
    assert.deepEqual(readdirSync(tempRoot), []);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
