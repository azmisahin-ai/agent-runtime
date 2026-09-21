# 08 — Data Model & Database Schema

**Status:** NORMATIVE

## 1. Canonical store

SQLite is the V0.1 canonical persistence layer.

Recommended settings:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

IDs are opaque UUID-like identifiers. Timestamps are UTC.

## 2. Tables

`projects`, `tasks`, `attempts`, `sessions`, `events`, `checkpoints`, `memories`, `memory_evidence`, `memory_relations`, `context_snapshots`, `tool_runs`, `evaluations`, `evaluation_metrics`, `schema_migrations`.

Repository-specific tables are added by the Repository Intelligence milestone.

## 3. Core relationships

```text
PROJECT → TASK → ATTEMPT
                   ├→ CONTEXT SNAPSHOT
                   ├→ TOOL RUNS
                   ├→ CHECKPOINTS
                   ├→ VERIFICATION
                   └→ EVALUATION
```

## 4. Task

`task_id`, `project_id`, title, description, state, current_attempt_id, current_checkpoint_id, created_at, updated_at.

States are those defined by the lifecycle specification.

## 5. Attempt

`attempt_id`, `task_id`, `attempt_number`, `backend_id`, `model`, start/end timestamps, outcome and verification. `(task_id, attempt_number)` is unique.

## 6. Events

Append-only `events` table with project/task/attempt IDs, type, timestamp, source and JSON payload. Add a monotonic `sequence_number` for deterministic ordering. Event payloads include schema version.

## 7. Checkpoint

Stores task/attempt, state, current goal/step, relevant memory references, repository revision, Git state, context snapshot and pending action.

## 8. Context snapshot

Stores model, token count, context hash, serialized sections and retrieval query. Hash is SHA-256 over canonical serialization.

## 9. Memory/tool/evaluation tables

Follow specifications 03, 10 and 06. Structured/queryable state must remain relational; JSON is for flexible payloads and snapshots, not hiding canonical state.

## 10. Transactions

Atomic transactions are required for: task creation + event; state transition + event; tool completion + event; verification + evaluation; checkpoint + required memory flush.

## 11. Integrity

Use foreign keys, uniqueness constraints, restricted deletion and explicit status/outcome combinations. A successful Attempt requires verification PASS. Execution evidence is archived rather than silently deleted.

## 12. Migration

`schema_migrations` records ordered migrations such as `001_initial.sql`. Startup: open DB → configure → migrate → validate schema → initialize repositories → READY.

## 13. Diagnostics

Startup and maintenance checks must identify orphaned records, invalid states, failed migrations and inconsistent references.
