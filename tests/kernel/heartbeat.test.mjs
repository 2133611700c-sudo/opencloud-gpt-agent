import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LeaseHeartbeatManager,
  LeaseLostError,
  HeartbeatRenewalError,
} from '../../src/kernel/heartbeat.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForAbort = (signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve(signal.reason);
  signal.addEventListener('abort', () => resolve(signal.reason), { once: true });
});

test('heartbeat aborts work when DB renewal reports lease lost', async () => {
  let calls = 0;
  const manager = new LeaseHeartbeatManager({
    intervalMs: 5,
    renew: async () => {
      calls += 1;
      return false;
    },
  }).start();

  const reason = await waitForAbort(manager.signal);
  assert.equal(calls, 1);
  assert.ok(reason instanceof LeaseLostError);
  assert.equal(reason.code, 'LEASE_LOST');
  assert.equal(manager.failure, reason);
  assert.equal(manager.running, false);
  await manager.stop();
});

test('heartbeat wraps renewal exceptions and aborts work', async () => {
  const sourceError = new Error('database unavailable');
  const manager = new LeaseHeartbeatManager({
    intervalMs: 5,
    renew: async () => {
      throw sourceError;
    },
  }).start();

  const reason = await waitForAbort(manager.signal);
  assert.ok(reason instanceof HeartbeatRenewalError);
  assert.equal(reason.code, 'HEARTBEAT_RENEWAL_FAILED');
  assert.equal(reason.cause, sourceError);
  assert.equal(manager.running, false);
  await manager.stop();
});

test('heartbeat renewals never overlap even when renewal is slower than interval', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const manager = new LeaseHeartbeatManager({
    intervalMs: 2,
    renew: async () => {
      active += 1;
      calls += 1;
      maxActive = Math.max(maxActive, active);
      await wait(12);
      active -= 1;
      return true;
    },
  }).start();

  await wait(45);
  await manager.stop();

  assert.ok(calls >= 2);
  assert.equal(maxActive, 1);
  assert.equal(manager.signal.aborted, false);
});

test('clean stop cancels sleeping heartbeat and prevents future renewals', async () => {
  let calls = 0;
  const manager = new LeaseHeartbeatManager({
    intervalMs: 5,
    renew: async () => {
      calls += 1;
      return true;
    },
  }).start();

  await wait(14);
  await manager.stop();
  const callsAtStop = calls;
  await wait(15);

  assert.equal(calls, callsAtStop);
  assert.equal(manager.running, false);
  assert.equal(manager.signal.aborted, false);
});

test('clean stop during an in-flight renewal does not emit a false lease-loss abort', async () => {
  let releaseRenewal;
  const renewalBlocked = new Promise((resolve) => {
    releaseRenewal = resolve;
  });
  let enteredRenewal;
  const renewalEntered = new Promise((resolve) => {
    enteredRenewal = resolve;
  });

  const manager = new LeaseHeartbeatManager({
    intervalMs: 1,
    renew: async () => {
      enteredRenewal();
      await renewalBlocked;
      return false;
    },
  }).start();

  await renewalEntered;
  const stopPromise = manager.stop();
  releaseRenewal();
  await stopPromise;

  assert.equal(manager.signal.aborted, false);
  assert.equal(manager.failure, null);
});

test('heartbeat manager rejects duplicate start', async () => {
  const manager = new LeaseHeartbeatManager({
    intervalMs: 50,
    renew: async () => true,
  }).start();

  assert.throws(() => manager.start(), /already started/);
  await manager.stop();
});
