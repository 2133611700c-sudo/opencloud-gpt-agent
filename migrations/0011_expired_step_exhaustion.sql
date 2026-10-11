BEGIN;

-- System-owned cleanup for expired RUNNING nodes when the task has exhausted
-- its total-step budget. Worker-owned writes remain fenced. Each expired node
-- is locked before reservation cleanup, preserving node -> task -> reservation
-- lock order.
CREATE OR REPLACE FUNCTION block_expired_running_nodes_for_step_limit(
  p_task_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_node RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_node IN
    SELECT n.id, n.lease_token
    FROM task_nodes n
    JOIN tasks t ON t.id = n.task_id
    WHERE n.task_id = p_task_id
      AND t.current_steps >= t.max_total_steps
      AND n.status = 'RUNNING'
      AND n.lease_until IS NOT NULL
      AND n.lease_until <= NOW()
    ORDER BY n.created_at ASC, n.id ASC
    FOR UPDATE OF n
  LOOP
    PERFORM release_reservations_for_lease(
      p_task_id,
      v_node.id,
      v_node.lease_token,
      'MAX_TOTAL_STEPS_EXCEEDED'
    );

    UPDATE task_nodes n
    SET status = 'BLOCKED',
        last_error = jsonb_build_object(
          'reason', 'MAX_TOTAL_STEPS_EXCEEDED',
          'detail', jsonb_build_object('expired_lease', TRUE)
        ),
        lease_until = NULL,
        heartbeat_at = NULL,
        finished_at = COALESCE(n.finished_at, NOW()),
        updated_at = NOW()
    WHERE n.id = v_node.id
      AND n.task_id = p_task_id
      AND n.status = 'RUNNING'
      AND n.lease_token IS NOT DISTINCT FROM v_node.lease_token
      AND n.lease_until IS NOT NULL
      AND n.lease_until <= NOW();

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

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
  -- Preserve attempt-exhaustion precedence established by migration 0010.
  PERFORM expire_exhausted_running_node(p_task_id);

  -- If attempts remain but no more total steps may be claimed, an expired
  -- worker must not keep the task RUNNING forever. Release its reservations
  -- and block that abandoned RUNNING node before lifecycle counting.
  PERFORM block_expired_running_nodes_for_step_limit(p_task_id);

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

COMMIT;
