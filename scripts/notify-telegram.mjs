// Sends one Telegram message from a workflow. Reads text from a file so task output never touches argv.
import { readFileSync } from 'node:fs';

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, MESSAGE_FILE: file, TASK_OUTCOME: outcome = 'success', TASK_ID: taskId = '' } = process.env;
if (!token || !chatId || !/^-?\d{1,20}$/.test(chatId)) { console.log('NOTIFY_SKIPPED: no Telegram chat for this task'); process.exit(0); }
let body = '';
try { body = file ? readFileSync(file, 'utf8').trim() : ''; } catch { /* empty */ }
const prefix = outcome === 'success' ? '' : `Задача ${taskId} не завершилась (${outcome}). Повторить: /run ${taskId}\n`;
const text = `${prefix}${body || '(пустой результат)'}`.slice(0, 3500);
const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
});
console.log(`NOTIFY_TELEGRAM_STATUS=${response.status}`);
if (!response.ok) process.exitCode = 1;
