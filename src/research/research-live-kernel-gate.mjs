import { isDeepStrictEqual } from 'node:util';
import { validateDataOutput } from '../data/data-contract.mjs';
import { transformData } from '../data/data-transformer.mjs';

const gateError = (message, code, extras = {}) => Object.assign(new Error(message), { code, ...extras });

const requireFn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
};

const requireObject = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
};

const requireText = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
};

const FAILED_TERMINAL_TASK_STATUSES = new Set(['FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED']);

const normalizeRequiredDomains = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('live gate request.constraints.requiredDomains must contain at least one domain');
  }
  const domains = value.map((domain) => {
    if (typeof domain !== 'string' || domain.trim() === '') {
      throw new TypeError('live gate requiredDomains entries must be non-empty hostnames');
    }
    const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
    try {
      const parsed = new URL(`https://${normalized}`);
      if (parsed.hostname !== normalized || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
        throw new Error('not a plain hostname');
      }
    } catch {
      throw new TypeError(`invalid live gate required domain: ${domain}`);
    }
    return normalized;
  });
  return Object.freeze([...new Set(domains)]);
};

const sourceUrl = (source) => {
  try {
    const url = new URL(source?.url);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

const isOfficialDeepSeekSource = (source) => {
  const url = sourceUrl(source);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'deepseek.com' || host.endsWith('.deepseek.com');
};

const isRequiredDomainSource = (source, requiredDomains) => {
  const url = sourceUrl(source);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return requiredDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

const hasFieldValue = (data, field) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!Object.prototype.hasOwnProperty.call(data, field)) return false;
  const value = data[field];
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
};

const acceptedEvidenceItems = (result, requiredFields, acceptedSourceIds) => {
  if (!Array.isArray(result?.items)) return [];
  return result.items.filter((item) => {
    if (!requiredFields.every((field) => hasFieldValue(item?.data, field))) return false;
    if (!Array.isArray(item?.sourceIds)) return false;
    return item.sourceIds.some((sourceId) => acceptedSourceIds.has(sourceId));
  });
};

const activeQueueCount = async (query, agentId) => {
  const result = await query(
    `SELECT count(*)::int AS active_count
     FROM task_nodes n
     WHERE n.agent_id=$1
       AND n.status IN ('PENDING','RUNNING','AWAITING_APPROVAL')`,
    [agentId],
  );
  return Number(result?.rows?.[0]?.active_count ?? 0);
};

const cancelFailedGateTask = async (query, taskId, originalError) => {
  const originalCode = typeof originalError?.code === 'string' ? originalError.code : 'LIVE_GATE_FAILED';
  try {
    const cleanup = await query(
      'SELECT cancel_task($1,$2,$3::jsonb) AS cancelled',
      [taskId, 'LIVE_GATE_FAILED', JSON.stringify({ gate: 'research-live-kernel', originalCode })],
    );
    if (cleanup?.rows?.[0]?.cancelled === true) return;

    const statusResult = await query('SELECT status FROM tasks WHERE id=$1', [taskId]);
    const taskStatus = statusResult?.rows?.[0]?.status ?? null;
    if (FAILED_TERMINAL_TASK_STATUSES.has(taskStatus)) return;

    throw gateError(
      `live gate failed with ${originalCode} and task cleanup was rejected; task_status=${String(taskStatus)}`,
      'LIVE_GATE_CLEANUP_FAILED',
      { originalCode, taskStatus },
    );
  } catch (cleanupError) {
    if (cleanupError?.code === 'LIVE_GATE_CLEANUP_FAILED' && cleanupError?.originalCode === originalCode) {
      throw cleanupError;
    }
    throw gateError(
      `live gate failed with ${originalCode} and task cleanup failed`,
      'LIVE_GATE_CLEANUP_FAILED',
      { originalCode, cause: cleanupError },
    );
  }
};

/**
 * Positive live gate for the 48h Research vertical.
 * Research is followed by the production Data worker. Durable canonical output,
 * terminal task state and zero Data model spend are checked independently.
 */
export async function runLiveResearchKernelGate({
  query,
  worker,
  dataWorker,
  idempotencyKey,
  now = () => new Date(),
  goal = 'Using official DeepSeek API documentation, identify the current release served by API model id deepseek-flash. Return modelId and modelVersion.',
  request = {
    maxResults: 3,
    requiredFields: ['modelId', 'modelVersion'],
    constraints: { requiredDomains: ['api-docs.deepseek.com'] },
  },
} = {}) {
  const q = requireFn(query, 'query');
  const researchWorker = requireObject(worker, 'worker');
  const runTask = requireFn(researchWorker.runTask?.bind(researchWorker), 'worker.runTask');
  const productionDataWorker = requireObject(dataWorker, 'dataWorker');
  const runDataTask = requireFn(productionDataWorker.runTask?.bind(productionDataWorker), 'dataWorker.runTask');
  const key = requireText(idempotencyKey, 'idempotencyKey');
  const requiredFields = Array.isArray(request?.requiredFields) ? [...request.requiredFields] : [];
  if (requiredFields.length === 0 || requiredFields.some((field) => typeof field !== 'string' || field.trim() === '')) {
    throw new TypeError('live gate request.requiredFields must contain at least one non-empty field');
  }
  const requiredDomains = normalizeRequiredDomains(request?.constraints?.requiredDomains);
  const requestPayload = JSON.stringify(request);
  const immutableRequest = JSON.parse(requestPayload);

  const existingResearch = await activeQueueCount(q, 'researcher');
  const existingData = await activeQueueCount(q, 'data');
  if (existingResearch !== 0 || existingData !== 0) {
    throw gateError(`live gate requires an isolated queue; researcher=${existingResearch}, data=${existingData}`, 'LIVE_QUEUE_NOT_ISOLATED');
  }

  let taskId = null;
  try {
    const deadline = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
    const created = await q(
      'SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)',
      [key, goal, requestPayload, 0.25, 100_000, 4, deadline],
    );
    taskId = created?.rows?.[0]?.task_id;
    if (typeof taskId !== 'string' || taskId === '') throw gateError('live gate task creation failed', 'LIVE_TASK_CREATE_FAILED');

    const execution = await runTask(taskId);
    if (execution?.status !== 'EXECUTED' || execution?.claim?.taskId !== taskId) {
      throw gateError('Research worker did not execute the live gate task', 'LIVE_RESEARCH_CLAIM_MISMATCH');
    }
    const research = execution?.execution?.research;
    if (execution?.execution?.status !== 'SUCCESS' || research?.result?.status !== 'SUCCESS') {
      throw gateError('live Research execution did not return SUCCESS', 'LIVE_RESEARCH_NOT_SUCCESS');
    }
    if (!Array.isArray(research.result.sources) || research.result.sources.length < 1) {
      throw gateError('live Research SUCCESS has no sources', 'LIVE_RESEARCH_NO_SOURCES');
    }
    const officialSources = research.result.sources.filter(isOfficialDeepSeekSource);
    if (officialSources.length < 1) {
      throw gateError('live Research did not cite an official DeepSeek source', 'LIVE_OFFICIAL_SOURCE_NOT_PROVEN');
    }
    const requiredDomainSources = officialSources.filter((source) => isRequiredDomainSource(source, requiredDomains));
    if (requiredDomainSources.length < 1) {
      throw gateError(
        `live Research did not cite an official source from required domains: ${requiredDomains.join(', ')}`,
        'LIVE_REQUIRED_DOMAIN_SOURCE_NOT_PROVEN',
      );
    }
    const acceptedSourceIds = new Set(requiredDomainSources.map((source) => source.id));
    const acceptedItems = acceptedEvidenceItems(research.result, requiredFields, acceptedSourceIds);
    if (acceptedItems.length < 1) {
      throw gateError(
        `live Research did not prove required fields from an accepted DeepSeek source: ${requiredFields.join(', ')}`,
        'LIVE_REQUIRED_FIELDS_NOT_PROVEN',
      );
    }
    const tools = research?.telemetry?.toolSummary?.tools;
    if (!Array.isArray(tools) || !tools.includes('web_search') || !tools.includes('web_fetch')) {
      throw gateError('live Research did not prove web_search and web_fetch use', 'LIVE_WEB_TOOLS_NOT_PROVEN');
    }

    const accounting = await q(
      `SELECT count(*)::int AS accounting_rows, min(accounting_basis) AS accounting_basis,
       COALESCE(jsonb_agg(to_jsonb(accounting) ORDER BY accounting.id), '[]'::jsonb) AS ledger_rows
       FROM llm_accounting accounting WHERE task_id=$1`,
      [taskId],
    );
    const accountingRows = Number(accounting?.rows?.[0]?.accounting_rows ?? 0);
    if (accountingRows !== 1 || !Array.isArray(accounting?.rows?.[0]?.ledger_rows) || accounting.rows[0].ledger_rows.length !== 1) {
      throw gateError('Expected exactly one complete model accounting record', 'LIVE_ACCOUNTING_INVALID');
    }

    const reservations = await q(
      "SELECT count(*) FILTER (WHERE status='RESERVED')::int AS unresolved_reservations FROM budget_reservations WHERE task_id=$1",
      [taskId],
    );
    const unresolvedReservations = Number(reservations?.rows?.[0]?.unresolved_reservations ?? -1);
    if (unresolvedReservations !== 0) throw gateError('live Research left unresolved budget reservation', 'LIVE_RESERVATION_LEAK');

    const dataExecution = await runDataTask(taskId);
    if (dataExecution?.status !== 'EXECUTED' || dataExecution?.claim?.taskId !== taskId
        || dataExecution?.claim?.agentId !== 'data' || typeof dataExecution?.claim?.nodeId !== 'string'
        || !dataExecution.claim.nodeId) {
      throw gateError('Production Data worker did not execute the gate task', 'LIVE_DATA_CLAIM_MISMATCH');
    }
    const productionData = dataExecution.execution;
    if (productionData?.status !== 'SUCCESS' || productionData?.nodeStatus !== 'SUCCESS') {
      throw gateError('Production Data node did not return SUCCESS', 'LIVE_DATA_NOT_SUCCESS');
    }
    if (productionData.taskStatus !== 'SUCCESS') {
      throw gateError('Production Data task finalizer did not return SUCCESS', 'LIVE_TASK_NOT_SUCCESS');
    }
    try { validateDataOutput(productionData.result); }
    catch { throw gateError('Production Data output does not satisfy schema v1', 'LIVE_DATA_OUTPUT_INVALID'); }

    const persisted = await q(`SELECT
      task.status AS task_status, task.terminal_reason, task.terminal_at,
      task.request_payload, task.reserved_cost_usd, task.reserved_tokens, task.current_steps,
      task.current_cost_usd = (SELECT COALESCE(sum(a.cost_usd), 0) FROM llm_accounting a WHERE a.task_id = task.id) AS cost_reconciled,
      task.current_tokens = (SELECT COALESCE(sum(a.total_tokens), 0) FROM llm_accounting a WHERE a.task_id = task.id) AS tokens_reconciled,
      research.status AS research_status, research.output_data AS research_result,
      research.reserved_cost_usd AS research_reserved_cost_usd, research.reserved_tokens AS research_reserved_tokens,
      data.status AS data_status, data.output_data AS data_result,
      data.reserved_cost_usd AS data_reserved_cost_usd, data.reserved_tokens AS data_reserved_tokens,
      (SELECT count(*)::int FROM task_nodes WHERE task_id = task.id) AS node_count,
      (SELECT count(*)::int FROM task_node_dependencies WHERE task_id = task.id) AS dependency_count
    FROM tasks task
    JOIN task_nodes research
      ON research.task_id = task.id AND research.id = $2
      AND research.node_key = 'research' AND research.agent_id = 'researcher'
    JOIN task_nodes data
      ON data.task_id = task.id AND data.id = $3
      AND data.node_key = 'data' AND data.agent_id = 'data'
    JOIN task_node_dependencies dependency
      ON dependency.task_id = task.id AND dependency.node_id = data.id
      AND dependency.parent_node_id = research.id
    WHERE task.id = $1 AND data.input_payload ->> 'source_node_key' = 'research'`,
    [taskId, execution.claim.nodeId, dataExecution.claim.nodeId]);
    if (!Array.isArray(persisted?.rows) || persisted.rows.length !== 1) {
      throw gateError('Production Data persistence is not linked to the claimed Research dependency', 'LIVE_DATA_PERSISTENCE_NOT_PROVEN');
    }
    const snapshot = persisted.rows[0];
    if (snapshot.task_status !== 'SUCCESS' || snapshot.terminal_reason !== 'ALL_NODES_SUCCEEDED'
        || snapshot.terminal_at == null || snapshot.node_count !== 2 || snapshot.dependency_count !== 1
        || snapshot.research_status !== 'SUCCESS' || snapshot.data_status !== 'SUCCESS') {
      throw gateError('Durable production task and canonical DAG are not terminal SUCCESS', 'LIVE_TASK_NOT_SUCCESS');
    }
    let canonicalData;
    try {
      if (!isDeepStrictEqual(immutableRequest, snapshot.request_payload)) {
        throw gateError('Stored task request differs from the acceptance contract', 'LIVE_REQUEST_PERSISTENCE_MISMATCH');
      }
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(research.result)), snapshot.research_result)) {
        throw gateError('Stored Research differs from the executed Research result', 'LIVE_RESEARCH_PERSISTENCE_MISMATCH');
      }
      validateDataOutput(snapshot.data_result);
      canonicalData = transformData({
        requiredFields: snapshot.request_payload?.requiredFields ?? [],
        researchResult: snapshot.research_result,
      });
    } catch (error) {
      if (error?.code === 'LIVE_RESEARCH_PERSISTENCE_MISMATCH' || error?.code === 'LIVE_REQUEST_PERSISTENCE_MISMATCH') throw error;
      throw gateError('Stored Research/Data cannot prove the production Data contract', 'LIVE_DATA_OUTPUT_INVALID');
    }
    // Ignore only object-key insertion order; do not repair persisted arrays or values.
    if (!isDeepStrictEqual(snapshot.data_result, canonicalData)
        || !isDeepStrictEqual(productionData.result, snapshot.data_result)) {
      throw gateError('Returned and persisted Data differ from the deterministic production result', 'LIVE_DATA_CANONICAL_MISMATCH');
    }
    const dataOfficialSources = snapshot.data_result.sources.filter(isOfficialDeepSeekSource);
    const dataRequiredSources = dataOfficialSources.filter((source) => isRequiredDomainSource(source, requiredDomains));
    const dataAcceptedItems = acceptedEvidenceItems(snapshot.data_result, requiredFields, new Set(dataRequiredSources.map((source) => source.id)));
    if (dataRequiredSources.length === 0 || dataAcceptedItems.length === 0) {
      throw gateError('Production Data does not preserve required official-source evidence', 'LIVE_DATA_SOURCE_NOT_PROVEN');
    }

    const afterAccounting = await q(`SELECT count(*)::int AS accounting_rows,
      min(accounting_basis) AS accounting_basis,
      COALESCE(jsonb_agg(to_jsonb(accounting) ORDER BY accounting.id), '[]'::jsonb) AS ledger_rows,
      count(*) FILTER (WHERE node_id = $2)::int AS research_accounting_rows,
      count(*) FILTER (WHERE node_id = $3)::int AS data_accounting_rows
      FROM llm_accounting accounting WHERE task_id = $1`, [taskId, execution.claim.nodeId, dataExecution.claim.nodeId]);
    const finalAccounting = afterAccounting?.rows?.[0];
    if (finalAccounting?.accounting_rows !== 1 || finalAccounting.research_accounting_rows !== 1
        || finalAccounting.data_accounting_rows !== 0 || finalAccounting.accounting_basis !== accounting.rows[0].accounting_basis
        || !isDeepStrictEqual(finalAccounting.ledger_rows, accounting.rows[0].ledger_rows)
        || snapshot.cost_reconciled !== true || snapshot.tokens_reconciled !== true || snapshot.current_steps !== 2) {
      throw gateError('Production Data changed model accounting or introduced a model call', 'LIVE_DATA_ACCOUNTING_INVALID');
    }
    const afterReservations = await q(`SELECT
      count(*) FILTER (WHERE status = 'RESERVED')::int AS unresolved_reservations,
      count(*) FILTER (WHERE node_id = $2)::int AS data_reservations
      FROM budget_reservations WHERE task_id = $1`, [taskId, dataExecution.claim.nodeId]);
    const finalReservations = afterReservations?.rows?.[0];
    const reservationCounters = [snapshot.reserved_cost_usd, snapshot.reserved_tokens,
      snapshot.research_reserved_cost_usd, snapshot.research_reserved_tokens,
      snapshot.data_reserved_cost_usd, snapshot.data_reserved_tokens];
    if (finalReservations?.unresolved_reservations !== 0 || finalReservations.data_reservations !== 0
        || reservationCounters.some((value) => value == null || Number(value) !== 0)) {
      throw gateError('Production Data has unresolved or new model budget reservations', 'LIVE_DATA_RESERVATION_INVALID');
    }
    const taskStatus = snapshot.task_status;

    return Object.freeze({
      status: 'PASS',
      task_id: taskId,
      task_status: taskStatus,
      research_status: research.result.status,
      source_count: research.result.sources.length,
      official_source_count: officialSources.length,
      required_domain_source_count: requiredDomainSources.length,
      accepted_item_count: acceptedItems.length,
      required_fields: Object.freeze([...requiredFields]),
      required_domains: requiredDomains,
      tools: Object.freeze([...tools]),
      model: research.telemetry?.model ?? null,
      accounting_rows: accountingRows,
      accounting_basis: accounting?.rows?.[0]?.accounting_basis ?? null,
      unresolved_reservations: unresolvedReservations,
      data_mode: 'PRODUCTION_DATA',
      data_status: productionData.nodeStatus,
      data_schema_version: snapshot.data_result.schemaVersion,
      data_item_count: snapshot.data_result.items.length,
      data_source_count: snapshot.data_result.sources.length,
      accepted_data_item_count: dataAcceptedItems.length,
      data_accounting_rows: finalAccounting.data_accounting_rows,
      data_reservation_rows: finalReservations.data_reservations,
    });
  } catch (error) {
    if (taskId) await cancelFailedGateTask(q, taskId, error);
    throw error;
  }
}
