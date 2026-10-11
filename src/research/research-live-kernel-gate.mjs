const gateError = (message, code) => Object.assign(new Error(message), { code });

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

const claimableCount = async (query, agentId) => {
  const result = await query(
    `SELECT count(*)::int AS claimable_count
     FROM task_nodes n
     JOIN tasks t ON t.id=n.task_id
     WHERE n.agent_id=$1
       AND t.status IN ('PENDING','RUNNING')
       AND t.deadline_at>NOW()
       AND t.current_steps<t.max_total_steps
       AND n.attempt<n.max_attempts
       AND (n.status='PENDING' OR (n.status='RUNNING' AND n.lease_until IS NOT NULL AND n.lease_until<NOW()))
       AND NOT EXISTS (
         SELECT 1 FROM task_node_dependencies d
         LEFT JOIN task_nodes parent ON parent.task_id=d.task_id AND parent.id=d.parent_node_id
         WHERE d.task_id=n.task_id AND d.node_id=n.id
           AND (parent.id IS NULL OR parent.status<>'SUCCESS')
       )`,
    [agentId],
  );
  return Number(result?.rows?.[0]?.claimable_count ?? 0);
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
  goal = 'Find the current DeepSeek API model version behind model id deepseek-flash and cite official DeepSeek API documentation.',
  request = {
    maxResults: 3,
    requiredFields: ['modelId', 'modelVersion'],
    constraints: { preferDomains: ['api-docs.deepseek.com', 'deepseek.com'] },
  },
} = {}) {
  const q = requireFn(query, 'query');
  const researchWorker = requireObject(worker, 'worker');
  const runOnce = requireFn(researchWorker.runOnce?.bind(researchWorker), 'worker.runOnce');
  const db = requireObject(kernel, 'kernel');
  const claimData = requireFn(db.claimNextNodeForAgent?.bind(db), 'kernel.claimNextNodeForAgent');
  const completeData = requireFn(db.completeSuccess?.bind(db), 'kernel.completeSuccess');
  const key = requireText(idempotencyKey, 'idempotencyKey');
  requireText(dataWorkerId, 'dataWorkerId');

  const existingResearch = await claimableCount(q, 'researcher');
  const existingData = await claimableCount(q, 'data');
  if (existingResearch !== 0 || existingData !== 0) {
    throw gateError(`live gate requires an isolated queue; researcher=${existingResearch}, data=${existingData}`, 'LIVE_QUEUE_NOT_ISOLATED');
  }

  const deadline = new Date(now().getTime() + 10 * 60 * 1000).toISOString();
  const created = await q(
    'SELECT * FROM create_lite_research_task($1,$2,$3::jsonb,$4,$5,$6,$7::timestamptz)',
    [key, goal, JSON.stringify(request), 0.25, 100_000, 4, deadline],
  );
  const taskId = created?.rows?.[0]?.task_id;
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

  const dataClaim = await claimData({ workerId: dataWorkerId, agentId: 'data', leaseSeconds: 30 });
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
    tools: Object.freeze([...tools]),
    model: research.telemetry?.model ?? null,
    accounting_rows: accountingRows,
    accounting_basis: accounting?.rows?.[0]?.accounting_basis ?? null,
    unresolved_reservations: unresolvedReservations,
    data_mode: 'DETERMINISTIC_LIVE_GATE_COMPLETION',
  });
}
