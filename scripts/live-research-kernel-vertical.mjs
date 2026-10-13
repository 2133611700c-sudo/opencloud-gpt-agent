import { randomUUID } from 'node:crypto';

import { createPostgresDataAdapter } from '../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../src/data/data-worker.mjs';
import { createPsqlQuery } from '../src/kernel/psql-query.mjs';
import {
  createProductionResearchWorker,
  DEFAULT_PRODUCTION_RESEARCH_MODEL,
} from '../src/research/research-production-wiring.mjs';
import { runLiveResearchKernelGate } from '../src/research/research-live-kernel-gate.mjs';

const model = process.env.OPENCLAW_DEEPSEEK_MODEL || DEFAULT_PRODUCTION_RESEARCH_MODEL;
const pricingVersion = process.env.OPENCLAW_DEEPSEEK_PRICING_VERSION || 'deepseek-v4.1-flash-2026-09-10';
const id = randomUUID();

try {
  const query = createPsqlQuery({ databaseUrl: process.env.DATABASE_URL });
  const dataWorker = createDataWorker({
    kernel: createPostgresDataAdapter({ query }),
    workerId: `live-data-${id}`,
    leaseSeconds: 60,
    heartbeatIntervalMs: 10_000,
  });
  const worker = createProductionResearchWorker({
    query,
    workerId: `live-research-${id}`,
    pricingVersion,
    model,
    leaseSeconds: 60,
    heartbeatIntervalMs: 10_000,
    researchTimeoutMs: 120_000,
    researchEnv: process.env,
    researchConfigOptions: {
      maxSearchResults: 5,
      searchTimeoutSeconds: 20,
      fetchTimeoutSeconds: 30,
      fetchMaxChars: 20_000,
    },
    estimateReservation: async () => ({ costUsd: 0.10, tokens: 50_000 }),
  });

  const evidence = await runLiveResearchKernelGate({
    query,
    worker,
    dataWorker,
    idempotencyKey: `ci-live-research-${id}`,
  });

  process.stdout.write(`${JSON.stringify({
    ...evidence,
    provider: 'deepseek',
    requested_model: model,
    pricing_version: pricingVersion,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    code: typeof error?.code === 'string' ? error.code : 'LIVE_RESEARCH_KERNEL_GATE_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'Live Research Kernel gate failed',
  })}\n`);
  process.exitCode = 1;
}
