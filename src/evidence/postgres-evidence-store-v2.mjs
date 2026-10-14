import { createPostgresEvidenceStore } from './postgres-evidence-store.mjs';

const ROUTES = Object.freeze([
  Object.freeze(['load_terminal_evidence_input_v1', 'load_terminal_evidence_input_v2']),
  Object.freeze(['persist_task_evidence_v1', 'persist_task_evidence_v2']),
  Object.freeze(['read_task_evidence_snapshot_v1', 'read_task_evidence_snapshot_v2']),
]);

const routeEvidenceSqlV2 = (sql) => {
  if (typeof sql !== 'string') throw new TypeError('evidence SQL must be a string');
  let routed = sql;
  for (const [v1, v2] of ROUTES) routed = routed.replace(v1, v2);
  return routed;
};

export function createPostgresEvidenceStoreV2({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const v2Query = (sql, values) => query(routeEvidenceSqlV2(sql), values);
  return createPostgresEvidenceStore({ query: v2Query });
}
