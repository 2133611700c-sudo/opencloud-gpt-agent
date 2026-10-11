BEGIN;

-- Restore lifecycle semantics lost when active-lease write hardening redefined
-- fail_node_terminal(). Keep the hardening: only the current worker holding the
-- current fencing token on a still-active RUNNING lease may perform the write.
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
  SELECT n.task_id
  INTO v_task_id
  FROM task_nodes n
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  PERFORM release_reservations_for_lease(
    v_task_id,
    p_node_id,
    p_lease_token,
    'NODE_TERMINAL_FAILURE'
  );

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
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW();

  IF NOT FOUND THEN
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
