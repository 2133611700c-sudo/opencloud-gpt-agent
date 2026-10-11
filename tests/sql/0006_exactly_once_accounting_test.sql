TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task RECORD;
  v_claim_a RECORD;
  v_claim_b RECORD;
  v_res_a UUID;
  v_res_b UUID;
  v_rec1 RECORD;
  v_rec2 RECORD;
  v_count INTEGER;
  v_status budget_reservation_status;
  v_reason VARCHAR(64);
  v_cost NUMERIC(12,6);
  v_reserved NUMERIC(12,6);
  v_tokens BIGINT;
  v_reserved_tokens BIGINT;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'exactly-once-main',
    'exactly once accounting test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_claim_a FROM claim_next_node('worker-a', 30);
  IF NOT FOUND OR v_claim_a.agent_id <> 'researcher' THEN
    RAISE EXCEPTION 'worker-a failed to claim Research';
  END IF;

  SELECT reserve_node_budget(
    'model-call-attempt-1',
    v_claim_a.node_id,
    'worker-a',
    v_claim_a.lease_token,
    0.050000,
    500
  ) INTO v_res_a;
  IF v_res_a IS NULL THEN RAISE EXCEPTION 'initial reservation failed'; END IF;

  -- Simulate crash after reserve but before model accounting.
  UPDATE task_nodes
  SET lease_until = NOW() - INTERVAL '1 second'
  WHERE id = v_claim_a.node_id AND lease_token = v_claim_a.lease_token;

  SELECT * INTO v_claim_b FROM claim_next_node('worker-b', 30);
  IF NOT FOUND OR v_claim_b.node_id <> v_claim_a.node_id THEN
    RAISE EXCEPTION 'expired Research lease was not reclaimed';
  END IF;
  IF v_claim_b.lease_token = v_claim_a.lease_token THEN
    RAISE EXCEPTION 'reclaim reused stale fencing token';
  END IF;

  SELECT status, release_reason INTO v_status, v_reason
  FROM budget_reservations WHERE id = v_res_a;
  IF v_status <> 'RELEASED' OR v_reason <> 'LEASE_RECLAIM' THEN
    RAISE EXCEPTION 'abandoned reservation not released on reclaim: %, %', v_status, v_reason;
  END IF;

  SELECT reserved_cost_usd, reserved_tokens
  INTO v_reserved, v_reserved_tokens
  FROM tasks WHERE id = v_task.task_id;
  IF v_reserved <> 0 OR v_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'reclaim leaked task reservation: %, %', v_reserved, v_reserved_tokens;
  END IF;

  -- Old worker cannot record a call after losing the lease.
  SELECT count(*) INTO v_count
  FROM record_llm_call(
    v_res_a, 'model-call-attempt-1', v_claim_a.node_id, 'worker-a', v_claim_a.lease_token,
    'deepseek', 'test-model', 'test-pricing-v1', 'provider-old',
    50, 100, 50, 200, 0.020000, 100
  );
  IF v_count <> 0 THEN RAISE EXCEPTION 'stale lease recorded model accounting'; END IF;

  -- New attempt reserves and records exactly once.
  SELECT reserve_node_budget(
    'model-call-attempt-2',
    v_claim_b.node_id,
    'worker-b',
    v_claim_b.lease_token,
    0.050000,
    500
  ) INTO v_res_b;
  IF v_res_b IS NULL THEN RAISE EXCEPTION 'new reservation failed after reclaim'; END IF;

  SELECT * INTO v_rec1
  FROM record_llm_call(
    v_res_b, 'model-call-attempt-2', v_claim_b.node_id, 'worker-b', v_claim_b.lease_token,
    'deepseek', 'test-model', 'test-pricing-v1', 'provider-2',
    50, 100, 50, 200, 0.020000, 123
  );
  IF NOT FOUND OR v_rec1.accounting_id IS NULL OR v_rec1.created IS NOT TRUE THEN
    RAISE EXCEPTION 'first accounting write did not create record';
  END IF;

  SELECT * INTO v_rec2
  FROM record_llm_call(
    v_res_b, 'model-call-attempt-2', v_claim_b.node_id, 'worker-b', v_claim_b.lease_token,
    'deepseek', 'test-model', 'test-pricing-v1', 'provider-2',
    50, 100, 50, 200, 0.020000, 123
  );
  IF NOT FOUND OR v_rec2.accounting_id <> v_rec1.accounting_id OR v_rec2.created IS NOT FALSE THEN
    RAISE EXCEPTION 'idempotent accounting retry did not return existing record';
  END IF;

  SELECT count(*) INTO v_count FROM llm_accounting WHERE call_key = 'model-call-attempt-2';
  IF v_count <> 1 THEN RAISE EXCEPTION 'duplicate accounting rows created: %', v_count; END IF;

  SELECT current_cost_usd, reserved_cost_usd, current_tokens, reserved_tokens
  INTO v_cost, v_reserved, v_tokens, v_reserved_tokens
  FROM tasks WHERE id = v_task.task_id;
  IF v_cost <> 0.020000 OR v_reserved <> 0 OR v_tokens <> 200 OR v_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'exactly-once totals incorrect: cost %, reserved %, tokens %, reserved_tokens %',
      v_cost, v_reserved, v_tokens, v_reserved_tokens;
  END IF;

  -- Same call key with different accounting contract must fail closed.
  BEGIN
    PERFORM * FROM record_llm_call(
      v_res_b, 'model-call-attempt-2', v_claim_b.node_id, 'worker-b', v_claim_b.lease_token,
      'deepseek', 'test-model', 'test-pricing-v1', 'provider-2',
      50, 100, 50, 200, 0.021000, 123
    );
    RAISE EXCEPTION 'expected accounting collision rejection';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'expected accounting collision rejection' THEN RAISE; END IF;
    IF position('call key accounting collision' in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'unexpected accounting collision error: %', SQLERRM;
    END IF;
  END;

  SELECT complete_node_success(
    v_claim_b.node_id, 'worker-b', v_claim_b.lease_token, '{"ok":true}'::jsonb
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'accounted node could not complete'; END IF;

  -- An exact retry remains idempotent even after node completion.
  SELECT * INTO v_rec2
  FROM record_llm_call(
    v_res_b, 'model-call-attempt-2', v_claim_b.node_id, 'worker-b', v_claim_b.lease_token,
    'deepseek', 'test-model', 'test-pricing-v1', 'provider-2',
    50, 100, 50, 200, 0.020000, 123
  );
  IF NOT FOUND OR v_rec2.accounting_id <> v_rec1.accounting_id OR v_rec2.created IS NOT FALSE THEN
    RAISE EXCEPTION 'terminal-node accounting retry was not idempotent';
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- SUCCESS is forbidden while an unresolved paid reservation exists.
DO $$
DECLARE
  v_task RECORD;
  v_claim RECORD;
  v_res UUID;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'unresolved-reservation', 'unresolved reservation test', '{}'::jsonb,
    1.000000, 10000, 10, NOW() + INTERVAL '20 minutes'
  );
  SELECT * INTO v_claim FROM claim_next_node('worker-u', 30);
  SELECT reserve_node_budget('unresolved-call', v_claim.node_id, 'worker-u', v_claim.lease_token, 0.010000, 100)
    INTO v_res;

  SELECT complete_node_success(v_claim.node_id, 'worker-u', v_claim.lease_token, '{}'::jsonb) INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'node completed with unresolved reservation'; END IF;

  SELECT release_node_budget(v_res, v_claim.node_id, 'worker-u', v_claim.lease_token) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'explicit reservation release failed'; END IF;
  SELECT complete_node_success(v_claim.node_id, 'worker-u', v_claim.lease_token, '{}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'node could not complete after reservation release'; END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Retry requeue automatically releases unresolved reservations.
DO $$
DECLARE
  v_task RECORD;
  v_claim RECORD;
  v_res UUID;
  v_ok BOOLEAN;
  v_status budget_reservation_status;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'requeue-release', 'requeue reservation release test', '{}'::jsonb,
    1.000000, 10000, 10, NOW() + INTERVAL '20 minutes'
  );
  SELECT * INTO v_claim FROM claim_next_node('worker-q', 30);
  SELECT reserve_node_budget('requeue-call', v_claim.node_id, 'worker-q', v_claim.lease_token, 0.010000, 100)
    INTO v_res;

  SELECT requeue_node_retry(v_claim.node_id, 'worker-q', v_claim.lease_token, '{"retry":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'requeue failed'; END IF;

  SELECT status, release_reason INTO v_status, v_reason FROM budget_reservations WHERE id = v_res;
  IF v_status <> 'RELEASED' OR v_reason <> 'NODE_REQUEUE' THEN
    RAISE EXCEPTION 'requeue did not release reservation: %, %', v_status, v_reason;
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Terminal failure automatically releases unresolved reservations.
DO $$
DECLARE
  v_task RECORD;
  v_claim RECORD;
  v_res UUID;
  v_ok BOOLEAN;
  v_status budget_reservation_status;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'failure-release', 'terminal failure release test', '{}'::jsonb,
    1.000000, 10000, 10, NOW() + INTERVAL '20 minutes'
  );
  SELECT * INTO v_claim FROM claim_next_node('worker-fail', 30);
  SELECT reserve_node_budget('failure-call', v_claim.node_id, 'worker-fail', v_claim.lease_token, 0.010000, 100)
    INTO v_res;

  SELECT fail_node_terminal(v_claim.node_id, 'worker-fail', v_claim.lease_token, '{"forced":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'terminal failure failed'; END IF;

  SELECT status, release_reason INTO v_status, v_reason FROM budget_reservations WHERE id = v_res;
  IF v_status <> 'RELEASED' OR v_reason <> 'NODE_TERMINAL_FAILURE' THEN
    RAISE EXCEPTION 'terminal failure did not release reservation: %, %', v_status, v_reason;
  END IF;
END $$;

SELECT 'exactly-once accounting assertions: PASS' AS result;
