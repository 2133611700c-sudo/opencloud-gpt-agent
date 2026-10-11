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

const isOfficialDeepSeekSource = (source) => {
  try {
    const url = new URL(source?.url);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'deepseek.com' || host.endsWith('.deepseek.com'));
  } catch {
    return false;
  }
};

const hasFieldValue = (data, field) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!Object.prototype.hasOwnProperty.call(data, field)) return false;
  const value = data[field];
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');
};

const acceptedEvidenceItems = (result, requiredFields, officialSourceIds) => {
  if (!Array.isArray(result?.items)) return [];
  return result.items.filter((item) => {
    if (!requiredFields.every((field) => hasFieldValue(item?.data, field))) return false;
    if (!Array.isArray(item?.sourceIds)) return false;
    return item.sourceIds.some((sourceId) => officialSourceIds.has(sourceId));
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
 * Data is completed deterministically only to terminalize the lite DAG; this does
 * not certify the future Data runtime implementation.
 */
export async function runLiveResearchKernelGate({
  query,
  worker,
  kernel,
  idempotencyKey,
  now = () => new Date(),
  dataWorkerId = 'live-research-gate-data',
  goal = 'Using official DeepSeek API documentation, identify the current release served by API model id deepseek-flash. Return modelId and modelVersion.',
  request = {
    maxResults: 3,
    requiredFields: ['modelId', 'modelVersion'],
    constraints: { requiredDomains: ['api-docs.deepseek.com'] },
  },
} = {}) {
  const q = requireFn(query, 'query');
  const researchWorker = requireObject(worker, 'worker');
  const runOnce = requireFn(researchWorker.runOnce?.bind(researchWorker), 'worker.runOnce');
  const db = requireObject(kernel, 'kernel');
  const claimData = requireFn(db.claimNodeForTaskAndAgent?.bind(db), 'kernel.claimNodeForTaskAndAgent');
  const completeData = requireFn(db.completeSuccess?.bind(db), 'kernel.completeSuccess');
  const key = requireText(idempotencyKey, 'idempotencyKey');
  requireText(dataWorkerId, 'dataWorkerId');
  const requiredFields = Array.isArray(request?.requiredFields) ? [...request.requiredFields] : [];
  if (requiredFields.length === 0 || requiredFields.some((field) => typeof field !== 'string' || field.trim() === '')) {
    throw new TypeError('live gate request.requiredFields must contain at least one non-empty field');
  }

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
      [key, goal, JSON.stringify(request), 0.25, 100_000, 4, deadline],
    );
    taskId = created?.rows?.[0]?.task_id;
    if (typeof taskId !== 'string' || taskId === '') throw gateError('live gate task creation failed', 'LIVE_TASK_CREATE_FAILED');

    const execution = await runOnce();
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
    const officialSourceIds = new Set(officialSources.map((source) => source.id));
    const acceptedItems = acceptedEvidenceItems(research.result, requiredFields, officialSourceIds);
    if (acceptedItems.length < 1) {
      throw gateError(
        `live Research did not prove required fields from an official DeepSeek source: ${requiredFields.join(', ')}`,
        'LIVE_REQUIRED_FIELDS_NOT_PROVEN',
      );
    }
    const tools = research?.telemetry?.toolSummary?.tools;
    if (!Array.isArray(tools) || !tools.includes('web_search') || !tools.includes('web_fetch')) {
      throw gateError('live Research did not prove web_search and web_fetch use', 'LIVE_WEB_TOOLS_NOT_PROVEN');
    }

    const accounting = await q(
      'SELECT count(*)::int AS accounting_rows, min(accounting_basis) AS accounting_basis FROM llm_accounting WHERE task_id=$1',
      [taskId],
    );
    const accountingRows = Number(accounting?.rows?.[0]?.accounting_rows ?? 0);
    if (accountingRows !== 1) throw gateError(`expected exactly one model accounting row, got ${accountingRows}`, 'LIVE_ACCOUNTING_INVALID');

    const reservations = await q(
      "SELECT count(*) FILTER (WHERE status='RESERVED')::int AS unresolved_reservations FROM budget_reservations WHERE task_id=$1",
      [taskId],
    );
    const unresolvedReservations = Number(reservations?.rows?.[0]?.unresolved_reservations ?? -1);
    if (unresolvedReservations !== 0) throw gateError('live Research left unresolved budget reservation', 'LIVE_RESERVATION_LEAK');

    const dataClaim = await claimData({ taskId, workerId: dataWorkerId, agentId: 'data', leaseSeconds: 30 });
    if (!dataClaim || dataClaim.taskId !== taskId) {
      throw gateError('Data did not become claimable after live Research SUCCESS', 'LIVE_DATA_NOT_RELEASED');
    }
    const dataCompleted = await completeData({
      nodeId: dataClaim.nodeId,
      workerId: dataClaim.workerId,
      leaseToken: dataClaim.leaseToken,
      outputData: { status: 'SUCCESS', mode: 'DETERMINISTIC_LIVE_GATE_COMPLETION', researchNodeId: execution.claim.nodeId },
    });
    if (dataCompleted !== true) throw gateError('deterministic Data gate completion was rejected', 'LIVE_DATA_COMPLETION_REJECTED');

    const finalized = await q('SELECT finalize_task($1) AS status', [taskId]);
    const taskStatus = finalized?.rows?.[0]?.status;
    if (taskStatus !== 'SUCCESS') throw gateError(`live task finalizer returned ${String(taskStatus)}`, 'LIVE_TASK_NOT_SUCCESS');

    return Object.freeze({
      status: 'PASS',
      task_id: taskId,
      task_status: taskStatus,
      research_status: research.result.status,
      source_count: research.result.sources.length,
      official_source_count: officialSources.length,
      accepted_item_count: acceptedItems.length,
      required_fields: Object.freeze([...requiredFields]),
      tools: Object.freeze([...tools]),
      model: research.telemetry?.model ?? null,
      accounting_rows: accountingRows,
      accounting_basis: accounting?.rows?.[0]?.accounting_basis ?? null,
      unresolved_reservations: unresolvedReservations,
      data_mode: 'DETERMINISTIC_LIVE_GATE_COMPLETION',
    });
  } catch (error) {
    if (taskId) await cancelFailedGateTask(q, taskId, error);
    throw error;
  }
}
