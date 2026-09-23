# Traceability Matrix

**Purpose:** connect normative requirements to implementation and proof without claiming unimplemented work is complete.

| Requirement | Specification | Current implementation | Proof / test | Status |
|---|---|---|---|---|
| Task ≠ Attempt | 02, 13 | `src/domain/types.ts`, persistence | `tests/unit/persistence.test.ts` | PASS (M0) |
| Central task state machine | 02, 13 | `src/domain/state-machine.ts` | `tests/unit/state-machine.test.ts` | PASS (M0) |
| Terminal state protection | 02, 13 | state machine | state-machine test | PASS (M0) |
| Retry = new Attempt | 02, 11, 13 | Attempt lifecycle + numbering; retry path in orchestrator | `tests/unit/persistence.test.ts`, `tests/e2e/vertical-slice.test.ts` | PASS (M1) |
| Atomic task/event persistence | 08, 17 | TaskService + repositories/event store | persistence test | PASS (M0) |
| Append-only event history | 08, 17 | `src/events/event-store.ts` | persistence test + M1 event tests | PASS (M1) |
| Checkpoint/resume | 02, 07, 11, 13, 14 | `src/persistence/checkpoint-repository.ts`, `src/runtime/orchestrator.ts` (resume) | `tests/unit/checkpoint.test.ts`, e2e resume test | PASS (M1) |
| UNKNOWN ≠ SUCCESS | 02, 06, 11 | verification engine + orchestrator completion gate | `tests/unit/verification.test.ts`, e2e verification tests | PASS (M1) |
| Tool request policy boundary | 10, 15 | `src/tools/tool-engine.ts` | `tests/adversarial/tools-security.test.ts` | PASS (M1) |
| Default deny | 10, 15 | `src/tools/policy.ts`, `src/config/config.ts` | adversarial suite | PASS (M1) |
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
| Backend abstraction | 05 | `src/backends/agent-backend.ts` | integration tests | PASS (M1) |
| Ollama adapter | 05, 07 | `src/backends/ollama-backend.ts` | `tests/integration/ollama-backend.test.ts` | PASS (M1) |
| Verification independent of claims | 11 | `src/verification/verification-engine.ts` | verification tests | PASS (M1) |
| Recovery creates new attempts | 11, 13 | `src/recovery/recovery-engine.ts`, orchestrator | `tests/recovery/recovery.test.ts`, e2e retry test | PASS (M1) |
| Config snapshot immutability | 16 | `src/persistence/config-snapshot-repository.ts` | checkpoint/config test | PASS (M1) |
| Security trust levels | 15 | path guard + policy engine; untrusted-data framing in context | adversarial suite, context tests | PASS (M1) |
| Structured observability | 17 | `src/observability/logger.ts` (correlated, secret-redacted logs + metrics), event store | `tests/unit/observability.test.ts`, persistence + evaluation tests | PASS (M2) |
| Secret redaction | 15, 17 | `src/security/secret-redaction.ts`; applied to logs, memory and tool output | `tests/unit/secret-redaction.test.ts` | PASS (M2) |
| Write tool (policy-gated) | 10, 15 | `src/tools/builtin-tools.ts` (`write_file`) + policy/path guard | `tests/e2e/durable-runtime.test.ts`, adversarial suite | PASS (M2) |
| Terminal execution (policy-gated) | 10, 15 | `src/tools/builtin-tools.ts` (`terminal.exec`) + command allowlist | adversarial suite, e2e allowlist test | PASS (M2) |
| Context compaction / flush | 04, 03 | `src/context/compactor.ts` | `tests/unit/compaction.test.ts` | PASS (M2) |
| Config reconciliation on resume | 16 | `src/config/config-reconciler.ts`, orchestrator resume | `tests/unit/config-reconciler.test.ts`, e2e drift test | PASS (M2) |
| Evaluation reproducibility | 06 | `src/evaluation/evaluation-recorder.ts` | e2e evaluation assertions | PARTIAL |
| Runtime owns continuity | 02, 14 | orchestrator state control + checkpoint/resume | e2e lifecycle tests | PASS (M1) |

## Status definitions

- **PASS:** implemented and directly tested in the current repository.
- **PARTIAL:** a subset is implemented; the full normative requirement remains.
- **FOUNDATIONAL:** architecture/primitive exists but downstream proof is incomplete.
- **PLANNED:** specified and scheduled, not implemented yet.

This matrix must be updated whenever a milestone changes implementation status.
