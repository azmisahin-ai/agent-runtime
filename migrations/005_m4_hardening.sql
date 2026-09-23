PRAGMA foreign_keys = ON;

-- M4 reliability & security hardening: API idempotency for asynchronous
-- state-changing operations (spec 09 §5) and an immutable security audit trail
-- (spec 15 §13).

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, operation)
);

CREATE TABLE IF NOT EXISTS security_audit (
  audit_id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(project_id) ON DELETE RESTRICT,
  task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  attempt_id TEXT REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  principal TEXT,
  tool_name TEXT,
  details_json TEXT NOT NULL,
  previous_hash TEXT,
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_audit_task ON security_audit(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_type ON security_audit(event_type, created_at);
