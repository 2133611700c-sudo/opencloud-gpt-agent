import { createPostgresEvidenceStoreV2 } from './postgres-evidence-store-v2.mjs';
import { persistTerminalEvidence } from './terminal-evidence-producer.mjs';

const requireSensitiveValues = (value) => {
  if (!Array.isArray(value)) throw new TypeError('sensitiveValues must be an array');
  return Object.freeze([...value]);
};

/**
 * Production PostgreSQL Evidence finalizer for receipt-bound terminal snapshots.
 * The v2 store binds Evidence to runtime_receipts, while the producer performs
 * canonical derivation, immutable persistence and durable read-back verification.
 */
export function createPostgresTerminalEvidenceFinalizer({ query, sensitiveValues = [] } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const defaults = requireSensitiveValues(sensitiveValues);
  const store = createPostgresEvidenceStoreV2({ query });

  return Object.freeze({
    async finalize(taskId, options = {}) {
      if (options == null || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('options must be an object');
      }
      const scopedSensitiveValues = Object.hasOwn(options, 'sensitiveValues')
        ? requireSensitiveValues(options.sensitiveValues)
        : defaults;
      return persistTerminalEvidence({
        store,
        taskId,
        sensitiveValues: scopedSensitiveValues,
      });
    },
  });
}
