import { verifyHostedPostgresSchema } from '../src/kernel/hosted-postgres-schema-gate.mjs';
import { createPsqlQuery } from '../src/kernel/psql-query.mjs';

try {
  const query = createPsqlQuery({ databaseUrl: process.env.DATABASE_URL });
  const result = await verifyHostedPostgresSchema({ query });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    code: typeof error?.code === 'string' ? error.code : 'HOSTED_POSTGRES_VERIFY_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'Hosted PostgreSQL verification failed',
    counts: error?.counts ?? null,
  })}\n`);
  process.exitCode = 1;
}
