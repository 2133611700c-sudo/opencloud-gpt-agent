import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createPsqlQuery } from '../src/kernel/psql-query.mjs';
import { createPostgresTaskPhoneRuntime } from '../src/runtime/postgres-task-phone-runtime.mjs';
import { runUserTaskWorker } from '../src/runtime/user-task-worker.mjs';

try {
  const query = createPsqlQuery({
    databaseUrl: process.env.DATABASE_URL,
    // A Promise timeout cannot interrupt a synchronous psql child. Bound the
    // actual child and server statements; never forward unrelated parent env.
    execFileSyncImpl: (file, args, options) => execFileSync(file, args, {
      ...options, timeout: 15_000, killSignal: 'SIGKILL',
      env: { ...options.env, PGOPTIONS: '-c statement_timeout=12000 -c lock_timeout=10000' },
    }),
  });
  const runtime = createPostgresTaskPhoneRuntime({
    query, publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL,
    workerId: `user-task-${randomUUID()}`,
  });
  const result = await runUserTaskWorker({
    query, runtime, principalId: process.env.OPENCLAW_USER_INTAKE_PRINCIPAL,
    requestId: process.env.OPENCLAW_REQUEST_ID,
  });
  process.stdout.write(`${result.text ?? JSON.stringify(result)}\n`);
} catch {
  process.stderr.write('USER_TASK_WORKER_FAILED: inspect durable request; resume the same request id\n');
  process.exitCode = 1;
}
