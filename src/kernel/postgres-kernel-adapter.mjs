const requireQuery = (query) => {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  return query;
};

const one = async (query, text, values) => {
  const result = await query(text, values);
  return result?.rows?.[0] ?? null;
};

const mapClaim = (row, workerId) => row ? Object.freeze({
  nodeId: row.node_id,
  taskId: row.task_id,
  leaseToken: row.lease_token,
  agentId: row.agent_id,
  inputPayload: row.input_payload,
  attempt: row.attempt,
  workerId,
}) : null;

const mapAccounting = (row) => row ? Object.freeze({
  accountingId: row.accounting_id,
  created: row.created === true,
}) : null;

export function createPostgresKernelAdapter({ query } = {}) {
  const q = requireQuery(query);

  return Object.freeze({
    async claimNextNode({ workerId, leaseSeconds = 30 }) {
      const row = await one(q, 'SELECT * FROM claim_next_node($1, $2)', [workerId, leaseSeconds]);
      return mapClaim(row, workerId);
    },

    async claimNextNodeForAgent({ workerId, agentId, leaseSeconds = 30 }) {
      const row = await one(q, 'SELECT * FROM claim_next_node_for_agent($1, $2, $3)', [workerId, agentId, leaseSeconds]);
      return mapClaim(row, workerId);
    },

    async claimNodeForTaskAndAgent({ taskId, workerId, agentId, leaseSeconds = 30 }) {
      const row = await one(q, 'SELECT * FROM claim_node_for_task_and_agent($1, $2, $3, $4)', [taskId, workerId, agentId, leaseSeconds]);
      return mapClaim(row, workerId);
    },

    async heartbeat({ nodeId, workerId, leaseToken, leaseSeconds = 30 }) {
      const row = await one(q, 'SELECT heartbeat_node($1, $2, $3, $4) AS accepted', [nodeId, workerId, leaseToken, leaseSeconds]);
      return row?.accepted === true;
    },

    async reserve({ reservationKey, nodeId, workerId, leaseToken, reservedCostUsd, reservedTokens }) {
      const row = await one(q, 'SELECT reserve_node_budget($1, $2, $3, $4, $5, $6) AS reservation_id', [reservationKey, nodeId, workerId, leaseToken, reservedCostUsd, reservedTokens]);
      return row?.reservation_id ?? null;
    },

    async completeSuccess({ nodeId, workerId, leaseToken, outputData }) {
      const row = await one(q, 'SELECT complete_node_success($1, $2, $3, $4::jsonb) AS accepted', [nodeId, workerId, leaseToken, JSON.stringify(outputData ?? {})]);
      return row?.accepted === true;
    },

    async failTerminal({ nodeId, workerId, leaseToken, error }) {
      const row = await one(q, 'SELECT fail_node_terminal($1, $2, $3, $4::jsonb) AS accepted', [nodeId, workerId, leaseToken, JSON.stringify(error ?? {})]);
      return row?.accepted === true;
    },

    async releaseReservation({ taskId, nodeId, leaseToken, reason }) {
      const row = await one(q, 'SELECT release_reservations_for_lease($1, $2, $3, $4) AS released', [taskId, nodeId, leaseToken, reason]);
      return Number(row?.released ?? 0);
    },

    async recordLlmCall({ reservationId, callKey, nodeId, workerId, leaseToken, provider, model, pricingVersion, providerRequestId = null, promptCacheHitTokens = 0, promptCacheMissTokens, completionTokens, totalTokens, actualCostUsd, latencyMs }) {
      const row = await one(q, 'SELECT * FROM record_llm_call($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [reservationId, callKey, nodeId, workerId, leaseToken, provider, model, pricingVersion, providerRequestId, promptCacheHitTokens, promptCacheMissTokens, completionTokens, totalTokens, actualCostUsd, latencyMs]);
      return mapAccounting(row);
    },

    async recordLlmCallReservationFallback({ reservationId, callKey, nodeId, workerId, leaseToken, provider, model, pricingVersion, providerRequestId = null, latencyMs, reason }) {
      const row = await one(q, 'SELECT * FROM record_llm_call_reservation_fallback($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [reservationId, callKey, nodeId, workerId, leaseToken, provider, model, pricingVersion, providerRequestId, latencyMs, reason]);
      return mapAccounting(row);
    },
  });
}
