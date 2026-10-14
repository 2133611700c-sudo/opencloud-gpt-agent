BEGIN;

-- E3b2: every newly accounted runtime receipt carries a deterministic,
-- non-transcript trace event. The timestamp is derived from the immutable
-- llm_accounting row so exactly-once replay normalizes to identical bytes.
-- No prompts, stdout/stderr, fetched content, environment values or reasoning
-- are persisted by this trace.
CREATE OR REPLACE FUNCTION normalize_runtime_receipt_trace_v1(
  p_accounting_id UUID,
  p_trace JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trace JSONB;
  v_accounted_at TIMESTAMPTZ;
BEGIN
  v_trace := COALESCE(NULLIF(p_trace, 'null'::jsonb), '[]'::jsonb);
  IF jsonb_typeof(v_trace) <> 'array' THEN
    RAISE EXCEPTION 'runtime receipt trace must be an array';
  END IF;
  IF jsonb_array_length(v_trace) > 0 THEN
    RETURN v_trace;
  END IF;

  SELECT a.created_at
  INTO v_accounted_at
  FROM public.llm_accounting a
  WHERE a.id = p_accounting_id;

  IF v_accounted_at IS NULL THEN
    RETURN v_trace;
  END IF;

  RETURN jsonb_build_array(jsonb_build_object(
    'event', 'ACCOUNTING_RECONCILED',
    'at', to_char(v_accounted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ));
END;
$$;

CREATE OR REPLACE FUNCTION record_runtime_receipt_v1(
  p_accounting_id UUID,
  p_call_key VARCHAR(160),
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_runtime_receipt JSONB
)
RETURNS TABLE (runtime_receipt_id UUID, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_task_id UUID;
  v_account RECORD;
  v_existing runtime_receipts%ROWTYPE;
  v_inserted_id UUID;
  v_observed JSONB;
  v_configured JSONB;
  v_trace JSONB;
  v_error JSONB;
BEGIN
  IF p_call_key IS NULL OR length(trim(p_call_key))=0 THEN RAISE EXCEPTION 'runtime receipt call key is required'; END IF;
  IF p_runtime_receipt IS NULL OR jsonb_typeof(p_runtime_receipt)<>'object' THEN RAISE EXCEPTION 'runtime receipt must be a JSON object'; END IF;
  IF (p_runtime_receipt - ARRAY['observed','configured','trace','error']) <> '{}'::jsonb THEN RAISE EXCEPTION 'runtime receipt contains unsupported fields'; END IF;

  v_observed := NULLIF(p_runtime_receipt->'observed','null'::jsonb);
  v_configured := NULLIF(p_runtime_receipt->'configured','null'::jsonb);
  v_trace := public.normalize_runtime_receipt_trace_v1(p_accounting_id, p_runtime_receipt->'trace');
  v_error := NULLIF(p_runtime_receipt->'error','null'::jsonb);
  IF v_observed IS NOT NULL AND jsonb_typeof(v_observed)<>'object' THEN RAISE EXCEPTION 'runtime receipt observed must be an object or null'; END IF;
  IF v_configured IS NOT NULL AND jsonb_typeof(v_configured)<>'object' THEN RAISE EXCEPTION 'runtime receipt configured must be an object or null'; END IF;
  IF jsonb_typeof(v_trace)<>'array' THEN RAISE EXCEPTION 'runtime receipt trace must be an array'; END IF;
  IF v_error IS NOT NULL AND jsonb_typeof(v_error)<>'object' THEN RAISE EXCEPTION 'runtime receipt error must be an object or null'; END IF;

  -- Exactly-once replay remains possible after terminalization. Empty caller
  -- traces normalize from the same accounting.created_at value on every retry.
  SELECT rr.* INTO v_existing FROM runtime_receipts rr WHERE rr.call_key=p_call_key;
  IF FOUND THEN
    IF v_existing.accounting_id<>p_accounting_id OR v_existing.node_id<>p_node_id OR v_existing.lease_token<>p_lease_token
       OR v_existing.observed IS DISTINCT FROM v_observed OR v_existing.configured IS DISTINCT FROM v_configured
       OR v_existing.trace IS DISTINCT FROM v_trace OR v_existing.error IS DISTINCT FROM v_error THEN
      RAISE EXCEPTION 'runtime receipt call key collision';
    END IF;
    runtime_receipt_id:=v_existing.id; created:=FALSE; RETURN NEXT; RETURN;
  END IF;

  -- Initial creation is fenced by the same active lease/deadline as accounting.
  SELECT n.task_id INTO v_task_id
  FROM task_nodes n JOIN tasks t ON t.id=n.task_id
  WHERE n.id=p_node_id AND n.status='RUNNING' AND n.lease_owner=p_worker_id AND n.lease_token=p_lease_token
    AND n.lease_until IS NOT NULL AND n.lease_until>NOW() AND t.status='RUNNING' AND t.deadline_at>NOW()
  FOR UPDATE OF n;
  IF NOT FOUND THEN
    SELECT rr.* INTO v_existing FROM runtime_receipts rr WHERE rr.call_key=p_call_key;
    IF FOUND THEN
      IF v_existing.accounting_id<>p_accounting_id OR v_existing.node_id<>p_node_id OR v_existing.lease_token<>p_lease_token
         OR v_existing.observed IS DISTINCT FROM v_observed OR v_existing.configured IS DISTINCT FROM v_configured
         OR v_existing.trace IS DISTINCT FROM v_trace OR v_existing.error IS DISTINCT FROM v_error THEN
        RAISE EXCEPTION 'runtime receipt call key collision';
      END IF;
      runtime_receipt_id:=v_existing.id; created:=FALSE; RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  SELECT a.* INTO v_account FROM llm_accounting a
  WHERE a.id=p_accounting_id AND a.call_key=p_call_key AND a.task_id=v_task_id AND a.node_id=p_node_id AND a.lease_token=p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime receipt accounting linkage is invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM budget_reservations br WHERE br.reservation_key=p_call_key AND br.task_id=v_task_id
    AND br.node_id=p_node_id AND br.lease_token=p_lease_token AND br.status='RECONCILED') THEN
    RAISE EXCEPTION 'runtime receipt requires reconciled reservation';
  END IF;
  IF v_observed IS NOT NULL AND (
      v_observed->>'provider' IS DISTINCT FROM v_account.provider OR
      v_observed->>'model' IS DISTINCT FROM v_account.model OR
      v_observed->>'sessionId' IS DISTINCT FROM v_account.provider_request_id) THEN
    RAISE EXCEPTION 'runtime receipt observed identity does not match accounting';
  END IF;

  INSERT INTO runtime_receipts(accounting_id,call_key,task_id,node_id,lease_token,observed,configured,trace,error)
  VALUES(p_accounting_id,p_call_key,v_task_id,p_node_id,p_lease_token,v_observed,v_configured,v_trace,v_error)
  ON CONFLICT (call_key) DO NOTHING RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN runtime_receipt_id:=v_inserted_id; created:=TRUE; RETURN NEXT; RETURN; END IF;

  SELECT rr.* INTO v_existing FROM runtime_receipts rr WHERE rr.call_key=p_call_key;
  IF NOT FOUND OR v_existing.accounting_id<>p_accounting_id OR v_existing.node_id<>p_node_id OR v_existing.lease_token<>p_lease_token
     OR v_existing.observed IS DISTINCT FROM v_observed OR v_existing.configured IS DISTINCT FROM v_configured
     OR v_existing.trace IS DISTINCT FROM v_trace OR v_existing.error IS DISTINCT FROM v_error THEN
    RAISE EXCEPTION 'runtime receipt concurrent collision';
  END IF;
  runtime_receipt_id:=v_existing.id; created:=FALSE; RETURN NEXT;
END;
$$;

COMMIT;
