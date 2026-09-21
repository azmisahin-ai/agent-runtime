# 03 — Memory Engine Specification

**Status:** NORMATIVE

## 1. Purpose

Memory provides durable, scoped, provenance-aware information continuity. It is not simply a vector database and it must distinguish current facts from superseded or uncertain information.

Lifecycle:

`OBSERVE → UNDERSTAND → PERSIST → RETRIEVE → RECONCILE → UPDATE`

## 2. Memory types

- `WORKING`
- `EPISODIC`
- `SEMANTIC`
- `PROJECT`
- `PROCEDURAL`
- `FAILURE`

Scopes: `GLOBAL`, `PROJECT`, `TASK`, `ATTEMPT`, `SESSION`.

## 3. Canonical record

```text
memory_id
project_id
scope
type
content
source
created_at
updated_at
confidence
status
valid_from
valid_until
supersedes
superseded_by
related_task_id
related_attempt_id
related_files
related_symbols
```

Sources: USER, MODEL, TOOL, REPOSITORY, GIT, TEST, SYSTEM, DERIVED. Confidence: LOW/MEDIUM/HIGH. Status: ACTIVE/SUPERSEDED/EXPIRED/UNCERTAIN/CONFLICTING/ARCHIVED.

## 4. Persistence gate

The model does not directly insert durable memory. A `ShouldPersist()` gate evaluates durability, reuse value, project relevance, information value, decision/failure relevance and provenance. Secrets are always excluded/redacted.

## 5. Retrieval

```text
query
 ↓ scope/type filters
 ↓ lexical/semantic candidates
 ↓ relation + validity filters
 ↓ ranking
 ↓ Context Engine
```

Vector similarity is never authoritative. Ranking combines relevance, scope, validity, confidence, recency and source quality.

## 6. Supersession and conflicts

A new fact can supersede an older fact without deleting it. The old record remains available for audit/history. Contradictions create explicit conflict relationships. `UNKNOWN` revalidation does not automatically invalidate a memory.

Relations: `supports`, `contradicts`, `supersedes`, `derived_from`, `related_to`.

## 7. Repository-backed truth

Current repository evidence can outrank stale memory for current project state. Memory records retain evidence references where possible.

## 8. Compaction integration

```text
Context Pressure
 → Compaction Requested
 → Memory Flush
 → Persist Durable Facts
 → Memory Flush Complete
 → Context Compaction
 → New Context
```

Flush failure is explicit; it cannot be silently ignored.

## 9. Audit events

`MemoryCandidateCreated`, `MemoryValidated`, `MemoryPersisted`, `MemoryRetrieved`, `MemorySuperseded`, `MemoryExpired`, `MemoryConflictDetected`, `MemoryRevalidated`, `MemoryConsolidated`, `MemoryFlushStarted`, `MemoryFlushCompleted`, `MemoryFlushFailed`.

## 10. V0.1 components

`MemoryStore`, `MemoryRepository`, `MemoryRetriever`, `MemoryRanker`, `MemoryValidator`, `ConflictResolver`, `SupersessionManager`, `MemoryFlush`, `MemoryAudit`.

## 11. Invariants

- Provenance is required.
- Superseded records are retained.
- Validity is explicit.
- Project isolation is enforced.
- Similarity is not authority.
- Memory flush precedes context compaction.
- Flush failure is observable.
- Conflicts preserve old and new evidence.
- Raw hidden reasoning is not automatically durable memory.
- Secrets never enter durable memory.

## 12. Acceptance focus

Persistence/retrieval across restart, supersession, historical retention, project isolation, compaction flush, flush failure, false semantic similarity, provenance, failure memory, conflict handling and secret redaction must be tested.
