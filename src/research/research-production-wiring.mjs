import { isAbsolute } from 'node:path';

import { createPostgresKernelAdapter } from '../kernel/postgres-kernel-adapter.mjs';
import {
  MissingResearchCredentialError,
  ResearchTrustRootError,
  runResearchAgent,
} from './research-agent-runner.mjs';
import { createResearchKernelExecutor } from './research-kernel-bindings.mjs';
import { createResearchWorker } from './research-worker.mjs';

export const DEFAULT_PRODUCTION_RESEARCH_MODEL = 'deepseek/deepseek-flash';

const requireFn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
};

const requireInteger = (value, name, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const preflightNativeResearchRuntime = ({ runResearchImpl, env }) => {
  if (runResearchImpl !== runResearchAgent) return;
  if (typeof env?.DEEPSEEK_API_KEY !== 'string' || env.DEEPSEEK_API_KEY.trim() === '') {
    throw new MissingResearchCredentialError();
  }
  if (typeof env?.OPENCLAW_STATE_DIR !== 'string' || env.OPENCLAW_STATE_DIR.trim() === '' || !isAbsolute(env.OPENCLAW_STATE_DIR)) {
    throw new ResearchTrustRootError();
  }
};

/**
 * Compose the production Research lane around one authoritative PostgreSQL Kernel.
 * The caller owns the database transport (`query`) and reservation estimate policy;
 * this factory owns the runtime wiring and guarantees that the same claim/fence flows
 * through reservation, native OpenClaw Research, accounting and completion.
 */
export function createProductionResearchWorker({
  query,
  workerId,
  pricingVersion,
  estimateReservation,
  model = DEFAULT_PRODUCTION_RESEARCH_MODEL,
  leaseSeconds = 30,
  heartbeatIntervalMs = 10_000,
  researchTimeoutMs = 120_000,
  researchEnv = process.env,
  researchConfigOptions = {},
  runResearchImpl = runResearchAgent,
} = {}) {
  requireFn(query, 'query');
  requireFn(estimateReservation, 'estimateReservation');
  requireFn(runResearchImpl, 'runResearchImpl');
  requireText(workerId, 'workerId');
  requireText(pricingVersion, 'pricingVersion');
  if (typeof model !== 'string' || !/^deepseek\/[A-Za-z0-9._:-]+$/.test(model)) {
    throw new TypeError('model must be a deepseek/<model> reference');
  }
  requireInteger(leaseSeconds, 'leaseSeconds', 5, 3600);
  requireInteger(heartbeatIntervalMs, 'heartbeatIntervalMs', 1, 3_600_000);
  requireInteger(researchTimeoutMs, 'researchTimeoutMs', 1, 300_000);
  const leaseDurationMs = leaseSeconds * 1000;
  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new RangeError('heartbeatIntervalMs must be less than the lease duration');
  }
  if (!researchConfigOptions || typeof researchConfigOptions !== 'object' || Array.isArray(researchConfigOptions)) {
    throw new TypeError('researchConfigOptions must be an object');
  }

  // Do not claim/fail a durable node merely because the live runtime is misconfigured.
  // Native credential/trust-root prerequisites are validated before worker construction.
  preflightNativeResearchRuntime({ runResearchImpl, env: researchEnv });

  const kernel = createPostgresKernelAdapter({ query });
  const executeKernelResearch = createResearchKernelExecutor({
    kernel,
    pricingVersion,
    estimateReservation,
    heartbeatIntervalMs,
    runResearch: ({ request, model: requestedModel, signal }) => runResearchImpl({
      request,
      model: requestedModel,
      signal,
      env: researchEnv,
      configOptions: researchConfigOptions,
      timeoutMs: researchTimeoutMs,
    }),
  });

  const executeResearch = ({ claim, request }) => executeKernelResearch({ claim, request, model });
  const worker = createResearchWorker({ kernel, executeResearch, workerId, leaseSeconds });

  return Object.freeze({
    runOnce: worker.runOnce,
    model,
    workerId,
  });
}
