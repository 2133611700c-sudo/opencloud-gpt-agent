BEGIN;

-- Restore the stale-lease reservation cleanup invariant from claim_next_node()
-- for the scoped claim variants added in migrations 0014 and 0016.

CREATE OR REPLACE FUNCTION claim_next_node_for_agent(
  p_worker_id VARCHAR(128),
  p_agent_id VARCHAR(128),
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
  IF p_agent_id IS NULL OR length(trim(p_agent_id)) = 0 THEN
    RAISE EXCEPTION 'agent id is required';
  END IF;
  IF p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'lease seconds must be between 5 and 3600';
  END IF;

  SELECT n.id, n.task_id, n.agent_id, n.input_payload, n.attempt, n.status, n.lease_token
  INTO v_node
  FROM task_nodes n
  JOIN tasks t ON t.id = n.task_id
  WHERE n.agent_id = p_agent_id
    AND t.status IN ('PENDING', 'RUNNING')
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

  IF NOT FOUND THEN RETURN; END IF;

  IF v_node.status = 'RUNNING' AND v_node.lease_token IS NOT NULL THEN
    PERFORM release_reservations_for_lease(
      v_node.task_id,
      v_node.id,
      v_node.lease_token,
      'LEASE_RECLAIM'
    );
  END IF;

  v_token := gen_random_uuid();

  UPDATE tasks AS t
  SET status = CASE WHEN t.status = 'PENDING' THEN 'RUNNING' ELSE t.status END,
      current_steps = t.current_steps + 1,
      updated_at = NOW()
  WHERE t.id = v_node.task_id;

  UPDATE task_nodes AS n
  SET status = 'RUNNING',
      lease_owner = p_worker_id,
      lease_token = v_token,
      lease_acquired_at = NOW(),
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      heartbeat_at = NOW(),
      attempt = n.attempt + 1,
      started_at = COALESCE(n.started_at, NOW()),
      updated_at = NOW()
  WHERE n.id = v_node.id;

  RETURN QUERY
  SELECT v_node.id, v_node.task_id, v_token, v_node.agent_id, v_node.input_payload, v_node.attempt + 1;
END;
$$;

CREATE OR REPLACE FUNCTION claim_node_for_task_and_agent(
  p_task_id UUID,
  p_worker_id VARCHAR(128),
  p_agent_id VARCHAR(128),
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
  IF p_task_id IS NULL THEN
    RAISE EXCEPTION 'task id is required';
  END IF;
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'worker id is required';
  END IF;
  IF p_agent_id IS NULL OR length(trim(p_agent_id)) = 0 THEN
    RAISE EXCEPTION 'agent id is required';
  END IF;
  IF p_lease_seconds < 5 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'lease seconds must be between 5 and 3600';
  END IF;

  SELECT n.id, n.task_id, n.agent_id, n.input_payload, n.attempt, n.status, n.lease_token
  INTO v_node
  FROM task_nodes n
  JOIN tasks t ON t.id = n.task_id
  WHERE n.task_id = p_task_id
    AND n.agent_id = p_agent_id
    AND t.status IN ('PENDING', 'RUNNING')
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

  IF NOT FOUND THEN RETURN; END IF;

  IF v_node.status = 'RUNNING' AND v_node.lease_token IS NOT NULL THEN
    PERFORM release_reservations_for_lease(
      v_node.task_id,
      v_node.id,
      v_node.lease_token,
      'LEASE_RECLAIM'
    );
  END IF;

  v_token := gen_random_uuid();

  UPDATE tasks AS t
  SET status = CASE WHEN t.status = 'PENDING' THEN 'RUNNING' ELSE t.status END,
      current_steps = t.current_steps + 1,
      updated_at = NOW()
  WHERE t.id = v_node.task_id;

  UPDATE task_nodes AS n
  SET status = 'RUNNING',
      lease_owner = p_worker_id,
      lease_token = v_token,
      lease_acquired_at = NOW(),
      lease_until = NOW() + make_interval(secs => p_lease_seconds),
      heartbeat_at = NOW(),
      attempt = n.attempt + 1,
      started_at = COALESCE(n.started_at, NOW()),
      updated_at = NOW()
  WHERE n.id = v_node.id;

  RETURN QUERY
  SELECT v_node.id, v_node.task_id, v_token, v_node.agent_id, v_node.input_payload, v_node.attempt + 1;
END;
$$;

COMMIT;
