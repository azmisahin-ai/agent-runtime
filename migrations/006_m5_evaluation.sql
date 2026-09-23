PRAGMA foreign_keys = ON;

-- M5 evaluation & benchmarking (spec 06 §10). Runs, metrics and artifacts are
-- append-only; a run is immutable once recorded.

CREATE TABLE IF NOT EXISTS evaluation_runs (
  run_id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL,
  suite_version TEXT NOT NULL,
  task_pack_id TEXT NOT NULL,
  category TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  constraints_json TEXT NOT NULL,
  isolation_json TEXT NOT NULL,
  repository_revision TEXT,
  backend_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  context_config_json TEXT NOT NULL,
  memory_snapshot_json TEXT NOT NULL,
  tool_config_json TEXT NOT NULL,
  verification_config_json TEXT NOT NULL,
  baseline_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  verification TEXT NOT NULL,
  failure_category TEXT,
  primary_cause TEXT,
  secondary_causes_json TEXT NOT NULL,
  attribution_evidence_json TEXT NOT NULL,
  reproducible INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_metrics (
  metric_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evaluation_runs(run_id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evaluation_runs(run_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evaluation_runs(run_id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Integrity records: baseline digests and tamper observations (spec 06 §9).
CREATE TABLE IF NOT EXISTS evaluation_integrity (
  integrity_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  detected INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_suite ON evaluation_runs(suite_id, task_pack_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_category ON evaluation_runs(category);
CREATE INDEX IF NOT EXISTS idx_evaluation_metrics_run ON evaluation_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_artifacts_run ON evaluation_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_events_run ON evaluation_events(run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_integrity_run ON evaluation_integrity(run_id);
