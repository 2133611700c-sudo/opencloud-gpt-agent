import { executeClaimedResearchNode } from './research-execution-adapter.mjs';

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value;
};

const requireEstimate = (estimate) => {
  if (!estimate || !Number.isFinite(estimate.costUsd) || estimate.costUsd < 0 || !Number.isSafeInteger(estimate.tokens) || estimate.tokens < 0) {
    throw Object.assign(new TypeError('estimateReservation must return nonnegative costUsd and tokens'), {
      code: 'INVALID_RESERVATION_ESTIMATE',
    });
  }
  return estimate;
};

const requireUsage = (usage) => {
  if (!usage || typeof usage !== 'object') {
    throw Object.assign(new Error('Research usage telemetry is invalid'), { code: 'USAGE_TELEMETRY_INVALID' });
  }
  for (const field of ['input', 'output', 'total']) {
    if (!Number.isSafeInteger(usage[field]) || usage[field] < 0) {
      throw Object.assign(new Error(`Research usage telemetry ${field} must be a nonnegative safe integer`), { code: 'USAGE_TELEMETRY_INVALID' });
    }
  }
  for (const field of ['cacheRead', 'cacheWrite']) {
    if (usage[field] != null && (!Number.isSafeInteger(usage[field]) || usage[field] < 0)) {
      throw Object.assign(new Error(`Research usage telemetry ${field} must be null or a nonnegative safe integer`), { code: 'USAGE_TELEMETRY_INVALID' });
    }
  }
  const expectedTotal = usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  if (usage.total !== expectedTotal) {
    throw Object.assign(new Error('Research usage telemetry total must equal input + output + cacheRead + cacheWrite'), { code: 'USAGE_TELEMETRY_INVALID' });
  }
  return usage;
};

const requireObservedCost = (costUsd) => {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw Object.assign(new Error('Research cost telemetry is invalid'), { code: 'COST_TELEMETRY_INVALID' });
  }
  return costUsd;
};

const latencyMsFor = (research) => {
  const value = research?.process?.latencyMs;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw Object.assign(new Error('Research process latency measurement is invalid'), { code: 'INVALID_PROCESS_LATENCY' });
  }
  return value;
};

export function createResearchKernelExecutor({ kernel, runResearch, pricingVersion, estimateReservation, heartbeatIntervalMs = 10_000 } = {}) {
  const db = requireObject(kernel, 'kernel');
  if (typeof runResearch !== 'function') throw new TypeError('runResearch must be a function');
  if (typeof estimateReservation !== 'function') throw new TypeError('estimateReservation must be a function');
  requireText(pricingVersion, 'pricingVersion');

  return async function execute({ claim, request, model = 'deepseek/deepseek-flash' } = {}) {
    const reservationKey = `research:${claim.taskId}:${claim.nodeId}:${claim.leaseToken}`;

    return executeClaimedResearchNode({
      claim,
      request,
      heartbeatIntervalMs,
      reservation: async () => {
        const estimate = requireEstimate(await estimateReservation({ claim, request, model }));
        return db.reserve({
          reservationKey,
          nodeId: claim.nodeId,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          reservedCostUsd: estimate.costUsd,
          reservedTokens: estimate.tokens,
        });
      },
      heartbeat: () => db.heartbeat({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken }),
      runResearch: ({ request: input, signal }) => runResearch({ request: input, model, signal }),
      accountUsage: async ({ reservationId, research }) => {
        const rawUsage = research?.telemetry?.usage;
        const rawCostUsd = research?.telemetry?.costUsd;
        const latencyMs = latencyMsFor(research);
        const missingUsage = rawUsage == null;
        const missingCost = rawCostUsd == null;
        const usage = missingUsage ? null : requireUsage(rawUsage);
        const observedCostUsd = missingCost ? null : requireObservedCost(rawCostUsd);
        const missingCacheRead = usage != null && usage.cacheRead == null;
        const zeroCostWithUsage = usage != null && usage.total > 0 && observedCostUsd === 0;

        if (missingUsage || missingCost || missingCacheRead || zeroCostWithUsage) {
          if (typeof db.recordLlmCallReservationFallback !== 'function') {
            throw Object.assign(new Error('reservation fallback accounting capability is required'), { code: 'ACCOUNTING_FALLBACK_UNAVAILABLE' });
          }
          const reason = missingUsage && missingCost
            ? 'MISSING_USAGE_AND_COST_TELEMETRY'
            : missingUsage
              ? 'MISSING_USAGE_TELEMETRY'
              : missingCost
                ? 'MISSING_COST_TELEMETRY'
                : missingCacheRead
                  ? 'MISSING_CACHE_READ_TELEMETRY'
                  : 'ZERO_COST_WITH_NONZERO_USAGE';
          const accounted = await db.recordLlmCallReservationFallback({
            reservationId,
            callKey: reservationKey,
            nodeId: claim.nodeId,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            provider: 'deepseek',
            model: model.replace(/^deepseek\//, ''),
            pricingVersion,
            providerRequestId: research?.telemetry?.sessionId ?? null,
            latencyMs,
            reason,
          });
          if (!accounted) throw Object.assign(new Error('fallback model accounting was rejected by fencing'), { code: 'ACCOUNTING_FENCE_REJECTED' });
          return;
        }

        const promptCacheHitTokens = usage.cacheRead;
        // OpenClaw reports uncached input, cache reads, and cache writes as separate buckets.
        // The kernel schema has hit/miss prompt buckets, so cache writes are conservatively
        // classified with misses while observed provider cost remains authoritative.
        const promptCacheMissTokens = usage.input + (usage.cacheWrite ?? 0);
        const accounted = await db.recordLlmCall({
          reservationId,
          callKey: reservationKey,
          nodeId: claim.nodeId,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          provider: 'deepseek',
          model: model.replace(/^deepseek\//, ''),
          pricingVersion,
          providerRequestId: research.telemetry.sessionId,
          promptCacheHitTokens,
          promptCacheMissTokens,
          completionTokens: usage.output,
          totalTokens: usage.total,
          actualCostUsd: observedCostUsd,
          latencyMs,
        });
        if (!accounted) throw Object.assign(new Error('model accounting was rejected by fencing'), { code: 'ACCOUNTING_FENCE_REJECTED' });
      },
      completeSuccess: ({ result }) => db.completeSuccess({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, outputData: result }),
      failTerminal: ({ error }) => db.failTerminal({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, error }),
      releaseReservation: ({ reason }) => db.releaseReservation({ taskId: claim.taskId, nodeId: claim.nodeId, leaseToken: claim.leaseToken, reason }),
    });
  };
}
