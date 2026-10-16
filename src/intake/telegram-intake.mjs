import { createHash } from 'node:crypto';

const HOUR_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Deterministic request id: a Telegram retry of the same update maps to the same task. */
export function telegramRequestId(updateId) {
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new TypeError('update_id must be a non-negative safe integer');
  const hex = createHash('sha256').update(`openclaw-v2:telegram:update:${updateId}`, 'utf8').digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parse a Telegram update into a command. Returns null for anything we do not act on.
 * Plain text or `/r <goal>` is a research request; `/run <task uuid>` re-dispatches a task.
 */
export function parseTelegramUpdate(update, allowedChatId) {
  if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id)) return null;
  const message = update.message;
  if (!message || typeof message !== 'object' || typeof message.text !== 'string') return null;
  const chat = message.chat;
  if (!chat || chat.type !== 'private' || String(chat.id) !== String(allowedChatId)) return null;
  const text = message.text.trim();
  if (!text) return null;
  const date = Number.isSafeInteger(message.date) ? message.date : null;
  const base = { updateId: update.update_id, chatId: String(chat.id), messageDateMs: date === null ? null : date * 1000 };

  const command = /^\/([A-Za-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (!command) return { ...base, kind: 'research', goal: text };
  const name = command[1].toLowerCase();
  const rest = (command[2] ?? '').trim();
  if (name === 'start' || name === 'help') return { ...base, kind: 'help' };
  if (name === 'r' || name === 'research') return rest ? { ...base, kind: 'research', goal: rest } : { ...base, kind: 'help' };
  if (name === 'run') return UUID.test(rest) ? { ...base, kind: 'run', taskId: rest } : { ...base, kind: 'bad_run' };
  return { ...base, kind: 'unknown' };
}

/** Bounded research request body. Deadline derives from the message date so retries stay byte-identical. */
export function buildTelegramResearchBody({ goal, messageDateMs, now = () => new Date() }) {
  const anchor = Number.isSafeInteger(messageDateMs) ? messageDateMs : now().getTime();
  return JSON.stringify({
    schemaVersion: 1,
    goal,
    maxResults: 5,
    constraints: {},
    requiredFields: ['sourceUrl'],
    budgetLimitUsd: '0.250000',
    tokenBudgetLimit: 50000,
    maxTotalSteps: 10,
    deadlineAt: new Date(anchor + HOUR_MS).toISOString(),
  });
}
