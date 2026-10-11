export class HostedPostgresSchemaError extends Error {
  constructor(message, { counts } = {}) {
    super(message);
    this.name = 'HostedPostgresSchemaError';
    this.code = 'HOSTED_POSTGRES_SCHEMA_MISMATCH';
    this.counts = counts ?? null;
  }
}

export async function verifyHostedPostgresSchema({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const result = await query(`SELECT
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('tasks','task_nodes','task_node_dependencies','llm_accounting','artifacts','registry_agents','registry_skills','approval_requests','budget_reservations')) AS core_tables,
    (SELECT count(DISTINCT p.proname)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('claim_next_node','claim_next_node_for_agent','claim_node_for_task_and_agent','heartbeat_node','complete_node_success','requeue_node_retry','reserve_node_budget','reconcile_node_budget','release_node_budget','create_lite_research_task','block_task_nodes','cascade_block_descendants','finalize_task','fail_node_terminal','release_reservations_for_lease','record_llm_call','record_llm_call_reservation_fallback')) AS core_functions,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_schema='public'
        AND ((table_name='llm_accounting' AND column_name IN ('accounting_basis','accounting_note'))
          OR (table_name='budget_reservations' AND column_name IN ('reconciliation_basis','reconciliation_reason')))) AS accounting_fallback_columns`);

  const row = result?.rows?.[0] ?? {};
  const counts = Object.freeze({
    core_tables: Number(row.core_tables ?? -1),
    core_functions: Number(row.core_functions ?? -1),
    accounting_fallback_columns: Number(row.accounting_fallback_columns ?? -1),
  });
  if (counts.core_tables !== 9 || counts.core_functions !== 17 || counts.accounting_fallback_columns !== 4) {
    throw new HostedPostgresSchemaError('hosted PostgreSQL schema does not match the OpenClaw V2 Kernel contract', { counts });
  }
  return Object.freeze({ status: 'PASS', ...counts });
}
