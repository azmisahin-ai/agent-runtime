# Agent Runtime — Status

**Last repository checkpoint:** M0 Foundation  
**Current milestone:** M0 complete / M1 ready to start

## Verified implementation

- Git repository with real history
- TypeScript/Node foundation
- SQLite initial migration
- Project / Task / Attempt domain model
- Central task state machine
- Terminal-state protection
- Append-only event store foundation
- Project/Task repositories
- Transactional TaskService
- Configuration loader
- M0 unit tests
- Architecture specifications 01–17 committed
- Master roadmap 18 committed
- Agent handoff instructions committed
- Traceability matrix committed

## Not yet implemented

- Ollama backend
- Tool Engine
- Context Engine
- Memory Engine
- Repository Intelligence
- Verification runner
- Recovery engine
- Runtime HTTP/SSE API
- Full security/policy engine
- Full observability/telemetry layer
- Evaluation harness

## Next exact work

1. Install dependencies.
2. Run `npm run check`.
3. If green, begin M1 from roadmap 18.
4. Implement backend abstraction before provider-specific execution.
5. Add baseline Ollama adapter.
6. Add read/search tools behind Tool Engine.
7. Add verification and checkpoint/resume.
8. Update status + traceability after each coherent slice.

## Important interpretation

The repository is now a **self-contained architecture + implementation handoff**, not a claim that V0.1 is already implemented. Specifications describe the target; source/tests prove the current milestone.
