# Agent Runtime — Status

**Last repository checkpoint:** M5 evaluation & benchmarking (suite, runner, metrics, integrity, regression)
**Current milestone:** M5 complete / V0.1 release candidate next

## Verified implementation

- Git repository with real history
- TypeScript/Node foundation
- SQLite migrations (001 foundation, 002 vertical slice, 003 durable runtime, 004 intelligence layer)
- Project / Task / Attempt domain model
- Central task state machine with terminal-state protection
- Append-only event store
- Transactional TaskService and repositories
- Configuration loader (default-deny network and process execution)
- Backend abstraction (`AgentBackend`) and baseline Ollama adapter
- Tool Engine: schema validation, default-deny policy, path guard, built-ins (read/list/search/git)
- Complete Tool Engine: `write_file` (policy-gated, path-guarded) and `terminal.exec` (structured argv, command allowlist, timeout, bounded output, secret redaction)
- Context Engine with budgeting and untrusted-data framing
- Context compaction: dedup, mandatory-section preservation, flush-before-compact
- Verification engine (UNKNOWN != PASS) with affected-scope evidence persistence
- Recovery engine and checkpoint/resume with crash reconciliation
- Resume configuration reconciliation (execution-sensitive drift forces PAUSE)
- Durable Memory Engine: persistence gate, provenance, supersession, conflict detection, flush, revalidation, project isolation
- Memory ranking and repository-backed reconciliation (drifted file-backed memory → UNCERTAIN, never deleted)
- Repository intelligence: file/symbol index, FRESH/STALE/UNKNOWN freshness, immutable content-addressed evidence
- Repository dependency graph (IMPORTS/EXPORTS edges, forward and reverse queries, cycles tolerated)
- Repository test discovery and test→implementation linking
- Affected-scope analysis: bounded transitive reverse-dependency closure with truncation reporting
- Combined repository search (filename/stem/path + symbol ranking)
- Git intelligence: changed files, diff, recent commits (structured argv, no shell)
- RepositoryReconciler: post-change freshness reconciliation; stale index is explicit historical evidence
- Context retrieval integration: memory + repository results become prioritised, provenanced sections
- Observability: correlated, secret-redacted structured logs and a metrics registry
- Secret redaction across logs, memory and tool output
- Config snapshot, context snapshot, tool-run and evaluation persistence
- Runtime orchestrator (runtime owns Task state and completion)
- Runtime HTTP+JSON API under `/api/v1` (spec 09): projects/tasks, async idempotency-key-protected start/pause/resume/cancel/retry, run, events, SSE stream with resume-after-sequence, attempts/checkpoints/tools/evaluations, repository status, backend capabilities
- API authentication (bearer token; mutations disabled without a configured token), typed error contract, DTOs separate from domain entities
- Client cannot supply verification checks or widen policy; runtime-owned checks are host-configured
- WorkspaceLock: exclusive single-writer lock with dead-holder reclaim
- Idempotency store for asynchronous state-changing operations
- Tamper-evident hash-chained security audit trail
- M5 Evaluation & Benchmarking (spec 06): 20-task initial suite (5 repository-analysis, 5 bug-fix, 5 test-fix, 5 feature) with expected behavior, verification intent, constraints and isolation
- `EvaluationRunner`: immutable evaluation runs with reproducibility metadata (suite version, model/backend, repository revision, context/memory/tool/verification configuration, baseline hash) and per-run metrics/artifacts/integrity observations
- Append-only evaluation persistence (`evaluation_runs`, `evaluation_metrics`, `evaluation_artifacts`, `evaluation_events`, `evaluation_integrity`); no update or delete path
- `EvaluationMetrics`: success/first-attempt/verification rates, latency mean/median/p95, tool calls/failures/denials/timeouts, recovery attempts, human interventions, context relevance/duplication ratios, memory hits/misses; no universal score
- `FailureClassifier`: evidence-cited primary and secondary failure attribution (UNKNOWN is not PASS)
- `IntegrityChecker`: test tampering, verification bypass, side effects and baseline-mismatch detection
- `EvaluationReporter` (per-category dimensions and suite comparison), `RegressionRunner` (baseline drop detection with re-derived attribution), `ArtifactStore`, `RuntimeEvaluationExecutor` (runs suite tasks through the real orchestrator)
- Read-only evaluation API under `/api/v1/evaluations` (suite, runs, run detail, report, compare)
- M0–M5 unit/integration/adversarial/recovery/e2e tests (155 passing)
- Architecture specifications 01–17, roadmap 18, traceability matrix, handoff instructions

## Not yet implemented

- OS-level sandboxing for tool execution and broader destructive-operation controls (M4 remainder)
- Persistence-failure injection and backend/tool crash hardening beyond current guards (M4 remainder)
- Live-model benchmark execution: the M5 harness runs through the real orchestrator, but a live Ollama model is not available in this environment, so suite runs are exercised with a scripted backend
- Multi-provider backends beyond Ollama

## Next exact work

1. Install dependencies if missing.
2. Run `npm run check` (must be green: build + tests).
3. Finish M4 remainder: OS-level tool sandboxing, persistence-failure injection, destructive-Git controls.
4. Begin V0.1 release-candidate consolidation (spec 17): documentation, status and traceability agreement; live-model benchmark run when Ollama is available.
5. Update status + traceability after each coherent slice.

## Environment notes

- Ollama is **not installed** in the current environment. The Ollama adapter is
  verified against an in-process fake HTTP server (`tests/integration/ollama-backend.test.ts`),
  not a live model. Live-model validation requires running Ollama separately.
- Default network policy is DENY; process execution and filesystem writes are disabled
  by default and widen only via explicit flags
  (`AGENT_RUNTIME_ALLOW_PROCESS`, `AGENT_RUNTIME_ALLOW_NETWORK`,
  `AGENT_RUNTIME_GRANTED_CAPABILITIES`, `AGENT_RUNTIME_ALLOWED_COMMANDS`).

## Important interpretation

The repository is a self-contained architecture + implementation handoff. Specifications
describe the target; source and tests prove the current milestone. M0, the M1 vertical
slice, M2 durable runtime, M3 intelligence layer, the M4 API/locking/audit slice, and
the M5 evaluation & benchmarking layer are implemented and tested; the remainder of M4
(OS-level sandboxing, persistence-failure injection, destructive-Git controls) and the
V0.1 release-candidate consolidation remain planned.
