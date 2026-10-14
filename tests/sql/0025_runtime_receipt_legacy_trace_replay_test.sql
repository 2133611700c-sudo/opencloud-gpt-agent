BEGIN;

DO $$
DECLARE
  v_task UUID := gen_random_uuid();
  v_node UUID := gen_random_uuid();
  v_lease UUID := gen_random_uuid();
  v_res UUID;
  v_acc RECORD;
  v_legacy_receipt UUID;
  v_replay RECORD;
  v_call_key TEXT;
  v_observed JSONB := jsonb_build_object('provider','deepseek','model','deepseek-flash','sessionId','legacy-session');
  v_configured JSONB := jsonb_build_object('runtimeVersion','2026.9.8','requestedModel','deepseek/deepseek-flash','thinkingLevel','max');

  v_new_task UUID := gen_random_uuid();
  v_new_node UUID := gen_random_uuid();
  v_new_lease UUID := gen_random_uuid();
  v_new_res UUID;
  v_new RECORD;
  v_new_trace JSONB;
  v_new_call_key TEXT;
BEGIN
  v_call_key := 'legacy-trace-replay:'||v_task||':'||v_node||':'||v_lease;
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_task,'legacy-trace-'||v_task,'legacy trace replay fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_node,v_task,'research','researcher','RUNNING',1,3,'worker-legacy',v_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());

  v_res := reserve_node_budget(v_call_key,v_node,'worker-legacy',v_lease,0.100000,100);
  SELECT * INTO v_acc FROM record_llm_call(
    v_res,v_call_key,v_node,'worker-legacy',v_lease,
    'deepseek','deepseek-flash','fixture-v1','legacy-session',2,3,4,9,0.000003,12);
  IF NOT FOUND OR v_acc.accounting_id IS NULL THEN RAISE EXCEPTION 'legacy accounting fixture was not created'; END IF;

  INSERT INTO runtime_receipts(accounting_id,call_key,task_id,node_id,lease_token,observed,configured,trace,error)
  VALUES(v_acc.accounting_id,v_call_key,v_task,v_node,v_lease,v_observed,v_configured,'[]'::jsonb,NULL)
  RETURNING id INTO v_legacy_receipt;

  SELECT * INTO v_replay FROM record_runtime_receipt_v1(
    v_acc.accounting_id,v_call_key,v_node,'compat-replay',v_lease,
    jsonb_build_object('observed',v_observed,'configured',v_configured,'trace','[]'::jsonb,'error',NULL));
  IF NOT FOUND OR v_replay.created OR v_replay.runtime_receipt_id<>v_legacy_receipt
     OR (SELECT trace FROM runtime_receipts WHERE id=v_legacy_receipt)<>'[]'::jsonb THEN
    RAISE EXCEPTION 'legacy empty-trace receipt did not replay byte-for-byte';
  END IF;

  -- New receipts must still receive the deterministic 0024 trace.
  v_new_call_key := 'new-trace:'||v_new_task||':'||v_new_node||':'||v_new_lease;
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_new_task,'new-trace-'||v_new_task,'new trace fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_new_node,v_new_task,'research','researcher','RUNNING',1,3,'worker-new',v_new_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());
  v_new_res := reserve_node_budget(v_new_call_key,v_new_node,'worker-new',v_new_lease,0.100000,100);
  SELECT * INTO v_new FROM record_llm_call_with_runtime_receipt_v1(
    v_new_res,v_new_call_key,v_new_node,'worker-new',v_new_lease,
    'deepseek','deepseek-flash','fixture-v1','new-session',2,3,4,9,0.000003,12,
    jsonb_build_object(
      'observed',jsonb_build_object('provider','deepseek','model','deepseek-flash','sessionId','new-session'),
      'configured',v_configured,'trace','[]'::jsonb,'error',NULL));
  SELECT trace INTO v_new_trace FROM runtime_receipts WHERE id=v_new.runtime_receipt_id;
  IF jsonb_array_length(v_new_trace)<>1 OR v_new_trace #>> '{0,event}'<>'ACCOUNTING_RECONCILED' THEN
    RAISE EXCEPTION 'new receipt lost deterministic accounting trace';
  END IF;
END;
$$;

ROLLBACK;
