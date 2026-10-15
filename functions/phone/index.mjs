import { Pool } from 'pg';
import { attachDatabasePool } from '@neon/functions';
import { createPostgresEvidenceStoreV2 } from '../../src/evidence/postgres-evidence-store-v2.mjs';
import { createPhoneHttpHandler } from '../../src/phone/phone-http-handler.mjs';
import { phoneDatabaseOptions } from './database-config.mjs';

const pool = new Pool(phoneDatabaseOptions(process.env.DATABASE_URL));
attachDatabasePool(pool);
pool.on('error', () => console.error('PHONE_DATABASE_CONNECTION_LOST'));
const store = createPostgresEvidenceStoreV2({ query: (sql, values) => pool.query(sql, values) });
const handler = createPhoneHttpHandler({ read: store.read, publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL });
export default { fetch: handler };
