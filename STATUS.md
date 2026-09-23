# Agent Runtime — Status

**Last repository checkpoint:** M4 reliability & security hardening (API, locking, audit)
**Current milestone:** M4 in progress / M5 next

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
- M0–M4 unit/integration/adversarial/recovery/e2e tests (143 passing)
- Architecture specifications 01–17, roadmap 18, traceability matrix, handoff instructions

## Not yet implemented

- OS-level sandboxing for tool execution and broader destructive-operation controls (M4 remainder)
- Persistence-failure injection and backend/tool crash hardening beyond current guards (M4 remainder)
- Full evaluation harness / reproducibility pipeline and benchmark suite (M5)
- Multi-provider backends beyond Ollama

## Next exact work

1. Install dependencies if missing.
2. Run `npm run check` (must be green: build + tests).
3. Finish M4: OS-level tool sandboxing, persistence-failure injection, destructive-Git controls.
4. Then begin M5 (Evaluation & Benchmarking) from roadmap 18.
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
slice, M2 durable runtime, M3 intelligence layer, and the M4 API/locking/audit slice are
implemented and tested; the remainder of M4 and later milestones remain planned.
