const requireFn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
};

const toResearchRequest = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Research node input_payload must be an object'), { code: 'INVALID_RESEARCH_NODE_INPUT' });
  }
  if (typeof payload.goal !== 'string' || payload.goal.trim() === '') {
    throw Object.assign(new Error('Research node input_payload.goal is required'), { code: 'INVALID_RESEARCH_NODE_INPUT' });
  }
  const request = payload.request == null ? {} : payload.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw Object.assign(new Error('Research node input_payload.request must be an object'), { code: 'INVALID_RESEARCH_NODE_INPUT' });
  }
  return Object.freeze({ ...structuredClone(request), goal: payload.goal.trim() });
};

export function createResearchWorker({ kernel, executeResearch, workerId, leaseSeconds = 30 } = {}) {
  if (!kernel || typeof kernel !== 'object') throw new TypeError('kernel must be an object');
  const claim = requireFn(kernel.claimNextNodeForAgent?.bind(kernel), 'kernel.claimNextNodeForAgent');
  const execute = requireFn(executeResearch, 'executeResearch');
  if (typeof workerId !== 'string' || workerId.trim() === '') throw new TypeError('workerId is required');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 3600) {
    throw new RangeError('leaseSeconds must be an integer between 5 and 3600');
  }

  return Object.freeze({
    async runOnce() {
      const lease = await claim({ workerId, agentId: 'researcher', leaseSeconds });
      if (!lease) return Object.freeze({ status: 'IDLE' });
      if (lease.agentId !== 'researcher') {
        throw Object.assign(new Error('agent-scoped claim returned a non-research node'), { code: 'AGENT_SCOPE_VIOLATION' });
      }
      const request = toResearchRequest(lease.inputPayload);
      const execution = await execute({ claim: lease, request });
      return Object.freeze({ status: 'EXECUTED', claim: lease, execution });
    },
  });
}

export { toResearchRequest };
