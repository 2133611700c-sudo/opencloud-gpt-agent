TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task RECORD;
  v_research RECORD;
  v_reservation_id UUID;
  v_cancelled BOOLEAN;
  v_task_status execution_status;
  v_task_reason VARCHAR(64);
  v_research_status execution_status;
  v_data_status execution_status;
  v_reservation_status budget_reservation_status;
  v_release_reason VARCHAR(64);
  v_task_reserved_cost NUMERIC(12,6);
  v_task_reserved_tokens BIGINT;
  v_node_reserved_cost NUMERIC(12,6);
  v_node_reserved_tokens BIGINT;
  v_claim_count INTEGER;
  v_reservation_after_cancel UUID;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'canonical-cancellation',
    'cancel task with active reservation',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_research FROM claim_next_node('worker-cancel', 30);
  IF NOT FOUND OR v_research.agent_id <> 'researcher' THEN
    RAISE EXCEPTION 'research node was not claimed';
  END IF;

  SELECT reserve_node_budget(
    'cancel-active-reservation',
    v_research.node_id,
    'worker-cancel',
    v_research.lease_token,
    0.100000,
    100
  ) INTO v_reservation_id;

  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION 'budget reservation was not created';
  END IF;

  SELECT cancel_task(
    v_task.task_id,
    'USER_CANCELLED',
    jsonb_build_object('source', 'test')
  ) INTO v_cancelled;

  IF v_cancelled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'active task was not cancelled';
  END IF;

  SELECT status, terminal_reason, reserved_cost_usd, reserved_tokens
  INTO v_task_status, v_task_reason, v_task_reserved_cost, v_task_reserved_tokens
  FROM tasks
  WHERE id = v_task.task_id;

  IF v_task_status <> 'CANCELLED' OR v_task_reason <> 'USER_CANCELLED' THEN
    RAISE EXCEPTION 'task cancellation metadata incorrect: %, %', v_task_status, v_task_reason;
  END IF;

  SELECT status, reserved_cost_usd, reserved_tokens
  INTO v_research_status, v_node_reserved_cost, v_node_reserved_tokens
  FROM task_nodes
  WHERE id = v_research.node_id;

  IF v_research_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'running Research node was not cancelled: %', v_research_status;
  END IF;

  SELECT status INTO v_data_status
  FROM task_nodes
  WHERE task_id = v_task.task_id
    AND node_key = 'data';

  IF v_data_status <> 'CANCELLED' THEN
    RAISE EXCEPTION 'pending Data node was not cancelled: %', v_data_status;
  END IF;

  SELECT status, release_reason
  INTO v_reservation_status, v_release_reason
  FROM budget_reservations
  WHERE id = v_reservation_id;

  IF v_reservation_status <> 'RELEASED' OR v_release_reason <> 'USER_CANCELLED' THEN
    RAISE EXCEPTION 'cancellation reservation cleanup incorrect: %, %',
      v_reservation_status, v_release_reason;
  END IF;

  IF v_task_reserved_cost <> 0 OR v_task_reserved_tokens <> 0
     OR v_node_reserved_cost <> 0 OR v_node_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'reservation totals leaked after cancellation: task %/% node %/%',
      v_task_reserved_cost, v_task_reserved_tokens, v_node_reserved_cost, v_node_reserved_tokens;
  END IF;

  -- Terminal cancellation is idempotent/no-op and cannot create new work.
  SELECT cancel_task(v_task.task_id, 'USER_CANCELLED', '{}'::jsonb) INTO v_cancelled;
  IF v_cancelled IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'repeated cancellation should return FALSE';
  END IF;

  SELECT count(*) INTO v_claim_count
  FROM claim_next_node('worker-after-cancel', 30);
  IF v_claim_count <> 0 THEN
    RAISE EXCEPTION 'cancelled task produced new claimable work';
  END IF;

  SELECT reserve_node_budget(
    'reservation-after-cancel',
    v_research.node_id,
    'worker-cancel',
    v_research.lease_token,
    0.010000,
    10
  ) INTO v_reservation_after_cancel;

  IF v_reservation_after_cancel IS NOT NULL THEN
    RAISE EXCEPTION 'cancelled task accepted a new budget reservation';
  END IF;
END $$;

SELECT 'task cancellation assertions: PASS' AS result;
