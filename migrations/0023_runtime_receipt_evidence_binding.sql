BEGIN;

-- E3b2: persist/read Evidence against the v2 terminal snapshot that includes
-- durable runtime receipts. Keep v1 functions intact for historical callers.
CREATE OR REPLACE FUNCTION read_task_evidence_snapshot_v2(p_task_id UUID)
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
  SELECT * INTO v_input FROM public.load_terminal_evidence_input_v2(p_task_id);
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

CREATE OR REPLACE FUNCTION persist_task_evidence_v2(
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

  SELECT * INTO v_input FROM public.load_terminal_evidence_input_v2(p_task_id);
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
    PERFORM * FROM public.read_task_evidence_snapshot_v2(p_task_id);
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

COMMIT;
