TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task RECORD;
  v_research RECORD;
  v_claim RECORD;
  v_reservation_id UUID;
  v_status execution_status;
  v_task_status execution_status;
  v_research_status execution_status;
  v_data_status execution_status;
  v_reason VARCHAR(64);
  v_error JSONB;
  v_reservation_status budget_reservation_status;
  v_release_reason VARCHAR(64);
  v_task_reserved_cost NUMERIC(12,6);
  v_task_reserved_tokens BIGINT;
  v_node_reserved_cost NUMERIC(12,6);
  v_node_reserved_tokens BIGINT;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'expired-max-attempts-terminalization',
    'expired final attempt must terminate',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_research FROM claim_next_node('worker-max-attempts', 30);
  IF NOT FOUND OR v_research.agent_id <> 'research' THEN
    RAISE EXCEPTION 'research node was not claimed';
  END IF;

  SELECT reserve_node_budget(
    'expired-max-attempts-reservation',
    v_research.node_id,
    'worker-max-attempts',
    v_research.lease_token,
    0.100000,
    100
  ) INTO v_reservation_id;
  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION 'budget reservation was not created';
  END IF;

  UPDATE task_nodes
  SET attempt = max_attempts,
      lease_until = NOW() - INTERVAL '1 second',
      heartbeat_at = NOW() - INTERVAL '2 seconds',
      updated_at = NOW()
  WHERE id = v_research.node_id;

  SELECT * INTO v_claim FROM claim_next_node('worker-after-expiry', 30);
  IF FOUND THEN
    RAISE EXCEPTION 'expired node at max attempts was unexpectedly reclaimed';
  END IF;

  SELECT finalize_task(v_task.task_id) INTO v_status;
  IF v_status <> 'FAIL_WITH_EVIDENCE' THEN
    RAISE EXCEPTION 'expired max-attempt node did not terminalize task: %', v_status;
  END IF;

  SELECT status, terminal_reason
  INTO v_task_status, v_reason
  FROM tasks
  WHERE id = v_task.task_id;

  IF v_task_status <> 'FAIL_WITH_EVIDENCE' OR v_reason <> 'NODE_FAILED' THEN
    RAISE EXCEPTION 'task terminal metadata incorrect: %, %', v_task_status, v_reason;
  END IF;

  SELECT status, last_error, reserved_cost_usd, reserved_tokens
  INTO v_research_status, v_error, v_node_reserved_cost, v_node_reserved_tokens
  FROM task_nodes
  WHERE id = v_research.node_id;

  IF v_research_status <> 'FAIL_WITH_EVIDENCE'
     OR v_error->>'reason' <> 'MAX_ATTEMPTS_EXHAUSTED' THEN
    RAISE EXCEPTION 'expired max-attempt node was not failed correctly: %, %', v_research_status, v_error;
  END IF;

  SELECT status INTO v_data_status
  FROM task_nodes
  WHERE task_id = v_task.task_id AND node_key = 'data';

  IF v_data_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'dependent Data node was not blocked: %', v_data_status;
  END IF;

  SELECT status, release_reason
  INTO v_reservation_status, v_release_reason
  FROM budget_reservations
  WHERE id = v_reservation_id;

  IF v_reservation_status <> 'RELEASED'
     OR v_release_reason <> 'MAX_ATTEMPTS_EXHAUSTED' THEN
    RAISE EXCEPTION 'expired lease reservation was not released correctly: %, %', v_reservation_status, v_release_reason;
  END IF;

  SELECT reserved_cost_usd, reserved_tokens
  INTO v_task_reserved_cost, v_task_reserved_tokens
  FROM tasks
  WHERE id = v_task.task_id;

  IF v_task_reserved_cost <> 0 OR v_task_reserved_tokens <> 0
     OR v_node_reserved_cost <> 0 OR v_node_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'reservation totals leaked after terminalization: task %/% node %/%',
      v_task_reserved_cost, v_task_reserved_tokens, v_node_reserved_cost, v_node_reserved_tokens;
  END IF;
END $$;

SELECT 'expired max-attempt terminalization assertions: PASS' AS result;
