import assert from 'node:assert/strict';
import test from 'node:test';

import { createTelegramHandler } from '../../src/intake/telegram-handler.mjs';
import { createWorkflowDispatcher } from '../../src/intake/github-dispatch.mjs';
import { buildTelegramResearchBody, parseTelegramUpdate, telegramRequestId } from '../../src/intake/telegram-intake.mjs';

const SECRET = 'telegram_webhook_secret_0123456789';
const CHAT = '424242';
const TASK = '11111111-2222-4333-8444-555555555555';
const BASE = 'https://phone.example.test';
const update = (text, extra = {}) => ({ update_id: 7, message: { date: 1_760_000_000, chat: { id: 424242, type: 'private' }, text, ...extra } });

async function handlerWithoutHeader() {
  const h = harness().handler;
  return h(new Request('https://x.test/telegram', { method: 'POST', body: '{}' }));
}

function harness({ created = true, dispatchError = null, kernelError = null } = {}) {
  const calls = { contracts: [], dispatched: [], sent: [] };
  const handler = createTelegramHandler({
    kernel: { async createLiteResearchTask(contract) { if (kernelError) throw kernelError; calls.contracts.push(contract); return { taskId: TASK, created }; } },
    principalId: 'owner', webhookSecret: SECRET, allowedChatId: CHAT,
    botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc', publicBaseUrl: BASE,
    dispatch: async (input) => { if (dispatchError) throw dispatchError; calls.dispatched.push(input); },
    fetchImpl: async (url, init) => { calls.sent.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); },
    now: () => new Date('2026-10-16T12:00:00Z'),
  });
  const post = (body, headers = {}) => handler(new Request('https://x.test/telegram', {
    method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return { calls, post, handler };
}

test('plain text creates one task, dispatches one run and acknowledges with the phone link', async () => {
  const { calls, post } = harness();
  const res = await post(update('Найди 5 лидов на покраску в Glendale'));
  assert.equal(res.status, 200);
  assert.equal(calls.contracts.length, 1);
  assert.equal(calls.contracts[0].goal, 'Найди 5 лидов на покраску в Glendale');
  assert.deepEqual(calls.dispatched, [{ taskId: TASK, chatId: CHAT }]);
  assert.match(calls.sent[0].body.text, new RegExp(`${BASE}/tasks/${TASK}/phone`));
});

test('replayed Telegram update is idempotent: same contract, no second dispatch', async () => {
  const first = harness();
  await first.post(update('goal'));
  const second = harness({ created: false });
  const res = await second.post(update('goal'));
  assert.equal((await res.json()).duplicate, true);
  assert.equal(second.calls.dispatched.length, 0);
  assert.equal(second.calls.contracts[0].idempotencyKey, first.calls.contracts[0].idempotencyKey);
  assert.equal(second.calls.contracts[0].deadlineAt, first.calls.contracts[0].deadlineAt);
});

test('wrong or missing secret is rejected before any parsing or side effect', async () => {
  const { calls, post } = harness();
  assert.equal((await post(update('x'), { 'x-telegram-bot-api-secret-token': 'wrong_secret_value_000000' })).status, 401);
  const bare = await handlerWithoutHeader();
  assert.equal(bare.status, 401);
  assert.equal(calls.contracts.length + calls.dispatched.length + calls.sent.length, 0);
});

test('a chat outside the allowlist gets a silent 200 and no task', async () => {
  const { calls, post } = harness();
  const stranger = update('hi');
  stranger.message.chat.id = 999;
  assert.equal((await post(stranger)).status, 200);
  assert.equal(calls.contracts.length + calls.dispatched.length + calls.sent.length, 0);
});

test('dispatch failure keeps the task and tells the user how to resume', async () => {
  const { calls, post } = harness({ dispatchError: new Error('WORKFLOW_DISPATCH_FAILED_404') });
  assert.equal((await post(update('goal'))).status, 200);
  assert.match(calls.sent[0].body.text, new RegExp(`/run ${TASK}`));
});

test('transient database failure returns 503 so Telegram retries the same update', async () => {
  const { post } = harness({ kernelError: new Error('connection lost') });
  assert.equal((await post(update('goal'))).status, 503);
});

test('/run <uuid> re-dispatches an existing task without creating a new one', async () => {
  const { calls, post } = harness();
  await post(update(`/run ${TASK}`));
  assert.equal(calls.contracts.length, 0);
  assert.deepEqual(calls.dispatched, [{ taskId: TASK, chatId: CHAT }]);
});

test('helpers: deterministic request id, command parsing, bounded body', () => {
  assert.equal(telegramRequestId(7), telegramRequestId(7));
  assert.notEqual(telegramRequestId(7), telegramRequestId(8));
  assert.match(telegramRequestId(7), /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(parseTelegramUpdate(update('/r find x'), CHAT).goal, 'find x');
  assert.equal(parseTelegramUpdate(update('/start'), CHAT).kind, 'help');
  assert.equal(parseTelegramUpdate(update('/run nope'), CHAT).kind, 'bad_run');
  assert.equal(parseTelegramUpdate({ update_id: 1, message: { chat: { id: 424242, type: 'group' }, text: 'x' } }, CHAT), null);
  const body = JSON.parse(buildTelegramResearchBody({ goal: 'g', messageDateMs: 1_760_000_000_000 }));
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.deadlineAt, new Date(1_760_000_000_000 + 3_600_000).toISOString());
});

test('workflow dispatcher posts ref and inputs and requires HTTP 204', async () => {
  let seen;
  const ok = createWorkflowDispatcher({
    token: 'x'.repeat(30), repository: 'o/r', workflow: 'v2-run-task.yml', ref: 'v2/openclaw-clean-20261011',
    fetchImpl: async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return new Response(null, { status: 204 }); },
  });
  await ok({ taskId: TASK, chatId: CHAT });
  assert.equal(seen.url, 'https://api.github.com/repos/o/r/actions/workflows/v2-run-task.yml/dispatches');
  assert.deepEqual(seen.body, { ref: 'v2/openclaw-clean-20261011', inputs: { task_id: TASK, chat_id: CHAT } });
  const bad = createWorkflowDispatcher({
    token: 'x'.repeat(30), repository: 'o/r', workflow: 'v2-run-task.yml', ref: 'main',
    fetchImpl: async () => new Response('{}', { status: 404 }),
  });
  await assert.rejects(() => bad({ taskId: TASK, chatId: CHAT }), /WORKFLOW_DISPATCH_FAILED_404/);
});
