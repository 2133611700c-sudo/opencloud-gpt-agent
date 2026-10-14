BEGIN;

DO $$
DECLARE
  v_task_id UUID := gen_random_uuid();
  v_pending_id UUID := gen_random_uuid();
  v_serialized TEXT;
  v_divergent TEXT;
  v_hash TEXT;
  v_first RECORD;
  v_second RECORD;
  v_read RECORD;
  v_count INTEGER;
BEGIN
  INSERT INTO tasks (
    id, idempotency_key, goal, request_payload, status,
    budget_limit_usd, token_budget_limit, max_total_steps,
    current_steps, deadline_at, terminal_at, terminal_reason
  ) VALUES (
    v_task_id,
    'sql-evidence-e2-' || v_task_id,
    'Evidence E2 task',
    '{"requiredFields":["price"],"maxResults":3,"constraints":{"requiredDomains":["example.com"]}}'::jsonb,
    'SUCCESS',
    1.000000,
    100,
    4,
    0,
    NOW() + INTERVAL '1 hour',
    NOW(),
    'ALL_NODES_SUCCEEDED'
  );

  v_serialized := format(
    '{"acceptanceCriteria":{"constraints":{"requiredDomains":["example.com"]},"goal":"Evidence E2 task","maxResults":3,"requiredFields":["price"],"valid":true},"schemaVersion":1,"task":{"id":"%s","status":"SUCCESS"}}',
    v_task_id
  );
  v_hash := encode(digest(convert_to(v_serialized, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_first FROM persist_task_evidence_v1(v_task_id, v_serialized, v_hash);
  IF v_first.created IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'first evidence persist must create artifact';
  END IF;
  IF v_first.sha256 IS DISTINCT FROM v_hash
     OR v_first.size_bytes IS DISTINCT FROM octet_length(v_serialized)
     OR v_first.uri IS DISTINCT FROM format('artifact://postgres/%s', v_first.artifact_id) THEN
    RAISE EXCEPTION 'first evidence persistence receipt mismatch';
  END IF;

  SELECT * INTO v_second FROM persist_task_evidence_v1(v_task_id, v_serialized, v_hash);
  IF v_second.created IS DISTINCT FROM FALSE OR v_second.artifact_id IS DISTINCT FROM v_first.artifact_id THEN
    RAISE EXCEPTION 'repeat evidence persist must be idempotent';
  END IF;

  SELECT count(*) INTO v_count
  FROM artifacts
  WHERE task_id = v_task_id AND artifact_type = 'EVIDENCE_BUNDLE_V1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'repeat evidence persist created duplicate artifact';
  END IF;

  SELECT * INTO v_read FROM read_task_evidence_snapshot_v1(v_task_id);
  IF v_read.artifact_id IS DISTINCT FROM v_first.artifact_id
     OR v_read.task_id IS DISTINCT FROM v_task_id
     OR v_read.serialized IS DISTINCT FROM v_serialized
     OR v_read.sha256 IS DISTINCT FROM v_hash
     OR v_read.size_bytes IS DISTINCT FROM octet_length(v_serialized) THEN
    RAISE EXCEPTION 'evidence retrieval mismatch';
  END IF;

  BEGIN
    PERFORM persist_task_evidence_v1(v_task_id, v_serialized, repeat('0', 64));
    RAISE EXCEPTION 'bad evidence hash was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'bad evidence hash was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT ILIKE '%sha256 mismatch%' THEN RAISE; END IF;
  END;

  v_divergent := replace(v_serialized, '"schemaVersion":1', '"extra":"different","schemaVersion":1');
  BEGIN
    PERFORM persist_task_evidence_v1(
      v_task_id,
      v_divergent,
      encode(digest(convert_to(v_divergent, 'UTF8'), 'sha256'), 'hex')
    );
    RAISE EXCEPTION 'divergent evidence was accepted for immutable task artifact';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'divergent evidence was accepted for immutable task artifact' THEN RAISE; END IF;
      IF SQLERRM NOT ILIKE '%immutable once persisted%' THEN RAISE; END IF;
  END;

  INSERT INTO tasks (
    id, idempotency_key, goal, request_payload, status,
    budget_limit_usd, token_budget_limit, max_total_steps,
    current_steps, deadline_at
  ) VALUES (
    v_pending_id,
    'sql-evidence-e2-pending-' || v_pending_id,
    'Evidence pending task',
    '{}'::jsonb,
    'PENDING',
    1.000000,
    100,
    4,
    0,
    NOW() + INTERVAL '1 hour'
  );

  BEGIN
    v_serialized := format(
      '{"acceptanceCriteria":{"goal":"Evidence pending task","requiredFields":[],"valid":true},"schemaVersion":1,"task":{"id":"%s","status":"PENDING"}}',
      v_pending_id
    );
    v_hash := encode(digest(convert_to(v_serialized, 'UTF8'), 'sha256'), 'hex');
    PERFORM persist_task_evidence_v1(v_pending_id, v_serialized, v_hash);
    RAISE EXCEPTION 'nonterminal evidence was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'nonterminal evidence was accepted' THEN RAISE; END IF;
      IF SQLERRM NOT ILIKE '%must be terminal%' THEN RAISE; END IF;
  END;

  DELETE FROM tasks WHERE id IN (v_task_id, v_pending_id);
END;
$$;

ROLLBACK;
