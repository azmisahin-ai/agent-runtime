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
| Memory provenance/supersession | 03 | not implemented | planned memory tests | PLANNED |
| Repository evidence/freshness | 12 | Git inspection only (`src/git/git-inspector.ts`); evidence model not implemented | planned repository tests | PARTIAL |
| Backend abstraction | 05 | `src/backends/agent-backend.ts` | integration tests | PASS (M1) |
| Ollama adapter | 05, 07 | `src/backends/ollama-backend.ts` | `tests/integration/ollama-backend.test.ts` | PASS (M1) |
| Verification independent of claims | 11 | `src/verification/verification-engine.ts` | verification tests | PASS (M1) |
| Recovery creates new attempts | 11, 13 | `src/recovery/recovery-engine.ts`, orchestrator | `tests/recovery/recovery.test.ts`, e2e retry test | PASS (M1) |
| Config snapshot immutability | 16 | `src/persistence/config-snapshot-repository.ts` | checkpoint/config test | PASS (M1) |
| Security trust levels | 15 | path guard + policy engine; untrusted-data framing in context | adversarial suite, context tests | PASS (M1) |
| Structured observability | 17 | event store + evaluation records | persistence + evaluation tests | PARTIAL |
| Evaluation reproducibility | 06 | `src/evaluation/evaluation-recorder.ts` | e2e evaluation assertions | PARTIAL |
| Runtime owns continuity | 02, 14 | orchestrator state control + checkpoint/resume | e2e lifecycle tests | PASS (M1) |

## Status definitions

- **PASS:** implemented and directly tested in the current repository.
- **PARTIAL:** a subset is implemented; the full normative requirement remains.
- **FOUNDATIONAL:** architecture/primitive exists but downstream proof is incomplete.
- **PLANNED:** specified and scheduled, not implemented yet.

This matrix must be updated whenever a milestone changes implementation status.
