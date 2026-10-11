BEGIN;

DO $$
BEGIN
  CREATE TYPE budget_reservation_status AS ENUM (
    'RESERVED',
    'RECONCILED',
    'RELEASED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS budget_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_key VARCHAR(160) NOT NULL UNIQUE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  lease_token UUID NOT NULL,
  status budget_reservation_status NOT NULL DEFAULT 'RESERVED',
  reserved_cost_usd NUMERIC(12, 6) NOT NULL,
  reserved_tokens BIGINT NOT NULL,
  actual_cost_usd NUMERIC(12, 6),
  actual_tokens BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciled_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,

  CONSTRAINT budget_reservations_node_fk
    FOREIGN KEY (task_id, node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE,
  CONSTRAINT budget_reservations_reserved_nonnegative CHECK (
    reserved_cost_usd >= 0 AND reserved_tokens >= 0
  ),
  CONSTRAINT budget_reservations_actual_nonnegative CHECK (
    (actual_cost_usd IS NULL OR actual_cost_usd >= 0) AND
    (actual_tokens IS NULL OR actual_tokens >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_task_status
  ON budget_reservations(task_id, status);

CREATE INDEX IF NOT EXISTS idx_budget_reservations_node_status
  ON budget_reservations(node_id, status);

CREATE OR REPLACE FUNCTION reserve_node_budget(
  p_reservation_key VARCHAR(160),
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_reserved_cost_usd NUMERIC(12, 6),
  p_reserved_tokens BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id UUID;
  v_existing RECORD;
  v_reservation_id UUID;
BEGIN
  IF p_reservation_key IS NULL OR length(trim(p_reservation_key)) = 0 THEN
    RAISE EXCEPTION 'reservation key is required';
  END IF;
  IF p_reserved_cost_usd < 0 OR p_reserved_tokens < 0 THEN
    RAISE EXCEPTION 'reservation values must be nonnegative';
  END IF;

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
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM tasks t
  WHERE t.id = v_task_id
  FOR UPDATE;

  SELECT br.id, br.task_id, br.node_id, br.lease_token
  INTO v_existing
  FROM budget_reservations br
  WHERE br.reservation_key = p_reservation_key;

  IF FOUND THEN
    IF v_existing.task_id <> v_task_id
       OR v_existing.node_id <> p_node_id
       OR v_existing.lease_token <> p_lease_token THEN
      RAISE EXCEPTION 'reservation key collision';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tasks t
    WHERE t.id = v_task_id
      AND t.status = 'RUNNING'
      AND t.deadline_at > NOW()
      AND t.current_steps <= t.max_total_steps
      AND t.current_cost_usd + t.reserved_cost_usd + p_reserved_cost_usd <= t.budget_limit_usd
      AND (
        t.token_budget_limit IS NULL
        OR t.current_tokens + t.reserved_tokens + p_reserved_tokens <= t.token_budget_limit
      )
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO budget_reservations (
    reservation_key,
    task_id,
    node_id,
    lease_token,
    reserved_cost_usd,
    reserved_tokens
  ) VALUES (
    p_reservation_key,
    v_task_id,
    p_node_id,
    p_lease_token,
    p_reserved_cost_usd,
    p_reserved_tokens
  )
  RETURNING id INTO v_reservation_id;

  UPDATE tasks t
  SET reserved_cost_usd = t.reserved_cost_usd + p_reserved_cost_usd,
      reserved_tokens = t.reserved_tokens + p_reserved_tokens,
      updated_at = NOW()
  WHERE t.id = v_task_id;

  UPDATE task_nodes n
  SET reserved_cost_usd = n.reserved_cost_usd + p_reserved_cost_usd,
      reserved_tokens = n.reserved_tokens + p_reserved_tokens,
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lease changed while reserving budget';
  END IF;

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_node_budget(
  p_reservation_id UUID,
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_actual_cost_usd NUMERIC(12, 6),
  p_actual_tokens BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation RECORD;
  v_task_id UUID;
BEGIN
  IF p_actual_cost_usd < 0 OR p_actual_tokens < 0 THEN
    RAISE EXCEPTION 'actual usage values must be nonnegative';
  END IF;

  SELECT br.*
  INTO v_reservation
  FROM budget_reservations br
  WHERE br.id = p_reservation_id
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND OR v_reservation.status <> 'RESERVED' THEN
    RETURN FALSE;
  END IF;

  IF p_actual_cost_usd > v_reservation.reserved_cost_usd
     OR p_actual_tokens > v_reservation.reserved_tokens THEN
    RAISE EXCEPTION 'actual usage exceeds reservation';
  END IF;

  SELECT n.task_id
  INTO v_task_id
  FROM task_nodes n
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND OR v_task_id <> v_reservation.task_id THEN
    RETURN FALSE;
  END IF;

  PERFORM 1 FROM tasks t WHERE t.id = v_task_id FOR UPDATE;

  UPDATE tasks t
  SET reserved_cost_usd = t.reserved_cost_usd - v_reservation.reserved_cost_usd,
      reserved_tokens = t.reserved_tokens - v_reservation.reserved_tokens,
      current_cost_usd = t.current_cost_usd + p_actual_cost_usd,
      current_tokens = t.current_tokens + p_actual_tokens,
      updated_at = NOW()
  WHERE t.id = v_task_id;

  UPDATE task_nodes n
  SET reserved_cost_usd = n.reserved_cost_usd - v_reservation.reserved_cost_usd,
      reserved_tokens = n.reserved_tokens - v_reservation.reserved_tokens,
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token;

  UPDATE budget_reservations br
  SET status = 'RECONCILED',
      actual_cost_usd = p_actual_cost_usd,
      actual_tokens = p_actual_tokens,
      reconciled_at = NOW()
  WHERE br.id = p_reservation_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION release_node_budget(
  p_reservation_id UUID,
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_reservation RECORD;
  v_task_id UUID;
BEGIN
  SELECT br.*
  INTO v_reservation
  FROM budget_reservations br
  WHERE br.id = p_reservation_id
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND OR v_reservation.status <> 'RESERVED' THEN
    RETURN FALSE;
  END IF;

  SELECT n.task_id
  INTO v_task_id
  FROM task_nodes n
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
  FOR UPDATE;

  IF NOT FOUND OR v_task_id <> v_reservation.task_id THEN
    RETURN FALSE;
  END IF;

  PERFORM 1 FROM tasks t WHERE t.id = v_task_id FOR UPDATE;

  UPDATE tasks t
  SET reserved_cost_usd = t.reserved_cost_usd - v_reservation.reserved_cost_usd,
      reserved_tokens = t.reserved_tokens - v_reservation.reserved_tokens,
      updated_at = NOW()
  WHERE t.id = v_task_id;

  UPDATE task_nodes n
  SET reserved_cost_usd = n.reserved_cost_usd - v_reservation.reserved_cost_usd,
      reserved_tokens = n.reserved_tokens - v_reservation.reserved_tokens,
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token;

  UPDATE budget_reservations br
  SET status = 'RELEASED',
      released_at = NOW()
  WHERE br.id = p_reservation_id;

  RETURN TRUE;
END;
$$;

COMMIT;
