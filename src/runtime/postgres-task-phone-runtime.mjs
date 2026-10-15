import { createDataWorker } from '../data/data-worker.mjs';
import { createPostgresDataAdapter } from '../data/postgres-data-adapter.mjs';
import { createPostgresTerminalEvidenceFinalizer } from '../evidence/postgres-terminal-evidence-finalizer.mjs';
import { createTerminalPhonePublication } from '../phone/terminal-phone-publication.mjs';
import { createProductionResearchWorker } from '../research/research-production-wiring.mjs';
import { createTaskPhoneRuntime } from './task-phone-runtime.mjs';

/** Production composition; caller owns the PostgreSQL transport and lifecycle. */
export function createPostgresTaskPhoneRuntime({ query, publicBaseUrl, workerId, env = process.env, fetchImpl = fetch } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  if (typeof workerId !== 'string' || !workerId.trim()) throw new TypeError('workerId is required');
  const proxyFlag = env.OPENCLAW_WEB_FETCH_TRUSTED_ENV_PROXY;
  if (proxyFlag != null && !['true', 'false'].includes(proxyFlag)) throw new TypeError('Invalid trusted proxy configuration');
  const finalizer = createPostgresTerminalEvidenceFinalizer({
    query,
    sensitiveValues: [env.DEEPSEEK_API_KEY, env.DATABASE_URL].filter((v) => typeof v === 'string' && v.length > 0),
  });
  const publisher = createTerminalPhonePublication({ finalizer, publicBaseUrl, fetchImpl });
  const researchWorker = createProductionResearchWorker({
    query, workerId: `${workerId}-research`, leaseSeconds: 60, heartbeatIntervalMs: 10_000,
    pricingVersion: 'deepseek-v4.1-flash-2026-09-10', researchTimeoutMs: 120_000, researchEnv: env,
    researchConfigOptions: {
      maxSearchResults: 5, searchTimeoutSeconds: 20, fetchTimeoutSeconds: 30,
      fetchMaxChars: 20_000, fetchUseTrustedEnvProxy: proxyFlag === 'true',
    },
    estimateReservation: async () => ({ costUsd: 0.10, tokens: 50_000 }),
  });
  const dataWorker = createDataWorker({
    kernel: createPostgresDataAdapter({ query }), workerId: `${workerId}-data`,
    leaseSeconds: 60, heartbeatIntervalMs: 10_000,
  });
  return createTaskPhoneRuntime({
    researchWorker, dataWorker, publisher,
    readTaskStatus: async (taskId) => {
      const result = await query('SELECT status FROM tasks WHERE id=$1', [taskId]);
      return result.rows?.length === 1 ? result.rows[0].status : null;
    },
  });
}
