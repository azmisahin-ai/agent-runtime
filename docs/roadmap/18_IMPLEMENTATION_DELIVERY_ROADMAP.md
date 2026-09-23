# 18 — Implementation & Delivery Roadmap

**Status:** MASTER IMPLEMENTATION ROADMAP

This document connects specifications 01–17 to executable milestones. It does not replace them.

## M0 — Foundation

TypeScript/Node project, SQLite/migrations, domain IDs/timestamps, Project/Task/Attempt, state machine, repository pattern, transaction manager, event store, config loader, logging and baseline tests.

**Current repository:** M0 is implemented and verified with the current unit suite.

## M1 — First Vertical Slice

Implement Task Engine integration, checkpointing, baseline context, Ollama backend, read/search tools, verification, structured events, restart/resume and first end-to-end evaluation.

**Current repository:** M1 is implemented and verified (checkpoint/resume, context engine, Ollama adapter, read/search/git tools, verification, recovery, evaluation, orchestrator). See `STATUS.md` and `docs/TRACEABILITY_MATRIX.md`.

## M2 — Durable Agent Runtime

Implement durable memory, context snapshots/compaction, complete Tool Engine, Git read tools, terminal execution, verification/recovery semantics, configuration snapshots and observability hardening. Network remains DENY by default.

**Current repository:** M2 is implemented and verified. Delivered: durable Memory Engine (persistence gate, provenance, supersession, conflict detection, flush, revalidation, project isolation), context compaction (dedup, priority preservation, flush-before-compact), the complete Tool Engine (`write_file`, `terminal.exec` — structured argv, deny-by-default, command allowlist, timeout, output bounds, secret redaction), resume configuration reconciliation (execution-sensitive drift forces PAUSE and a new Attempt), repository intelligence (file/symbol index, freshness, immutable evidence), and an observability layer (correlated structured logs, secret-redacted, plus metrics). Network and process execution remain DENY by default and widen only via explicit flags. See `STATUS.md` and `docs/TRACEABILITY_MATRIX.md`.

## M3 — Intelligence Layer

Repository symbols/dependency graph, affected scope analysis, Git intelligence, memory ranking/reconciliation, richer context retrieval and repository evidence freshness.

**Current repository:** M3 is implemented and verified. Delivered: the repository dependency graph (`repository_edges`, IMPORTS/EXPORTS, forward and reverse queries, cycles tolerated), test discovery and test→implementation linking (`repository_tests`), `AffectedScopeAnalyzer` (bounded transitive reverse-dependency closure, truncation reported), combined `RepositorySearch` (filename/stem/path + symbol ranking), richer context retrieval (`ContextRetriever` turning memory and repository results into prioritised, provenanced, staleness-visible sections), Git intelligence (changed files, diff, recent commits, all structured-argv), `RepositoryReconciler` (FRESH/STALE/UNKNOWN freshness, stale index used only as explicit historical evidence), and memory ranking/reconciliation against current repository truth (drifted file-backed memory becomes UNCERTAIN, never deleted; UNKNOWN does not invalidate). The scanner never follows symlinks and the project root remains a hard boundary. See `STATUS.md` and `docs/TRACEABILITY_MATRIX.md`.

## M4 — Reliability & Security Hardening

Sandboxing, policy engine, secret handling, prompt-injection defenses, persistence failure handling, backend/tool crashes, workspace reconciliation, destructive-operation controls and security adversarial testing.

## M5 — Evaluation & Benchmarking

20-task initial suite, reproducibility metadata, evaluation artifacts, regression runner, failure attribution and model/backend/context/memory comparisons under controlled conditions.

## V0.1 Release Candidate

All core subsystems implemented, integrated and covered by unit/integration/adversarial/recovery/e2e tests. Documentation, status and traceability agree with actual code.

## Development order

1. repository bootstrap
2. database
3. domain model
4. event store
5. state machine
6. config/policy primitives
7. project/task services
8. checkpoint
9. backend abstraction
10. Ollama backend
11. tool engine
12. context engine
13. verification
14. recovery
15. memory
16. repository intelligence
17. observability
18. API
19. evaluation
20. security hardening
21. benchmark suite
22. release

## Master invariants

1. UNKNOWN != SUCCESS.
2. Model != Runtime.
3. Agent != Runtime.
4. External agent != Runtime authority.
5. Tool request != tool execution.
6. Task != Attempt.
7. Terminal state != RUNNING.
8. Retry = new Attempt.
9. Verification PASS required for SUCCESS.
10. Security policy = default deny.
11. Most restrictive policy wins.
12. Secrets != Context.
13. Secrets != Telemetry.
14. Event history = append-only.
15. Configuration snapshot = immutable.
16. Active Attempt semantics cannot silently change.
17. Repository content != Runtime policy.
18. Persistence failure cannot be silently ignored.
19. Runtime owns continuity.
20. Evidence outranks claims.

## Definition of Done

A milestone is complete only when implementation, tests, documentation, status and traceability agree. A feature described by the architecture but absent from code must remain marked PLANNED/PARTIAL.

## Handoff rule

Another agent must continue from the repository itself. The correct entry sequence is:

```text
AGENTS.md
  ↓
STATUS.md
  ↓
TRACEABILITY_MATRIX.md
  ↓
relevant docs/specifications/01–17
  ↓
this roadmap (18)
  ↓
source + tests
  ↓
implement next milestone
```
