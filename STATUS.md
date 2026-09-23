# Agent Runtime — Status

**Last repository checkpoint:** M1 vertical slice
**Current milestone:** M1 complete / M2 next

## Verified implementation

- Git repository with real history
- TypeScript/Node foundation
- SQLite migrations (001 foundation, 002 vertical slice)
- Project / Task / Attempt domain model
- Central task state machine with terminal-state protection
- Append-only event store
- Transactional TaskService and repositories
- Configuration loader (default-deny network)
- Backend abstraction (`AgentBackend`) and baseline Ollama adapter
- Tool Engine: schema validation, default-deny policy, path guard, built-ins (read/list/search/git)
- Context Engine with budgeting and untrusted-data framing
- Verification engine (UNKNOWN != PASS)
- Recovery engine and checkpoint/resume with crash reconciliation
- Config snapshot, context snapshot, tool-run and evaluation persistence
- Runtime orchestrator (runtime owns Task state and completion)
- M0 unit tests + M1 unit/integration/adversarial/e2e tests (57 passing)
- Architecture specifications 01–17, roadmap 18, traceability matrix, handoff instructions

## Not yet implemented

- Memory Engine (provenance/supersession)
- Repository Intelligence evidence/freshness model (only read-only Git inspection exists)
- Runtime HTTP/SSE API
- Process execution and write tools (policy-gated, currently disabled by default)
- Full observability/telemetry layer
- Full evaluation harness / reproducibility pipeline
- Multi-provider backends beyond Ollama

## Next exact work

1. Install dependencies if missing.
2. Run `npm run check` (must be green: build + tests).
3. Begin M2 from roadmap 18.
4. Implement the Memory Engine with provenance and supersession.
5. Implement Repository Intelligence (evidence, freshness) beyond read-only Git inspection.
6. Add the Runtime HTTP/SSE API surface.
7. Update status + traceability after each coherent slice.

## Environment notes

- Ollama is **not installed** in the current environment. The Ollama adapter is
  verified against an in-process fake HTTP server (`tests/integration/ollama-backend.test.ts`),
  not a live model. Live-model validation requires running Ollama separately.
- Default network policy is DENY; process execution and filesystem writes are disabled by default.

## Important interpretation

The repository is a self-contained architecture + implementation handoff. Specifications
describe the target; source and tests prove the current milestone. M0 and the M1 vertical
slice are implemented and tested; later milestones remain planned.
