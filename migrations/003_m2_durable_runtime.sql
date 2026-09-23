PRAGMA foreign_keys = ON;

-- M2 durable runtime: durable memory (spec 03), repository intelligence index
-- (spec 12) and observability/metrics support (spec 17).

CREATE TABLE IF NOT EXISTS memories (
  memory_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL','PROJECT','TASK','ATTEMPT','SESSION')),
  type TEXT NOT NULL CHECK (type IN ('WORKING','EPISODIC','SEMANTIC','PROJECT','PROCEDURAL','FAILURE')),
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('USER','MODEL','TOOL','REPOSITORY','GIT','TEST','SYSTEM','DERIVED')),
  confidence TEXT NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED','EXPIRED','UNCERTAIN','CONFLICTING','ARCHIVED')),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  supersedes TEXT REFERENCES memories(memory_id) ON DELETE RESTRICT,
  superseded_by TEXT REFERENCES memories(memory_id) ON DELETE RESTRICT,
  related_task_id TEXT REFERENCES tasks(task_id) ON DELETE RESTRICT,
  related_attempt_id TEXT REFERENCES attempts(attempt_id) ON DELETE RESTRICT,
  related_files_json TEXT NOT NULL,
  related_symbols_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_evidence (
  memory_evidence_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE RESTRICT,
  source TEXT NOT NULL,
  reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_relations (
  memory_relation_id TEXT PRIMARY KEY,
  from_memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE RESTRICT,
  to_memory_id TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('supports','contradicts','supersedes','derived_from','related_to')),
  created_at TEXT NOT NULL,
  UNIQUE(from_memory_id, to_memory_id, relation)
);

CREATE TABLE IF NOT EXISTS repository_files (
  file_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  path TEXT NOT NULL,
  language TEXT,
  size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  revision TEXT,
  indexed_at TEXT NOT NULL,
  UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS repository_symbols (
  symbol_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  file_id TEXT NOT NULL REFERENCES repository_files(file_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  location TEXT NOT NULL,
  signature TEXT,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  -- Symbol identity is project + file + kind + qualified name (spec 12 §3).
  UNIQUE(project_id, file_id, kind, qualified_name)
);

CREATE TABLE IF NOT EXISTS repository_index_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('FRESH','STALE','BUILDING','FAILED','UNKNOWN')),
  revision TEXT,
  indexed_at TEXT,
  file_count INTEGER NOT NULL,
  symbol_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- Repository evidence is immutable (spec 12 §9).
CREATE TABLE IF NOT EXISTS repository_evidence (
  evidence_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  reference TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_project_scope ON memories(project_id, scope, status);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory ON memory_evidence(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relations_from ON memory_relations(from_memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_relations_to ON memory_relations(to_memory_id);
CREATE INDEX IF NOT EXISTS idx_repository_files_project ON repository_files(project_id, path);
CREATE INDEX IF NOT EXISTS idx_repository_symbols_project ON repository_symbols(project_id, qualified_name);
