import { createPostgresKernelAdapter } from '../kernel/postgres-kernel-adapter.mjs';

export function createPostgresDataAdapter({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const kernel = createPostgresKernelAdapter({ query });

  return Object.freeze({
    claimNextNodeForAgent: kernel.claimNextNodeForAgent,
    claimNodeForTaskAndAgent: kernel.claimNodeForTaskAndAgent,
    heartbeat: kernel.heartbeat,
    completeSuccess: kernel.completeSuccess,
    failTerminal: kernel.failTerminal,

    async loadInput({ nodeId, taskId, workerId, leaseToken }) {
      const response = await query(`SELECT
        task.request_payload -> 'requiredFields' AS required_fields,
        parent.output_data AS research_result
      FROM task_nodes child
      JOIN tasks task ON task.id = child.task_id
      JOIN task_node_dependencies dependency
        ON dependency.task_id = child.task_id AND dependency.node_id = child.id
      JOIN task_nodes parent
        ON parent.task_id = dependency.task_id AND parent.id = dependency.parent_node_id
      WHERE child.id = $1 AND child.task_id = $2
        AND child.agent_id = 'data' AND child.node_key = 'data'
        AND child.status = 'RUNNING' AND child.lease_owner = $3
        AND child.lease_token = $4::uuid AND child.lease_until > NOW()
        AND task.status = 'RUNNING' AND task.deadline_at > NOW()
        AND (jsonb_typeof(task.request_payload) = 'object' OR task.request_payload = 'null'::jsonb)
        AND child.input_payload ->> 'source_node_key' = 'research'
        AND parent.node_key = child.input_payload ->> 'source_node_key'
        AND parent.agent_id = 'researcher' AND parent.status = 'SUCCESS'`,
      [nodeId, taskId, workerId, leaseToken]);
      if (!Array.isArray(response?.rows) || response.rows.length !== 1) return null;
      const row = response.rows[0];
      return { requiredFields: row.required_fields ?? [], researchResult: row.research_result };
    },

    async finalizeTask(taskId) {
      const response = await query('SELECT finalize_task($1) AS task_status', [taskId]);
      return response?.rows?.[0]?.task_status ?? null;
    },
  });
}
