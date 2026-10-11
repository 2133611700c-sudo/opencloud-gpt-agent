\set ON_ERROR_STOP on

DO $$
DECLARE
  t1 UUID;
  t2 UUID;
  n1 UUID;
  n2 UUID;
BEGIN
  INSERT INTO tasks (
    idempotency_key,
    goal,
    budget_limit_usd,
    token_budget_limit,
    deadline_at
  ) VALUES (
    'schema-test-request-1',
    'schema test task 1',
    1.000000,
    10000,
    NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO t1;

  INSERT INTO tasks (
    idempotency_key,
    goal,
    budget_limit_usd,
    token_budget_limit,
    deadline_at
  ) VALUES (
    'schema-test-request-2',
    'schema test task 2',
    1.000000,
    10000,
    NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO t2;

  INSERT INTO task_nodes (task_id, node_key, agent_id)
  VALUES (t1, 'research', 'researcher')
  RETURNING id INTO n1;

  INSERT INTO task_nodes (task_id, node_key, agent_id)
  VALUES (t2, 'data', 'data')
  RETURNING id INTO n2;

  BEGIN
    INSERT INTO task_node_dependencies (task_id, node_id, parent_node_id)
    VALUES (t2, n2, n1);
    RAISE EXCEPTION 'cross-task dependency unexpectedly succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL;
  END;

  BEGIN
    UPDATE tasks
    SET reserved_cost_usd = 0.800000,
        current_cost_usd = 0.300000
    WHERE id = t1;
    RAISE EXCEPTION 'budget invariant unexpectedly allowed oversubscription';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO tasks (
      idempotency_key,
      goal,
      budget_limit_usd,
      deadline_at
    ) VALUES (
      'schema-test-request-1',
      'duplicate request should fail',
      1.000000,
      NOW() + INTERVAL '10 minutes'
    );
    RAISE EXCEPTION 'idempotency uniqueness unexpectedly allowed duplicate';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_budget_invariant'
  ) THEN
    RAISE EXCEPTION 'tasks_budget_invariant constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_node_dependencies_parent_fk'
  ) THEN
    RAISE EXCEPTION 'normalized same-task dependency FK missing';
  END IF;
END $$;

SELECT 'core schema assertions: PASS' AS result;
