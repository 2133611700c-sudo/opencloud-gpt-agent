import { LeaseHeartbeatManager } from '../kernel/heartbeat.mjs';

export class ResearchExecutionAdapterError extends Error {
  constructor(message, { code = 'RESEARCH_EXECUTION_ADAPTER_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ResearchExecutionAdapterError';
    this.code = code;
  }
}

const requireFn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
};

const requireClaim = (claim) => {
  if (!claim || typeof claim !== 'object') throw new TypeError('claim must be an object');
  for (const field of ['taskId', 'nodeId', 'workerId']) {
    if (typeof claim[field] !== 'string' || claim[field].trim() === '') {
      throw new TypeError(`claim.${field} is required`);
    }
  }
  if (!Number.isSafeInteger(claim.leaseToken) || claim.leaseToken < 1) {
    throw new TypeError('claim.leaseToken must be a positive safe integer');
  }
  if (claim.agentId !== 'researcher') throw new TypeError('claim.agentId must be researcher');
  return claim;
};

export async function executeClaimedResearchNode({
  claim,
  request,
  reservation,
  heartbeat,
  runResearch,
  accountUsage,
  completeSuccess,
  failTerminal,
  releaseReservation,
  heartbeatIntervalMs = 10_000,
} = {}) {
  const lease = requireClaim(claim);
  const reserve = requireFn(reservation, 'reservation');
  const renew = requireFn(heartbeat, 'heartbeat');
  const run = requireFn(runResearch, 'runResearch');
  const account = requireFn(accountUsage, 'accountUsage');
  const complete = requireFn(completeSuccess, 'completeSuccess');
  const fail = requireFn(failTerminal, 'failTerminal');
  const release = requireFn(releaseReservation, 'releaseReservation');

  const reservationId = await reserve(lease);
  if (typeof reservationId !== 'string' || reservationId.trim() === '') {
    throw new ResearchExecutionAdapterError('budget reservation was rejected', { code: 'RESERVATION_REJECTED' });
  }

  const abortController = new AbortController();
  const heartbeatManager = new LeaseHeartbeatManager({
    intervalMs: heartbeatIntervalMs,
    abortController,
    renew: () => renew(lease),
  });

  let accounted = false;
  let terminalized = false;
  heartbeatManager.start();

  try {
    const research = await run({ request, signal: heartbeatManager.signal, claim: lease });
    if (heartbeatManager.failure) throw heartbeatManager.failure;

    await account({ claim: lease, reservationId, research });
    accounted = true;

    if (heartbeatManager.failure) throw heartbeatManager.failure;
    const completed = await complete({ claim: lease, result: research.result });
    if (completed !== true) {
      throw new ResearchExecutionAdapterError('fenced success completion was rejected', { code: 'SUCCESS_FENCE_REJECTED' });
    }
    terminalized = true;

    return Object.freeze({ status: 'SUCCESS', reservationId, research });
  } catch (error) {
    if (!terminalized) {
      try {
        const failed = await fail({
          claim: lease,
          error: {
            code: typeof error?.code === 'string' ? error.code : 'RESEARCH_EXECUTION_FAILED',
            message: typeof error?.message === 'string' ? error.message : 'Research execution failed',
          },
        });
        terminalized = failed === true;
      } catch {
        // The lease may already be lost/reclaimed. Never bypass fencing here.
      }
    }
    throw error;
  } finally {
    await heartbeatManager.stop();
    // Accounting normally reconciles/releases the reservation. On any path that
    // did not reach accounting, explicitly release under the original fence.
    if (!accounted) {
      try { await release({ claim: lease, reservationId, reason: 'RESEARCH_EXECUTION_ABORTED' }); }
      catch { /* cleanup is best-effort; durable finalizers remain authoritative */ }
    }
  }
}
