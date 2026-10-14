BEGIN;

-- A terminal raw-input snapshot is distinct from the existing artifact reader.
-- One projection statement observes one MVCC state. VOLATILE deliberately gives
-- a fresh command snapshot when called after a blocked task-row lock.
CREATE OR REPLACE FUNCTION load_terminal_evidence_input_v1(p_task_id UUID)
RETURNS TABLE (snapshot JSONB, snapshot_sha256 TEXT)
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  SELECT jsonb_build_object(
    'task', to_jsonb(t) || jsonb_build_object(
      'budget_limit_usd', t.budget_limit_usd::text,
      'reserved_cost_usd', t.reserved_cost_usd::text,
      'current_cost_usd', t.current_cost_usd::text,
      'token_budget_limit', t.token_budget_limit::text,
      'reserved_tokens', t.reserved_tokens::text,
      'current_tokens', t.current_tokens::text,
      'deadline_at', to_char(t.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'created_at', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updated_at', to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'terminal_at', to_char(t.terminal_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ),
    'nodes', COALESCE((SELECT jsonb_agg(to_jsonb(n) || jsonb_build_object(
      'reserved_cost_usd', n.reserved_cost_usd::text,
      'reserved_tokens', n.reserved_tokens::text,
      'created_at', to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updated_at', to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'started_at', to_char(n.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'finished_at', to_char(n.finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'lease_acquired_at', to_char(n.lease_acquired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'lease_until', to_char(n.lease_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'heartbeat_at', to_char(n.heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ORDER BY n.id) FROM public.task_nodes n WHERE n.task_id = t.id), '[]'::jsonb),
    'dependencies', COALESCE((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'created_at', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ORDER BY d.node_id, d.parent_node_id) FROM public.task_node_dependencies d WHERE d.task_id = t.id), '[]'::jsonb),
    'accounting', COALESCE((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'prompt_cache_hit_tokens', a.prompt_cache_hit_tokens::text,
      'prompt_cache_miss_tokens', a.prompt_cache_miss_tokens::text,
      'completion_tokens', a.completion_tokens::text,
      'total_tokens', a.total_tokens::text,
      'reserved_cost_usd', a.reserved_cost_usd::text,
      'cost_usd', a.cost_usd::text,
      'created_at', to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ORDER BY a.id) FROM public.llm_accounting a WHERE a.task_id = t.id), '[]'::jsonb),
    'reservations', COALESCE((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'reserved_cost_usd', r.reserved_cost_usd::text,
      'reserved_tokens', r.reserved_tokens::text,
      'actual_cost_usd', r.actual_cost_usd::text,
      'actual_tokens', r.actual_tokens::text,
      'created_at', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'reconciled_at', to_char(r.reconciled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'released_at', to_char(r.released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ORDER BY r.id) FROM public.budget_reservations r WHERE r.task_id = t.id), '[]'::jsonb),
    -- No producer for a recognized accounted runtime receipt exists before E3b.
    -- Never promote arbitrary artifact metadata to observed execution evidence.
    'runtimeReceipts', '[]'::jsonb
  ) INTO v_snapshot
  FROM public.tasks t
  WHERE t.id = p_task_id
    AND t.status IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED')
    AND t.terminal_at IS NOT NULL AND length(trim(t.terminal_reason)) > 0
    AND t.reserved_cost_usd = 0 AND t.reserved_tokens = 0
    AND NOT EXISTS (SELECT 1 FROM public.task_nodes n WHERE n.task_id = t.id
      AND (n.status NOT IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED')
        OR n.reserved_cost_usd <> 0 OR n.reserved_tokens <> 0))
    AND NOT EXISTS (SELECT 1 FROM public.budget_reservations r WHERE r.task_id = t.id AND r.status = 'RESERVED');

  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT v_snapshot,
    encode(public.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex');
END;
$$;

CREATE OR REPLACE FUNCTION persist_task_evidence_v1(
  p_task_id UUID, p_serialized TEXT, p_sha256 TEXT, p_expected_snapshot_sha256 TEXT
)
RETURNS TABLE (artifact_id UUID, created BOOLEAN, uri TEXT, sha256 TEXT, size_bytes BIGINT)
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.tasks%ROWTYPE;
  v_input RECORD;
  v_bundle JSONB;
  v_artifact public.artifacts%ROWTYPE;
  v_hash TEXT;
  v_size BIGINT;
  v_id UUID;
  v_reason TEXT;
BEGIN
  IF p_expected_snapshot_sha256 IS NULL OR p_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_REQUIRED';
  END IF;
  SELECT t.* INTO v_task FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_UNAVAILABLE'; END IF;

  -- A new command snapshot after the lock is essential to observe a preceding
  -- lock holder's committed state instead of the outer SELECT's older snapshot.
  SELECT * INTO v_input FROM public.load_terminal_evidence_input_v1(p_task_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_UNAVAILABLE'; END IF;
  IF v_input.snapshot_sha256 IS DISTINCT FROM p_expected_snapshot_sha256 THEN
    RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_CHANGED';
  END IF;
  BEGIN v_bundle := p_serialized::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'EVIDENCE_BUNDLE_INVALID'; END;
  v_reason := CASE WHEN v_task.terminal_reason ~ '^[A-Z][A-Z0-9_]{0,127}$'
    THEN v_task.terminal_reason ELSE 'UNCLASSIFIED_TERMINAL_REASON' END;
  IF jsonb_typeof(v_bundle) IS DISTINCT FROM 'object'
    OR v_bundle->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR v_bundle #>> '{task,id}' IS DISTINCT FROM p_task_id::text
    OR v_bundle #>> '{task,status}' IS DISTINCT FROM v_task.status::text
    OR v_bundle #>> '{task,terminalReason}' IS DISTINCT FROM v_reason
    OR v_bundle #>> '{task,currentCostUsd}' IS DISTINCT FROM v_task.current_cost_usd::text
    OR v_bundle #>> '{task,currentTokens}' IS DISTINCT FROM v_task.current_tokens::text
    OR v_bundle #>> '{task,currentSteps}' IS DISTINCT FROM v_task.current_steps::text
    OR v_bundle #>> '{task,reservedCostUsd}' IS DISTINCT FROM '0.000000'
    OR v_bundle #>> '{task,reservedTokens}' IS DISTINCT FROM '0'
    OR jsonb_typeof(v_bundle->'acceptanceCriteria') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'EVIDENCE_BUNDLE_INVALID';
  END IF;
  -- E1 in the trusted adapter derives sanitized criteria/results from the exact
  -- raw snapshot. Repeating normalization/redaction in SQL would reject valid
  -- nullable/default/trimmed inputs or expose the original secret-bearing goal.
  v_hash := encode(public.digest(convert_to(p_serialized, 'UTF8'), 'sha256'), 'hex');
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR v_hash IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'EVIDENCE_HASH_MISMATCH';
  END IF;
  v_size := octet_length(p_serialized);

  SELECT a.* INTO v_artifact FROM public.artifacts a
  WHERE a.task_id = p_task_id AND a.artifact_type = 'EVIDENCE_BUNDLE_V1' FOR UPDATE;
  IF FOUND THEN
    IF v_artifact.sha256::text IS DISTINCT FROM p_sha256 OR v_artifact.size_bytes IS DISTINCT FROM v_size
      OR v_artifact.metadata->>'serialized' IS DISTINCT FROM p_serialized THEN
      RAISE EXCEPTION 'EVIDENCE_ARTIFACT_CONFLICT';
    END IF;
    PERFORM * FROM public.read_task_evidence_snapshot_v1(p_task_id);
    RETURN QUERY SELECT v_artifact.id, false, v_artifact.uri, v_artifact.sha256::text, v_artifact.size_bytes;
    RETURN;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO public.artifacts (id, task_id, node_id, artifact_type, uri, sha256, mime_type, size_bytes, metadata)
  VALUES (v_id, p_task_id, NULL, 'EVIDENCE_BUNDLE_V1', format('artifact://postgres/%s', v_id),
    p_sha256, 'application/json', v_size, jsonb_build_object(
      'schemaVersion', 1, 'serialized', p_serialized, 'acceptanceCriteria', v_bundle->'acceptanceCriteria',
      'snapshotSha256', v_input.snapshot_sha256
    )) RETURNING * INTO v_artifact;
  RETURN QUERY SELECT v_artifact.id, true, v_artifact.uri, v_artifact.sha256::text, v_artifact.size_bytes;
END;
$$;

-- Preserve the existing artifact-retrieval name and return columns. A legacy
-- unbound row is unproven; reading never backfills or changes its provenance.
CREATE OR REPLACE FUNCTION read_task_evidence_snapshot_v1(p_task_id UUID)
RETURNS TABLE (artifact_id UUID, task_id UUID, uri TEXT, serialized TEXT, sha256 TEXT, size_bytes BIGINT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_artifact public.artifacts%ROWTYPE;
  v_input RECORD;
  v_bundle JSONB;
  v_serialized TEXT;
  v_hash TEXT;
  v_reason TEXT;
BEGIN
  SELECT a.* INTO v_artifact FROM public.artifacts a
  WHERE a.task_id = p_task_id AND a.artifact_type = 'EVIDENCE_BUNDLE_V1';
  IF NOT FOUND THEN RETURN; END IF;
  IF v_artifact.node_id IS NOT NULL OR v_artifact.mime_type IS DISTINCT FROM 'application/json'
    OR v_artifact.uri IS DISTINCT FROM format('artifact://postgres/%s', v_artifact.id)
    OR v_artifact.metadata->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR jsonb_typeof(v_artifact.metadata->'serialized') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'EVIDENCE_ARTIFACT_INVALID';
  END IF;
  IF COALESCE(v_artifact.metadata->>'snapshotSha256', '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_REQUIRED';
  END IF;
  SELECT * INTO v_input FROM public.load_terminal_evidence_input_v1(p_task_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_UNAVAILABLE'; END IF;
  IF v_input.snapshot_sha256 IS DISTINCT FROM v_artifact.metadata->>'snapshotSha256' THEN
    RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_CHANGED';
  END IF;
  v_serialized := v_artifact.metadata->>'serialized';
  v_hash := encode(public.digest(convert_to(v_serialized, 'UTF8'), 'sha256'), 'hex');
  IF v_artifact.size_bytes IS DISTINCT FROM octet_length(v_serialized)
    OR v_artifact.sha256::text IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'EVIDENCE_ARTIFACT_INVALID';
  END IF;
  BEGIN v_bundle := v_serialized::jsonb;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'EVIDENCE_ARTIFACT_INVALID'; END;
  v_reason := CASE WHEN v_input.snapshot #>> '{task,terminal_reason}' ~ '^[A-Z][A-Z0-9_]{0,127}$'
    THEN v_input.snapshot #>> '{task,terminal_reason}' ELSE 'UNCLASSIFIED_TERMINAL_REASON' END;
  IF v_bundle->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR v_bundle #>> '{task,id}' IS DISTINCT FROM p_task_id::text
    OR v_bundle #>> '{task,status}' IS DISTINCT FROM v_input.snapshot #>> '{task,status}'
    OR v_bundle #>> '{task,terminalReason}' IS DISTINCT FROM v_reason
    OR v_bundle #>> '{task,currentCostUsd}' IS DISTINCT FROM v_input.snapshot #>> '{task,current_cost_usd}'
    OR v_bundle #>> '{task,currentTokens}' IS DISTINCT FROM v_input.snapshot #>> '{task,current_tokens}'
    OR v_artifact.metadata->'acceptanceCriteria' IS DISTINCT FROM v_bundle->'acceptanceCriteria' THEN
    RAISE EXCEPTION 'EVIDENCE_ARTIFACT_INVALID';
  END IF;
  RETURN QUERY SELECT v_artifact.id, v_artifact.task_id, v_artifact.uri, v_serialized,
    v_artifact.sha256::text, v_artifact.size_bytes, v_artifact.created_at;
END;
$$;

-- Keep the old SQL call shape for read-only identical retries. It cannot create
-- a new row or silently assign provenance to historical unbound evidence.
CREATE OR REPLACE FUNCTION persist_task_evidence_v1(p_task_id UUID, p_serialized TEXT, p_sha256 TEXT)
RETURNS TABLE (artifact_id UUID, created BOOLEAN, uri TEXT, sha256 TEXT, size_bytes BIGINT)
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE v_existing RECORD;
BEGIN
  SELECT * INTO v_existing FROM public.read_task_evidence_snapshot_v1(p_task_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'EVIDENCE_SNAPSHOT_REQUIRED'; END IF;
  IF v_existing.serialized IS DISTINCT FROM p_serialized OR v_existing.sha256 IS DISTINCT FROM p_sha256 THEN
    RAISE EXCEPTION 'EVIDENCE_ARTIFACT_CONFLICT';
  END IF;
  RETURN QUERY SELECT v_existing.artifact_id, false, v_existing.uri, v_existing.sha256, v_existing.size_bytes;
END;
$$;

COMMIT;
