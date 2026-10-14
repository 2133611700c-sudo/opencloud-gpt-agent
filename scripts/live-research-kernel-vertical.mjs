import { randomUUID } from 'node:crypto';

import { createPostgresDataAdapter } from '../src/data/postgres-data-adapter.mjs';
import { createDataWorker } from '../src/data/data-worker.mjs';
import { finalizeLiveRuntimeEvidence } from '../src/evidence/live-runtime-evidence-gate.mjs';
import { createPostgresTerminalEvidenceFinalizer } from '../src/evidence/postgres-terminal-evidence-finalizer.mjs';
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
  // Set to true only for an operator-controlled outbound proxy. Presence of
  // HTTP(S)_PROXY alone does not enable trust; direct networking remains default.
  const proxyFlag = process.env.OPENCLAW_WEB_FETCH_TRUSTED_ENV_PROXY;
  if (proxyFlag != null && proxyFlag !== 'true' && proxyFlag !== 'false') {
    throw new TypeError('OPENCLAW_WEB_FETCH_TRUSTED_ENV_PROXY must be true or false');
  }
  const query = createPsqlQuery({ databaseUrl: process.env.DATABASE_URL });
  const evidenceFinalizer = createPostgresTerminalEvidenceFinalizer({ query });
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
      fetchUseTrustedEnvProxy: proxyFlag === 'true',
    },
    estimateReservation: async () => ({ costUsd: 0.10, tokens: 50_000 }),
  });

  const evidence = await runLiveResearchKernelGate({
    query,
    worker,
    dataWorker,
    idempotencyKey: `ci-live-research-${id}`,
  });
  const sensitiveValues = [process.env.DEEPSEEK_API_KEY, process.env.DATABASE_URL]
    .filter((value) => typeof value === 'string' && value.length > 0);
  const durableEvidence = await finalizeLiveRuntimeEvidence({
    finalizer: evidenceFinalizer,
    evidence,
    model,
    sensitiveValues,
  });

  process.stdout.write(`${JSON.stringify({
    ...evidence,
    provider: 'deepseek',
    requested_model: model,
    pricing_version: pricingVersion,
    evidence_artifact_id: durableEvidence.artifactId,
    evidence_uri: durableEvidence.uri,
    evidence_sha256: durableEvidence.sha256,
    runtime_receipt_count: durableEvidence.runtimeReceiptCount,
    runtime_receipt_id: durableEvidence.runtimeReceiptId,
    runtime_session_id: durableEvidence.runtimeSessionId,
    evidence_tools: durableEvidence.tools,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    code: typeof error?.code === 'string' ? error.code : 'LIVE_RESEARCH_KERNEL_GATE_FAILED',
    message: typeof error?.message === 'string' ? error.message : 'Live Research Kernel gate failed',
  })}\n`);
  process.exitCode = 1;
}
