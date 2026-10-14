BEGIN;

-- Preserve exactly-once replay for receipts created before 0024, whose stored
-- trace is legitimately []. New receipts still normalize an empty caller trace
-- to the deterministic ACCOUNTING_RECONCILED event introduced by 0024.
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
  v_input_trace JSONB;
  v_trace JSONB;
  v_error JSONB;
BEGIN
  IF p_call_key IS NULL OR length(trim(p_call_key))=0 THEN RAISE EXCEPTION 'runtime receipt call key is required'; END IF;
  IF p_runtime_receipt IS NULL OR jsonb_typeof(p_runtime_receipt)<>'object' THEN RAISE EXCEPTION 'runtime receipt must be a JSON object'; END IF;
  IF (p_runtime_receipt - ARRAY['observed','configured','trace','error']) <> '{}'::jsonb THEN RAISE EXCEPTION 'runtime receipt contains unsupported fields'; END IF;

  v_observed := NULLIF(p_runtime_receipt->'observed','null'::jsonb);
  v_configured := NULLIF(p_runtime_receipt->'configured','null'::jsonb);
  v_input_trace := COALESCE(NULLIF(p_runtime_receipt->'trace','null'::jsonb), '[]'::jsonb);
  v_error := NULLIF(p_runtime_receipt->'error','null'::jsonb);
  IF v_observed IS NOT NULL AND jsonb_typeof(v_observed)<>'object' THEN RAISE EXCEPTION 'runtime receipt observed must be an object or null'; END IF;
  IF v_configured IS NOT NULL AND jsonb_typeof(v_configured)<>'object' THEN RAISE EXCEPTION 'runtime receipt configured must be an object or null'; END IF;
  IF jsonb_typeof(v_input_trace)<>'array' THEN RAISE EXCEPTION 'runtime receipt trace must be an array'; END IF;
  IF v_error IS NOT NULL AND jsonb_typeof(v_error)<>'object' THEN RAISE EXCEPTION 'runtime receipt error must be an object or null'; END IF;

  -- Replay must compare against the bytes that were valid when the receipt was
  -- originally created. A pre-0024 [] stays []; all other cases use current
  -- deterministic normalization.
  SELECT rr.* INTO v_existing FROM runtime_receipts rr WHERE rr.call_key=p_call_key;
  IF FOUND THEN
    IF v_existing.trace='[]'::jsonb AND jsonb_array_length(v_input_trace)=0 THEN
      v_trace := v_input_trace;
    ELSE
      v_trace := public.normalize_runtime_receipt_trace_v1(p_accounting_id, v_input_trace);
    END IF;
    IF v_existing.accounting_id<>p_accounting_id OR v_existing.node_id<>p_node_id OR v_existing.lease_token<>p_lease_token
       OR v_existing.observed IS DISTINCT FROM v_observed OR v_existing.configured IS DISTINCT FROM v_configured
       OR v_existing.trace IS DISTINCT FROM v_trace OR v_existing.error IS DISTINCT FROM v_error THEN
      RAISE EXCEPTION 'runtime receipt call key collision';
    END IF;
    runtime_receipt_id:=v_existing.id; created:=FALSE; RETURN NEXT; RETURN;
  END IF;

  -- Only new receipts get the 0024 deterministic trace normalization.
  v_trace := public.normalize_runtime_receipt_trace_v1(p_accounting_id, v_input_trace);

  SELECT n.task_id INTO v_task_id
  FROM task_nodes n JOIN tasks t ON t.id=n.task_id
  WHERE n.id=p_node_id AND n.status='RUNNING' AND n.lease_owner=p_worker_id AND n.lease_token=p_lease_token
    AND n.lease_until IS NOT NULL AND n.lease_until>NOW() AND t.status='RUNNING' AND t.deadline_at>NOW()
  FOR UPDATE OF n;
  IF NOT FOUND THEN
    SELECT rr.* INTO v_existing FROM runtime_receipts rr WHERE rr.call_key=p_call_key;
    IF FOUND THEN
      IF v_existing.trace='[]'::jsonb AND jsonb_array_length(v_input_trace)=0 THEN
        v_trace := v_input_trace;
      ELSE
        v_trace := public.normalize_runtime_receipt_trace_v1(p_accounting_id, v_input_trace);
      END IF;
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
