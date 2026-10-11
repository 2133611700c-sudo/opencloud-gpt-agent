BEGIN;

CREATE OR REPLACE FUNCTION claim_next_node(
  p_worker_id VARCHAR(128),
  p_lease_seconds INTEGER DEFAULT 30
)
RETURNS TABLE (
  node_id UUID,
  task_id UUID,
  lease_token UUID,
  agent_id VARCHAR(128),
  input_payload JSONB,
  attempt INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_node RECORD;
  v_token UUID;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'lease seconds must be between 5 and 3600';
  END IF;

  SELECT
    n.id,
    n.task_id,
    n.agent_id,
    n.input_payload,
    n.attempt
  INTO v_node
  FROM task_nodes n
  JOIN tasks t ON t.id = n.task_id
  WHERE t.status IN ('PENDING', 'RUNNING')
    AND t.deadline_at > NOW()
    AND t.current_steps < t.max_total_steps
    AND n.attempt < n.max_attempts
    AND (
      n.status = 'PENDING'
      OR (
        n.status = 'RUNNING'
        AND n.lease_until IS NOT NULL
        AND n.lease_until < NOW()
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM task_node_dependencies d
      LEFT JOIN task_nodes parent
        ON parent.task_id = d.task_id
       AND parent.id = d.parent_node_id
      WHERE d.task_id = n.task_id
        AND d.node_id = n.id
        AND (parent.id IS NULL OR parent.status <> 'SUCCESS')
    )
  ORDER BY n.created_at ASC, n.id ASC
  LIMIT 1
  FOR UPDATE OF n, t SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_token := gen_random_uuid();

  UPDATE tasks
  SET status = CASE WHEN status = 'PENDING' THEN 'RUNNING' ELSE status END,
      current_steps = current_steps + 1,
      updated_at = NOW()
  WHERE id = v_node.task_id;

  UPDATE task_nodes
  SET status = 'RUNNING',
      lease_owner = p_worker_id,
      lease_token = v_token,
      lease_acquired_at = NOW(),
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      heartbeat_at = NOW(),
      attempt = attempt + 1,
      started_at = COALESCE(started_at, NOW()),
      updated_at = NOW()
  WHERE id = v_node.id;

  RETURN QUERY
  SELECT
    v_node.id,
    v_node.task_id,
    v_token,
    v_node.agent_id,
    v_node.input_payload,
    v_node.attempt + 1;
END;
$$;

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

  UPDATE task_nodes
  SET heartbeat_at = NOW(),
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      updated_at = NOW()
  WHERE id = p_node_id
    AND status = 'RUNNING'
    AND lease_owner = p_worker_id
    AND lease_token = p_lease_token
  RETURNING id INTO v_updated;

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
  UPDATE task_nodes
  SET status = 'SUCCESS',
      output_data = COALESCE(p_output_data, '{}'::jsonb),
      lease_until = NULL,
      heartbeat_at = NOW(),
      finished_at = NOW(),
      updated_at = NOW()
  WHERE id = p_node_id
    AND status = 'RUNNING'
    AND lease_owner = p_worker_id
    AND lease_token = p_lease_token
  RETURNING id INTO v_updated;

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
  v_updated UUID;
BEGIN
  UPDATE task_nodes
  SET status = 'PENDING',
      last_error = COALESCE(p_error, '{}'::jsonb),
      lease_owner = NULL,
      lease_token = NULL,
      lease_acquired_at = NULL,
      lease_until = NULL,
      heartbeat_at = NULL,
      updated_at = NOW()
  WHERE id = p_node_id
    AND status = 'RUNNING'
    AND lease_owner = p_worker_id
    AND lease_token = p_lease_token
    AND attempt < max_attempts
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

COMMIT;
