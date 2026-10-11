TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task RECORD;
  v_research UUID;
  v_data UUID;
  v_claim RECORD;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'agent-scoped-claim',
    'agent scoped claim test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT id INTO v_research FROM task_nodes WHERE task_id=v_task.task_id AND agent_id='researcher';
  SELECT id INTO v_data FROM task_nodes WHERE task_id=v_task.task_id AND agent_id='data';

  SELECT * INTO v_claim FROM claim_next_node_for_agent('research-worker','data',30);
  IF FOUND THEN
    RAISE EXCEPTION 'data worker claimed a dependency-blocked node';
  END IF;

  SELECT * INTO v_claim FROM claim_next_node_for_agent('research-worker','researcher',30);
  IF NOT FOUND OR v_claim.node_id <> v_research OR v_claim.agent_id <> 'researcher' THEN
    RAISE EXCEPTION 'research worker did not claim the researcher node';
  END IF;

  IF EXISTS (
    SELECT 1 FROM task_nodes
    WHERE id=v_data AND (lease_owner IS NOT NULL OR status <> 'PENDING')
  ) THEN
    RAISE EXCEPTION 'agent-scoped research claim mutated data node';
  END IF;
END $$;

SELECT 'agent-scoped claim assertions: PASS' AS result;
