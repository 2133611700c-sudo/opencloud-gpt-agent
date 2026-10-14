BEGIN;

-- Migration0020 is history. Migration0021 closes its unbound first-insert API.
-- Actual E1-built persistence is proved in the PostgreSQL integration script.
DO $$
DECLARE
  v_task_id UUID := gen_random_uuid();
  v_serialized TEXT;
BEGIN
  INSERT INTO tasks(id,idempotency_key,goal,status,budget_limit_usd,
    max_total_steps,deadline_at,terminal_at,terminal_reason)
  VALUES(v_task_id,'sql-evidence-legacy-' || v_task_id,'Legacy evidence guard',
    'CANCELLED',1,4,NOW()+INTERVAL '1 hour',NOW(),'USER_CANCELLED');
  v_serialized := jsonb_build_object('schemaVersion',1,
    'task',jsonb_build_object('id',v_task_id,'status','CANCELLED'))::text;
  BEGIN
    PERFORM persist_task_evidence_v1(v_task_id,v_serialized,
      encode(digest(convert_to(v_serialized,'UTF8'),'sha256'),'hex'));
    RAISE EXCEPTION 'legacy unbound insert was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EVIDENCE_SNAPSHOT_REQUIRED' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM artifacts WHERE task_id=v_task_id)
    OR EXISTS(SELECT 1 FROM read_task_evidence_snapshot_v1(v_task_id)) THEN
    RAISE EXCEPTION 'rejected unbound insert mutated evidence';
  END IF;
END;
$$;

ROLLBACK;
