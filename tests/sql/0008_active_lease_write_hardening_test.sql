TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task UUID;
  v_node UUID;
  v_token UUID := gen_random_uuid();
  v_result BOOLEAN;
  v_status execution_status;
  v_owner VARCHAR(128);
  v_token_after UUID;
  v_output JSONB;
  v_error JSONB;
  v_lease_until TIMESTAMPTZ;
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
    'lease-expiry-hardening',
    'prove expired lease cannot mutate',
    'RUNNING',
    10.000000,
    10000,
    10,
    1,
    NOW() + interval '1 hour'
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
    'research',
    'RUNNING',
    'worker-expired',
    v_token,
    NOW() - interval '2 minutes',
    NOW() - interval '1 minute',
    NOW() - interval '2 minutes',
    1,
    3
  ) RETURNING id INTO v_node;

  SELECT heartbeat_node(v_node, 'worker-expired', v_token, 30) INTO v_result;
  IF v_result THEN
    RAISE EXCEPTION 'expired lease heartbeat unexpectedly succeeded';
  END IF;

  SELECT complete_node_success(v_node, 'worker-expired', v_token, '{"should":"not-write"}'::jsonb)
  INTO v_result;
  IF v_result THEN
    RAISE EXCEPTION 'expired lease completion unexpectedly succeeded';
  END IF;

  SELECT requeue_node_retry(v_node, 'worker-expired', v_token, '{"reason":"should-not-write"}'::jsonb)
  INTO v_result;
  IF v_result THEN
    RAISE EXCEPTION 'expired lease requeue unexpectedly succeeded';
  END IF;

  SELECT fail_node_terminal(v_node, 'worker-expired', v_token, '{"reason":"should-not-write"}'::jsonb)
  INTO v_result;
  IF v_result THEN
    RAISE EXCEPTION 'expired lease terminal failure unexpectedly succeeded';
  END IF;

  SELECT status, lease_owner, lease_token, output_data, last_error, lease_until
  INTO v_status, v_owner, v_token_after, v_output, v_error, v_lease_until
  FROM task_nodes
  WHERE id = v_node;

  IF v_status <> 'RUNNING'
     OR v_owner <> 'worker-expired'
     OR v_token_after <> v_token
     OR v_output IS NOT NULL
     OR v_error IS NOT NULL
     OR v_lease_until >= NOW() THEN
    RAISE EXCEPTION 'expired lease attempts mutated node state';
  END IF;
END $$;

SELECT 'active lease write hardening assertions: PASS' AS result;
