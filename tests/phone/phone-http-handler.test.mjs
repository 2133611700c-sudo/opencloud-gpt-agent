import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidenceArtifact } from '../../src/evidence/evidence-contract.mjs';
import { createPhoneHttpHandler } from '../../src/phone/phone-http-handler.mjs';
import { renderTerminalPhonePublication } from '../../src/phone/terminal-phone-publication.mjs';

const taskId = '00000000-0000-4000-8000-000000000001';
const artifactId = '00000000-0000-4000-8000-000000000007';
const publicBaseUrl = 'https://evidence.example.com';
const at = '2026-10-14T10:00:00.123456Z';
const makeReceipt = () => {
  const artifact = createEvidenceArtifact({
    task: {
      id: taskId, goal: 'Failure publication', request_payload: {}, status: 'FAIL_WITH_EVIDENCE',
      terminal_reason: 'NODE_FAILED', terminal_detail: {}, budget_limit_usd: '1', current_cost_usd: '0',
      reserved_cost_usd: '0', token_budget_limit: '100', current_tokens: '0', reserved_tokens: '0',
      max_total_steps: 4, current_steps: 1, created_at: at, updated_at: at, terminal_at: at,
      deadline_at: '2026-10-14T11:00:00Z',
    },
    nodes: [{
      id: '00000000-0000-4000-8000-000000000002', task_id: taskId, node_key: 'research', agent_id: 'researcher',
      status: 'FAIL_WITH_EVIDENCE', attempt: 1, max_attempts: 3, output_data: null,
      last_error: { code: 'RUNTIME_FAILED', message: 'secret never published' }, reserved_cost_usd: '0',
      reserved_tokens: '0', created_at: at, updated_at: at, started_at: at, finished_at: at,
    }],
    dependencies: [], accounting: [], reservations: [], runtimeReceipts: [],
  });
  return Object.freeze({ ...artifact, taskId, artifactId, uri: `artifact://postgres/${artifactId}` });
};

test('serves exact UTF-8 deep-log and phone bodies with durable identity headers', async () => {
  const receipt = makeReceipt();
  const before = structuredClone(receipt);
  const reads = [];
  const handler = createPhoneHttpHandler({ publicBaseUrl, read: async (id) => { reads.push(id); return receipt; } });
  const rendered = renderTerminalPhonePublication({ receipt, publicBaseUrl });
  for (const [route, expected] of [['deep-log', rendered.deepLogText], ['phone', rendered.text]]) {
    const response = await handler(new Request(`${publicBaseUrl}/tasks/${taskId}/${route}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-openclaw-task-id'), taskId);
    assert.equal(response.headers.get('x-openclaw-artifact-id'), artifactId);
    assert.equal(response.headers.get('x-openclaw-evidence-sha256'), receipt.sha256);
    assert.equal(await response.text(), expected);
  }
  assert.deepEqual(reads, [taskId, taskId]);
  assert.deepEqual(receipt, before);
});

test('request URL, Host and forwarded headers cannot influence published URLs', async () => {
  const handler = createPhoneHttpHandler({ read: async () => makeReceipt(), publicBaseUrl });
  const response = await handler(new Request(`https://attacker.example.net/tasks/${taskId}/phone`, {
    headers: { Host: 'attacker.example.net', 'X-Forwarded-Host': 'evil.example.org', 'X-Forwarded-Proto': 'http' },
  }));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(text.includes(`Deep log: ${publicBaseUrl}/tasks/${taskId}/deep-log`));
  assert.doesNotMatch(text, /attacker|evil\.example/);
});

test('invalid paths, UUIDs, query strings and methods do not touch storage', async () => {
  let reads = 0;
  const handler = createPhoneHttpHandler({ publicBaseUrl, read: async () => { reads += 1; return null; } });
  for (const path of ['/', '/tasks/no-id/phone', `/tasks/${taskId}/raw`, `/tasks/${taskId}/phone?key=secret`,
    `/tasks/${taskId}/phone#fragment`, `/tasks/${taskId}/phone/`, `/tasks/%30${taskId.slice(1)}/phone`]) {
    assert.equal((await handler(new Request(`${publicBaseUrl}${path}`))).status, 404);
  }
  const post = await handler(new Request(`${publicBaseUrl}/tasks/${taskId}/phone`, { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  assert.equal(reads, 0);
});

test('absent durable Evidence returns 404 without identity claims', async () => {
  const handler = createPhoneHttpHandler({ publicBaseUrl, read: async () => null });
  const response = await handler(new Request(`${publicBaseUrl}/tasks/${taskId}/phone`));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('x-openclaw-artifact-id'), null);
  assert.equal(await response.text(), 'Not found');
});

test('corrupt receipts and storage errors return safe 503 without secret diagnostics', async () => {
  const receipt = makeReceipt();
  for (const read of [
    async () => ({ ...receipt, sha256: 'b'.repeat(64) }),
    async () => ({ ...receipt, taskId: '00000000-0000-4000-8000-000000000099' }),
    async () => ({ ...receipt, serialized: 'secret diagnostic' }),
    async () => { throw new Error('secret database credential'); },
  ]) {
    const handler = createPhoneHttpHandler({ publicBaseUrl, read });
    const response = await handler(new Request(`${publicBaseUrl}/tasks/${taskId}/deep-log`));
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'Evidence unavailable');
    assert.equal(response.headers.get('x-openclaw-artifact-id'), null);
  }
});

test('a valid artifact for another task cannot be served under the requested task URL', async () => {
  const handler = createPhoneHttpHandler({ publicBaseUrl, read: async () => makeReceipt() });
  const otherTaskId = '00000000-0000-4000-8000-000000000099';
  const response = await handler(new Request(`${publicBaseUrl}/tasks/${otherTaskId}/phone`));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), 'Evidence unavailable');
});

test('read-only handler rejects missing capabilities and unsafe configured origins', () => {
  assert.throws(() => createPhoneHttpHandler({ publicBaseUrl }), TypeError);
  assert.throws(() => createPhoneHttpHandler({ read: async () => null, publicBaseUrl: 'https://user:secret@example.com' }), TypeError);
});
