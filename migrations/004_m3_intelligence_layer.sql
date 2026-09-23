PRAGMA foreign_keys = ON;

-- M3 intelligence layer: repository dependency graph and test index (spec 12 §4, §5).

CREATE TABLE IF NOT EXISTS repository_edges (
  edge_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('IMPORTS','EXPORTS','REFERENCES','CALLS','EXTENDS','IMPLEMENTS','USES_TYPE','TESTS')),
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  from_symbol_id TEXT REFERENCES repository_symbols(symbol_id) ON DELETE RESTRICT,
  to_symbol_id TEXT REFERENCES repository_symbols(symbol_id) ON DELETE RESTRICT,
  revision TEXT,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_tests (
  test_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  test_path TEXT NOT NULL,
  test_name TEXT,
  target_path TEXT,
  target_symbol_id TEXT REFERENCES repository_symbols(symbol_id) ON DELETE RESTRICT,
  revision TEXT,
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repository_edges_from ON repository_edges(project_id, from_path, kind);
CREATE INDEX IF NOT EXISTS idx_repository_edges_to ON repository_edges(project_id, to_path, kind);
CREATE INDEX IF NOT EXISTS idx_repository_tests_target ON repository_tests(project_id, target_path);
