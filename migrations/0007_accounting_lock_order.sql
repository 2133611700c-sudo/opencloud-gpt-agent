BEGIN;

-- Canonical lock order for budget/model accounting is:
-- task_node -> task -> budget_reservation.
-- Callers such as reclaim/requeue already hold the node lock; reacquiring it is safe.
CREATE OR REPLACE FUNCTION release_reservations_for_lease(
  p_task_id UUID,
  p_node_id UUID,
  p_lease_token UUID,
  p_reason VARCHAR(64)
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cost NUMERIC(12,6) := 0;
  v_tokens BIGINT := 0;
  v_count INTEGER := 0;
  v_task_reserved NUMERIC(12,6);
  v_task_tokens BIGINT;
  v_node_reserved NUMERIC(12,6);
  v_node_tokens BIGINT;
BEGIN
  IF p_lease_token IS NULL THEN RETURN 0; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'release reason is required';
  END IF;

  SELECT n.reserved_cost_usd, n.reserved_tokens
  INTO v_node_reserved, v_node_tokens
  FROM task_nodes n
  WHERE n.task_id = p_task_id AND n.id = p_node_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'node not found while releasing reservations'; END IF;

  SELECT t.reserved_cost_usd, t.reserved_tokens
  INTO v_task_reserved, v_task_tokens
  FROM tasks t
  WHERE t.id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found while releasing reservations'; END IF;

  PERFORM 1
  FROM budget_reservations br
  WHERE br.task_id = p_task_id
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token
    AND br.status = 'RESERVED'
  FOR UPDATE;

  SELECT COALESCE(sum(br.reserved_cost_usd), 0),
         COALESCE(sum(br.reserved_tokens), 0),
         count(*)
  INTO v_cost, v_tokens, v_count
  FROM budget_reservations br
  WHERE br.task_id = p_task_id
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token
    AND br.status = 'RESERVED';

  IF v_count = 0 THEN RETURN 0; END IF;

  IF v_task_reserved < v_cost OR v_task_tokens < v_tokens
     OR v_node_reserved < v_cost OR v_node_tokens < v_tokens THEN
    RAISE EXCEPTION 'reservation totals are inconsistent; refusing release';
  END IF;

  UPDATE task_nodes n
  SET reserved_cost_usd = n.reserved_cost_usd - v_cost,
      reserved_tokens = n.reserved_tokens - v_tokens,
      updated_at = NOW()
  WHERE n.task_id = p_task_id AND n.id = p_node_id;

  UPDATE tasks t
  SET reserved_cost_usd = t.reserved_cost_usd - v_cost,
      reserved_tokens = t.reserved_tokens - v_tokens,
      updated_at = NOW()
  WHERE t.id = p_task_id;

  UPDATE budget_reservations br
  SET status = 'RELEASED',
      release_reason = p_reason,
      released_at = NOW()
  WHERE br.task_id = p_task_id
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token
    AND br.status = 'RESERVED';

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION record_llm_call(
  p_reservation_id UUID,
  p_call_key VARCHAR(160),
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_provider VARCHAR(64),
  p_model VARCHAR(128),
  p_pricing_version VARCHAR(64),
  p_provider_request_id VARCHAR(256),
  p_prompt_cache_hit_tokens BIGINT,
  p_prompt_cache_miss_tokens BIGINT,
  p_completion_tokens BIGINT,
  p_total_tokens BIGINT,
  p_actual_cost_usd NUMERIC(12,6),
  p_latency_ms INTEGER
)
RETURNS TABLE (accounting_id UUID, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res RECORD;
  v_existing RECORD;
  v_task_id UUID;
  v_accounting_id UUID;
BEGIN
  IF p_call_key IS NULL OR length(trim(p_call_key)) = 0 THEN RAISE EXCEPTION 'call key is required'; END IF;
  IF p_provider IS NULL OR length(trim(p_provider)) = 0
     OR p_model IS NULL OR length(trim(p_model)) = 0
     OR p_pricing_version IS NULL OR length(trim(p_pricing_version)) = 0 THEN
    RAISE EXCEPTION 'provider, model and pricing version are required';
  END IF;
  IF p_prompt_cache_hit_tokens < 0 OR p_prompt_cache_miss_tokens < 0
     OR p_completion_tokens < 0 OR p_total_tokens < 0
     OR p_actual_cost_usd < 0 OR p_latency_ms < 0 THEN
    RAISE EXCEPTION 'model usage/accounting values must be nonnegative';
  END IF;
  IF p_total_tokens <> p_prompt_cache_hit_tokens + p_prompt_cache_miss_tokens + p_completion_tokens THEN
    RAISE EXCEPTION 'total token count does not match classified token counts';
  END IF;

  -- Fast idempotent path also works after the node is terminal.
  SELECT a.* INTO v_existing FROM llm_accounting a WHERE a.call_key = p_call_key;
  IF FOUND THEN
    SELECT br.* INTO v_res FROM budget_reservations br WHERE br.id = p_reservation_id;
    IF NOT FOUND
       OR v_res.status <> 'RECONCILED'
       OR v_res.reservation_key <> p_call_key
       OR v_res.node_id <> p_node_id
       OR v_res.lease_token <> p_lease_token
       OR v_existing.task_id <> v_res.task_id
       OR v_existing.node_id <> p_node_id
       OR v_existing.lease_token <> p_lease_token
       OR v_existing.provider <> p_provider
       OR v_existing.model <> p_model
       OR v_existing.pricing_version <> p_pricing_version
       OR v_existing.provider_request_id IS DISTINCT FROM p_provider_request_id
       OR v_existing.prompt_cache_hit_tokens <> p_prompt_cache_hit_tokens
       OR v_existing.prompt_cache_miss_tokens <> p_prompt_cache_miss_tokens
       OR v_existing.completion_tokens <> p_completion_tokens
       OR v_existing.total_tokens <> p_total_tokens
       OR v_existing.cost_usd <> p_actual_cost_usd
       OR v_existing.latency_ms <> p_latency_ms THEN
      RAISE EXCEPTION 'call key accounting collision';
    END IF;
    accounting_id := v_existing.id; created := FALSE; RETURN NEXT; RETURN;
  END IF;

  -- Lock in canonical order: node -> task -> reservation.
  SELECT n.task_id INTO v_task_id
  FROM task_nodes n
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token
    AND n.lease_until IS NOT NULL
    AND n.lease_until > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    -- A concurrent writer may have committed while we were entering this call.
    SELECT a.* INTO v_existing FROM llm_accounting a WHERE a.call_key = p_call_key;
    IF FOUND THEN
      SELECT br.* INTO v_res FROM budget_reservations br WHERE br.id = p_reservation_id;
      IF NOT FOUND OR v_res.status <> 'RECONCILED'
         OR v_res.reservation_key <> p_call_key
         OR v_existing.task_id <> v_res.task_id
         OR v_existing.node_id <> p_node_id
         OR v_existing.lease_token <> p_lease_token
         OR v_existing.provider <> p_provider
         OR v_existing.model <> p_model
         OR v_existing.pricing_version <> p_pricing_version
         OR v_existing.provider_request_id IS DISTINCT FROM p_provider_request_id
         OR v_existing.prompt_cache_hit_tokens <> p_prompt_cache_hit_tokens
         OR v_existing.prompt_cache_miss_tokens <> p_prompt_cache_miss_tokens
         OR v_existing.completion_tokens <> p_completion_tokens
         OR v_existing.total_tokens <> p_total_tokens
         OR v_existing.cost_usd <> p_actual_cost_usd
         OR v_existing.latency_ms <> p_latency_ms THEN
        RAISE EXCEPTION 'call key accounting collision';
      END IF;
      accounting_id := v_existing.id; created := FALSE; RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  PERFORM 1 FROM tasks t WHERE t.id = v_task_id FOR UPDATE;

  SELECT br.* INTO v_res
  FROM budget_reservations br
  WHERE br.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_res.reservation_key <> p_call_key
     OR v_res.task_id <> v_task_id
     OR v_res.node_id <> p_node_id
     OR v_res.lease_token <> p_lease_token THEN
    RAISE EXCEPTION 'reservation does not match model call contract';
  END IF;

  -- Recheck under locks for a concurrent identical writer.
  SELECT a.* INTO v_existing FROM llm_accounting a WHERE a.call_key = p_call_key;
  IF FOUND THEN
    IF v_res.status <> 'RECONCILED'
       OR v_existing.task_id <> v_res.task_id
       OR v_existing.node_id <> p_node_id
       OR v_existing.lease_token <> p_lease_token
       OR v_existing.provider <> p_provider
       OR v_existing.model <> p_model
       OR v_existing.pricing_version <> p_pricing_version
       OR v_existing.provider_request_id IS DISTINCT FROM p_provider_request_id
       OR v_existing.prompt_cache_hit_tokens <> p_prompt_cache_hit_tokens
       OR v_existing.prompt_cache_miss_tokens <> p_prompt_cache_miss_tokens
       OR v_existing.completion_tokens <> p_completion_tokens
       OR v_existing.total_tokens <> p_total_tokens
       OR v_existing.cost_usd <> p_actual_cost_usd
       OR v_existing.latency_ms <> p_latency_ms THEN
      RAISE EXCEPTION 'call key accounting collision';
    END IF;
    accounting_id := v_existing.id; created := FALSE; RETURN NEXT; RETURN;
  END IF;

  IF v_res.status <> 'RESERVED' THEN RETURN; END IF;
  IF p_actual_cost_usd > v_res.reserved_cost_usd OR p_total_tokens > v_res.reserved_tokens THEN
    RAISE EXCEPTION 'actual model usage exceeds reservation';
  END IF;

  UPDATE task_nodes n
  SET reserved_cost_usd = n.reserved_cost_usd - v_res.reserved_cost_usd,
      reserved_tokens = n.reserved_tokens - v_res.reserved_tokens,
      updated_at = NOW()
  WHERE n.id = p_node_id
    AND n.status = 'RUNNING'
    AND n.lease_owner = p_worker_id
    AND n.lease_token = p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'lease changed while recording model call'; END IF;

  UPDATE tasks t
  SET reserved_cost_usd = t.reserved_cost_usd - v_res.reserved_cost_usd,
      reserved_tokens = t.reserved_tokens - v_res.reserved_tokens,
      current_cost_usd = t.current_cost_usd + p_actual_cost_usd,
      current_tokens = t.current_tokens + p_total_tokens,
      updated_at = NOW()
  WHERE t.id = v_task_id;

  UPDATE budget_reservations br
  SET status = 'RECONCILED',
      actual_cost_usd = p_actual_cost_usd,
      actual_tokens = p_total_tokens,
      reconciled_at = NOW()
  WHERE br.id = p_reservation_id AND br.status = 'RESERVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation changed while recording model call'; END IF;

  INSERT INTO llm_accounting (
    call_key, task_id, node_id, lease_token, provider, model, pricing_version,
    provider_request_id, prompt_cache_hit_tokens, prompt_cache_miss_tokens,
    completion_tokens, total_tokens, reserved_cost_usd, cost_usd, latency_ms
  ) VALUES (
    p_call_key, v_task_id, p_node_id, p_lease_token, p_provider, p_model,
    p_pricing_version, p_provider_request_id, p_prompt_cache_hit_tokens,
    p_prompt_cache_miss_tokens, p_completion_tokens, p_total_tokens,
    v_res.reserved_cost_usd, p_actual_cost_usd, p_latency_ms
  ) RETURNING id INTO v_accounting_id;

  accounting_id := v_accounting_id; created := TRUE; RETURN NEXT;
END;
$$;

COMMIT;
