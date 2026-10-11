TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_deadline TIMESTAMPTZ := NOW() + INTERVAL '20 minutes';
  v_first RECORD;
  v_second RECORD;
  v_task_count INTEGER;
  v_node_count INTEGER;
  v_dep_count INTEGER;
  v_research_id UUID;
  v_data_id UUID;
  v_claim RECORD;
BEGIN
  SELECT * INTO v_first
  FROM create_lite_research_task(
    'request-123',
    'Find five current test listings',
    '{"region":"CA","limit":5}'::jsonb,
    0.250000,
    5000,
    10,
    v_deadline
  );

  IF NOT FOUND OR v_first.task_id IS NULL OR v_first.created IS NOT TRUE THEN
    RAISE EXCEPTION 'first lite task intake did not create task';
  END IF;

  SELECT * INTO v_second
  FROM create_lite_research_task(
    'request-123',
    'Find five current test listings',
    '{"region":"CA","limit":5}'::jsonb,
    0.250000,
    5000,
    10,
    v_deadline
  );

  IF NOT FOUND OR v_second.task_id <> v_first.task_id OR v_second.created IS NOT FALSE THEN
    RAISE EXCEPTION 'repeated request_id did not return same task idempotently';
  END IF;

  SELECT count(*) INTO v_task_count
  FROM tasks
  WHERE idempotency_key = 'request-123';
  IF v_task_count <> 1 THEN
    RAISE EXCEPTION 'idempotency produced % tasks instead of 1', v_task_count;
  END IF;

  SELECT count(*) INTO v_node_count
  FROM task_nodes
  WHERE task_id = v_first.task_id;
  IF v_node_count <> 2 THEN
    RAISE EXCEPTION 'lite DAG has % nodes instead of exactly 2', v_node_count;
  END IF;

  SELECT id INTO v_research_id
  FROM task_nodes
  WHERE task_id = v_first.task_id
    AND node_key = 'research'
    AND agent_id = 'researcher';

  SELECT id INTO v_data_id
  FROM task_nodes
  WHERE task_id = v_first.task_id
    AND node_key = 'data'
    AND agent_id = 'data';

  IF v_research_id IS NULL OR v_data_id IS NULL THEN
    RAISE EXCEPTION 'canonical research/data nodes missing';
  END IF;

  SELECT count(*) INTO v_dep_count
  FROM task_node_dependencies
  WHERE task_id = v_first.task_id
    AND node_id = v_data_id
    AND parent_node_id = v_research_id;
  IF v_dep_count <> 1 THEN
    RAISE EXCEPTION 'data node does not depend exactly once on research node';
  END IF;

  -- Scheduler must expose Research first; Data remains blocked by dependency.
  SELECT * INTO v_claim FROM claim_next_node('lite-worker', 30);
  IF NOT FOUND OR v_claim.node_id <> v_research_id THEN
    RAISE EXCEPTION 'lite DAG scheduler did not claim Research first';
  END IF;
END $$;

-- Reusing a request id with a different contract must fail closed.
DO $$
DECLARE
  v_deadline TIMESTAMPTZ;
BEGIN
  SELECT deadline_at INTO v_deadline
  FROM tasks
  WHERE idempotency_key = 'request-123';

  BEGIN
    PERFORM *
    FROM create_lite_research_task(
      'request-123',
      'DIFFERENT GOAL',
      '{"region":"CA","limit":5}'::jsonb,
      0.250000,
      5000,
      10,
      v_deadline
    );
    RAISE EXCEPTION 'expected idempotency contract mismatch rejection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected idempotency contract mismatch rejection' THEN
        RAISE;
      END IF;
      IF position('idempotency key reused with different request contract' in SQLERRM) = 0 THEN
        RAISE EXCEPTION 'unexpected mismatch error: %', SQLERRM;
      END IF;
  END;
END $$;

SELECT 'lite orchestrator intake assertions: PASS' AS result;
