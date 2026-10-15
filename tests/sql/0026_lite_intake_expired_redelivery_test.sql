BEGIN;

DO $$
DECLARE
  v_task UUID := gen_random_uuid();
  v_research UUID := gen_random_uuid();
  v_data UUID := gen_random_uuid();
  v_deadline TIMESTAMPTZ := NOW() - INTERVAL '1 hour';
  v_replay RECORD;
  v_failed BOOLEAN := FALSE;
BEGIN
  INSERT INTO tasks(
    id,idempotency_key,goal,request_payload,budget_limit_usd,token_budget_limit,max_total_steps,deadline_at
  ) VALUES (
    v_task,'expired-redelivery-0026','stable goal',
    '{"maxResults":5,"requiredFields":["dealer","price"]}'::jsonb,
    0.250000,50000,10,v_deadline
  );
  INSERT INTO task_nodes(id,task_id,node_key,agent_id,input_payload)
  VALUES
    (v_research,v_task,'research','researcher',jsonb_build_object('goal','stable goal','request','{"maxResults":5,"requiredFields":["dealer","price"]}'::jsonb)),
    (v_data,v_task,'data','data',jsonb_build_object('source_node_key','research'));
  INSERT INTO task_node_dependencies(task_id,node_id,parent_node_id)
  VALUES(v_task,v_data,v_research);

  SELECT * INTO v_replay FROM create_lite_research_task(
    'expired-redelivery-0026','stable goal',
    '{"requiredFields":["dealer","price"],"maxResults":5}'::jsonb,
    0.250000,50000,10,v_deadline
  );
  IF NOT FOUND OR v_replay.task_id <> v_task OR v_replay.created THEN
    RAISE EXCEPTION 'exact expired redelivery did not return existing task';
  END IF;
  IF (SELECT count(*) FROM tasks WHERE idempotency_key='expired-redelivery-0026') <> 1
     OR (SELECT count(*) FROM task_nodes WHERE task_id=v_task) <> 2
     OR (SELECT count(*) FROM task_node_dependencies WHERE task_id=v_task) <> 1 THEN
    RAISE EXCEPTION 'expired redelivery duplicated durable DAG state';
  END IF;

  BEGIN
    PERFORM * FROM create_lite_research_task(
      'expired-redelivery-0026','different goal',
      '{"requiredFields":["dealer","price"],"maxResults":5}'::jsonb,
      0.250000,50000,10,v_deadline
    );
  EXCEPTION WHEN OTHERS THEN
    IF position('idempotency key reused with different request contract' in SQLERRM) > 0 THEN
      v_failed := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'expired redelivery contract mismatch did not fail closed'; END IF;

  v_failed := FALSE;
  BEGIN
    PERFORM * FROM create_lite_research_task(
      'expired-new-0026','new expired goal','{}'::jsonb,0.100000,1000,5,v_deadline
    );
  EXCEPTION WHEN OTHERS THEN
    IF position('deadline must be in the future' in SQLERRM) > 0 THEN
      v_failed := TRUE;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'new request with expired deadline was accepted'; END IF;
END;
$$;

ROLLBACK;
