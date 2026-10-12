TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task UUID;
  v_node UUID;
  v_token UUID := gen_random_uuid();
  v_result BOOLEAN;
  v_before TIMESTAMPTZ;
  v_after TIMESTAMPTZ;
BEGIN
  INSERT INTO tasks (
    idempotency_key,
    goal,
    status,
    budget_limit_usd,
    token_budget_limit,
    max_total_steps,
    current_steps,
    deadline_at
  ) VALUES (
    'deadline-heartbeat-guard',
    'prove deadline stops lease renewal',
    'RUNNING',
    10.000000,
    10000,
    10,
    1,
    NOW() - interval '1 second'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (
    task_id,
    node_key,
    agent_id,
    status,
    lease_owner,
    lease_token,
    lease_acquired_at,
    lease_until,
    heartbeat_at,
    attempt,
    max_attempts
  ) VALUES (
    v_task,
    'research',
    'researcher',
    'RUNNING',
    'worker-deadline',
    v_token,
    NOW() - interval '5 seconds',
    NOW() + interval '2 minutes',
    NOW() - interval '5 seconds',
    1,
    3
  ) RETURNING id, lease_until INTO v_node, v_before;

  SELECT heartbeat_node(v_node, 'worker-deadline', v_token, 30) INTO v_result;
  IF v_result THEN
    RAISE EXCEPTION 'heartbeat unexpectedly renewed lease after task deadline';
  END IF;

  SELECT lease_until INTO v_after FROM task_nodes WHERE id = v_node;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'deadline-rejected heartbeat mutated lease_until';
  END IF;
END $$;

SELECT 'deadline heartbeat guard assertions: PASS' AS result;
