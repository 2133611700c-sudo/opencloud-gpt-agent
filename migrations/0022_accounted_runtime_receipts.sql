BEGIN;

-- E3b1: durable runtime receipts are append-only evidence of an accounted
-- Research execution. The receipt is deliberately not a transcript: raw
-- prompts, stdout/stderr and environment data are never persisted here.
CREATE TABLE IF NOT EXISTS runtime_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_id UUID NOT NULL UNIQUE REFERENCES llm_accounting(id) ON DELETE CASCADE,
  call_key VARCHAR(160) NOT NULL UNIQUE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  lease_token UUID NOT NULL,
  observed JSONB,
  configured JSONB,
  trace JSONB NOT NULL DEFAULT '[]'::jsonb,
  error JSONB,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runtime_receipts_node_fk FOREIGN KEY (task_id,node_id)
    REFERENCES task_nodes(task_id,id) ON DELETE CASCADE,
  CONSTRAINT runtime_receipts_observed_object CHECK (observed IS NULL OR jsonb_typeof(observed)='object'),
  CONSTRAINT runtime_receipts_configured_object CHECK (configured IS NULL OR jsonb_typeof(configured)='object'),
  CONSTRAINT runtime_receipts_trace_array CHECK (jsonb_typeof(trace)='array'),
  CONSTRAINT runtime_receipts_error_object CHECK (error IS NULL OR jsonb_typeof(error)='object')
);

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
  v_trace := COALESCE(NULLIF(p_runtime_receipt->'trace','null'::jsonb),'[]'::jsonb);
  v_error := NULLIF(p_runtime_receipt->'error','null'::jsonb);
  IF v_observed IS NOT NULL AND jsonb_typeof(v_observed)<>'object' THEN RAISE EXCEPTION 'runtime receipt observed must be an object or null'; END IF;
  IF v_configured IS NOT NULL AND jsonb_typeof(v_configured)<>'object' THEN RAISE EXCEPTION 'runtime receipt configured must be an object or null'; END IF;
  IF jsonb_typeof(v_trace)<>'array' THEN RAISE EXCEPTION 'runtime receipt trace must be an array'; END IF;
  IF v_error IS NOT NULL AND jsonb_typeof(v_error)<>'object' THEN RAISE EXCEPTION 'runtime receipt error must be an object or null'; END IF;

  -- Exactly-once replay remains possible after terminalization.
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

CREATE OR REPLACE FUNCTION record_llm_call_with_runtime_receipt_v1(
  p_reservation_id UUID,p_call_key VARCHAR(160),p_node_id UUID,p_worker_id VARCHAR(128),p_lease_token UUID,
  p_provider VARCHAR(64),p_model VARCHAR(128),p_pricing_version VARCHAR(64),p_provider_request_id VARCHAR(256),
  p_prompt_cache_hit_tokens BIGINT,p_prompt_cache_miss_tokens BIGINT,p_completion_tokens BIGINT,p_total_tokens BIGINT,
  p_actual_cost_usd NUMERIC(12,6),p_latency_ms INTEGER,p_runtime_receipt JSONB
)
RETURNS TABLE(accounting_id UUID,accounting_created BOOLEAN,runtime_receipt_id UUID,runtime_receipt_created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE v_account RECORD; v_receipt RECORD;
BEGIN
  SELECT * INTO v_account FROM record_llm_call(p_reservation_id,p_call_key,p_node_id,p_worker_id,p_lease_token,
    p_provider,p_model,p_pricing_version,p_provider_request_id,p_prompt_cache_hit_tokens,p_prompt_cache_miss_tokens,
    p_completion_tokens,p_total_tokens,p_actual_cost_usd,p_latency_ms);
  IF NOT FOUND OR v_account.accounting_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_receipt FROM record_runtime_receipt_v1(v_account.accounting_id,p_call_key,p_node_id,p_worker_id,p_lease_token,p_runtime_receipt);
  IF NOT FOUND OR v_receipt.runtime_receipt_id IS NULL THEN RAISE EXCEPTION 'runtime receipt write rejected after accounting'; END IF;
  accounting_id:=v_account.accounting_id; accounting_created:=v_account.created;
  runtime_receipt_id:=v_receipt.runtime_receipt_id; runtime_receipt_created:=v_receipt.created; RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION record_llm_call_reservation_fallback_with_runtime_receipt_v1(
  p_reservation_id UUID,p_call_key VARCHAR(160),p_node_id UUID,p_worker_id VARCHAR(128),p_lease_token UUID,
  p_provider VARCHAR(64),p_model VARCHAR(128),p_pricing_version VARCHAR(64),p_provider_request_id VARCHAR(256),
  p_latency_ms INTEGER,p_reason VARCHAR(256),p_runtime_receipt JSONB
)
RETURNS TABLE(accounting_id UUID,accounting_created BOOLEAN,runtime_receipt_id UUID,runtime_receipt_created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE v_account RECORD; v_receipt RECORD;
BEGIN
  SELECT * INTO v_account FROM record_llm_call_reservation_fallback(p_reservation_id,p_call_key,p_node_id,p_worker_id,p_lease_token,
    p_provider,p_model,p_pricing_version,p_provider_request_id,p_latency_ms,p_reason);
  IF NOT FOUND OR v_account.accounting_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_receipt FROM record_runtime_receipt_v1(v_account.accounting_id,p_call_key,p_node_id,p_worker_id,p_lease_token,p_runtime_receipt);
  IF NOT FOUND OR v_receipt.runtime_receipt_id IS NULL THEN RAISE EXCEPTION 'runtime receipt write rejected after fallback accounting'; END IF;
  accounting_id:=v_account.accounting_id; accounting_created:=v_account.created;
  runtime_receipt_id:=v_receipt.runtime_receipt_id; runtime_receipt_created:=v_receipt.created; RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION load_terminal_evidence_input_v2(p_task_id UUID)
RETURNS TABLE (snapshot JSONB, snapshot_sha256 TEXT)
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base RECORD;
  v_receipts JSONB;
  v_snapshot JSONB;
BEGIN
  SELECT * INTO v_base FROM public.load_terminal_evidence_input_v1(p_task_id);
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',rr.id::text,
    'task_id',rr.task_id::text,
    'node_id',rr.node_id::text,
    'call_key',rr.call_key,
    'lease_token',rr.lease_token::text,
    'recorded_at',to_char(rr.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'observed',rr.observed,
    'configured',rr.configured,
    'trace',rr.trace,
    'error',rr.error
  ) ORDER BY rr.id),'[]'::jsonb)
  INTO v_receipts
  FROM public.runtime_receipts rr
  WHERE rr.task_id=p_task_id;

  v_snapshot := jsonb_set(v_base.snapshot,'{runtimeReceipts}',v_receipts,FALSE);
  RETURN QUERY SELECT v_snapshot,
    encode(public.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');
END;
$$;

COMMIT;
