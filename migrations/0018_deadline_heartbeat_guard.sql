BEGIN;

-- A task deadline is a hard breaker. Once the parent task deadline has passed
-- (or the task is no longer RUNNING), a worker must not extend its lease.
-- Returning FALSE causes the worker heartbeat manager to abort in-flight work.
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
    AND EXISTS (
      SELECT 1
      FROM tasks t
      WHERE t.id = n.task_id
        AND t.status = 'RUNNING'
        AND t.deadline_at > NOW()
    )
  RETURNING n.id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

COMMIT;
