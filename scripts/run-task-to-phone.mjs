import { randomUUID } from 'node:crypto';
import { createPsqlQuery } from '../src/kernel/psql-query.mjs';
import { createPostgresTaskPhoneRuntime } from '../src/runtime/postgres-task-phone-runtime.mjs';

try {
  const runtime = createPostgresTaskPhoneRuntime({
    query: createPsqlQuery({ databaseUrl: process.env.DATABASE_URL }),
    publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL, workerId: `task-phone-${randomUUID()}`,
  });
  const result = await runtime.runTask(process.env.OPENCLAW_TASK_ID);
  process.stdout.write(`${result.text ?? JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('TASK_PHONE_RUNTIME_FAILED: inspect durable task; resume the same task id\n');
  process.exitCode = 1;
}
