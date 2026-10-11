\set ON_ERROR_STOP on

TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task UUID;
  v_research UUID;
  v_data UUID;
  first_claim RECORD;
  second_claim RECORD;
  data_claim RECORD;
  v_old_token UUID;
  v_none_count INTEGER;
  v_ok BOOLEAN;
BEGIN
  INSERT INTO tasks (
    idempotency_key,
    goal,
    budget_limit_usd,
    token_budget_limit,
    max_total_steps,
    deadline_at
  ) VALUES (
    'lease-test-request',
    'lease and fencing test',
    1.000000,
    10000,
    10,
    NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (task_id, node_key, agent_id, max_attempts)
  VALUES (v_task, 'research', 'researcher', 3)
  RETURNING id INTO v_research;

  INSERT INTO task_nodes (task_id, node_key, agent_id, max_attempts)
  VALUES (v_task, 'data', 'data', 3)
  RETURNING id INTO v_data;

  INSERT INTO task_node_dependencies (task_id, node_id, parent_node_id)
  VALUES (v_task, v_data, v_research);

  SELECT * INTO first_claim FROM claim_next_node('worker-a', 30);
  IF NOT FOUND OR first_claim.node_id <> v_research THEN
    RAISE EXCEPTION 'worker-a did not claim expected research node';
  END IF;
  v_old_token := first_claim.lease_token;

  SELECT count(*) INTO v_none_count FROM claim_next_node('worker-other', 30);
  IF v_none_count <> 0 THEN
    RAISE EXCEPTION 'second worker claimed a node while research lease active or dependency blocked';
  END IF;

  SELECT heartbeat_node(v_research, 'worker-a', gen_random_uuid(), 30) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'heartbeat accepted invalid fencing token';
  END IF;

  SELECT heartbeat_node(v_research, 'worker-a', v_old_token, 30) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'heartbeat rejected valid fencing token';
  END IF;

  UPDATE task_nodes
  SET lease_until = NOW() - INTERVAL '1 second'
  WHERE id = v_research AND lease_token = v_old_token;

  SELECT * INTO second_claim FROM claim_next_node('worker-b', 30);
  IF NOT FOUND OR second_claim.node_id <> v_research THEN
    RAISE EXCEPTION 'expired research node was not reclaimed';
  END IF;
  IF second_claim.lease_token = v_old_token THEN
    RAISE EXCEPTION 'reclaim reused stale fencing token';
  END IF;
  IF second_claim.attempt <> 2 THEN
    RAISE EXCEPTION 'reclaim did not increment attempt; got %', second_claim.attempt;
  END IF;

  SELECT heartbeat_node(v_research, 'worker-a', v_old_token, 30) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'stale worker heartbeat mutated reclaimed node';
  END IF;

  SELECT complete_node_success(v_research, 'worker-a', v_old_token, '{"stale":true}'::jsonb) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'stale worker completed reclaimed node';
  END IF;

  SELECT complete_node_success(v_research, 'worker-b', second_claim.lease_token, '{"ok":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'current lease holder could not complete node';
  END IF;

  SELECT * INTO data_claim FROM claim_next_node('worker-c', 30);
  IF NOT FOUND OR data_claim.node_id <> v_data THEN
    RAISE EXCEPTION 'data node did not become ready after parent success';
  END IF;

  SELECT complete_node_success(v_data, 'worker-c', data_claim.lease_token, '{"normalized":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'data node completion failed';
  END IF;
END $$;

SELECT 'lease/fencing assertions: PASS' AS result;
