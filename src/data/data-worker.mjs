import { HeartbeatRenewalError, LeaseHeartbeatManager, LeaseLostError } from '../kernel/heartbeat.mjs';
import { DataContractError, validateDataOutput } from './data-contract.mjs';
import { transformData } from './data-transformer.mjs';

export class DataWorkerError extends Error {
  constructor(message, { code = 'DATA_EXECUTION_FAILED' } = {}) {
    super(message);
    this.name = 'DataWorkerError';
    this.code = code;
  }
}

const contractCodes = new Set([
  'DATA_CONTRACT_INVALID', 'INVALID_SOURCE_URL', 'INVALID_REQUIRED_FIELDS',
  'DUPLICATE_REQUIRED_FIELD', 'SOURCES_REQUIRED', 'DUPLICATE_SOURCE_ID',
  'ITEMS_REQUIRED', 'DUPLICATE_ITEM_ID', 'UNSOURCED_ITEM', 'DUPLICATE_ITEM_SOURCE',
  'UNKNOWN_SOURCE_REFERENCE', 'REQUIRED_FIELD_MISSING', 'RESEARCH_NOT_SUCCESS',
  'UNSUPPORTED_DATA_SCHEMA_VERSION', 'DATA_OUTPUT_NOT_SUCCESS', 'INVALID_DATA_JSON',
]);
const taskStatuses = new Set(['PENDING', 'RUNNING', 'SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'AWAITING_APPROVAL', 'CANCELLED']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireFn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
};
const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
};

const safeFailure = (error) => {
  if (error instanceof DataContractError && contractCodes.has(error.code)) return error;
  if (error instanceof LeaseLostError || error instanceof HeartbeatRenewalError) return error;
  if (error instanceof DataWorkerError && error.code === 'DATA_INPUT_UNAVAILABLE') return error;
  return new DataWorkerError('Data execution failed');
};

export function createDataWorker({
  kernel,
  workerId,
  leaseSeconds = 30,
  heartbeatIntervalMs = Math.min(10_000, Math.floor(leaseSeconds * 1000 / 3)),
  transform = transformData,
} = {}) {
  if (!kernel || typeof kernel !== 'object') throw new TypeError('kernel must be an object');
  const normalizedWorkerId = requireText(workerId, 'workerId');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) {
    throw new RangeError('leaseSeconds must be an integer between 5 and 3600');
  }
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 || heartbeatIntervalMs >= leaseSeconds * 1000) {
    throw new RangeError('heartbeatIntervalMs must be positive and shorter than the lease');
  }
  const claimAny = requireFn(kernel.claimNextNodeForAgent?.bind(kernel), 'kernel.claimNextNodeForAgent');
  const claimTask = typeof kernel.claimNodeForTaskAndAgent === 'function' ? kernel.claimNodeForTaskAndAgent.bind(kernel) : null;
  const heartbeat = requireFn(kernel.heartbeat?.bind(kernel), 'kernel.heartbeat');
  const loadInput = requireFn(kernel.loadInput?.bind(kernel), 'kernel.loadInput');
  const completeSuccess = requireFn(kernel.completeSuccess?.bind(kernel), 'kernel.completeSuccess');
  const failTerminal = requireFn(kernel.failTerminal?.bind(kernel), 'kernel.failTerminal');
  const finalizeTask = requireFn(kernel.finalizeTask?.bind(kernel), 'kernel.finalizeTask');
  const processData = requireFn(transform, 'transform');

  const executeLease = async (claim, requestedTaskId = null) => {
    if (!claim) return Object.freeze({ status: 'IDLE' });
    if (claim.agentId !== 'data') throw new DataWorkerError('Data claim has the wrong agent', { code: 'AGENT_SCOPE_VIOLATION' });
    if (requestedTaskId !== null && claim.taskId !== requestedTaskId) {
      throw new DataWorkerError('Data claim has the wrong task', { code: 'TASK_SCOPE_VIOLATION' });
    }
    if (claim.workerId !== normalizedWorkerId) throw new DataWorkerError('Data claim has the wrong worker', { code: 'WORKER_SCOPE_VIOLATION' });
    requireText(claim.taskId, 'claim.taskId');
    requireText(claim.nodeId, 'claim.nodeId');
    if (typeof claim.leaseToken !== 'string' || !UUID_RE.test(claim.leaseToken)) {
      throw new TypeError('claim.leaseToken must be a UUID fencing token');
    }

    const fence = { nodeId: claim.nodeId, workerId: claim.workerId, leaseToken: claim.leaseToken };
    let leaseLost = false;
    const renew = async () => {
      try {
        if (await heartbeat({ ...fence, leaseSeconds }) !== true) throw new LeaseLostError();
        return true;
      } catch (error) {
        leaseLost = true;
        throw error instanceof LeaseLostError ? error : new HeartbeatRenewalError('Heartbeat renewal failed');
      }
    };
    const manager = new LeaseHeartbeatManager({ renew, intervalMs: heartbeatIntervalMs });
    const assertLease = () => {
      if (manager.failure) throw manager.failure;
      if (leaseLost) throw new LeaseLostError();
    };
    let result;
    manager.start();
    try {
      await renew();
      assertLease();
      const input = await loadInput(claim);
      assertLease();
      if (input === null) throw new DataWorkerError('Data input is unavailable under the active dependency and fence', { code: 'DATA_INPUT_UNAVAILABLE' });
      result = processData(input);
      validateDataOutput(result);
      await renew();
      assertLease();
      if (await completeSuccess({ ...fence, outputData: result }) !== true) {
        leaseLost = true;
        throw new DataWorkerError('Data completion was rejected by fencing', { code: 'SUCCESS_FENCE_REJECTED' });
      }
    } catch (error) {
      await manager.stop();
      if (leaseLost || manager.failure) throw manager.failure ?? error;
      const failure = safeFailure(error);
      let accepted;
      try {
        accepted = await failTerminal({
          ...fence,
          error: { code: failure.code, message: failure instanceof DataContractError ? 'Data contract validation failed' : 'Data execution failed' },
        });
      } catch {
        throw new DataWorkerError('Data terminal failure could not be confirmed', { code: 'DATA_FAILURE_NOT_CONFIRMED' });
      }
      if (accepted !== true) throw new DataWorkerError('Data terminal failure was rejected by fencing', { code: 'FAILURE_FENCE_REJECTED' });
      throw failure;
    } finally {
      await manager.stop();
    }

    // Node completion is authoritative; taskStatus separately reports the whole task.
    // Finalizer errors cannot downgrade the completed node.
    const taskStatus = await finalizeTask(claim.taskId);
    if (!taskStatuses.has(taskStatus)) throw new DataWorkerError('Data task finalization returned an invalid status', { code: 'DATA_FINALIZE_INVALID' });
    return Object.freeze({
      status: 'EXECUTED', claim,
      execution: Object.freeze({ status: 'SUCCESS', nodeStatus: 'SUCCESS', taskStatus, result }),
    });
  };

  return Object.freeze({
    async runOnce() {
      return executeLease(await claimAny({ workerId: normalizedWorkerId, agentId: 'data', leaseSeconds }));
    },
    async runTask(taskId) {
      const normalizedTaskId = requireText(taskId, 'taskId');
      if (!claimTask) throw new TypeError('kernel.claimNodeForTaskAndAgent must be a function');
      return executeLease(await claimTask({ taskId: normalizedTaskId, workerId: normalizedWorkerId, agentId: 'data', leaseSeconds }), normalizedTaskId);
    },
  });
}
