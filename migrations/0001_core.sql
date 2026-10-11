BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE execution_status AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'FAIL_WITH_EVIDENCE',
    'BLOCKED',
    'AWAITING_APPROVAL',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE registry_readiness AS ENUM (
    'UNTESTED',
    'READY',
    'NEEDS_SECRET',
    'DISABLED',
    'DEGRADED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  goal TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status execution_status NOT NULL DEFAULT 'PENDING',

  budget_limit_usd NUMERIC(12, 6) NOT NULL,
  reserved_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  current_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,

  token_budget_limit BIGINT,
  reserved_tokens BIGINT NOT NULL DEFAULT 0,
  current_tokens BIGINT NOT NULL DEFAULT 0,

  max_total_steps INTEGER NOT NULL DEFAULT 50,
  current_steps INTEGER NOT NULL DEFAULT 0,
  deadline_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminal_at TIMESTAMPTZ,

  CONSTRAINT tasks_budget_nonnegative CHECK (
    budget_limit_usd >= 0 AND reserved_cost_usd >= 0 AND current_cost_usd >= 0
  ),
  CONSTRAINT tasks_budget_invariant CHECK (
    current_cost_usd + reserved_cost_usd <= budget_limit_usd
  ),
  CONSTRAINT tasks_tokens_nonnegative CHECK (
    reserved_tokens >= 0 AND current_tokens >= 0 AND
    (token_budget_limit IS NULL OR token_budget_limit >= 0)
  ),
  CONSTRAINT tasks_token_budget_invariant CHECK (
    token_budget_limit IS NULL OR current_tokens + reserved_tokens <= token_budget_limit
  ),
  CONSTRAINT tasks_steps_valid CHECK (
    max_total_steps > 0 AND current_steps >= 0 AND current_steps <= max_total_steps
  )
);

CREATE TABLE IF NOT EXISTS task_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_key VARCHAR(128) NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  skill_ids TEXT[] NOT NULL DEFAULT '{}',

  status execution_status NOT NULL DEFAULT 'PENDING',
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data JSONB,
  last_error JSONB,

  lease_owner VARCHAR(128),
  lease_token UUID,
  lease_acquired_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,

  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,

  reserved_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  reserved_tokens BIGINT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  CONSTRAINT task_nodes_task_id_id_unique UNIQUE (task_id, id),
  CONSTRAINT task_nodes_task_key_unique UNIQUE (task_id, node_key),
  CONSTRAINT task_nodes_attempts_valid CHECK (
    attempt >= 0 AND max_attempts > 0 AND attempt <= max_attempts
  ),
  CONSTRAINT task_nodes_reservations_nonnegative CHECK (
    reserved_cost_usd >= 0 AND reserved_tokens >= 0
  )
);

CREATE TABLE IF NOT EXISTS task_node_dependencies (
  task_id UUID NOT NULL,
  node_id UUID NOT NULL,
  parent_node_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id, parent_node_id),
  CONSTRAINT task_node_dependencies_not_self CHECK (node_id <> parent_node_id),
  CONSTRAINT task_node_dependencies_child_fk
    FOREIGN KEY (task_id, node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE,
  CONSTRAINT task_node_dependencies_parent_fk
    FOREIGN KEY (task_id, parent_node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_accounting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_key VARCHAR(160) NOT NULL UNIQUE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  lease_token UUID NOT NULL,

  provider VARCHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  pricing_version VARCHAR(64) NOT NULL,
  provider_request_id VARCHAR(256),

  prompt_cache_hit_tokens BIGINT NOT NULL DEFAULT 0,
  prompt_cache_miss_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL DEFAULT 0,

  reserved_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12, 6) NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT llm_accounting_node_fk
    FOREIGN KEY (task_id, node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE,
  CONSTRAINT llm_accounting_nonnegative CHECK (
    prompt_cache_hit_tokens >= 0 AND
    prompt_cache_miss_tokens >= 0 AND
    completion_tokens >= 0 AND
    total_tokens >= 0 AND
    reserved_cost_usd >= 0 AND
    cost_usd >= 0 AND
    latency_ms >= 0
  )
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_id UUID,
  artifact_type VARCHAR(64) NOT NULL,
  uri TEXT NOT NULL,
  sha256 CHAR(64),
  mime_type VARCHAR(255),
  size_bytes BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT artifacts_node_fk
    FOREIGN KEY (task_id, node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE,
  CONSTRAINT artifacts_size_valid CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS registry_agents (
  id VARCHAR(128) PRIMARY KEY,
  version VARCHAR(64) NOT NULL,
  role TEXT NOT NULL,
  source_path TEXT,
  content_sha256 CHAR(64),
  readiness registry_readiness NOT NULL DEFAULT 'UNTESTED',
  risk_level VARCHAR(32) NOT NULL DEFAULT 'LOW',
  required_tools TEXT[] NOT NULL DEFAULT '{}',
  required_secrets TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS registry_skills (
  id VARCHAR(128) PRIMARY KEY,
  version VARCHAR(64) NOT NULL,
  purpose TEXT NOT NULL,
  source_path TEXT,
  content_sha256 CHAR(64),
  readiness registry_readiness NOT NULL DEFAULT 'UNTESTED',
  risk_level VARCHAR(32) NOT NULL DEFAULT 'LOW',
  required_tools TEXT[] NOT NULL DEFAULT '{}',
  required_secrets TEXT[] NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  node_id UUID NOT NULL,
  action_type VARCHAR(128) NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision VARCHAR(32),
  decision_payload JSONB,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,

  CONSTRAINT approval_requests_node_fk
    FOREIGN KEY (task_id, node_id)
    REFERENCES task_nodes(task_id, id)
    ON DELETE CASCADE,
  CONSTRAINT approval_requests_decision_valid CHECK (
    decision IS NULL OR decision IN ('APPROVED', 'REJECTED', 'CANCELLED')
  )
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline
  ON tasks(status, deadline_at);

CREATE INDEX IF NOT EXISTS idx_task_nodes_claim
  ON task_nodes(status, lease_until, created_at)
  WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_task_nodes_task_status
  ON task_nodes(task_id, status);

CREATE INDEX IF NOT EXISTS idx_dependencies_parent
  ON task_node_dependencies(parent_node_id);

CREATE INDEX IF NOT EXISTS idx_accounting_task_node
  ON llm_accounting(task_id, node_id, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_task
  ON artifacts(task_id, created_at);

COMMIT;
