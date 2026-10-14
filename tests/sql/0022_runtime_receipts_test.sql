BEGIN;

DO $$
DECLARE
  v_task UUID := gen_random_uuid(); v_node UUID := gen_random_uuid(); v_lease UUID := gen_random_uuid(); v_res UUID;
  v_first RECORD; v_again RECORD; v_snapshot RECORD;
  v_fb_task UUID := gen_random_uuid(); v_fb_node UUID := gen_random_uuid(); v_fb_lease UUID := gen_random_uuid(); v_fb_res UUID; v_fb RECORD;
  v_stale_task UUID := gen_random_uuid(); v_stale_node UUID := gen_random_uuid(); v_stale_lease UUID := gen_random_uuid(); v_stale_res UUID; v_stale_acc RECORD;
  v_count INTEGER;
  v_receipt JSONB := jsonb_build_object(
    'observed',jsonb_build_object('provider','deepseek','model','deepseek-flash','sessionId','session-1','toolSummary',jsonb_build_object('calls',2,'failures',0,'tools',jsonb_build_array('web_search','web_fetch'),'totalToolTimeMs',7)),
    'configured',jsonb_build_object('runtimeVersion','2026.9.8','requestedModel','deepseek/deepseek-flash','thinkingLevel','max'),
    'trace','[]'::jsonb,'error',NULL
  );
BEGIN
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_task,'e3b1-observed-'||v_task,'E3b1 observed fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_node,v_task,'research','researcher','RUNNING',1,3,'worker-observed',v_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());
  v_res := reserve_node_budget('research:'||v_task||':'||v_node||':'||v_lease,v_node,'worker-observed',v_lease,0.100000,100);
  IF v_res IS NULL THEN RAISE EXCEPTION 'observed reservation was rejected'; END IF;

  SELECT * INTO v_first FROM record_llm_call_with_runtime_receipt_v1(
    v_res,'research:'||v_task||':'||v_node||':'||v_lease,v_node,'worker-observed',v_lease,
    'deepseek','deepseek-flash','fixture-v1','session-1',2,3,4,9,0.000003,12,v_receipt);
  IF NOT FOUND OR NOT v_first.accounting_created OR NOT v_first.runtime_receipt_created THEN
    RAISE EXCEPTION 'first atomic accounting/runtime receipt write was not created';
  END IF;

  SELECT * INTO v_again FROM record_llm_call_with_runtime_receipt_v1(
    v_res,'research:'||v_task||':'||v_node||':'||v_lease,v_node,'worker-observed',v_lease,
    'deepseek','deepseek-flash','fixture-v1','session-1',2,3,4,9,0.000003,12,v_receipt);
  IF NOT FOUND OR v_again.accounting_created OR v_again.runtime_receipt_created
     OR v_again.accounting_id<>v_first.accounting_id OR v_again.runtime_receipt_id<>v_first.runtime_receipt_id
     OR (SELECT count(*) FROM llm_accounting WHERE task_id=v_task)<>1
     OR (SELECT count(*) FROM runtime_receipts WHERE task_id=v_task)<>1 THEN
    RAISE EXCEPTION 'atomic accounting/runtime receipt replay was not exactly-once';
  END IF;

  UPDATE task_nodes SET status='FAIL_WITH_EVIDENCE',finished_at=NOW(),lease_owner=NULL,lease_token=NULL,lease_until=NULL,heartbeat_at=NULL WHERE id=v_node;
  UPDATE tasks SET status='FAIL_WITH_EVIDENCE',terminal_reason='NODE_FAILED',terminal_detail='{"code":"FIXTURE_DONE"}',terminal_at=NOW(),updated_at=NOW() WHERE id=v_task;
  SELECT * INTO v_snapshot FROM load_terminal_evidence_input_v2(v_task);
  IF NOT FOUND OR jsonb_array_length(v_snapshot.snapshot->'runtimeReceipts')<>1
     OR v_snapshot.snapshot #>> '{runtimeReceipts,0,observed,provider}' <> 'deepseek'
     OR v_snapshot.snapshot #>> '{runtimeReceipts,0,configured,runtimeVersion}' <> '2026.9.8'
     OR v_snapshot.snapshot #>> '{runtimeReceipts,0,recorded_at}' !~ 'Z$' THEN
    RAISE EXCEPTION 'terminal Evidence snapshot did not bind durable runtime receipt';
  END IF;

  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_fb_task,'e3b1-fallback-'||v_fb_task,'E3b1 fallback fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_fb_node,v_fb_task,'research','researcher','RUNNING',1,3,'worker-fallback',v_fb_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());
  v_fb_res := reserve_node_budget('research:'||v_fb_task||':'||v_fb_node||':'||v_fb_lease,v_fb_node,'worker-fallback',v_fb_lease,0.100000,50);
  SELECT * INTO v_fb FROM record_llm_call_reservation_fallback_with_runtime_receipt_v1(
    v_fb_res,'research:'||v_fb_task||':'||v_fb_node||':'||v_fb_lease,v_fb_node,'worker-fallback',v_fb_lease,
    'deepseek','deepseek-flash','fixture-v1',NULL,15,'REJECTED_RESEARCH_BILLING_UNTRUSTWORTHY',
    jsonb_build_object('observed',NULL,'configured',jsonb_build_object('runtimeVersion','2026.9.8','requestedModel','deepseek/deepseek-flash','thinkingLevel','max'),'trace','[]'::jsonb,'error',NULL));
  IF NOT FOUND OR v_fb.accounting_id IS NULL OR v_fb.runtime_receipt_id IS NULL
     OR (SELECT accounting_basis FROM llm_accounting WHERE id=v_fb.accounting_id)<>'RESERVATION_FALLBACK'
     OR (SELECT count(*) FROM runtime_receipts WHERE task_id=v_fb_task)<>1 THEN
    RAISE EXCEPTION 'fallback accounting did not persist one runtime receipt';
  END IF;

  -- Direct producer rejects a first receipt after the lease expires. The old
  -- accounting function is used only to build this rollback-scoped fixture.
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_stale_task,'e3b1-stale-'||v_stale_task,'E3b1 stale fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_stale_node,v_stale_task,'research','researcher','RUNNING',1,3,'worker-stale',v_stale_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());
  v_stale_res := reserve_node_budget('research:'||v_stale_task||':'||v_stale_node||':'||v_stale_lease,v_stale_node,'worker-stale',v_stale_lease,0.100000,10);
  SELECT * INTO v_stale_acc FROM record_llm_call(v_stale_res,'research:'||v_stale_task||':'||v_stale_node||':'||v_stale_lease,v_stale_node,'worker-stale',v_stale_lease,
    'deepseek','deepseek-flash','fixture-v1','session-stale',0,3,2,5,0.000002,10);
  UPDATE task_nodes SET lease_until=NOW()-INTERVAL '1 second' WHERE id=v_stale_node;
  SELECT count(*) INTO v_count FROM record_runtime_receipt_v1(v_stale_acc.accounting_id,'research:'||v_stale_task||':'||v_stale_node||':'||v_stale_lease,
    v_stale_node,'worker-stale',v_stale_lease,jsonb_build_object('observed',jsonb_build_object('provider','deepseek','model','deepseek-flash','sessionId','session-stale'),'configured',jsonb_build_object('runtimeVersion','2026.9.8'),'trace','[]'::jsonb,'error',NULL));
  IF v_count<>0 OR EXISTS(SELECT 1 FROM runtime_receipts WHERE task_id=v_stale_task) THEN
    RAISE EXCEPTION 'expired lease created a runtime receipt';
  END IF;
END;
$$;

ROLLBACK;
