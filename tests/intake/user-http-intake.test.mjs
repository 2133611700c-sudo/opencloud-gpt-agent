import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseUserHttpIntake,
  persistUserHttpIntake,
  userHttpIdempotencyKey,
  UserHttpIntakeError,
} from '../../src/intake/user-http-intake.mjs';

const requestId = '8ab450d5-6b39-498c-bdf3-a6ed05a10e03';
const taskId = 'dc750c4f-a0d0-4618-856b-d645520a2b66';
const now = () => new Date('2026-10-15T12:00:00Z');
const request = {
  schemaVersion: 1,
  goal: ' Find the current documented DeepSeek model. ',
  maxResults: 1,
  constraints: { requiredDomains: ['api-docs.deepseek.com'] },
  requiredFields: ['modelId', 'modelVersion', 'modelId'],
  budgetLimitUsd: '0.100000',
  tokenBudgetLimit: 50000,
  maxTotalSteps: 4,
  deadlineAt: '2026-10-15T12:10:00Z',
};
const input = (changes = {}) => ({ body: JSON.stringify(request), requestId, principalId: 'operator', now, ...changes });

test('normalizes a bounded user request with honest configured-principal provenance', () => {
  const result = parseUserHttpIntake(input());
  assert.equal(result.idempotencyKey, `user:http:operator:${requestId}`);
  assert.equal(result.goal, request.goal.trim());
  assert.equal(result.budgetLimitUsd, '0.100000');
  assert.equal(result.deadlineAt, '2026-10-15T12:10:00.000Z');
  assert.deepEqual(result.source, { type: 'authenticated_http', principalId: 'operator', requestId });
  assert.deepEqual(result.requestPayload, {
    maxResults: 1,
    constraints: request.constraints,
    requiredFields: ['modelId', 'modelVersion'],
    source: result.source,
  });
  assert.equal(Object.hasOwn(result.requestPayload, 'github'), false);
  assert.deepEqual(parseUserHttpIntake(input()), result);
});

test('stable keys isolate principals and reject ambiguous or unbounded identities', () => {
  assert.notEqual(userHttpIdempotencyKey({ principalId: 'other', requestId }), userHttpIdempotencyKey({ principalId: 'operator', requestId }));
  for (const principalId of ['', 'a:b', 'owner@example.com', 'x'.repeat(65), null]) {
    assert.throws(() => userHttpIdempotencyKey({ principalId, requestId }), TypeError);
  }
  for (const value of ['', requestId.toUpperCase(), `${requestId},${requestId}`, 'not-a-uuid', null]) {
    assert.throws(() => userHttpIdempotencyKey({ principalId: 'operator', requestId: value }), UserHttpIntakeError);
  }
});

test('rejects unknown identity/GitHub fields, nested credentials, malformed and oversized JSON', () => {
  for (const changes of [{ principalId: 'attacker' }, { source: { type: 'github_issue' } }, { github: { issueId: 1 } },
    { constraints: { nested: [{ apiKey: 'private' }] } }, { schemaVersion: 2 }]) {
    assert.throws(() => parseUserHttpIntake(input({ body: JSON.stringify({ ...request, ...changes }) })), UserHttpIntakeError);
  }
  for (const body of ['{', '[]', 'null', 'x'.repeat(20001)]) {
    assert.throws(() => parseUserHttpIntake(input({ body })), UserHttpIntakeError);
  }
});

test('preserves existing execution caps and validates the upper deadline bound', () => {
  for (const changes of [{ budgetLimitUsd: '1.000001' }, { budgetLimitUsd: 0.1 }, { tokenBudgetLimit: 200001 },
    { tokenBudgetLimit: 0 }, { maxTotalSteps: 51 }, { maxTotalSteps: 0 }, { goal: '' },
    { deadlineAt: '2026-10-16T12:00:00.001Z' }, { deadlineAt: 'tomorrow' }]) {
    assert.throws(() => parseUserHttpIntake(input({ body: JSON.stringify({ ...request, ...changes }) })), UserHttpIntakeError);
  }
  assert.doesNotThrow(() => parseUserHttpIntake(input({ body: JSON.stringify({ ...request, deadlineAt: '2026-10-16T12:00:00Z' }) })));
  assert.throws(() => parseUserHttpIntake(input({ now: () => new Date(NaN) })), TypeError);
});

test('passes exact immutable contracts to the kernel and permits expired replay lookup', async () => {
  const calls = [];
  const kernel = { async createLiteResearchTask(contract) { calls.push(contract); return { taskId, created: false }; } };
  const result = await persistUserHttpIntake({ ...input({ now: () => new Date('2026-10-17T12:00:00Z') }), kernel });
  assert.equal(result.created, false);
  assert.equal(result.taskId, taskId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].deadlineAt, '2026-10-15T12:10:00.000Z');
  assert.equal(Object.hasOwn(calls[0], 'source'), false);
  assert.equal(calls[0].requestPayload.source.type, 'authenticated_http');
  assert.deepEqual(calls[0], (({ source, ...contract }) => contract)(parseUserHttpIntake(input())));
});

test('concurrent deliveries retain one task through kernel atomic idempotency', async () => {
  let stored;
  let calls = 0;
  const kernel = {
    async createLiteResearchTask(contract) {
      calls += 1;
      const created = !stored;
      if (stored) assert.deepEqual(contract, stored);
      else stored = contract;
      await Promise.resolve();
      return { taskId, created };
    },
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => persistUserHttpIntake({ ...input(), kernel })));
  assert.equal(calls, 5);
  assert.equal(results.filter((value) => value.created).length, 1);
  assert.ok(results.every((value) => value.taskId === taskId));
});

test('invalid requests never create a task and invalid persistence results fail closed', async () => {
  let calls = 0;
  const kernel = { async createLiteResearchTask() { calls += 1; return { taskId, created: true }; } };
  await assert.rejects(persistUserHttpIntake({ ...input({ body: '{}' }), kernel }), UserHttpIntakeError);
  assert.equal(calls, 0);
  for (const value of [null, { taskId: 'not-a-uuid', created: true }, { taskId, created: 'true' }]) {
    await assert.rejects(persistUserHttpIntake({ ...input(), kernel: { createLiteResearchTask: async () => value } }), TypeError);
  }
  await assert.rejects(persistUserHttpIntake({ ...input(), kernel: {} }), TypeError);
});
