PRAGMA foreign_keys = ON;

-- M1 vertical slice: checkpoints, config snapshots, sessions, tool runs,
-- context snapshots, verifications and evaluations (specs 04,05,06,08,09,10,11,16).

CREATE TABLE IF NOT EXISTS checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  state TEXT NOT NULL,
  current_goal TEXT NOT NULL,
  current_step TEXT NOT NULL,
  repository_revision TEXT,
  git_state_json TEXT NOT NULL,
  memory_refs_json TEXT NOT NULL,
  context_snapshot_id TEXT,
  pending_action_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config_snapshots (
  config_snapshot_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL,
  profile TEXT NOT NULL,
  effective_config_json TEXT NOT NULL,
  effective_policy_json TEXT NOT NULL,
  backend_id TEXT NOT NULL,
  model TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  config_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(attempt_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  backend_id TEXT NOT NULL,
  external_session_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_runs (
  tool_run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','VALIDATING','VALIDATED','AUTHORIZED','RUNNING','SUCCEEDED','FAILED','TIMEOUT','DENIED','CANCELLED','UNKNOWN')),
  permission TEXT NOT NULL,
  output TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  context_snapshot_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  context_hash TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  retrieval_query TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  verification_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','UNKNOWN')),
  checks_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  evaluation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  backend_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  repository_revision TEXT,
  runtime_config_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  verification TEXT NOT NULL,
  failure_category TEXT,
  evidence_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_runs_attempt ON tool_runs(attempt_id);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_attempt ON context_snapshots(attempt_id);
CREATE INDEX IF NOT EXISTS idx_verifications_attempt ON verifications(attempt_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_task ON evaluations(task_id);
CREATE INDEX IF NOT EXISTS idx_config_snapshots_task ON config_snapshots(task_id);
