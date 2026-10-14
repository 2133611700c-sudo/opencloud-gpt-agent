BEGIN;

DO $$
DECLARE
  v_task UUID := gen_random_uuid();
  v_node UUID := gen_random_uuid();
  v_lease UUID := gen_random_uuid();
  v_res UUID;
  v_account RECORD;
  v_v1 RECORD;
  v_v2 RECORD;
  v_receipt JSONB := jsonb_build_object(
    'observed',jsonb_build_object(
      'provider','deepseek','model','deepseek-flash','sessionId','session-e3b2',
      'toolSummary',jsonb_build_object('calls',2,'failures',0,'tools',jsonb_build_array('web_search','web_fetch'),'totalToolTimeMs',7)
    ),
    'configured',jsonb_build_object('runtimeVersion','2026.9.8','requestedModel','deepseek/deepseek-flash','thinkingLevel','max'),
    'trace','[]'::jsonb,
    'error',NULL
  );
BEGIN
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_task,'e3b2-evidence-'||v_task,'E3b2 Evidence receipt fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');

  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_node,v_task,'research','researcher','RUNNING',1,3,'worker-e3b2',v_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());

  v_res := reserve_node_budget('research:'||v_task||':'||v_node||':'||v_lease,v_node,'worker-e3b2',v_lease,0.100000,100);
  IF v_res IS NULL THEN RAISE EXCEPTION 'E3b2 reservation was rejected'; END IF;

  SELECT * INTO v_account FROM record_llm_call_with_runtime_receipt_v1(
    v_res,'research:'||v_task||':'||v_node||':'||v_lease,v_node,'worker-e3b2',v_lease,
    'deepseek','deepseek-flash','fixture-v1','session-e3b2',2,3,4,9,0.000003,12,v_receipt);
  IF NOT FOUND OR v_account.accounting_id IS NULL OR v_account.runtime_receipt_id IS NULL THEN
    RAISE EXCEPTION 'E3b2 atomic accounting/receipt fixture was not created';
  END IF;

  UPDATE task_nodes
  SET status='FAIL_WITH_EVIDENCE',finished_at=NOW(),lease_owner=NULL,lease_token=NULL,lease_until=NULL,heartbeat_at=NULL,updated_at=NOW()
  WHERE id=v_node;
  UPDATE tasks
  SET status='FAIL_WITH_EVIDENCE',terminal_reason='NODE_FAILED',terminal_detail='{"code":"FIXTURE_DONE"}',terminal_at=NOW(),updated_at=NOW()
  WHERE id=v_task;

  SELECT * INTO v_v1 FROM load_terminal_evidence_input_v1(v_task);
  SELECT * INTO v_v2 FROM load_terminal_evidence_input_v2(v_task);
  IF NOT FOUND OR jsonb_array_length(v_v2.snapshot->'runtimeReceipts')<>1
     OR v_v2.snapshot #>> '{runtimeReceipts,0,configured,runtimeVersion}' <> '2026.9.8'
     OR v_v2.snapshot_sha256 IS NOT DISTINCT FROM v_v1.snapshot_sha256 THEN
    RAISE EXCEPTION 'E3b2 v2 snapshot did not bind the durable receipt';
  END IF;

  IF position('load_terminal_evidence_input_v2' in pg_get_functiondef('persist_task_evidence_v2(uuid,text,text,text)'::regprocedure))=0
     OR position('load_terminal_evidence_input_v2' in pg_get_functiondef('read_task_evidence_snapshot_v2(uuid)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'E3b2 persist/read functions are not bound to v2 snapshot';
  END IF;

  BEGIN
    PERFORM persist_task_evidence_v2(v_task,'{}',repeat('0',64),v_v1.snapshot_sha256);
    RAISE EXCEPTION 'v1 fingerprint was accepted by v2 Evidence persistence';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EVIDENCE_SNAPSHOT_CHANGED' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM persist_task_evidence_v2(v_task,'{}',repeat('0',64),v_v2.snapshot_sha256);
    RAISE EXCEPTION 'invalid Evidence bundle unexpectedly persisted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'EVIDENCE_BUNDLE_INVALID' THEN RAISE; END IF;
  END;

  IF EXISTS(SELECT 1 FROM artifacts WHERE task_id=v_task) THEN
    RAISE EXCEPTION 'failed E3b2 persistence leaked an artifact';
  END IF;
END;
$$;

ROLLBACK;
