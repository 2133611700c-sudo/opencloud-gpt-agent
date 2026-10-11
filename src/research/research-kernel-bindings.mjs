import { executeClaimedResearchNode } from './research-execution-adapter.mjs';

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value;
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
  if (usage.total < usage.input + usage.output) {
    throw Object.assign(new Error('Research usage telemetry total is smaller than input + output'), { code: 'USAGE_TELEMETRY_INVALID' });
  }
  if (usage.cacheRead != null && usage.cacheWrite != null) {
    const expected = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (!Number.isSafeInteger(expected) || usage.total !== expected) {
      throw Object.assign(new Error('Research usage telemetry total is inconsistent with cache split'), { code: 'USAGE_TELEMETRY_INVALID' });
    }
  }
  return usage;
};

const latencyMsFor = (research) => {
  const value = research?.process?.latencyMs ?? research?.telemetry?.toolSummary?.totalToolTimeMs ?? 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

export function createResearchKernelExecutor({ kernel, runResearch, pricingVersion, estimateReservation, heartbeatIntervalMs = 10_000 } = {}) {
  const db = requireObject(kernel, 'kernel');
  if (typeof runResearch !== 'function') throw new TypeError('runResearch must be a function');
  if (typeof estimateReservation !== 'function') throw new TypeError('estimateReservation must be a function');
  requireText(pricingVersion, 'pricingVersion');

  return async function execute({ claim, request, model = 'deepseek/deepseek-flash' } = {}) {
    const estimate = await estimateReservation({ claim, request, model });
    if (!estimate || !Number.isFinite(estimate.costUsd) || estimate.costUsd < 0 || !Number.isSafeInteger(estimate.tokens) || estimate.tokens < 0) {
      throw new TypeError('estimateReservation must return nonnegative costUsd and tokens');
    }
    const reservationKey = `research:${claim.taskId}:${claim.nodeId}:${claim.leaseToken}`;

    return executeClaimedResearchNode({
      claim,
      request,
      heartbeatIntervalMs,
      reservation: () => db.reserve({ reservationKey, nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, reservedCostUsd: estimate.costUsd, reservedTokens: estimate.tokens }),
      heartbeat: () => db.heartbeat({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken }),
      runResearch: ({ request: input, signal }) => runResearch({ request: input, model, signal }),
      accountUsage: async ({ reservationId, research }) => {
        const rawUsage = research?.telemetry?.usage;
        const rawCostUsd = research?.telemetry?.costUsd;
        const latencyMs = latencyMsFor(research);
        const missingUsage = rawUsage == null;
        const missingCost = rawCostUsd == null;
        const usage = missingUsage ? null : requireUsage(rawUsage);
        const missingCacheSplit = usage != null && (usage.cacheRead == null || usage.cacheWrite == null);

        if (missingUsage || missingCost || missingCacheSplit) {
          if (typeof db.recordLlmCallReservationFallback !== 'function') {
            throw Object.assign(new Error('reservation fallback accounting capability is required'), { code: 'ACCOUNTING_FALLBACK_UNAVAILABLE' });
          }
          const reason = missingUsage && missingCost
            ? 'MISSING_USAGE_AND_COST_TELEMETRY'
            : missingUsage
              ? 'MISSING_USAGE_TELEMETRY'
              : missingCost
                ? 'MISSING_COST_TELEMETRY'
                : 'MISSING_CACHE_SPLIT_TELEMETRY';
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

        if (!Number.isFinite(rawCostUsd) || rawCostUsd < 0) {
          throw Object.assign(new Error('Research cost telemetry is invalid'), { code: 'COST_TELEMETRY_INVALID' });
        }
        const promptCacheMissTokens = usage.input + usage.cacheWrite;
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
          promptCacheHitTokens: usage.cacheRead,
          promptCacheMissTokens,
          completionTokens: usage.output,
          totalTokens: usage.total,
          actualCostUsd: rawCostUsd,
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
