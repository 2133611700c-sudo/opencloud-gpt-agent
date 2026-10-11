BEGIN;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS terminal_reason VARCHAR(64),
  ADD COLUMN IF NOT EXISTS terminal_detail JSONB;

CREATE OR REPLACE FUNCTION block_task_nodes(
  p_task_id UUID,
  p_reason VARCHAR(64),
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE task_nodes n
  SET status = 'BLOCKED',
      last_error = jsonb_build_object(
        'reason', p_reason,
        'detail', COALESCE(p_detail, '{}'::jsonb)
      ),
      lease_until = NULL,
      heartbeat_at = NULL,
      finished_at = COALESCE(n.finished_at, NOW()),
      updated_at = NOW()
  WHERE n.task_id = p_task_id
    AND n.status IN ('PENDING', 'RUNNING', 'AWAITING_APPROVAL');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION cascade_block_descendants(
  p_task_id UUID,
  p_failed_node_id UUID,
  p_reason VARCHAR(64),
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH RECURSIVE descendants(node_id) AS (
    SELECT d.node_id
    FROM task_node_dependencies d
    WHERE d.task_id = p_task_id
      AND d.parent_node_id = p_failed_node_id
    UNION
    SELECT d.node_id
    FROM task_node_dependencies d
    JOIN descendants x ON x.node_id = d.parent_node_id
    WHERE d.task_id = p_task_id
  )
  UPDATE task_nodes n
  SET status = 'BLOCKED',
      last_error = jsonb_build_object(
        'reason', p_reason,
        'failed_parent_node_id', p_failed_node_id,
        'detail', COALESCE(p_detail, '{}'::jsonb)
      ),
      lease_until = NULL,
      heartbeat_at = NULL,
      finished_at = COALESCE(n.finished_at, NOW()),
      updated_at = NOW()
  WHERE n.task_id = p_task_id
    AND n.id IN (SELECT node_id FROM descendants)
    AND n.status IN ('PENDING', 'RUNNING', 'AWAITING_APPROVAL');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_task(
  p_task_id UUID
)
RETURNS execution_status
LANGUAGE plpgsql
AS $$
DECLARE
  v_task RECORD;
  v_total INTEGER;
  v_success INTEGER;
  v_failed INTEGER;
  v_blocked INTEGER;
  v_pending INTEGER;
  v_running INTEGER;
  v_awaiting INTEGER;
  v_ready INTEGER;
  v_failed_node UUID;
BEGIN
  SELECT * INTO v_task
  FROM tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found: %', p_task_id;
  END IF;

  IF v_task.status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED') THEN
    RETURN v_task.status;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'SUCCESS'),
    count(*) FILTER (WHERE status = 'FAIL_WITH_EVIDENCE'),
    count(*) FILTER (WHERE status = 'BLOCKED'),
    count(*) FILTER (WHERE status = 'PENDING'),
    count(*) FILTER (WHERE status = 'RUNNING'),
    count(*) FILTER (WHERE status = 'AWAITING_APPROVAL')
  INTO v_total, v_success, v_failed, v_blocked, v_pending, v_running, v_awaiting
  FROM task_nodes
  WHERE task_id = p_task_id;

  IF v_total = 0 THEN
    UPDATE tasks
    SET status = 'FAIL_WITH_EVIDENCE',
        terminal_reason = 'EMPTY_DAG',
        terminal_detail = '{}'::jsonb,
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  IF v_task.deadline_at <= NOW() THEN
    PERFORM block_task_nodes(p_task_id, 'DEADLINE_EXCEEDED');
    UPDATE tasks
    SET status = 'FAIL_WITH_EVIDENCE',
        terminal_reason = 'DEADLINE_EXCEEDED',
        terminal_detail = jsonb_build_object('deadline_at', v_task.deadline_at),
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  IF v_failed > 0 THEN
    SELECT id INTO v_failed_node
    FROM task_nodes
    WHERE task_id = p_task_id
      AND status = 'FAIL_WITH_EVIDENCE'
    ORDER BY finished_at NULLS LAST, created_at, id
    LIMIT 1;

    PERFORM cascade_block_descendants(
      p_task_id,
      v_failed_node,
      'UPSTREAM_FAILED',
      jsonb_build_object('failed_node_id', v_failed_node)
    );

    UPDATE tasks
    SET status = 'FAIL_WITH_EVIDENCE',
        terminal_reason = 'NODE_FAILED',
        terminal_detail = jsonb_build_object('failed_node_id', v_failed_node),
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  IF v_success = v_total THEN
    UPDATE tasks
    SET status = 'SUCCESS',
        terminal_reason = 'ALL_NODES_SUCCEEDED',
        terminal_detail = '{}'::jsonb,
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'SUCCESS';
  END IF;

  IF v_awaiting > 0 THEN
    UPDATE tasks
    SET status = 'AWAITING_APPROVAL',
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'AWAITING_APPROVAL';
  END IF;

  IF v_running = 0 AND v_pending > 0 AND v_task.current_steps >= v_task.max_total_steps THEN
    PERFORM block_task_nodes(p_task_id, 'MAX_TOTAL_STEPS_EXCEEDED');
    UPDATE tasks
    SET status = 'FAIL_WITH_EVIDENCE',
        terminal_reason = 'MAX_TOTAL_STEPS_EXCEEDED',
        terminal_detail = jsonb_build_object(
          'current_steps', v_task.current_steps,
          'max_total_steps', v_task.max_total_steps
        ),
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  SELECT count(*) INTO v_ready
  FROM task_nodes n
  WHERE n.task_id = p_task_id
    AND n.status = 'PENDING'
    AND NOT EXISTS (
      SELECT 1
      FROM task_node_dependencies d
      LEFT JOIN task_nodes parent
        ON parent.task_id = d.task_id
       AND parent.id = d.parent_node_id
      WHERE d.task_id = n.task_id
        AND d.node_id = n.id
        AND (parent.id IS NULL OR parent.status <> 'SUCCESS')
    );

  IF v_running = 0 AND v_pending > 0 AND v_ready = 0 THEN
    PERFORM block_task_nodes(p_task_id, 'DAG_DEADLOCK');
    UPDATE tasks
    SET status = 'FAIL_WITH_EVIDENCE',
        terminal_reason = 'DAG_DEADLOCK',
        terminal_detail = jsonb_build_object('pending_nodes', v_pending),
        terminal_at = NOW(),
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  UPDATE tasks
  SET status = 'RUNNING',
      updated_at = NOW()
  WHERE id = p_task_id;

  RETURN 'RUNNING';
END;
$$;

CREATE OR REPLACE FUNCTION fail_node_terminal(
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_error JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id UUID;
BEGIN
  UPDATE task_nodes n
  SET status = 'FAIL_WITH_EVIDENCE',
      last_error = COALESCE(p_error, '{}'::jsonb),
      lease_until = NULL,
      heartbeat_at = NOW(),
      finished_at = NOW(),
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
  RETURNING n.task_id INTO v_task_id;

  IF v_task_id IS NULL THEN
    RETURN FALSE;
  END IF;

  PERFORM cascade_block_descendants(
    v_task_id,
    p_node_id,
    'UPSTREAM_FAILED',
    COALESCE(p_error, '{}'::jsonb)
  );
  PERFORM finalize_task(v_task_id);
  RETURN TRUE;
END;
$$;

COMMIT;
