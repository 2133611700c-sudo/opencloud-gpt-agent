import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';
import { createPhoneHttpHandler } from '../../src/phone/phone-http-handler.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { createUserHttpHandler } from '../../src/intake/user-http-handler.mjs';
import { createTelegramHandler } from '../../src/intake/telegram-handler.mjs';
import { createWorkflowDispatcher } from '../../src/intake/github-dispatch.mjs';
import { phoneDatabaseOptions } from './database-config.mjs';

const pool = new Pool(phoneDatabaseOptions(process.env.DATABASE_URL));
attachDatabasePool(pool);
pool.on('error', () => console.error('PHONE_DATABASE_CONNECTION_LOST'));
const store = createPostgresEvidenceStoreV2({ query: (sql, values) => pool.query(sql, values) });
const handler = createPhoneHttpHandler({ read: store.read, publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL });
const intake = createUserHttpHandler({
  kernel: createPostgresKernelAdapter({ query: (sql, values) => pool.query(sql, values) }),
  secret: process.env.OPENCLAW_USER_INTAKE_SECRET,
  principalId: process.env.OPENCLAW_USER_INTAKE_PRINCIPAL,
  publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL,
});
const env = process.env;
// Telegram door is optional: it exists only when every secret is configured.
const telegram = env.OPENCLAW_TELEGRAM_WEBHOOK_SECRET && env.OPENCLAW_TELEGRAM_ALLOWED_CHAT_ID
  && env.OPENCLAW_TELEGRAM_BOT_TOKEN && env.OPENCLAW_GITHUB_DISPATCH_TOKEN
  ? createTelegramHandler({
    kernel: createPostgresKernelAdapter({ query: (sql, values) => pool.query(sql, values) }),
    principalId: env.OPENCLAW_USER_INTAKE_PRINCIPAL,
    webhookSecret: env.OPENCLAW_TELEGRAM_WEBHOOK_SECRET,
    allowedChatId: env.OPENCLAW_TELEGRAM_ALLOWED_CHAT_ID,
    botToken: env.OPENCLAW_TELEGRAM_BOT_TOKEN,
    publicBaseUrl: env.OPENCLAW_PUBLIC_BASE_URL,
    dispatch: createWorkflowDispatcher({
      token: env.OPENCLAW_GITHUB_DISPATCH_TOKEN,
      repository: env.OPENCLAW_GITHUB_REPOSITORY ?? '2133611700c-sudo/opencloud-gpt-agent',
      workflow: 'v2-run-task.yml',
      ref: env.OPENCLAW_GITHUB_REF ?? 'v2/openclaw-clean-20261011',
    }),
  })
  : null;
export default {
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/research/tasks') return intake(request);
    if (pathname === '/telegram') return telegram ? telegram(request) : new Response('Not found', { status: 404 });
    return handler(request);
  },
};
