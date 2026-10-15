import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { transformData } from '../../src/data/data-transformer.mjs';
import { createEvidenceArtifact } from '../../src/evidence/evidence-contract.mjs';
import { createPhoneHttpHandler } from '../../src/phone/phone-http-handler.mjs';
import { runtimeSensitiveValues } from '../../src/runtime/runtime-sensitive-values.mjs';
import {
  createTerminalPhonePublication,
  renderTerminalPhonePublication,
} from '../../src/phone/terminal-phone-publication.mjs';

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const publicBaseUrl = 'https://evidence.example.com';
const at = '2026-10-14T10:00:00.123456Z';
const makeReceipt = (status = 'SUCCESS', secret = '', sensitiveValues = secret ? [secret] : []) => {
  const taskId = uuid(1);
  const researchId = uuid(2);
  const dataId = uuid(3);
  const lease = uuid(4);
  const result = {
    status: 'SUCCESS', summary: 'Verified model', confidence: 'HIGH', needsBrowser: [],
    sources: [{ id: 's1', title: 'Source', url: 'https://example.com/docs', checkedAt: at }],
    items: [{ id: 'i1', title: `Model ${secret}`, data: { price: 1, apiKey: secret }, sourceIds: ['s1'] }],
  };
  const task = {
    id: taskId, goal: 'Research a model', request_payload: { requiredFields: ['price'] }, status,
    terminal_reason: status === 'SUCCESS' ? 'ALL_NODES_SUCCEEDED' : 'NODE_FAILED', terminal_detail: {},
    budget_limit_usd: '1', current_cost_usd: '0.000003', reserved_cost_usd: '0', token_budget_limit: '100',
    current_tokens: '9', reserved_tokens: '0', max_total_steps: 4, current_steps: status === 'SUCCESS' ? 2 : 1,
    created_at: at, updated_at: at, terminal_at: at, deadline_at: '2026-10-14T11:00:00Z',
  };
  const node = (id, key, agent, output) => ({
    id, task_id: taskId, node_key: key, agent_id: agent, status: 'SUCCESS', attempt: 1, max_attempts: 3,
    output_data: output, last_error: null, reserved_cost_usd: '0', reserved_tokens: '0',
    created_at: at, updated_at: at, started_at: at, finished_at: at,
  });
  const research = node(researchId, 'research', 'researcher', result);
  const data = node(dataId, 'data', 'data', transformData({ requiredFields: ['price'], researchResult: result }));
  if (status !== 'SUCCESS') {
    Object.assign(research, { status, output_data: null, last_error: { code: 'RUNTIME_FAILED', message: secret } });
    Object.assign(data, { status: 'BLOCKED', attempt: 0, started_at: null, output_data: null });
  }
  const artifact = createEvidenceArtifact({
    task, nodes: [research, data], dependencies: [{ task_id: taskId, node_id: dataId, parent_node_id: researchId }],
    accounting: [{
      id: uuid(5), task_id: taskId, node_id: researchId, lease_token: lease, call_key: 'fixture',
      provider: 'deepseek', model: 'deepseek-flash', pricing_version: 'fixture-v1', provider_request_id: 'session-1',
      prompt_cache_hit_tokens: '2', prompt_cache_miss_tokens: '3', completion_tokens: '4', total_tokens: '9',
      reserved_cost_usd: '0.1', cost_usd: '0.000003', latency_ms: 12, created_at: at, accounting_basis: 'OBSERVED_USAGE',
    }],
    reservations: [{
      id: uuid(6), task_id: taskId, node_id: researchId, lease_token: lease, reservation_key: 'fixture',
      status: 'RECONCILED', reserved_cost_usd: '0.1', reserved_tokens: '100', actual_cost_usd: '0.000003',
      actual_tokens: '9', reconciliation_basis: 'OBSERVED_USAGE', created_at: at, reconciled_at: at,
      released_at: null, release_reason: null,
    }],
    runtimeReceipts: [],
  }, { sensitiveValues });
  return Object.freeze({ ...artifact, taskId, artifactId: uuid(7), uri: `artifact://postgres/${uuid(7)}` });
};

const setup = (receipt = makeReceipt(), options = {}) => {
  const handler = createPhoneHttpHandler({ read: async () => receipt, publicBaseUrl });
  const calls = [];
  const finalizer = { finalize: async (taskId) => { calls.push(taskId); return receipt; } };
  const fetchImpl = async (url, init) => handler(new Request(url, init));
  return { calls, publisher: createTerminalPhonePublication({ finalizer, publicBaseUrl, fetchImpl, ...options }) };
};

for (const status of ['SUCCESS', 'FAIL_WITH_EVIDENCE']) {
  test(`publishes frozen canonical ${status} Evidence with task identity and no mutation`, async () => {
    const receipt = makeReceipt(status);
    const before = structuredClone(receipt);
    const { publisher, calls } = setup(receipt);
    const publication = await publisher.publish(receipt.taskId);
    assert.equal(publication.status, status);
    assert.equal(publication.published, true);
    assert.equal(publication.artifactId, receipt.artifactId);
    assert.equal(publication.sha256, receipt.sha256);
    assert.equal(Object.hasOwn(publication, 'deepLogText'), false);
    assert.ok(Object.isFrozen(publication));
    assert.ok(Object.isFrozen(receipt.bundle));
    assert.ok(publication.text.startsWith(`[${status}]\nTask: ${receipt.taskId}\n`));
    assert.match(publication.text, /Cost: \$0\.000003/);
    assert.deepEqual(calls, [receipt.taskId]);
    assert.deepEqual(receipt, before);
  });
}

test('concurrent publication and a new publisher retry converge on the same artifact and URLs', async () => {
  const receipt = makeReceipt();
  const { publisher, calls } = setup(receipt);
  const results = await Promise.all([publisher.publish(receipt.taskId), publisher.publish(receipt.taskId)]);
  const retry = await setup(receipt).publisher.publish(receipt.taskId);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], retry);
  assert.deepEqual(calls, [receipt.taskId, receipt.taskId]);
});

test('known and supplied secrets do not reach either rendered response', async () => {
  const secret = 'opaque-credential-to-redact';
  const receipt = makeReceipt('SUCCESS', secret);
  const publication = await setup(receipt).publisher.publish(receipt.taskId);
  const rendered = renderTerminalPhonePublication({ receipt, publicBaseUrl });
  assert.equal(publication.text.includes(secret), false);
  assert.equal(rendered.deepLogText.includes(secret), false);
  assert.equal(rendered.deepLogText.includes('apiKey'), false);
});

test('production redaction policy includes the opaque intake credential in both public surfaces', async () => {
  const secret = 'opaque-intake-credential-not-a-provider-key';
  const values = runtimeSensitiveValues({ OPENCLAW_USER_INTAKE_SECRET: secret });
  const receipt = makeReceipt('SUCCESS', secret, values);
  const publication = await setup(receipt).publisher.publish(receipt.taskId);
  const rendered = renderTerminalPhonePublication({ receipt, publicBaseUrl });
  assert.equal(publication.text.includes(secret), false);
  assert.equal(rendered.deepLogText.includes(secret), false);
  assert.equal(receipt.serialized.includes(secret), false);
});

test('rejects unsafe public origins before finalization', () => {
  for (const value of [
    'http://example.com', 'https://user:pass@example.com', 'https://localhost', 'https://a.localhost',
    'https://127.0.0.1', 'https://2130706433', 'https://192.168.1.1', 'https://[::1]',
    'https://[::ffff:127.0.0.1]', 'https://[fd00::1]', 'https://example.com/path',
    'https://example.com/?token=secret', 'https://example.com/#fragment', 'https://example.com/?',
    'https://example.com/#', 'https://localhost.', 'https://private.local.',
  ]) {
    assert.throws(() => setup(makeReceipt(), { publicBaseUrl: value }), TypeError);
  }
});

test('rejects corrupt hashes, sizes, canonical payloads and task linkage', () => {
  const receipt = makeReceipt();
  const noncanonical = JSON.stringify(receipt.bundle, null, 2);
  for (const corrupt of [
    { sha256: 'a'.repeat(64) }, { sizeBytes: receipt.sizeBytes + 1 }, { serialized: `${receipt.serialized}\n` },
    { taskId: uuid(99) }, { artifactId: 'not-an-id' }, { uri: 'https://example.com/fake' },
    { serialized: noncanonical, sizeBytes: Buffer.byteLength(noncanonical),
      sha256: createHash('sha256').update(noncanonical).digest('hex') },
    { bundle: { ...receipt.bundle, acceptanceCriteria: { ...receipt.bundle.acceptanceCriteria, goal: 'Other goal' } } },
    { bundle: { ...receipt.bundle, task: { ...receipt.bundle.task, status: 'RUNNING' } } },
  ]) {
    assert.throws(() => renderTerminalPhonePublication({ receipt: { ...receipt, ...corrupt }, publicBaseUrl }),
      { code: 'PHONE_EVIDENCE_INVALID' });
  }
});

test('publisher fails safely without changing accounting or Evidence, and retry performs no Research', async () => {
  const receipt = makeReceipt();
  const before = structuredClone(receipt);
  const { publisher } = setup(receipt, { fetchImpl: async () => { throw new Error('secret transport payload'); } });
  await assert.rejects(() => publisher.publish(receipt.taskId), (error) => {
    assert.equal(error.code, 'PHONE_PUBLICATION_HTTP_FAILED');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  assert.deepEqual(receipt, before);
  assert.equal((await setup(receipt).publisher.publish(receipt.taskId)).published, true);
});

test('finalizer failures expose a safe code and make no HTTP request', async () => {
  let requests = 0;
  const publisher = createTerminalPhonePublication({
    publicBaseUrl, finalizer: { finalize: async () => { throw new Error('database credential'); } },
    fetchImpl: async () => { requests += 1; },
  });
  await assert.rejects(() => publisher.publish(uuid(1)), { code: 'PHONE_EVIDENCE_FINALIZE_FAILED' });
  assert.equal(requests, 0);
});

test('a finalizer receipt for another task cannot be published', async () => {
  let requests = 0;
  const { publisher } = setup(makeReceipt(), { fetchImpl: async () => { requests += 1; } });
  await assert.rejects(() => publisher.publish(uuid(99)), { code: 'PHONE_EVIDENCE_TASK_MISMATCH' });
  assert.equal(requests, 0);
});

test('requires verified deep log before requesting the phone route', async () => {
  const receipt = makeReceipt();
  const calls = [];
  const { publisher } = setup(receipt, { fetchImpl: async (url, init) => {
    calls.push({ url, redirect: init.redirect, signal: init.signal });
    return new Response('wrong body', { status: 200, headers: { 'Content-Type': 'text/html' } });
  } });
  await assert.rejects(() => publisher.publish(receipt.taskId), { code: 'PHONE_PUBLICATION_HTTP_INVALID' });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/deep-log'));
  assert.equal(calls[0].redirect, 'error');
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('rejects redirects, wrong identity and body mismatches', async () => {
  const receipt = makeReceipt();
  const handler = createPhoneHttpHandler({ read: async () => receipt, publicBaseUrl });
  for (const [mutate, code] of [
    [async () => new Response('', { status: 302, headers: { Location: 'https://other.example.com' } }), 'PHONE_PUBLICATION_HTTP_INVALID'],
    [async (response) => { response.headers.set('X-OpenClaw-Task-Id', uuid(99)); return response; }, 'PHONE_PUBLICATION_IDENTITY_MISMATCH'],
    [async (response) => new Response('wrong', { headers: response.headers }), 'PHONE_PUBLICATION_BODY_MISMATCH'],
  ]) {
    const { publisher } = setup(receipt, { fetchImpl: async (url, init) => mutate(await handler(new Request(url, init))) });
    await assert.rejects(() => publisher.publish(receipt.taskId), { code });
  }
});

test('bounds response streams and cancels a body that exceeds the byte limit', async () => {
  const receipt = makeReceipt();
  let cancelled = false;
  const rendered = renderTerminalPhonePublication({ receipt, publicBaseUrl });
  const handler = createPhoneHttpHandler({ read: async () => receipt, publicBaseUrl });
  const { publisher } = setup(receipt, { maxResponseBytes: 10, fetchImpl: async (url, init) => {
    const valid = await handler(new Request(url, init));
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode(rendered.deepLogText)); },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: valid.headers });
  } });
  await assert.rejects(() => publisher.publish(receipt.taskId), { code: 'PHONE_PUBLICATION_BODY_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('rejects oversized Content-Length before reading and cancels the rejected body', async () => {
  const receipt = makeReceipt();
  let cancelled = false;
  const handler = createPhoneHttpHandler({ read: async () => receipt, publicBaseUrl });
  const { publisher } = setup(receipt, { maxResponseBytes: 10, fetchImpl: async (url, init) => {
    const valid = await handler(new Request(url, init));
    valid.headers.set('Content-Length', '1000000');
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: valid.headers });
  } });
  await assert.rejects(() => publisher.publish(receipt.taskId), { code: 'PHONE_PUBLICATION_BODY_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('timeout aborts an unresponsive fetch without exposing its errors', async () => {
  let signal;
  const { publisher } = setup(makeReceipt(), { timeoutMs: 10, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(() => publisher.publish(uuid(1)), { code: 'PHONE_PUBLICATION_TIMEOUT' });
  assert.equal(signal.aborted, true);
});

test('timeout bounds a stalled response stream and cancels it', async () => {
  const receipt = makeReceipt();
  let cancelled = false;
  const handler = createPhoneHttpHandler({ read: async () => receipt, publicBaseUrl });
  const { publisher } = setup(receipt, { timeoutMs: 10, fetchImpl: async (url, init) => {
    const valid = await handler(new Request(url, init));
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: valid.headers });
  } });
  await assert.rejects(() => publisher.publish(receipt.taskId), { code: 'PHONE_PUBLICATION_TIMEOUT' });
  assert.equal(cancelled, true);
});
