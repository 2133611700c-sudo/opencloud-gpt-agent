import assert from 'node:assert/strict';
import test from 'node:test';

import { createUserHttpHandler } from '../../src/intake/user-http-handler.mjs';

const secret = 'only-test-secret-with-at-least-32-characters';
const principalId = 'operator';
const publicBaseUrl = 'https://evidence.example.com';
const requestId = '8ab450d5-6b39-498c-bdf3-a6ed05a10e03';
const taskId = 'dc750c4f-a0d0-4618-856b-d645520a2b66';
const now = () => new Date('2026-10-15T12:00:00Z');
const request = {
  schemaVersion: 1, goal: 'Find current documentation.', maxResults: 1,
  requiredFields: ['title'], constraints: { requiredDomains: ['example.com'] },
  budgetLimitUsd: '0.100000', tokenBudgetLimit: 50000, maxTotalSteps: 4,
  deadlineAt: '2026-10-15T12:10:00Z',
};
const headers = { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'idempotency-key': requestId };
const req = (options = {}) => new Request(`${publicBaseUrl}/v1/research/tasks`, {
  method: 'POST', headers, body: JSON.stringify(request), ...options,
});
const setup = (create = async () => ({ taskId, created: true })) => {
  const calls = [];
  const kernel = { createLiteResearchTask: async (value) => { calls.push(value); return create(value); } };
  return { calls, handler: createUserHttpHandler({ kernel, secret, principalId, publicBaseUrl, now }) };
};

test('acknowledges only durable persistence and generates links from configured origin', async () => {
  let release;
  const { handler, calls } = setup(() => new Promise((resolve) => { release = resolve; }));
  let settled = false;
  const pending = handler(new Request('https://attacker.example/v1/research/tasks', { method: 'POST', headers, body: JSON.stringify(request) }))
    .then((value) => { settled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(settled, false);
  release({ taskId, created: true });
  const response = await pending;
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), {
    taskId, created: true, idempotencyKey: `user:http:operator:${requestId}`,
    phoneUrl: `${publicBaseUrl}/tasks/${taskId}/phone`, deepLogUrl: `${publicBaseUrl}/tasks/${taskId}/deep-log`,
  });
  assert.deepEqual(calls[0].requestPayload.source, { type: 'authenticated_http', principalId, requestId });
  assert.equal(Object.hasOwn(calls[0].requestPayload, 'github'), false);
});

test('unauthorized requests do not read the body or access the kernel', async () => {
  const { handler, calls } = setup();
  for (const authorization of [null, 'Bearer short', `Bearer ${'x'.repeat(secret.length)}`, `Bearer ${secret}, Bearer ${secret}`, `Basic ${secret}`]) {
    const values = new Headers(headers);
    if (authorization === null) values.delete('authorization');
    else values.set('authorization', authorization);
    const requestWithUnreadableBody = req({ headers: values });
    Object.defineProperty(requestWithUnreadableBody, 'body', { get() { throw new Error('body must not be read'); } });
    const response = await handler(requestWithUnreadableBody);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
  }
  assert.equal(calls.length, 0);
});

test('rejects wrong routes, methods, media types, compression and ambiguous request IDs', async () => {
  const { handler, calls } = setup();
  for (const path of ['/v1/research/tasks/', '/v1/research/tasks?token=private', '/v1/research/tasks#fragment', '/v1/research/%74asks']) {
    assert.equal((await handler(new Request(`${publicBaseUrl}${path}`, { method: 'POST', headers, body: '{}' }))).status, 404);
  }
  const method = await handler(req({ method: 'PUT' }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  for (const changes of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=latin1' },
    { 'content-type': 'application/json, application/json' }, { 'content-encoding': 'gzip' }]) {
    assert.equal((await handler(req({ headers: { ...headers, ...changes } }))).status, 415);
  }
  for (const value of ['', requestId.toUpperCase(), `${requestId}, ${requestId}`, 'invalid']) {
    assert.equal((await handler(req({ headers: { ...headers, 'idempotency-key': value } }))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('bounds declared and streamed bodies, rejects malformed UTF-8/JSON and length mismatch', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(req({ headers: { ...headers, 'content-length': '20001' } }))).status, 413);
  assert.equal((await handler(req({ headers: { ...headers, 'content-length': '1' } }))).status, 400);
  assert.equal((await handler(req({ headers: { ...headers, 'content-length': '1, 2' } }))).status, 400);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(10000)); controller.enqueue(new Uint8Array(10001)); },
    cancel() { cancelled = true; },
  });
  assert.equal((await handler(req({ body, duplex: 'half' }))).status, 413);
  assert.equal(cancelled, true);
  const invalidUtf8 = await handler(req({ body: new Uint8Array([0xc3, 0x28]) }));
  assert.deepEqual(await invalidUtf8.json(), { error: 'BODY_UTF8_INVALID' });
  for (const body of ['{', '[]', 'null', '', JSON.stringify({ ...request, github: { issueId: 42 } }),
    JSON.stringify({ ...request, constraints: { credentials: 'private' } })]) {
    assert.equal((await handler(req({ body }))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('the intake credential in literal or escaped goal text never reaches persistence', async () => {
  const { handler, calls } = setup();
  const literal = JSON.stringify({ ...request, goal: 'Accidental credential ' + secret });
  const escaped = literal.replace(secret, '\\u' + secret.charCodeAt(0).toString(16).padStart(4, '0') + secret.slice(1));
  for (const body of [literal, escaped]) {
    const response = await handler(req({ body }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'SENSITIVE_REQUEST_CONTENT' });
  }
  assert.equal(calls.length, 0);
});

test('a body stalled beyond five seconds is cancelled without persistence', async () => {
  const { handler, calls } = setup();
  let cancelled = false;
  const response = await handler(req({ body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' }));
  assert.equal(response.status, 408);
  assert.deepEqual(await response.json(), { error: 'BODY_TIMEOUT' });
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});

test('concurrent HTTP replay preserves the kernel task identity and created result', async () => {
  let created = false;
  const { handler } = setup(async () => {
    const first = !created;
    created = true;
    await Promise.resolve();
    return { taskId, created: first };
  });
  const responses = await Promise.all([handler(req()), handler(req())]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.ok(responses.every((response) => response.status === 202));
  assert.deepEqual(bodies.map((body) => body.created).sort(), [false, true]);
  assert.ok(bodies.every((body) => body.taskId === taskId));
});

test('expired exact replay reaches SQL while new-expiry/conflict and unknown DB failures stay safe', async () => {
  const { handler: replay } = setup(async () => ({ taskId, created: false }));
  const expiredBody = JSON.stringify({ ...request, deadlineAt: '2026-10-14T12:00:00Z' });
  assert.equal((await replay(req({ body: expiredBody }))).status, 202);
  for (const [error, status, code] of [
    [Object.assign(new Error('idempotency key reused with different request contract'), { code: 'P0001' }), 409, 'IDEMPOTENCY_CONFLICT'],
    [Object.assign(new Error('deadline must be in the future'), { code: 'P0001' }), 400, 'DEADLINE_EXPIRED'],
    [Object.assign(new Error('database password secret-sensitive-payload'), { code: 'P0001' }), 503, 'INTAKE_UNAVAILABLE'],
    [new Error(secret), 503, 'INTAKE_UNAVAILABLE'],
  ]) {
    const { handler } = setup(async () => { throw error; });
    const response = await handler(req({ body: expiredBody }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test('invalid persisted results and incomplete deployment configuration fail closed', async () => {
  const { handler } = setup(async () => ({ taskId: 'bad-task-id', created: true }));
  assert.equal((await handler(req())).status, 503);
  const config = { kernel: { createLiteResearchTask: async () => ({ taskId, created: true }) }, secret, principalId, publicBaseUrl, now };
  for (const changes of [{ kernel: {} }, { secret: '' }, { secret: 'x'.repeat(31) }, { secret: `${secret} ` },
    { principalId: 'untrusted:owner' }, { publicBaseUrl: 'http://example.com' }, { publicBaseUrl: 'https://user:private@example.com' }, { now: null }]) {
    assert.throws(() => createUserHttpHandler({ ...config, ...changes }), TypeError);
  }
});
