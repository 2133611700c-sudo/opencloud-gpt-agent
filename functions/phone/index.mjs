import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';
import { createPhoneHttpHandler } from '../../src/phone/phone-http-handler.mjs';
import { createPostgresKernelAdapter } from '../../src/kernel/postgres-kernel-adapter.mjs';
import { createUserHttpHandler } from '../../src/intake/user-http-handler.mjs';
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
export default {
  fetch(request) {
    return new URL(request.url).pathname === '/v1/research/tasks' ? intake(request) : handler(request);
  },
};
