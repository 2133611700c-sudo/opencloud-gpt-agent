import { createEvidenceArtifact } from './evidence-contract.mjs';

export class TerminalEvidenceProducerError extends Error {
  constructor(message, { code = 'TERMINAL_EVIDENCE_PRODUCER_INVALID' } = {}) {
    super(message);
    this.name = 'TerminalEvidenceProducerError';
    this.code = code;
  }
}

const requireStore = (store) => {
  if (!store || typeof store !== 'object') throw new TypeError('store must be an object');
  for (const method of ['loadInput', 'persist', 'read']) {
    if (typeof store[method] !== 'function') throw new TypeError(`store.${method} must be a function`);
  }
  return store;
};

const sameDurableArtifact = (persisted, durable, artifact) => Boolean(
  persisted && durable
  && persisted.artifactId === durable.artifactId
  && persisted.uri === durable.uri
  && persisted.sha256 === durable.sha256
  && durable.sha256 === artifact.sha256
  && persisted.sizeBytes === durable.sizeBytes
  && durable.sizeBytes === artifact.sizeBytes
  && persisted.serialized === durable.serialized
  && durable.serialized === artifact.serialized
);

export async function persistTerminalEvidence({ store, taskId, sensitiveValues = [] } = {}) {
  const evidenceStore = requireStore(store);
  if (!Array.isArray(sensitiveValues)) throw new TypeError('sensitiveValues must be an array');

  const input = await evidenceStore.loadInput(taskId);
  if (!input || typeof input !== 'object' || !input.snapshot || typeof input.snapshot !== 'object'
      || typeof input.snapshotSha256 !== 'string') {
    throw new TerminalEvidenceProducerError('Terminal Evidence input is invalid', { code: 'TERMINAL_EVIDENCE_INPUT_INVALID' });
  }

  const artifact = createEvidenceArtifact(input.snapshot, { sensitiveValues });
  const persisted = await evidenceStore.persist({
    taskId,
    artifact,
    expectedSnapshotFingerprint: input.snapshotSha256,
    sensitiveValues,
  });
  const durable = await evidenceStore.read(taskId);
  if (!sameDurableArtifact(persisted, durable, artifact)) {
    throw new TerminalEvidenceProducerError('Durable Evidence read-back does not match persisted artifact', {
      code: 'TERMINAL_EVIDENCE_READBACK_MISMATCH',
    });
  }

  return Object.freeze({
    ...durable,
    created: persisted.created === true,
  });
}
