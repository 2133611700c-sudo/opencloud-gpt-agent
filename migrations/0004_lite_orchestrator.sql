BEGIN;

CREATE OR REPLACE FUNCTION create_lite_research_task(
  p_idempotency_key VARCHAR(128),
  p_goal TEXT,
  p_request_payload JSONB,
  p_budget_limit_usd NUMERIC(12,6),
  p_token_budget_limit BIGINT,
  p_max_total_steps INTEGER,
  p_deadline_at TIMESTAMPTZ
)
RETURNS TABLE (
  task_id UUID,
  created BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id UUID;
  v_created BOOLEAN := FALSE;
  v_existing RECORD;
  v_research_id UUID;
  v_data_id UUID;
  v_total_node_count INTEGER;
  v_research_count INTEGER;
  v_data_count INTEGER;
  v_dep_count INTEGER;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;
  IF p_goal IS NULL OR length(trim(p_goal)) = 0 THEN
    RAISE EXCEPTION 'goal is required';
  END IF;
  IF p_budget_limit_usd < 0 THEN
    RAISE EXCEPTION 'budget limit must be nonnegative';
  END IF;
  IF p_token_budget_limit IS NOT NULL AND p_token_budget_limit < 0 THEN
    RAISE EXCEPTION 'token budget limit must be nonnegative';
  END IF;
  IF p_max_total_steps <= 0 THEN
    RAISE EXCEPTION 'max total steps must be positive';
  END IF;
  IF p_deadline_at <= NOW() THEN
    RAISE EXCEPTION 'deadline must be in the future';
  END IF;

  INSERT INTO tasks (
    idempotency_key,
    goal,
    request_payload,
    budget_limit_usd,
    token_budget_limit,
    max_total_steps,
    deadline_at
  ) VALUES (
    p_idempotency_key,
    p_goal,
    COALESCE(p_request_payload, '{}'::jsonb),
    p_budget_limit_usd,
    p_token_budget_limit,
    p_max_total_steps,
    p_deadline_at
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_task_id;

  IF v_task_id IS NOT NULL THEN
    v_created := TRUE;

    INSERT INTO task_nodes (
      task_id,
      node_key,
      agent_id,
      input_payload
    ) VALUES (
      v_task_id,
      'research',
      'researcher',
      jsonb_build_object(
        'goal', p_goal,
        'request', COALESCE(p_request_payload, '{}'::jsonb)
      )
    ) RETURNING id INTO v_research_id;

    INSERT INTO task_nodes (
      task_id,
      node_key,
      agent_id,
      input_payload
    ) VALUES (
      v_task_id,
      'data',
      'data',
      jsonb_build_object(
        'source_node_key', 'research'
      )
    ) RETURNING id INTO v_data_id;

    INSERT INTO task_node_dependencies (task_id, node_id, parent_node_id)
    VALUES (v_task_id, v_data_id, v_research_id);
  ELSE
    SELECT
      t.id,
      t.goal,
      t.request_payload,
      t.budget_limit_usd,
      t.token_budget_limit,
      t.max_total_steps,
      t.deadline_at
    INTO v_existing
    FROM tasks t
    WHERE t.idempotency_key = p_idempotency_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency conflict resolved without existing task';
    END IF;

    IF v_existing.goal IS DISTINCT FROM p_goal
       OR v_existing.request_payload IS DISTINCT FROM COALESCE(p_request_payload, '{}'::jsonb)
       OR v_existing.budget_limit_usd IS DISTINCT FROM p_budget_limit_usd
       OR v_existing.token_budget_limit IS DISTINCT FROM p_token_budget_limit
       OR v_existing.max_total_steps IS DISTINCT FROM p_max_total_steps
       OR v_existing.deadline_at IS DISTINCT FROM p_deadline_at THEN
      RAISE EXCEPTION 'idempotency key reused with different request contract';
    END IF;

    v_task_id := v_existing.id;
  END IF;

  SELECT count(*) INTO v_total_node_count
  FROM task_nodes n
  WHERE n.task_id = v_task_id;

  SELECT count(*) INTO v_research_count
  FROM task_nodes n
  WHERE n.task_id = v_task_id
    AND n.node_key = 'research'
    AND n.agent_id = 'researcher';

  SELECT count(*) INTO v_data_count
  FROM task_nodes n
  WHERE n.task_id = v_task_id
    AND n.node_key = 'data'
    AND n.agent_id = 'data';

  SELECT count(*) INTO v_dep_count
  FROM task_node_dependencies d
  JOIN task_nodes child
    ON child.task_id = d.task_id AND child.id = d.node_id
  JOIN task_nodes parent
    ON parent.task_id = d.task_id AND parent.id = d.parent_node_id
  WHERE d.task_id = v_task_id
    AND child.node_key = 'data'
    AND parent.node_key = 'research';

  IF v_total_node_count <> 2
     OR v_research_count <> 1
     OR v_data_count <> 1
     OR v_dep_count <> 1 THEN
    RAISE EXCEPTION 'canonical lite DAG is missing or corrupted for task %', v_task_id;
  END IF;

  task_id := v_task_id;
  created := v_created;
  RETURN NEXT;
END;
$$;

COMMIT;
