BEGIN;

-- Canonical task cancellation preserves the accounting lock order:
-- task_node -> task -> budget_reservation. Cancellation is task-wide and
-- terminal; all unresolved reservations are released before node/task state
-- becomes CANCELLED.
CREATE OR REPLACE FUNCTION cancel_task(
  p_task_id UUID,
  p_reason VARCHAR(64) DEFAULT 'USER_CANCELLED',
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_status execution_status;
  v_res RECORD;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'cancellation reason is required';
  END IF;

  SELECT t.status
  INTO v_status
  FROM tasks t
  WHERE t.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found: %', p_task_id;
  END IF;

  IF v_status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED') THEN
    RETURN FALSE;
  END IF;

  -- Lock every node first, deterministically, to avoid task->node inversion
  -- against worker/accounting paths.
  PERFORM n.id
  FROM task_nodes n
  WHERE n.task_id = p_task_id
  ORDER BY n.id
  FOR UPDATE;

  SELECT t.status
  INTO v_status
  FROM tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;

  IF v_status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED') THEN
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
      p_reason
    );
  END LOOP;

  UPDATE task_nodes
  SET status = 'CANCELLED',
      last_error = jsonb_build_object(
        'reason', p_reason,
        'detail', COALESCE(p_detail, '{}'::jsonb)
      ),
      lease_owner = NULL,
      lease_token = NULL,
      lease_acquired_at = NULL,
      lease_until = NULL,
      heartbeat_at = NULL,
      finished_at = COALESCE(finished_at, NOW()),
      updated_at = NOW()
  WHERE task_id = p_task_id
    AND status NOT IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED');

  UPDATE tasks
  SET status = 'CANCELLED',
      terminal_reason = p_reason,
      terminal_detail = COALESCE(p_detail, '{}'::jsonb),
      terminal_at = NOW(),
      updated_at = NOW()
  WHERE id = p_task_id;

  RETURN TRUE;
END;
$$;

COMMIT;
