# Agent Runtime — V0.1 Release Candidate

**Status:** release candidate assembled from `main`.
**Verification command:** `npm install && npm run check`.

## What V0.1 is

A model-agnostic coding Agent Runtime / Harness. The runtime owns continuity: the
model is not the agent, the agent is not the runtime, and no external agent is the
authority for Task state, policy, tool execution or success.

## Implemented subsystems (M0–M5)

| Milestone | Delivered |
|---|---|
| M0 Foundation | TypeScript/Node, SQLite + migrations, domain IDs, Project/Task/Attempt, state machine, repositories, transaction manager, event store, config loader, logging, baseline tests |
| M1 Vertical slice | Task engine, checkpointing, baseline context, Ollama backend, read/search tools, verification, events, restart/resume, first evaluation record |
| M2 Durable runtime | Durable memory (persistence gate, provenance, supersession, conflicts), context snapshots/compaction, complete Tool Engine (`write_file`, `terminal.exec`), config snapshots, resume reconciliation, observability |
| M3 Intelligence | Dependency graph, affected-scope analysis, test discovery/linking, ranked search, richer context retrieval, Git intelligence, repository reconciler, memory ranking |
| M4 Reliability & security | HTTP/JSON+SSE API, workspace lock, idempotency, hash-chained audit trail, destructive-operation controls, process sandbox, persistence-failure handling |
| M5 Evaluation & benchmarking | 20-task suite, immutable runs, reproducibility metadata, metrics, failure attribution, integrity checks, reporter, regression runner, artifact store, real-runtime executor, read-only API |

## Evidence

- Full test suite: **174/174 passing** (`npm run check`), spanning unit, integration,
  adversarial, recovery, evaluation and end-to-end tests.
- Every normative requirement row in `docs/TRACEABILITY_MATRIX.md` is marked PASS with
  a linked implementation and test.
- Documentation, status and traceability agree with the code (`STATUS.md`,
  `docs/roadmap/18_IMPLEMENTATION_DELIVERY_ROADMAP.md`, this file).

## Known gaps (honestly partial)

These are not implemented and are not claimed as complete:

- **Live-model benchmark execution.** The evaluation harness runs suite tasks through
  the real orchestrator, but no live Ollama model is available in the build
  environment. The Ollama adapter is verified against an in-process fake HTTP server
  (`tests/integration/ollama-backend.test.ts`). A live run requires Ollama running
  separately.
- **External-agent adapters and span/trace export** are specified but not implemented; see `docs/TRACEABILITY_MATRIX.md`.
- **Kernel-enforced isolation.** The in-process `ProcessSandbox` controls cwd,
  environment, timeout and output bounds and never inherits ambient credentials, but
  it is not a container/seccomp/namespace jail.
- **Backends beyond Ollama.** Only the baseline Ollama adapter ships in V0.1.

## Invariants the candidate preserves

1. UNKNOWN is never SUCCESS and never PASS.
2. A retry creates a new Attempt.
3. Terminal Task states cannot silently return to RUNNING.
4. Tool execution stays behind validation and policy; default network policy is DENY.
5. Canonical evidence is persisted; a persistence failure is never silently ignored.
6. Secrets never enter context, memory, logs or evaluation artifacts.
7. Repository content is untrusted data, not runtime policy.
8. Recovery never silently widens permissions.

## Verify locally

```bash
npm install
npm run check        # build + full test suite
npm start            # starts the API; prints READY with api_base
```
