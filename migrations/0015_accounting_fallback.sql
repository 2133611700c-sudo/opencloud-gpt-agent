BEGIN;

-- Canonical repair migration for the historical duplicate 0008 prefix.
-- Some hosted installations advanced past 0008 with active-lease hardening
-- present but accounting fallback absent. Keep this migration idempotent so
-- both fresh and already-repaired databases converge on the same schema.
ALTER TABLE llm_accounting
  ADD COLUMN IF NOT EXISTS accounting_basis VARCHAR(32) NOT NULL DEFAULT 'OBSERVED_USAGE',
  ADD COLUMN IF NOT EXISTS accounting_note VARCHAR(256);

ALTER TABLE budget_reservations
  ADD COLUMN IF NOT EXISTS reconciliation_basis VARCHAR(32) NOT NULL DEFAULT 'OBSERVED_USAGE',
  ADD COLUMN IF NOT EXISTS reconciliation_reason VARCHAR(256);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'llm_accounting_basis_valid'
  ) THEN
    ALTER TABLE llm_accounting
      ADD CONSTRAINT llm_accounting_basis_valid
      CHECK (accounting_basis IN ('OBSERVED_USAGE', 'RESERVATION_FALLBACK'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'budget_reservations_reconciliation_basis_valid'
  ) THEN
    ALTER TABLE budget_reservations
      ADD CONSTRAINT budget_reservations_reconciliation_basis_valid
      CHECK (reconciliation_basis IN ('OBSERVED_USAGE', 'RESERVATION_FALLBACK'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION record_llm_call_reservation_fallback(
  p_reservation_id UUID,
  p_call_key VARCHAR(160),
  p_node_id UUID,
  p_worker_id VARCHAR(128),
  p_lease_token UUID,
  p_provider VARCHAR(64),
  p_model VARCHAR(128),
  p_pricing_version VARCHAR(64),
  p_provider_request_id VARCHAR(256),
  p_latency_ms INTEGER,
  p_reason VARCHAR(256)
)
RETURNS TABLE (accounting_id UUID, created BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res RECORD;
  v_rec RECORD;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'fallback accounting reason is required';
  END IF;
  IF p_latency_ms < 0 THEN
    RAISE EXCEPTION 'latency must be nonnegative';
  END IF;

  SELECT br.*
  INTO v_res
  FROM budget_reservations br
  WHERE br.id = p_reservation_id
    AND br.reservation_key = p_call_key
    AND br.node_id = p_node_id
    AND br.lease_token = p_lease_token;

  IF NOT FOUND OR v_res.status NOT IN ('RESERVED', 'RECONCILED') THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_rec
  FROM record_llm_call(
    p_reservation_id,
    p_call_key,
    p_node_id,
    p_worker_id,
    p_lease_token,
    p_provider,
    p_model,
    p_pricing_version,
    p_provider_request_id,
    0,
    v_res.reserved_tokens,
    0,
    v_res.reserved_tokens,
    v_res.reserved_cost_usd,
    p_latency_ms
  );

  IF NOT FOUND OR v_rec.accounting_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE llm_accounting a
  SET accounting_basis = 'RESERVATION_FALLBACK',
      accounting_note = p_reason
  WHERE a.id = v_rec.accounting_id;

  UPDATE budget_reservations br
  SET reconciliation_basis = 'RESERVATION_FALLBACK',
      reconciliation_reason = p_reason
  WHERE br.id = p_reservation_id
    AND br.status = 'RECONCILED';

  accounting_id := v_rec.accounting_id;
  created := v_rec.created;
  RETURN NEXT;
END;
$$;

COMMIT;
