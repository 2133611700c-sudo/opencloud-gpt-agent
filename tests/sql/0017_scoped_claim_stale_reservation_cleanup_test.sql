TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task_agent RECORD;
  v_claim_agent_1 RECORD;
  v_claim_agent_2 RECORD;
  v_res_agent UUID;
  v_task_scoped RECORD;
  v_claim_task_1 RECORD;
  v_claim_task_2 RECORD;
  v_res_task UUID;
BEGIN
  -- Agent-scoped reclaim must release reservations from the expired fencing token.
  SELECT * INTO v_task_agent
  FROM create_lite_research_task(
    'stale-agent-reclaim-0017',
    'stale agent-scoped reclaim cleanup',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_claim_agent_1
  FROM claim_next_node_for_agent('agent-worker-1', 'researcher', 30);

  IF NOT FOUND OR v_claim_agent_1.task_id <> v_task_agent.task_id THEN
    RAISE EXCEPTION 'initial agent-scoped claim failed';
  END IF;

  SELECT reserve_node_budget(
    'stale-agent-reclaim-reservation-0017',
    v_claim_agent_1.node_id,
    'agent-worker-1',
    v_claim_agent_1.lease_token,
    0.100000,
    100
  ) INTO v_res_agent;

  IF v_res_agent IS NULL THEN
    RAISE EXCEPTION 'agent-scoped reservation failed';
  END IF;

  UPDATE task_nodes
  SET lease_until = NOW() - INTERVAL '1 second', updated_at = NOW()
  WHERE id = v_claim_agent_1.node_id;

  SELECT * INTO v_claim_agent_2
  FROM claim_next_node_for_agent('agent-worker-2', 'researcher', 30);

  IF NOT FOUND OR v_claim_agent_2.node_id <> v_claim_agent_1.node_id THEN
    RAISE EXCEPTION 'agent-scoped stale reclaim failed';
  END IF;
  IF v_claim_agent_2.lease_token = v_claim_agent_1.lease_token THEN
    RAISE EXCEPTION 'agent-scoped stale reclaim reused fencing token';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM budget_reservations
    WHERE id = v_res_agent
      AND status = 'RELEASED'
      AND release_reason = 'LEASE_RECLAIM'
  ) THEN
    RAISE EXCEPTION 'agent-scoped stale reservation was not released';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tasks
    WHERE id = v_task_agent.task_id
      AND (reserved_cost_usd <> 0 OR reserved_tokens <> 0)
  ) THEN
    RAISE EXCEPTION 'agent-scoped reclaim left task reservation counters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM task_nodes
    WHERE id = v_claim_agent_1.node_id
      AND (reserved_cost_usd <> 0 OR reserved_tokens <> 0)
  ) THEN
    RAISE EXCEPTION 'agent-scoped reclaim left node reservation counters';
  END IF;

  -- Task-scoped reclaim must enforce the same cleanup invariant.
  SELECT * INTO v_task_scoped
  FROM create_lite_research_task(
    'stale-task-reclaim-0017',
    'stale task-scoped reclaim cleanup',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_claim_task_1
  FROM claim_node_for_task_and_agent(
    v_task_scoped.task_id,
    'task-worker-1',
    'researcher',
    30
  );

  IF NOT FOUND OR v_claim_task_1.task_id <> v_task_scoped.task_id THEN
    RAISE EXCEPTION 'initial task-scoped claim failed';
  END IF;

  SELECT reserve_node_budget(
    'stale-task-reclaim-reservation-0017',
    v_claim_task_1.node_id,
    'task-worker-1',
    v_claim_task_1.lease_token,
    0.100000,
    100
  ) INTO v_res_task;

  IF v_res_task IS NULL THEN
    RAISE EXCEPTION 'task-scoped reservation failed';
  END IF;

  UPDATE task_nodes
  SET lease_until = NOW() - INTERVAL '1 second', updated_at = NOW()
  WHERE id = v_claim_task_1.node_id;

  SELECT * INTO v_claim_task_2
  FROM claim_node_for_task_and_agent(
    v_task_scoped.task_id,
    'task-worker-2',
    'researcher',
    30
  );

  IF NOT FOUND OR v_claim_task_2.node_id <> v_claim_task_1.node_id THEN
    RAISE EXCEPTION 'task-scoped stale reclaim failed';
  END IF;
  IF v_claim_task_2.lease_token = v_claim_task_1.lease_token THEN
    RAISE EXCEPTION 'task-scoped stale reclaim reused fencing token';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM budget_reservations
    WHERE id = v_res_task
      AND status = 'RELEASED'
      AND release_reason = 'LEASE_RECLAIM'
  ) THEN
    RAISE EXCEPTION 'task-scoped stale reservation was not released';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tasks
    WHERE id = v_task_scoped.task_id
      AND (reserved_cost_usd <> 0 OR reserved_tokens <> 0)
  ) THEN
    RAISE EXCEPTION 'task-scoped reclaim left task reservation counters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM task_nodes
    WHERE id = v_claim_task_1.node_id
      AND (reserved_cost_usd <> 0 OR reserved_tokens <> 0)
  ) THEN
    RAISE EXCEPTION 'task-scoped reclaim left node reservation counters';
  END IF;
END $$;

SELECT 'scoped stale reclaim reservation cleanup assertions: PASS' AS result;
