BEGIN;

-- Deadline terminalization must preserve the canonical accounting lock order:
-- task_node -> task -> budget_reservation. A terminal task must not retain
-- unresolved RESERVED budget. The preliminary read is safe because NOW() is
-- transaction-stable; if the deadline is not due in this transaction, normal
-- finalization continues without taking the terminalization locks.
CREATE OR REPLACE FUNCTION terminalize_task_deadline(
  p_task_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_status execution_status;
  v_deadline TIMESTAMPTZ;
  v_res RECORD;
BEGIN
  SELECT t.status, t.deadline_at
  INTO v_status, v_deadline
  FROM tasks t
  WHERE t.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found: %', p_task_id;
  END IF;

  IF v_status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED')
     OR v_deadline > NOW() THEN
    RETURN FALSE;
  END IF;

  -- Lock every node deterministically before the task row. This prevents a
  -- task->node inversion against worker accounting paths that lock node->task.
  PERFORM n.id
  FROM task_nodes n
  WHERE n.task_id = p_task_id
  ORDER BY n.id
  FOR UPDATE;

  SELECT t.status, t.deadline_at
  INTO v_status, v_deadline
  FROM tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF v_status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED')
     OR v_deadline > NOW() THEN
    RETURN FALSE;
  END IF;

  FOR v_res IN
    SELECT DISTINCT br.node_id, br.lease_token
    FROM budget_reservations br
    WHERE br.task_id = p_task_id
      AND br.status = 'RESERVED'
    ORDER BY br.node_id, br.lease_token
  LOOP
    PERFORM release_reservations_for_lease(
      p_task_id,
      v_res.node_id,
      v_res.lease_token,
      'DEADLINE_EXCEEDED'
    );
  END LOOP;

  PERFORM block_task_nodes(p_task_id, 'DEADLINE_EXCEEDED');

  UPDATE tasks
  SET status = 'FAIL_WITH_EVIDENCE',
      terminal_reason = 'DEADLINE_EXCEEDED',
      terminal_detail = jsonb_build_object('deadline_at', v_deadline),
      terminal_at = NOW(),
      updated_at = NOW()
  WHERE id = p_task_id;

  RETURN TRUE;
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
  -- Deadline is a task-wide terminal condition and takes precedence. Handle it
  -- before recovery reapers so all outstanding reservations are released under
  -- canonical node->task->reservation locking.
  IF terminalize_task_deadline(p_task_id) THEN
    RETURN 'FAIL_WITH_EVIDENCE';
  END IF;

  -- Preserve attempt-exhaustion precedence for non-deadline recovery.
  PERFORM expire_exhausted_running_node(p_task_id);

  -- Preserve total-step recovery for abandoned expired workers.
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
