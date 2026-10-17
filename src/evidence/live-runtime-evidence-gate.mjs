export class LiveRuntimeEvidenceGateError extends Error {
  constructor(message, { code = 'LIVE_RUNTIME_EVIDENCE_NOT_PROVEN' } = {}) {
    super(message);
    this.name = 'LiveRuntimeEvidenceGateError';
    this.code = code;
  }
}

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
};

const normalizedDeepSeekModel = (model) => requireText(model, 'model').replace(/^deepseek\//, '');
const hasRequiredWebTools = (summary) => Array.isArray(summary?.tools)
  && summary.failures === 0
  && summary.tools.includes('web_search')
  && summary.tools.includes('web_fetch');

export function assertLiveRuntimeEvidenceProof({ receipt, taskId, model } = {}) {
  const durable = requireObject(receipt, 'receipt');
  const expectedTaskId = requireText(taskId, 'taskId');
  const expectedModel = normalizedDeepSeekModel(model);
  const bundle = requireObject(durable.bundle, 'receipt.bundle');
  const coverage = requireObject(bundle.coverage, 'receipt.bundle.coverage');
  const runtimeReceipts = Array.isArray(bundle.runtimeReceipts) ? bundle.runtimeReceipts : [];

  if (durable.taskId !== expectedTaskId || bundle.task?.id !== expectedTaskId) {
    throw new LiveRuntimeEvidenceGateError('Durable Evidence references another task', { code: 'LIVE_RUNTIME_EVIDENCE_TASK_MISMATCH' });
  }
  if (typeof durable.artifactId !== 'string' || typeof durable.uri !== 'string' || typeof durable.sha256 !== 'string') {
    throw new LiveRuntimeEvidenceGateError('Durable Evidence identity is incomplete');
  }
  if (coverage.runtimeReceiptsPresent !== true || coverage.toolMetadataPresent !== true || runtimeReceipts.length < 1) {
    throw new LiveRuntimeEvidenceGateError('Durable Evidence does not contain runtime receipt tool metadata');
  }

  const proven = runtimeReceipts.find((row) => row?.observed?.provider === 'deepseek'
    && row.observed.model === expectedModel
    && row?.configured?.runtimeVersion === '2026.10.3'
    && row.configured.requestedModel === model
    && row.configured.thinkingLevel === 'max'
    && row.error === null
    && hasRequiredWebTools(row.observed.toolSummary));
  if (!proven) {
    throw new LiveRuntimeEvidenceGateError('Durable Evidence does not prove the pinned DeepSeek web runtime');
  }

  return Object.freeze({
    artifactId: durable.artifactId,
    uri: durable.uri,
    sha256: durable.sha256,
    runtimeReceiptCount: runtimeReceipts.length,
    runtimeReceiptId: proven.id,
    runtimeSessionId: proven.observed.sessionId ?? null,
    tools: Object.freeze([...proven.observed.toolSummary.tools]),
  });
}

export async function finalizeLiveRuntimeEvidence({ finalizer, evidence, model, sensitiveValues = [] } = {}) {
  const target = requireObject(finalizer, 'finalizer');
  if (typeof target.finalize !== 'function') throw new TypeError('finalizer.finalize must be a function');
  const gateEvidence = requireObject(evidence, 'evidence');
  const taskId = requireText(gateEvidence.task_id, 'evidence.task_id');
  if (!Array.isArray(sensitiveValues)) throw new TypeError('sensitiveValues must be an array');
  const receipt = await target.finalize(taskId, { sensitiveValues });
  return assertLiveRuntimeEvidenceProof({ receipt, taskId, model });
}
