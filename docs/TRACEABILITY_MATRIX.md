# Traceability Matrix

**Purpose:** connect normative requirements to implementation and proof without claiming unimplemented work is complete.

| Requirement | Specification | Current implementation | Proof / test | Status |
|---|---|---|---|---|
| Task ≠ Attempt | 02, 13 | `src/domain/types.ts`, persistence | `tests/unit/persistence.test.ts` | PASS (M0) |
| Central task state machine | 02, 13 | `src/domain/state-machine.ts` | `tests/unit/state-machine.test.ts` | PASS (M0) |
| Terminal state protection | 02, 13 | state machine | state-machine test | PASS (M0) |
| Retry = new Attempt | 02, 11, 13 | Attempt lifecycle + numbering; retry path in orchestrator | `tests/unit/persistence.test.ts`, `tests/e2e/vertical-slice.test.ts` | PASS (M1) |
| Atomic task/event persistence | 08, 17 | TaskService + repositories/event store | `tests/unit/persistence.test.ts` | PASS (M0) |
| Append-only event history | 08, 17 | `src/events/event-store.ts` | persistence test + M1 event tests | PASS (M1) |
| Checkpoint/resume | 02, 07, 11, 13, 14 | `src/persistence/checkpoint-repository.ts`, `src/runtime/orchestrator.ts` (resume) | `tests/unit/checkpoint.test.ts`, e2e resume test | PASS (M1) |
| UNKNOWN ≠ SUCCESS | 02, 06, 11 | verification engine + orchestrator completion gate | `tests/unit/verification.test.ts`, e2e verification tests | PASS (M1) |
| Tool request policy boundary | 10, 15 | `src/tools/tool-engine.ts` | `tests/adversarial/tools-security.test.ts` | PASS (M1) |
| Default deny | 10, 15 | `src/tools/policy.ts`, `src/config/config.ts` | `tests/adversarial/tools-security.test.ts`, `tests/adversarial/hardening.test.ts` | PASS (M1) |
| Context budget | 04 | `src/context/context-engine.ts` | `tests/unit/context-engine.test.ts` | PASS (M1) |
| Memory provenance/supersession | 03 | `src/memory/memory-engine.ts`, `src/memory/memory-policy.ts`, `src/persistence/memory-repository.ts` | `tests/unit/memory.test.ts`, `tests/e2e/durable-runtime.test.ts` | PASS (M2) |
| Memory persistence gate / no secrets | 03, 15 | `src/memory/memory-policy.ts`, `src/security/secret-redaction.ts` | memory + secret-redaction tests | PASS (M2) |
| Memory conflict handling | 03 | `src/memory/memory-engine.ts` (polarity contradiction) | memory test (contradictions) | PASS (M2) |
| Repository evidence/freshness | 12 | `src/repository/repository-scanner.ts`, `src/persistence/repository-index-repository.ts` | `tests/unit/repository-index.test.ts`, e2e index test | PASS (M2) |
| Repository dependency graph / affected scope | 12 | `src/repository/repository-scanner.ts` (edges+tests), `src/repository/repository-search.ts` (`AffectedScopeAnalyzer`), `src/persistence/repository-index-repository.ts` | `tests/unit/repository-intelligence.test.ts`, adversarial suite | PASS (M3) |
| Repository search ranking | 12 | `src/repository/repository-search.ts` (`RepositorySearch`) | `tests/unit/repository-intelligence.test.ts` | PASS (M3) |
| Repository test discovery | 12 | `src/repository/repository-scanner.ts` (`indexTests`), `repository_tests` | `tests/unit/repository-intelligence.test.ts` | PASS (M3) |
| Repository reconciler / stale index | 12 | `src/repository/repository-reconciler.ts` | `tests/unit/repository-reconciler.test.ts` | PASS (M3) |
| Git intelligence (changes/diff/commits) | 12 | `src/git/git-inspector.ts` | `tests/unit/repository-reconciler.test.ts` | PASS (M3) |
| Memory ranking + repository-backed reconciliation | 03, 12 | `src/memory/memory-engine.ts` (`reconcileWithRepository`), `src/memory/memory-policy.ts` | `tests/unit/memory.test.ts` | PASS (M3) |
| Context retrieval integration | 04, 12 | `src/context/context-retriever.ts`, orchestrator `buildContext` | `tests/unit/context-retriever.test.ts`, e2e | PASS (M3) |
| Affected scope in verification | 11, 12 | `src/verification/verification-engine.ts`, orchestrator | `tests/e2e/durable-runtime.test.ts` | PASS (M3) |
| Runtime HTTP+JSON API | 09 | `src/api/server.ts`, `src/api/runtime-api.ts`, `src/api/dto.ts`, `src/api/errors.ts` | `tests/e2e/runtime-api.test.ts` | PASS (M4) |
| API idempotency | 09 | `src/persistence/idempotency-store.ts`, `migrations/005_m4_hardening.sql` | `tests/e2e/runtime-api.test.ts` | PASS (M4) |
| SSE event streaming / resume | 09 | `src/api/server.ts` (`streamEvents`) | `tests/e2e/runtime-api.test.ts` | PASS (M4) |
| Workspace lock (single writer) | 14 | `src/runtime/workspace-lock.ts`, orchestrator | `tests/adversarial/hardening.test.ts` | PASS (M4) |
| Security audit trail (hash chain) | 15 | `src/security/security-audit.ts`, `migrations/005_m4_hardening.sql` | `tests/adversarial/hardening.test.ts` | PASS (M4) |
| Client cannot supply checks / widen policy | 09, 11, 15 | `src/api/runtime-api.ts`, `src/api/server.ts`, `src/tools/policy.ts` | `tests/e2e/runtime-api.test.ts`, `tests/adversarial/hardening.test.ts` | PASS (M4) |
| API error contract (typed codes + retryable + HTTP mapping) | 09 | `src/api/errors.ts`, `src/api/server.ts` | `tests/e2e/runtime-api.test.ts` (PERMISSION_DENIED, TASK_INVALID_STATE, CONFLICT, INVALID_REQUEST, NOT_FOUND + retryable) | PASS (M4) |
| Destructive-operation controls (Git deny-by-default) | 15 | `src/security/destructive-operations.ts`, `src/tools/builtin-tools.ts` (`authorizeGit`), `src/config/config.ts` | `tests/adversarial/m4-remainder.test.ts` | PASS (M4 remainder) |
| Process sandbox (single chokepoint, explicit env, bounded) | 15 | `src/security/process-sandbox.ts`, `src/tools/builtin-tools.ts` (`runCommand`), `src/runtime/bootstrap.ts` | `tests/adversarial/m4-remainder.test.ts` | PASS (M4 remainder) |
| Persistence-failure handling (durability precondition) | 13 | `src/security/persistence-guard.ts`, `src/runtime/orchestrator.ts` (`assertDurable`) | `tests/adversarial/m4-remainder.test.ts` | PASS (M4 remainder) |
| Backend abstraction | 05 | `src/backends/agent-backend.ts` | `tests/integration/ollama-backend.test.ts`, `tests/e2e/vertical-slice.test.ts` | PASS (M1) |
| Ollama adapter | 05, 07 | `src/backends/ollama-backend.ts` | `tests/integration/ollama-backend.test.ts` | PASS (M1) |
| Verification independent of claims | 11 | `src/verification/verification-engine.ts` | `tests/unit/verification.test.ts`, `tests/e2e/vertical-slice.test.ts` | PASS (M1) |
| Recovery creates new attempts | 11, 13 | `src/recovery/recovery-engine.ts`, orchestrator | `tests/recovery/recovery.test.ts`, e2e retry test | PASS (M1) |
| Config snapshot immutability | 16 | `src/persistence/config-snapshot-repository.ts` | checkpoint/config test | PASS (M1) |
| Security trust levels | 15 | path guard + policy engine; untrusted-data framing in context | adversarial suite, context tests | PASS (M1) |
| Structured observability | 17 | `src/observability/logger.ts` (correlated, secret-redacted logs + metrics), event store | `tests/unit/observability.test.ts`, persistence + evaluation tests | PASS (M2) |
| Secret redaction | 15, 17 | `src/security/secret-redaction.ts`; applied to logs, memory and tool output | `tests/unit/secret-redaction.test.ts` | PASS (M2) |
| Write tool (policy-gated) | 10, 15 | `src/tools/builtin-tools.ts` (`write_file`) + policy/path guard | `tests/e2e/durable-runtime.test.ts`, adversarial suite | PASS (M2) |
| Terminal execution (policy-gated) | 10, 15 | `src/tools/builtin-tools.ts` (`terminal.exec`) + command allowlist | adversarial suite, e2e allowlist test | PASS (M2) |
| Context compaction / flush | 04, 03 | `src/context/compactor.ts` | `tests/unit/compaction.test.ts` | PASS (M2) |
| Config reconciliation on resume | 16 | `src/config/config-reconciler.ts`, orchestrator resume | `tests/unit/config-reconciler.test.ts`, e2e drift test | PASS (M2) |
| Evaluation reproducibility | 06 | `src/evaluation/evaluation-recorder.ts`, `src/evaluation/evaluation-runner.ts` (baseline hash, run metadata, `migrations/006_m5_evaluation.sql`) | `tests/evaluation/evaluation.test.ts`, `tests/e2e/evaluation-api.test.ts` | PASS (M5) |
| 20-task initial suite | 06 | `src/evaluation/suite.ts` (`INITIAL_SUITE`) | `tests/evaluation/evaluation.test.ts` (20 tasks, 5 per category) | PASS (M5) |
| Evaluation metrics | 06 | `src/evaluation/metrics.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Evaluation ordering invariant (UNKNOWN != SUCCESS/PASS) | 06 | `src/evaluation/evaluation-runner.ts`, `src/evaluation/metrics.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Failure attribution | 06 | `src/evaluation/failure-classifier.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Benchmark integrity / tamper detection | 06 | `src/evaluation/integrity.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Evaluation artifacts (content-addressed) | 06 | `src/evaluation/artifact-store.ts`, `evaluation_artifacts` | `tests/evaluation/evaluation.test.ts`, e2e | PASS (M5) |
| Immutable evaluation evidence (append-only) | 06 | `src/persistence/evaluation-run-repository.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Evaluation reporting / comparison (no universal score) | 06 | `src/evaluation/reporter.ts` | `tests/evaluation/evaluation.test.ts` (per-category summary, signed per-dimension deltas), `tests/e2e/evaluation-api.test.ts` | PASS (M5) |
| Regression runner | 06 | `src/evaluation/regression-runner.ts` | `tests/evaluation/evaluation.test.ts` | PASS (M5) |
| Suite execution through the real runtime | 06 | `src/evaluation/runtime-executor.ts`, orchestrator | `tests/e2e/evaluation-api.test.ts` | PASS (M5) |
| Read-only evaluation API | 06, 09 | `src/api/runtime-api.ts`, `src/api/server.ts` | `tests/e2e/evaluation-api.test.ts` | PASS (M5) |
| Runtime owns continuity | 02, 14 | orchestrator state control + checkpoint/resume | e2e lifecycle tests | PASS (M1) |
| Data classification (PUBLIC/PROJECT/SENSITIVE/SECRET across persistence, context, logging, artifacts) | 15 §12 | `src/security/data-classification.ts`; gates in `src/memory/memory-policy.ts`, `src/context/context-engine.ts`, `src/observability/logger.ts`, `src/evaluation/artifact-store.ts` | `tests/adversarial/data-classification.test.ts` | PASS (M4 remainder) |

## Known gaps

These normative requirements are specified but **not implemented**. They are listed
here rather than given a PASS row so the matrix cannot be read as complete coverage.

| Requirement | Specification | State |
|---|---|---|
| External agent (ACP/CLI/native) integration with runtime-owned vs externally-owned tool documentation | 05 §8, 15 §11 | PLANNED — capability flags (`acp`, `nativeFilesystem`, `nativeTerminal`, `nativeGit`) exist on the backend contract and default to `false`, but no external-agent adapter ships in V0.1 |
| Distributed traces / causal timing structure | 17 §7 | PARTIAL — structured logs carry correlation IDs and metrics exist; there is no span/trace export. Canonical events are unaffected by a trace outage by construction |
| Live-model benchmark execution | 06 | PARTIAL — the harness runs through the real orchestrator, but no live model is available in the build environment (Ollama absent); verified against an in-process fake server |

## Status definitions

- **PASS:** implemented and directly tested in the current repository.
- **PARTIAL:** a subset is implemented; the full normative requirement remains.
- **FOUNDATIONAL:** architecture/primitive exists but downstream proof is incomplete.
- **PLANNED:** specified and scheduled, not implemented yet.

This matrix must be updated whenever a milestone changes implementation status.
