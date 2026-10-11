TRUNCATE TABLE tasks CASCADE;

DO $$
DECLARE
  v_task UUID;
  v_node UUID;
  v_claim RECORD;
  v_res1 UUID;
  v_res2 UUID;
  v_release UUID;
  v_ok BOOLEAN;
  v_cost NUMERIC(12,6);
  v_reserved NUMERIC(12,6);
  v_tokens BIGINT;
  v_reserved_tokens BIGINT;
  v_count INTEGER;
BEGIN
  INSERT INTO tasks (
    idempotency_key, goal, budget_limit_usd, token_budget_limit,
    max_total_steps, deadline_at
  ) VALUES (
    'budget-test', 'budget test', 0.100000, 1000, 10, NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (task_id, node_key, agent_id, max_attempts)
  VALUES (v_task, 'research', 'researcher', 3)
  RETURNING id INTO v_node;

  SELECT * INTO v_claim FROM claim_next_node('worker-budget', 30);
  IF NOT FOUND OR v_claim.node_id <> v_node THEN
    RAISE EXCEPTION 'budget test node was not claimed';
  END IF;

  -- Stale/invalid fencing token cannot reserve budget.
  SELECT reserve_node_budget(
    'stale-reservation', v_node, 'worker-budget', gen_random_uuid(), 0.010000, 100
  ) INTO v_res1;
  IF v_res1 IS NOT NULL THEN
    RAISE EXCEPTION 'stale fencing token reserved budget';
  END IF;

  -- Valid reservation succeeds.
  SELECT reserve_node_budget(
    'call-1', v_node, 'worker-budget', v_claim.lease_token, 0.050000, 500
  ) INTO v_res1;
  IF v_res1 IS NULL THEN
    RAISE EXCEPTION 'valid budget reservation failed';
  END IF;

  SELECT reserved_cost_usd, reserved_tokens
    INTO v_reserved, v_reserved_tokens
  FROM tasks WHERE id = v_task;
  IF v_reserved <> 0.050000 OR v_reserved_tokens <> 500 THEN
    RAISE EXCEPTION 'task reservation totals incorrect: %, %', v_reserved, v_reserved_tokens;
  END IF;

  -- Same reservation key is idempotent and must not reserve twice.
  SELECT reserve_node_budget(
    'call-1', v_node, 'worker-budget', v_claim.lease_token, 0.050000, 500
  ) INTO v_res2;
  IF v_res2 <> v_res1 THEN
    RAISE EXCEPTION 'idempotent reservation returned a different id';
  END IF;

  SELECT reserved_cost_usd, reserved_tokens
    INTO v_reserved, v_reserved_tokens
  FROM tasks WHERE id = v_task;
  IF v_reserved <> 0.050000 OR v_reserved_tokens <> 500 THEN
    RAISE EXCEPTION 'idempotent reservation double-counted budget';
  END IF;

  -- Cost and token over-reservations are rejected.
  SELECT reserve_node_budget(
    'too-expensive', v_node, 'worker-budget', v_claim.lease_token, 0.060001, 1
  ) INTO v_res2;
  IF v_res2 IS NOT NULL THEN
    RAISE EXCEPTION 'cost circuit breaker allowed oversubscription';
  END IF;

  SELECT reserve_node_budget(
    'too-many-tokens', v_node, 'worker-budget', v_claim.lease_token, 0.001000, 501
  ) INTO v_res2;
  IF v_res2 IS NOT NULL THEN
    RAISE EXCEPTION 'token circuit breaker allowed oversubscription';
  END IF;

  -- Reconcile actual usage, releasing the unused part of the reservation.
  SELECT reconcile_node_budget(
    v_res1, v_node, 'worker-budget', v_claim.lease_token, 0.020000, 200
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'budget reconciliation failed';
  END IF;

  SELECT current_cost_usd, reserved_cost_usd, current_tokens, reserved_tokens
    INTO v_cost, v_reserved, v_tokens, v_reserved_tokens
  FROM tasks WHERE id = v_task;
  IF v_cost <> 0.020000 OR v_reserved <> 0 OR v_tokens <> 200 OR v_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'reconciliation totals incorrect: cost %, reserved %, tokens %, reserved_tokens %',
      v_cost, v_reserved, v_tokens, v_reserved_tokens;
  END IF;

  -- A second reservation can be released without charging actual usage.
  SELECT reserve_node_budget(
    'call-2', v_node, 'worker-budget', v_claim.lease_token, 0.030000, 300
  ) INTO v_release;
  IF v_release IS NULL THEN
    RAISE EXCEPTION 'second valid reservation failed';
  END IF;

  SELECT release_node_budget(
    v_release, v_node, 'worker-budget', v_claim.lease_token
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'budget release failed';
  END IF;

  SELECT current_cost_usd, reserved_cost_usd, current_tokens, reserved_tokens
    INTO v_cost, v_reserved, v_tokens, v_reserved_tokens
  FROM tasks WHERE id = v_task;
  IF v_cost <> 0.020000 OR v_reserved <> 0 OR v_tokens <> 200 OR v_reserved_tokens <> 0 THEN
    RAISE EXCEPTION 'release changed charged usage or left reservation behind';
  END IF;

  -- Terminal node cannot start a new paid reservation.
  SELECT complete_node_success(v_node, 'worker-budget', v_claim.lease_token, '{"ok":true}'::jsonb) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'could not complete budget test node';
  END IF;

  SELECT reserve_node_budget(
    'after-terminal-node', v_node, 'worker-budget', v_claim.lease_token, 0.001000, 1
  ) INTO v_res2;
  IF v_res2 IS NOT NULL THEN
    RAISE EXCEPTION 'terminal node reserved new budget';
  END IF;
END $$;

-- Deadline breaker: expired task cannot issue a node claim.
DO $$
DECLARE
  v_task UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO tasks (
    idempotency_key, goal, budget_limit_usd, max_total_steps, deadline_at
  ) VALUES (
    'deadline-test', 'deadline test', 1.000000, 10, NOW() - INTERVAL '1 second'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (task_id, node_key, agent_id)
  VALUES (v_task, 'research', 'researcher');

  SELECT count(*) INTO v_count FROM claim_next_node('deadline-worker', 30);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'deadline circuit breaker allowed claim';
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Total-step breaker: exhausted task cannot issue another node claim.
DO $$
DECLARE
  v_task UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO tasks (
    idempotency_key, goal, budget_limit_usd, max_total_steps, current_steps, deadline_at
  ) VALUES (
    'steps-test', 'steps test', 1.000000, 1, 1, NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (task_id, node_key, agent_id)
  VALUES (v_task, 'research', 'researcher');

  SELECT count(*) INTO v_count FROM claim_next_node('steps-worker', 30);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'total-step circuit breaker allowed claim';
  END IF;
END $$;

TRUNCATE TABLE tasks CASCADE;

-- Max-attempt breaker: exhausted node cannot be reclaimed.
DO $$
DECLARE
  v_task UUID;
  v_node UUID;
  v_count INTEGER;
BEGIN
  INSERT INTO tasks (
    idempotency_key, goal, budget_limit_usd, max_total_steps, deadline_at
  ) VALUES (
    'attempt-test', 'attempt test', 1.000000, 10, NOW() + INTERVAL '10 minutes'
  ) RETURNING id INTO v_task;

  INSERT INTO task_nodes (
    task_id, node_key, agent_id, status,
    attempt, max_attempts, lease_owner, lease_token, lease_until
  ) VALUES (
    v_task, 'research', 'researcher', 'RUNNING',
    3, 3, 'dead-worker', gen_random_uuid(), NOW() - INTERVAL '1 second'
  ) RETURNING id INTO v_node;

  SELECT count(*) INTO v_count FROM claim_next_node('attempt-worker', 30);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'max-attempt circuit breaker allowed reclaim';
  END IF;
END $$;

SELECT 'budget and circuit-breaker assertions: PASS' AS result;
