BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_artifacts_task_evidence_v1
  ON artifacts(task_id)
  WHERE artifact_type = 'EVIDENCE_BUNDLE_V1';

CREATE OR REPLACE FUNCTION persist_task_evidence_v1(
  p_task_id UUID,
  p_serialized TEXT,
  p_sha256 TEXT
)
RETURNS TABLE (
  artifact_id UUID,
  created BOOLEAN,
  uri TEXT,
  sha256 TEXT,
  size_bytes BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_bundle JSONB;
  v_acceptance JSONB;
  v_expected_acceptance JSONB;
  v_digest TEXT;
  v_size BIGINT;
  v_artifact artifacts%ROWTYPE;
  v_artifact_id UUID;
  v_uri TEXT;
BEGIN
  IF p_task_id IS NULL THEN
    RAISE EXCEPTION 'evidence task id is required';
  END IF;
  IF p_serialized IS NULL OR length(p_serialized) = 0 THEN
    RAISE EXCEPTION 'evidence serialized payload is required';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'evidence sha256 must be lowercase hex';
  END IF;

  BEGIN
    v_bundle := p_serialized::jsonb;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'evidence serialized payload must be valid JSON';
  END;

  IF jsonb_typeof(v_bundle) <> 'object' OR v_bundle->>'schemaVersion' <> '1' THEN
    RAISE EXCEPTION 'evidence schema version 1 is required';
  END IF;

  SELECT * INTO v_task
  FROM tasks
  WHERE id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence task does not exist';
  END IF;

  IF v_task.status NOT IN ('SUCCESS', 'FAIL_WITH_EVIDENCE', 'BLOCKED', 'CANCELLED') THEN
    RAISE EXCEPTION 'evidence task must be terminal';
  END IF;

  IF v_bundle #>> '{task,id}' IS DISTINCT FROM p_task_id::text THEN
    RAISE EXCEPTION 'evidence task linkage mismatch';
  END IF;
  IF v_bundle #>> '{task,status}' IS DISTINCT FROM v_task.status::text THEN
    RAISE EXCEPTION 'evidence terminal status mismatch';
  END IF;

  v_acceptance := v_bundle->'acceptanceCriteria';
  IF jsonb_typeof(v_acceptance) <> 'object'
     OR v_acceptance->>'goal' IS DISTINCT FROM v_task.goal THEN
    RAISE EXCEPTION 'evidence acceptance linkage mismatch';
  END IF;

  IF v_acceptance->>'valid' = 'true' THEN
    IF jsonb_typeof(v_task.request_payload) <> 'object' THEN
      RAISE EXCEPTION 'evidence acceptance cannot be valid for malformed request payload';
    END IF;
    v_expected_acceptance := jsonb_build_object(
      'goal', v_task.goal,
      'valid', true,
      'requiredFields', COALESCE(v_task.request_payload->'requiredFields', '[]'::jsonb)
    );
    IF v_task.request_payload ? 'maxResults' THEN
      v_expected_acceptance := v_expected_acceptance || jsonb_build_object('maxResults', v_task.request_payload->'maxResults');
    END IF;
    IF v_task.request_payload ? 'constraints' THEN
      v_expected_acceptance := v_expected_acceptance || jsonb_build_object('constraints', v_task.request_payload->'constraints');
    END IF;
    IF v_acceptance IS DISTINCT FROM v_expected_acceptance THEN
      RAISE EXCEPTION 'evidence immutable acceptance criteria mismatch';
    END IF;
  ELSE
    IF v_task.status = 'SUCCESS'
       OR v_acceptance IS DISTINCT FROM jsonb_build_object(
         'goal', v_task.goal,
         'valid', false,
         'verification', 'NOT_PROVEN',
         'reason', 'INVALID_REQUEST_PAYLOAD'
       ) THEN
      RAISE EXCEPTION 'evidence invalid acceptance criteria mismatch';
    END IF;
  END IF;

  v_digest := encode(digest(convert_to(p_serialized, 'UTF8'), 'sha256'), 'hex');
  IF v_digest <> p_sha256 THEN
    RAISE EXCEPTION 'evidence sha256 mismatch';
  END IF;
  v_size := octet_length(p_serialized);

  SELECT * INTO v_artifact
  FROM artifacts
  WHERE task_id = p_task_id
    AND artifact_type = 'EVIDENCE_BUNDLE_V1'
  FOR UPDATE;

  IF FOUND THEN
    IF v_artifact.sha256::text = p_sha256
       AND v_artifact.size_bytes = v_size
       AND v_artifact.metadata->>'serialized' = p_serialized THEN
      artifact_id := v_artifact.id;
      created := false;
      uri := v_artifact.uri;
      sha256 := v_artifact.sha256::text;
      size_bytes := v_artifact.size_bytes;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'evidence is immutable once persisted for task';
  END IF;

  v_artifact_id := gen_random_uuid();
  v_uri := format('artifact://postgres/%s', v_artifact_id);

  INSERT INTO artifacts (
    id,
    task_id,
    node_id,
    artifact_type,
    uri,
    sha256,
    mime_type,
    size_bytes,
    metadata
  ) VALUES (
    v_artifact_id,
    p_task_id,
    NULL,
    'EVIDENCE_BUNDLE_V1',
    v_uri,
    p_sha256,
    'application/json',
    v_size,
    jsonb_build_object(
      'schemaVersion', 1,
      'serialized', p_serialized,
      'acceptanceCriteria', v_acceptance
    )
  );

  artifact_id := v_artifact_id;
  created := true;
  uri := v_uri;
  sha256 := p_sha256;
  size_bytes := v_size;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION read_task_evidence_snapshot_v1(p_task_id UUID)
RETURNS TABLE (
  artifact_id UUID,
  task_id UUID,
  uri TEXT,
  serialized TEXT,
  sha256 TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_artifact artifacts%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_bundle JSONB;
  v_serialized TEXT;
  v_digest TEXT;
BEGIN
  SELECT * INTO v_artifact
  FROM artifacts
  WHERE artifacts.task_id = p_task_id
    AND artifact_type = 'EVIDENCE_BUNDLE_V1';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence task linkage is broken';
  END IF;

  v_serialized := v_artifact.metadata->>'serialized';
  IF v_serialized IS NULL OR octet_length(v_serialized) <> v_artifact.size_bytes THEN
    RAISE EXCEPTION 'evidence stored size mismatch';
  END IF;
  v_digest := encode(digest(convert_to(v_serialized, 'UTF8'), 'sha256'), 'hex');
  IF v_digest <> v_artifact.sha256::text THEN
    RAISE EXCEPTION 'evidence stored sha256 mismatch';
  END IF;

  BEGIN
    v_bundle := v_serialized::jsonb;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'evidence stored payload is invalid JSON';
  END;

  IF v_bundle #>> '{task,id}' IS DISTINCT FROM p_task_id::text
     OR v_bundle #>> '{task,status}' IS DISTINCT FROM v_task.status::text
     OR v_bundle #>> '{acceptanceCriteria,goal}' IS DISTINCT FROM v_task.goal THEN
    RAISE EXCEPTION 'evidence stored task linkage mismatch';
  END IF;

  artifact_id := v_artifact.id;
  task_id := v_artifact.task_id;
  uri := v_artifact.uri;
  serialized := v_serialized;
  sha256 := v_artifact.sha256::text;
  size_bytes := v_artifact.size_bytes;
  created_at := v_artifact.created_at;
  RETURN NEXT;
END;
$$;

COMMIT;
