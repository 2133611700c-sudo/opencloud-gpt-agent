import { executeClaimedResearchNode } from './research-execution-adapter.mjs';

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value;
};

const requireUsage = (research) => {
  const usage = research?.telemetry?.usage;
  if (!usage) throw Object.assign(new Error('Research usage telemetry is required for accounting'), { code: 'USAGE_TELEMETRY_REQUIRED' });
  return usage;
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
        const usage = requireUsage(research);
        const actualCostUsd = research.telemetry.costUsd;
        if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
          throw Object.assign(new Error('Research cost telemetry is required for accounting'), { code: 'COST_TELEMETRY_REQUIRED' });
        }
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
          promptCacheHitTokens: 0,
          promptCacheMissTokens: usage.input,
          completionTokens: usage.output,
          totalTokens: usage.total,
          actualCostUsd,
          latencyMs: research.process?.latencyMs ?? research.telemetry.toolSummary?.totalToolTimeMs ?? 0,
        });
        if (!accounted) throw Object.assign(new Error('model accounting was rejected by fencing'), { code: 'ACCOUNTING_FENCE_REJECTED' });
      },
      completeSuccess: ({ result }) => db.completeSuccess({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, outputData: result }),
      failTerminal: ({ error }) => db.failTerminal({ nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken, error }),
      releaseReservation: ({ reason }) => db.releaseReservation({ taskId: claim.taskId, nodeId: claim.nodeId, leaseToken: claim.leaseToken, reason }),
    });
  };
}
