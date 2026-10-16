import { createHash, timingSafeEqual } from 'node:crypto';

import { requirePhonePublicBaseUrl } from '../phone/terminal-phone-publication.mjs';
import { buildTelegramResearchBody, parseTelegramUpdate, telegramRequestId } from './telegram-intake.mjs';
import { persistUserHttpIntake, requireUserHttpPrincipal, UserHttpIntakeError } from './user-http-intake.mjs';

const MAX_BODY_BYTES = 20_000;
const SECRET = /^[A-Za-z0-9_-]{16,256}$/;
const HELP = [
  'OpenClaw V2.',
  'Напишите вопрос обычным текстом или /r <запрос>: запущу исследование.',
  '/run <task id>: повторно запустить уже созданную задачу.',
].join('\n');
const json = (status, value) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const digest = (value) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Telegram webhook -> same bounded intake as POST /v1/research/tasks -> one GitHub Actions run.
 * Only the allowed private chat is served; everything else gets a silent 200 so Telegram stops retrying.
 */
export function createTelegramHandler({
  kernel, principalId, webhookSecret, allowedChatId, botToken, dispatch, publicBaseUrl,
  fetchImpl = globalThis.fetch, now = () => new Date(),
} = {}) {
  if (!kernel || typeof kernel.createLiteResearchTask !== 'function') throw new TypeError('kernel.createLiteResearchTask must be a function');
  requireUserHttpPrincipal(principalId);
  if (typeof webhookSecret !== 'string' || !SECRET.test(webhookSecret)) throw new TypeError('webhookSecret must be 16-256 chars of A-Z a-z 0-9 _ -');
  if (!/^-?\d{1,20}$/.test(String(allowedChatId ?? ''))) throw new TypeError('allowedChatId must be a numeric chat id');
  if (typeof botToken !== 'string' || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw new TypeError('botToken has an invalid shape');
  if (typeof dispatch !== 'function') throw new TypeError('dispatch must be a function');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const origin = requirePhonePublicBaseUrl(publicBaseUrl);
  const expected = digest(webhookSecret);

  async function say(chatId, text) {
    try {
      await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3500), disable_web_page_preview: true }),
      });
    } catch { /* a failed notification must never fail the webhook */ }
  }

  async function launch(chatId, taskId) {
    try {
      await dispatch({ taskId, chatId });
      return true;
    } catch {
      await say(chatId, `Задача ${taskId} создана, но запуск не удался. Повторите: /run ${taskId}`);
      return false;
    }
  }

  return async function handleTelegram(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/telegram' || url.search || url.hash) return json(404, { error: 'NOT_FOUND' });
    if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    const header = request.headers.get('x-telegram-bot-api-secret-token');
    if (typeof header !== 'string' || !timingSafeEqual(expected, digest(header))) return json(401, { error: 'UNAUTHORIZED' });

    const length = request.headers.get('content-length');
    if (length !== null && Number(length) > MAX_BODY_BYTES) return json(413, { error: 'BODY_TOO_LARGE' });
    let update;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'BODY_TOO_LARGE' });
      update = JSON.parse(text);
    } catch { return json(400, { error: 'REQUEST_JSON_INVALID' }); }

    const command = parseTelegramUpdate(update, allowedChatId);
    if (!command) return json(200, { ok: true });

    if (command.kind === 'help' || command.kind === 'unknown') { await say(command.chatId, HELP); return json(200, { ok: true }); }
    if (command.kind === 'bad_run') { await say(command.chatId, 'Нужен task id (UUID): /run <task id>'); return json(200, { ok: true }); }
    if (command.kind === 'run') {
      const started = await launch(command.chatId, command.taskId);
      if (started) await say(command.chatId, `Запущено повторно: ${origin}/tasks/${command.taskId}/phone`);
      return json(200, { ok: true });
    }

    let result;
    try {
      result = await persistUserHttpIntake({
        body: buildTelegramResearchBody({ goal: command.goal, messageDateMs: command.messageDateMs, now }),
        requestId: telegramRequestId(command.updateId), principalId, kernel, now,
      });
    } catch (error) {
      if (error instanceof UserHttpIntakeError) {
        await say(command.chatId, `Запрос не принят (${error.code}).`);
        return json(200, { ok: true });
      }
      if (error?.code === 'P0001') { await say(command.chatId, 'Запрос не принят: конфликт или истёк срок.'); return json(200, { ok: true }); }
      return json(503, { error: 'INTAKE_UNAVAILABLE' }); // transient: Telegram retries the same update id
    }
    if (!result.created) return json(200, { ok: true, duplicate: true });
    if (await launch(command.chatId, result.taskId)) {
      await say(command.chatId, `Принято. Задача ${result.taskId}\nРезультат придёт сюда. Страница: ${origin}/tasks/${result.taskId}/phone`);
    }
    return json(200, { ok: true, taskId: result.taskId });
  };
}
