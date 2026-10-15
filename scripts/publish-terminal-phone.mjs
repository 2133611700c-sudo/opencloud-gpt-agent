import { createPostgresTerminalEvidenceFinalizer } from '../src/evidence/postgres-terminal-evidence-finalizer.mjs';
import { createPsqlQuery } from '../src/kernel/psql-query.mjs';
import { createTerminalPhonePublication } from '../src/phone/terminal-phone-publication.mjs';
import { runtimeSensitiveValues } from '../src/runtime/runtime-sensitive-values.mjs';

// Publication-only recovery: no Research worker or provider runtime is imported.
try {
  const query = createPsqlQuery({ databaseUrl: process.env.DATABASE_URL });
  const finalizer = createPostgresTerminalEvidenceFinalizer({
    query, sensitiveValues: runtimeSensitiveValues(),
  });
  const publisher = createTerminalPhonePublication({ finalizer, publicBaseUrl: process.env.OPENCLAW_PUBLIC_BASE_URL });
  const result = await publisher.publish(process.env.OPENCLAW_TASK_ID);
  process.stdout.write(`${result.text}\n`);
} catch {
  process.stderr.write('PHONE_PUBLICATION_FAILED: retry publication for the same terminal task\n');
  process.exitCode = 1;
}
