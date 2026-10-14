BEGIN;

DO $$
DECLARE
  v_task UUID := gen_random_uuid();
  v_node UUID := gen_random_uuid();
  v_lease UUID := gen_random_uuid();
  v_res UUID;
  v_first RECORD;
  v_again RECORD;
  v_trace JSONB;
  v_expected_at TEXT;
  v_call_key TEXT;
  v_receipt JSONB := jsonb_build_object(
    'observed',jsonb_build_object(
      'provider','deepseek','model','deepseek-flash','sessionId','trace-session',
      'toolSummary',jsonb_build_object('calls',2,'failures',0,'tools',jsonb_build_array('web_search','web_fetch'),'totalToolTimeMs',7)
    ),
    'configured',jsonb_build_object('runtimeVersion','2026.9.8','requestedModel','deepseek/deepseek-flash','thinkingLevel','max'),
    'trace','[]'::jsonb,
    'error',NULL
  );
BEGIN
  v_call_key := 'research:'||v_task||':'||v_node||':'||v_lease;
  INSERT INTO tasks(id,idempotency_key,goal,request_payload,status,budget_limit_usd,token_budget_limit,max_total_steps,current_steps,deadline_at)
  VALUES(v_task,'e3b2-trace-'||v_task,'E3b2 deterministic trace fixture','{}','RUNNING',1,1000,5,1,NOW()+INTERVAL '1 hour');
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,status,attempt,max_attempts,lease_owner,lease_token,lease_acquired_at,lease_until,heartbeat_at,started_at)
  VALUES(v_node,v_task,'research','researcher','RUNNING',1,3,'worker-trace',v_lease,NOW(),NOW()+INTERVAL '10 minutes',NOW(),NOW());

  v_res := reserve_node_budget(v_call_key,v_node,'worker-trace',v_lease,0.100000,100);
  IF v_res IS NULL THEN RAISE EXCEPTION 'trace fixture reservation was rejected'; END IF;

  SELECT * INTO v_first FROM record_llm_call_with_runtime_receipt_v1(
    v_res,v_call_key,v_node,'worker-trace',v_lease,
    'deepseek','deepseek-flash','fixture-v1','trace-session',2,3,4,9,0.000003,12,v_receipt);
  IF NOT FOUND OR NOT v_first.accounting_created OR NOT v_first.runtime_receipt_created THEN
    RAISE EXCEPTION 'trace fixture first write was not created';
  END IF;

  SELECT rr.trace,
         to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  INTO v_trace, v_expected_at
  FROM runtime_receipts rr
  JOIN llm_accounting a ON a.id=rr.accounting_id
  WHERE rr.id=v_first.runtime_receipt_id;

  IF jsonb_array_length(v_trace)<>1
     OR v_trace #>> '{0,event}' <> 'ACCOUNTING_RECONCILED'
     OR v_trace #>> '{0,at}' <> v_expected_at THEN
    RAISE EXCEPTION 'empty runtime trace was not deterministically bound to accounting.created_at';
  END IF;

  -- Replay the exact original caller payload with trace=[]; normalization must
  -- reproduce the same stored trace instead of creating an exactly-once collision.
  SELECT * INTO v_again FROM record_llm_call_with_runtime_receipt_v1(
    v_res,v_call_key,v_node,'worker-trace',v_lease,
    'deepseek','deepseek-flash','fixture-v1','trace-session',2,3,4,9,0.000003,12,v_receipt);
  IF NOT FOUND OR v_again.accounting_created OR v_again.runtime_receipt_created
     OR v_again.accounting_id<>v_first.accounting_id
     OR v_again.runtime_receipt_id<>v_first.runtime_receipt_id
     OR (SELECT count(*) FROM runtime_receipts WHERE task_id=v_task)<>1 THEN
    RAISE EXCEPTION 'deterministic trace broke exactly-once runtime receipt replay';
  END IF;
END;
$$;

ROLLBACK;
