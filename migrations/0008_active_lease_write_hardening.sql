BEGIN;

-- Worker-owned state changes require BOTH the fencing token and a currently valid lease.
-- An expired token is stale even before another worker reclaims the node.

CREATE OR REPLACE FUNCTION heartbeat_node(
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'lease seconds must be between 5 and 3600';
  END IF;

  UPDATE task_nodes AS n
  SET heartbeat_at = NOW(),
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW()
  RETURNING n.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION complete_node_success(
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_output_data JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM budget_reservations br
    WHERE br.node_id = p_node_id
      AND br.lease_token = p_lease_token
      AND br.status = 'RESERVED'
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE task_nodes AS n
  SET status = 'SUCCESS',
      output_data = COALESCE(p_output_data, '{}'::jsonb),
      lease_until = NULL,
      heartbeat_at = NOW(),
      finished_at = NOW(),
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW()
  RETURNING n.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION requeue_node_retry(
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
    AND n.attempt < n.max_attempts
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  PERFORM release_reservations_for_lease(v_task_id, p_node_id, p_lease_token, 'NODE_REQUEUE');

  UPDATE task_nodes AS n
  SET status = 'PENDING',
      last_error = COALESCE(p_error, '{}'::jsonb),
      lease_owner = NULL,
      lease_token = NULL,
      lease_acquired_at = NULL,
      lease_until = NULL,
      heartbeat_at = NULL,
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW();

  RETURN FOUND;
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

  PERFORM release_reservations_for_lease(v_task_id, p_node_id, p_lease_token, 'NODE_TERMINAL_FAILURE');

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

  RETURN FOUND;
END;
$$;

COMMIT;
