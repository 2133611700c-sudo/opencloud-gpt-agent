import { LeaseHeartbeatManager } from '../kernel/heartbeat.mjs';
import { admitResearchResultForData } from './research-result-admission.mjs';
import { isProxy } from 'node:util/types';
import { getRejectedResearchBilling } from './research-agent-runner.mjs';

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

const ownText = (value, key) => {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || isProxy(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && typeof descriptor.value === 'string' ? descriptor.value : null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireClaim = (claim) => {
  if (!claim || typeof claim !== 'object') throw new TypeError('claim must be an object');
  for (const field of ['taskId', 'nodeId', 'workerId']) {
    if (typeof claim[field] !== 'string' || claim[field].trim() === '') {
      throw new TypeError(`claim.${field} is required`);
    }
  }
  if (typeof claim.leaseToken !== 'string' || !UUID_RE.test(claim.leaseToken)) {
    throw new TypeError('claim.leaseToken must be a UUID fencing token');
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

  const abortController = new AbortController();
  const heartbeatManager = new LeaseHeartbeatManager({
    intervalMs: heartbeatIntervalMs,
    abortController,
    renew: () => renew(lease),
  });

  let reservationId = null;
  let accounted = false;
  let terminalized = false;
  heartbeatManager.start();

  try {
    reservationId = await reserve(lease);
    if (typeof reservationId !== 'string' || reservationId.trim() === '') {
      throw new ResearchExecutionAdapterError('budget reservation was rejected', { code: 'RESERVATION_REJECTED' });
    }
    if (heartbeatManager.failure) throw heartbeatManager.failure;

    let research;
    try {
      research = await run({ request, signal: heartbeatManager.signal, claim: lease });
    } catch (error) {
      const billing = getRejectedResearchBilling(error);
      if (billing) {
        if (heartbeatManager.failure) throw heartbeatManager.failure;
        try {
          const receipt = await account({ claim: lease, reservationId, research: billing.research, rejectionCode: billing.originalCode });
          const accountingId = ownText(receipt, 'accountingId');
          if (accountingId === null || accountingId.trim() === '') throw new Error();
          accounted = true;
        } catch {
          throw new ResearchExecutionAdapterError(
            `Accounting for rejected Research was not accepted (${billing.originalCode})`,
            { code: 'REJECTED_RESEARCH_ACCOUNTING_FAILED' },
          );
        }
      }
      throw error;
    }
    if (heartbeatManager.failure) throw heartbeatManager.failure;

    await account({ claim: lease, reservationId, research });
    accounted = true;

    if (heartbeatManager.failure) throw heartbeatManager.failure;
    const admittedResult = request && typeof request === 'object' && !Array.isArray(request)
      ? admitResearchResultForData({ request, result: research.result })
      : research.result;
    const completed = await complete({ claim: lease, result: admittedResult });
    if (completed !== true) {
      throw new ResearchExecutionAdapterError('fenced success completion was rejected', { code: 'SUCCESS_FENCE_REJECTED' });
    }
    terminalized = true;

    const admittedResearch = admittedResult === research.result
      ? research
      : Object.freeze({ ...research, result: admittedResult });
    return Object.freeze({ status: 'SUCCESS', reservationId, research: admittedResearch });
  } catch (error) {
    if (!terminalized) {
      try {
        const failed = await fail({
          claim: lease,
          error: {
            code: ownText(error, 'code') ?? 'RESEARCH_EXECUTION_FAILED',
            message: ownText(error, 'message') ?? 'Research execution failed',
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
    // Accounting normally reconciles/releases the reservation. Only release when
    // reservation acquisition actually succeeded and accounting did not run.
    if (!accounted && typeof reservationId === 'string' && reservationId.trim() !== '') {
      try { await release({ claim: lease, reservationId, reason: 'RESEARCH_EXECUTION_ABORTED' }); }
      catch { /* cleanup is best-effort; durable finalizers remain authoritative */ }
    }
  }
}
