TRUNCATE TABLE tasks CASCADE;

-- Positive path: Research -> Data -> SUCCESS.
DO $$
DECLARE
  v_task RECORD;
  v_research RECORD;
  v_data RECORD;
  v_ok BOOLEAN;
  v_status execution_status;
  v_task_status execution_status;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'finalizer-success',
    'positive finalizer test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_research FROM claim_next_node('worker-r', 30);
  SELECT complete_node_success(v_research.node_id, 'worker-r', v_research.lease_token, '{"research":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'research completion failed'; END IF;

  SELECT finalize_task(v_task.task_id) INTO v_status;
  IF v_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'task finalized too early after Research: %', v_status;
  END IF;

  SELECT * INTO v_data FROM claim_next_node('worker-d', 30);
  IF NOT FOUND OR v_data.agent_id <> 'data' THEN
    RAISE EXCEPTION 'Data node was not released after Research success';
  END IF;

  SELECT complete_node_success(v_data.node_id, 'worker-d', v_data.lease_token, '{"data":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'data completion failed'; END IF;

  SELECT finalize_task(v_task.task_id) INTO v_status;
  IF v_status <> 'SUCCESS' THEN
    RAISE EXCEPTION 'all-success DAG did not finalize SUCCESS: %', v_status;
  END IF;

  SELECT status, terminal_reason INTO v_task_status, v_reason
  FROM tasks WHERE id = v_task.task_id;
  IF v_task_status <> 'SUCCESS' OR v_reason <> 'ALL_NODES_SUCCEEDED' THEN
    RAISE EXCEPTION 'success terminal metadata incorrect: %, %', v_task_status, v_reason;
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Terminal node failure cascades to Data and closes task.
DO $$
DECLARE
  v_task RECORD;
  v_research RECORD;
  v_ok BOOLEAN;
  v_data_status execution_status;
  v_task_status execution_status;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'finalizer-failure',
    'failure cascade test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_research FROM claim_next_node('worker-f', 30);
  SELECT fail_node_terminal(
    v_research.node_id,
    'worker-f',
    v_research.lease_token,
    '{"error":"forced failure"}'::jsonb
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'terminal failure write rejected valid lease'; END IF;

  SELECT status INTO v_data_status
  FROM task_nodes
  WHERE task_id = v_task.task_id AND node_key = 'data';
  IF v_data_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'Data descendant not BLOCKED after Research failure: %', v_data_status;
  END IF;

  SELECT status, terminal_reason INTO v_task_status, v_reason
  FROM tasks WHERE id = v_task.task_id;
  IF v_task_status <> 'FAIL_WITH_EVIDENCE' OR v_reason <> 'NODE_FAILED' THEN
    RAISE EXCEPTION 'failed DAG did not terminate correctly: %, %', v_task_status, v_reason;
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Deadline closes unfinished task and blocks remaining nodes.
DO $$
DECLARE
  v_task RECORD;
  v_status execution_status;
  v_unfinished INTEGER;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'finalizer-deadline',
    'deadline closure test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  UPDATE tasks SET deadline_at = NOW() - INTERVAL '1 second' WHERE id = v_task.task_id;
  SELECT finalize_task(v_task.task_id) INTO v_status;
  IF v_status <> 'FAIL_WITH_EVIDENCE' THEN
    RAISE EXCEPTION 'deadline did not terminate task';
  END IF;

  SELECT terminal_reason INTO v_reason FROM tasks WHERE id = v_task.task_id;
  SELECT count(*) INTO v_unfinished FROM task_nodes
  WHERE task_id = v_task.task_id AND status IN ('PENDING','RUNNING','AWAITING_APPROVAL');
  IF v_reason <> 'DEADLINE_EXCEEDED' OR v_unfinished <> 0 THEN
    RAISE EXCEPTION 'deadline closure incomplete: reason %, unfinished %', v_reason, v_unfinished;
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Total-step exhaustion after Research blocks Data and terminates.
DO $$
DECLARE
  v_task RECORD;
  v_research RECORD;
  v_ok BOOLEAN;
  v_status execution_status;
  v_data_status execution_status;
  v_reason VARCHAR(64);
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'finalizer-steps',
    'step breaker closure test',
    '{}'::jsonb,
    1.000000,
    10000,
    1,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT * INTO v_research FROM claim_next_node('worker-s', 30);
  SELECT complete_node_success(v_research.node_id, 'worker-s', v_research.lease_token, '{}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'research completion failed for step test'; END IF;

  SELECT finalize_task(v_task.task_id) INTO v_status;
  SELECT terminal_reason INTO v_reason FROM tasks WHERE id = v_task.task_id;
  SELECT status INTO v_data_status FROM task_nodes WHERE task_id = v_task.task_id AND node_key = 'data';

  IF v_status <> 'FAIL_WITH_EVIDENCE'
     OR v_reason <> 'MAX_TOTAL_STEPS_EXCEEDED'
     OR v_data_status <> 'BLOCKED' THEN
    RAISE EXCEPTION 'step exhaustion did not close task correctly: %, %, %', v_status, v_reason, v_data_status;
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Corrupted cyclic DAG is detected as deadlock, not left dangling.
DO $$
DECLARE
  v_task RECORD;
  v_research_id UUID;
  v_data_id UUID;
  v_status execution_status;
  v_reason VARCHAR(64);
  v_pending INTEGER;
BEGIN
  SELECT * INTO v_task
  FROM create_lite_research_task(
    'finalizer-deadlock',
    'deadlock test',
    '{}'::jsonb,
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '20 minutes'
  );

  SELECT id INTO v_research_id FROM task_nodes WHERE task_id = v_task.task_id AND node_key = 'research';
  SELECT id INTO v_data_id FROM task_nodes WHERE task_id = v_task.task_id AND node_key = 'data';

  INSERT INTO task_node_dependencies(task_id, node_id, parent_node_id)
  VALUES (v_task.task_id, v_research_id, v_data_id);

  SELECT finalize_task(v_task.task_id) INTO v_status;
  SELECT terminal_reason INTO v_reason FROM tasks WHERE id = v_task.task_id;
  SELECT count(*) INTO v_pending FROM task_nodes
  WHERE task_id = v_task.task_id AND status IN ('PENDING','RUNNING','AWAITING_APPROVAL');

  IF v_status <> 'FAIL_WITH_EVIDENCE'
     OR v_reason <> 'DAG_DEADLOCK'
     OR v_pending <> 0 THEN
    RAISE EXCEPTION 'deadlock not closed correctly: %, %, remaining %', v_status, v_reason, v_pending;
  END IF;
END $$;

SELECT 'task finalizer assertions: PASS' AS result;
