# Traceability Matrix

**Purpose:** connect normative requirements to implementation and proof without claiming unimplemented work is complete.

| Requirement | Specification | Current implementation | Proof / test | Status |
|---|---|---|---|---|
| Task ≠ Attempt | 02, 13 | `src/domain/types.ts`, persistence | `tests/unit/persistence.test.ts` | PASS (M0) |
| Central task state machine | 02, 13 | `src/domain/state-machine.ts` | `tests/unit/state-machine.test.ts` | PASS (M0) |
| Terminal state protection | 02, 13 | state machine | state-machine test | PASS (M0) |
| Retry = new Attempt | 02, 11, 13 | Attempt numbering foundation | persistence test + schema | PARTIAL |
| Atomic task/event persistence | 08, 17 | TaskService + repositories/event store | persistence test | PASS (M0) |
| Append-only event history | 08, 17 | `src/events/event-store.ts` | persistence test | PARTIAL |
| Checkpoint/resume | 02, 07, 11, 13, 14 | not implemented | planned recovery tests | PLANNED |
| UNKNOWN ≠ SUCCESS | 02, 06, 11 | not fully implemented | planned verification tests | PLANNED |
| Tool request policy boundary | 10, 15 | not implemented | planned adversarial suite | PLANNED |
| Default deny | 10, 15 | baseline documented; engine not implemented | planned security tests | PLANNED |
| Context budget | 04 | not implemented | planned context tests | PLANNED |
| Memory provenance/supersession | 03 | not implemented | planned memory tests | PLANNED |
| Repository evidence/freshness | 12 | not implemented | planned repository tests | PLANNED |
| Backend abstraction | 05 | not implemented; interface specified | planned backend tests | PLANNED |
| Ollama adapter | 05, 07 | not implemented | M1 integration tests | PLANNED |
| Verification independent of claims | 11 | not implemented | planned verification tests | PLANNED |
| Recovery creates new attempts | 11, 13 | not implemented | planned recovery tests | PLANNED |
| Config snapshot immutability | 16 | not implemented | planned config tests | PLANNED |
| Security trust levels | 15 | not implemented | planned adversarial tests | PLANNED |
| Structured observability | 17 | basic event store exists | planned observability tests | PARTIAL |
| Evaluation reproducibility | 06 | not implemented | planned evaluation suite | PLANNED |
| Runtime owns continuity | 02, 14 | architecture + M0 persistence/state | lifecycle tests | FOUNDATIONAL |

## Status definitions

- **PASS:** implemented and directly tested in the current repository.
- **PARTIAL:** a subset is implemented; the full normative requirement remains.
- **FOUNDATIONAL:** architecture/primitive exists but downstream proof is incomplete.
- **PLANNED:** specified and scheduled, not implemented yet.

This matrix must be updated whenever a milestone changes implementation status.
