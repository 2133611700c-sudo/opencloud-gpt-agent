TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task_a RECORD;
  v_task_b RECORD;
  v_research_a UUID;
  v_research_b UUID;
  v_data_a UUID;
  v_data_b UUID;
  v_claim RECORD;
BEGIN
  SELECT * INTO v_task_a
  FROM create_lite_research_task(
    'task-scoped-claim-a',
    'task scoped claim A',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_task_b
  FROM create_lite_research_task(
    'task-scoped-claim-b',
    'task scoped claim B',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT id INTO v_research_a FROM task_nodes WHERE task_id=v_task_a.task_id AND agent_id='researcher';
  SELECT id INTO v_research_b FROM task_nodes WHERE task_id=v_task_b.task_id AND agent_id='researcher';
  SELECT id INTO v_data_a FROM task_nodes WHERE task_id=v_task_a.task_id AND agent_id='data';
  SELECT id INTO v_data_b FROM task_nodes WHERE task_id=v_task_b.task_id AND agent_id='data';

  UPDATE task_nodes
  SET status='SUCCESS', finished_at=NOW(), updated_at=NOW()
  WHERE id IN (v_research_a, v_research_b);

  SELECT * INTO v_claim
  FROM claim_node_for_task_and_agent(v_task_b.task_id, 'data-worker-b', 'data', 30);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task-scoped claim returned no node for target task';
  END IF;
  IF v_claim.task_id <> v_task_b.task_id OR v_claim.node_id <> v_data_b OR v_claim.agent_id <> 'data' THEN
    RAISE EXCEPTION 'task-scoped claim selected the wrong task/node';
  END IF;

  IF EXISTS (
    SELECT 1 FROM task_nodes
    WHERE id=v_data_a AND (status <> 'PENDING' OR lease_owner IS NOT NULL OR lease_token IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'task-scoped claim mutated data node from another task';
  END IF;

  IF (SELECT current_steps FROM tasks WHERE id=v_task_a.task_id) <> 0 THEN
    RAISE EXCEPTION 'task-scoped claim changed current_steps on another task';
  END IF;
  IF (SELECT current_steps FROM tasks WHERE id=v_task_b.task_id) <> 1 THEN
    RAISE EXCEPTION 'task-scoped claim did not increment target task current_steps exactly once';
  END IF;
END $$;

SELECT 'task-scoped claim assertions: PASS' AS result;
