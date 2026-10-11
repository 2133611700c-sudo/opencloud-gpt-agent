TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task RECORD;
  v_claim RECORD;
  v_reservation_id UUID;
  v_first RECORD;
  v_second RECORD;
  v_task_cost NUMERIC(12,6);
  v_task_reserved NUMERIC(12,6);
  v_task_tokens BIGINT;
  v_task_reserved_tokens BIGINT;
  v_basis VARCHAR(32);
  v_note VARCHAR(256);
  v_hit BIGINT;
  v_miss BIGINT;
  v_completion BIGINT;
  v_total BIGINT;
  v_cost NUMERIC(12,6);
  v_res_status budget_reservation_status;
  v_res_basis VARCHAR(32);
  v_res_reason VARCHAR(256);
  v_res_actual_cost NUMERIC(12,6);
  v_res_actual_tokens BIGINT;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'fallback-accounting-main',
    'fallback accounting test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_claim FROM claim_next_node('worker-fallback', 30);
  IF NOT FOUND OR v_claim.agent_id <> 'researcher' THEN
    RAISE EXCEPTION 'failed to claim Research node';
  END IF;

  SELECT reserve_node_budget(
    'fallback-call-1',
    v_claim.node_id,
    'worker-fallback',
    v_claim.lease_token,
    0.050000,
    500
  ) INTO v_reservation_id;
  IF v_reservation_id IS NULL THEN RAISE EXCEPTION 'fallback reservation failed'; END IF;

  SELECT * INTO v_first
  FROM record_llm_call_reservation_fallback(
    v_reservation_id,
    'fallback-call-1',
    v_claim.node_id,
    'worker-fallback',
    v_claim.lease_token,
    'deepseek',
    'deepseek-flash',
    'test-pricing-v1',
    NULL,
    250,
    'PROVIDER_USAGE_NOT_EXPOSED'
  );

  IF NOT FOUND OR v_first.accounting_id IS NULL OR v_first.created IS NOT TRUE THEN
    RAISE EXCEPTION 'first fallback accounting write did not create a record';
  END IF;

  SELECT accounting_basis, accounting_note,
         prompt_cache_hit_tokens, prompt_cache_miss_tokens,
         completion_tokens, total_tokens, cost_usd
  INTO v_basis, v_note, v_hit, v_miss, v_completion, v_total, v_cost
  FROM llm_accounting
  WHERE id = v_first.accounting_id;

  IF v_basis <> 'RESERVATION_FALLBACK'
     OR v_note <> 'PROVIDER_USAGE_NOT_EXPOSED'
     OR v_hit <> 0
     OR v_miss <> 500
     OR v_completion <> 0
     OR v_total <> 500
     OR v_cost <> 0.050000 THEN
    RAISE EXCEPTION 'fallback accounting row incorrect: basis %, note %, hit %, miss %, completion %, total %, cost %',
      v_basis, v_note, v_hit, v_miss, v_completion, v_total, v_cost;
  END IF;

  SELECT status, reconciliation_basis, reconciliation_reason, actual_cost_usd, actual_tokens
  INTO v_res_status, v_res_basis, v_res_reason, v_res_actual_cost, v_res_actual_tokens
  FROM budget_reservations
  WHERE id = v_reservation_id;

  IF v_res_status <> 'RECONCILED'
     OR v_res_basis <> 'RESERVATION_FALLBACK'
     OR v_res_reason <> 'PROVIDER_USAGE_NOT_EXPOSED'
     OR v_res_actual_cost <> 0.050000
     OR v_res_actual_tokens <> 500 THEN
    RAISE EXCEPTION 'fallback reservation reconciliation incorrect';
  END IF;

  SELECT current_cost_usd, reserved_cost_usd, current_tokens, reserved_tokens
  INTO v_task_cost, v_task_reserved, v_task_tokens, v_task_reserved_tokens
  FROM tasks
  WHERE id = v_task.task_id;

  IF v_task_cost <> 0.050000
     OR v_task_reserved <> 0
     OR v_task_tokens <> 500
     OR v_task_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'fallback hard-budget charge incorrect: cost %, reserved %, tokens %, reserved tokens %',
      v_task_cost, v_task_reserved, v_task_tokens, v_task_reserved_tokens;
  END IF;

  -- Exact replay must be idempotent and must not charge the task twice.
  SELECT * INTO v_second
  FROM record_llm_call_reservation_fallback(
    v_reservation_id,
    'fallback-call-1',
    v_claim.node_id,
    'worker-fallback',
    v_claim.lease_token,
    'deepseek',
    'deepseek-flash',
    'test-pricing-v1',
    NULL,
    250,
    'PROVIDER_USAGE_NOT_EXPOSED'
  );

  IF NOT FOUND
     OR v_second.accounting_id <> v_first.accounting_id
     OR v_second.created IS NOT FALSE THEN
    RAISE EXCEPTION 'fallback retry was not idempotent';
  END IF;

  SELECT count(*) INTO v_count FROM llm_accounting WHERE call_key = 'fallback-call-1';
  IF v_count <> 1 THEN RAISE EXCEPTION 'fallback created duplicate accounting rows: %', v_count; END IF;

  SELECT current_cost_usd, current_tokens
  INTO v_task_cost, v_task_tokens
  FROM tasks WHERE id = v_task.task_id;
  IF v_task_cost <> 0.050000 OR v_task_tokens <> 500 THEN
    RAISE EXCEPTION 'idempotent retry double-charged budget';
  END IF;

  -- A stale fencing token must not create fallback accounting.
  UPDATE task_nodes
  SET lease_until = NOW() - INTERVAL '1 second'
  WHERE id = v_claim.node_id AND lease_token = v_claim.lease_token;

  SELECT reserve_node_budget(
    'fallback-stale-call',
    v_claim.node_id,
    'worker-fallback',
    v_claim.lease_token,
    0.010000,
    100
  ) INTO v_reservation_id;
  IF v_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'stale lease obtained a new reservation';
  END IF;
END $$;

SELECT 'conservative accounting fallback assertions: PASS' AS result;
