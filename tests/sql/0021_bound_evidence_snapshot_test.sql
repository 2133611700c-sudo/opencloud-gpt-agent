BEGIN;

DO $$
DECLARE
  v_task_id UUID := gen_random_uuid();
  v_pending_id UUID := gen_random_uuid();
  v_input RECORD;
  v_again RECORD;
  v_serialized TEXT := '{}';
BEGIN
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,
    budget_limit_usd,token_budget_limit,max_total_steps,deadline_at,
    created_at,updated_at,terminal_at,terminal_reason)
  VALUES(v_task_id,'sql-bound-evidence-' || v_task_id,'Snapshot UTC fixture',
    'null'::jsonb,'CANCELLED',1,9007199254740993,4,
    '2026-10-14T11:00:00.123456Z','2026-10-14T10:00:00.123456Z',
    '2026-10-14T10:01:00.234567Z','2026-10-14T10:01:00.234567Z','USER_CANCELLED');
  SELECT * INTO v_input FROM load_terminal_evidence_input_v1(v_task_id);
  IF NOT FOUND OR v_input.snapshot_sha256 !~ '^[0-9a-f]{64}$'
    OR v_input.snapshot #>> '{task,token_budget_limit}' <> '9007199254740993'
    OR jsonb_typeof(v_input.snapshot #> '{task,current_tokens}') <> 'string'
    OR jsonb_typeof(v_input.snapshot #> '{task,current_cost_usd}') <> 'string'
    OR v_input.snapshot #>> '{task,created_at}' <> '2026-10-14T10:00:00.123456Z'
    OR v_input.snapshot->'nodes' <> '[]'::jsonb
    OR v_input.snapshot->'runtimeReceipts' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'raw snapshot lost exact numeric, time or empty-state representation';
  END IF;
  PERFORM set_config('TimeZone','Pacific/Honolulu',true);
  SELECT * INTO v_again FROM load_terminal_evidence_input_v1(v_task_id);
  IF v_again.snapshot IS DISTINCT FROM v_input.snapshot
    OR v_again.snapshot_sha256 IS DISTINCT FROM v_input.snapshot_sha256 THEN
    RAISE EXCEPTION 'raw snapshot depends on connection TimeZone';
  END IF;
  BEGIN
    PERFORM persist_task_evidence_v1(v_task_id,v_serialized,repeat('0',64),NULL);
    RAISE EXCEPTION 'missing snapshot fingerprint was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EVIDENCE_SNAPSHOT_REQUIRED' THEN RAISE; END IF;
  END;
  UPDATE tasks SET goal='Changed snapshot fixture' WHERE id=v_task_id;
  BEGIN
    PERFORM persist_task_evidence_v1(v_task_id,v_serialized,repeat('0',64),v_input.snapshot_sha256);
    RAISE EXCEPTION 'stale snapshot fingerprint was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EVIDENCE_SNAPSHOT_CHANGED' THEN RAISE; END IF;
  END;
  UPDATE tasks SET reserved_cost_usd=0.100000 WHERE id=v_task_id;
  IF EXISTS(SELECT 1 FROM load_terminal_evidence_input_v1(v_task_id)) THEN
    RAISE EXCEPTION 'terminal task with a reservation was exposed as eligible';
  END IF;
  INSERT INTO tasks(id,idempotency_key,goal,status,budget_limit_usd,max_total_steps,deadline_at)
  VALUES(v_pending_id,'sql-bound-pending-' || v_pending_id,'Pending snapshot fixture',
    'PENDING',1,4,NOW()+INTERVAL '1 hour');
  IF EXISTS(SELECT 1 FROM load_terminal_evidence_input_v1(v_pending_id))
    OR EXISTS(SELECT 1 FROM load_terminal_evidence_input_v1(gen_random_uuid()))
    OR EXISTS(SELECT 1 FROM artifacts WHERE task_id IN(v_task_id,v_pending_id)) THEN
    RAISE EXCEPTION 'unavailable snapshot or failed persist leaked state';
  END IF;
END;
$$;

ROLLBACK;
