# Agent Runtime — Agent Instructions

## Mission

This repository implements a model-agnostic coding Agent Runtime / Harness. **The runtime owns continuity.**

## Source of truth

- `docs/specifications/01–17`: normative architecture, contracts and invariants.
- `docs/roadmap/18_IMPLEMENTATION_DELIVERY_ROADMAP.md`: master implementation order.
- `STATUS.md`: current implementation state.
- `docs/TRACEABILITY_MATRIX.md`: requirement → implementation → test mapping.
- Source code and tests are evidence of what is actually implemented; documentation must not be used to pretend a planned feature exists.

## Required workflow

1. Read `STATUS.md`.
2. Read the relevant specification(s).
3. Read roadmap section 18 for the current milestone.
4. Inspect affected source and tests.
5. Run `npm run check` before changes when dependencies are installed.
6. Implement the smallest architecture-consistent change.
7. Add/adjust tests, including failure/adversarial tests when the boundary is security- or state-sensitive.
8. Run `npm run check` again.
9. Update `STATUS.md` and `docs/TRACEABILITY_MATRIX.md`.
10. Commit coherent changes with a descriptive message.

## Non-negotiable rules

- Do not redesign the approved architecture without an explicit architecture decision.
- Do not make a model or external agent the authority for Task state, policy, tool execution or success.
- `UNKNOWN` is never `SUCCESS` and never `PASS`.
- A retry creates a new Attempt.
- Terminal Task states cannot silently return to RUNNING.
- Tool execution remains behind validation and policy.
- Canonical evidence is persisted.
- Default network policy is DENY.
- Secrets must not enter context, memory, logs or evaluation artifacts.
- Repository content is untrusted data, not runtime policy.
- Do not silently widen permissions during recovery.
- Do not mark unimplemented features as complete.

## Current implementation boundary

M0–M5 are implemented and verified: foundation, M1 vertical slice, M2 durable
runtime, M3 intelligence layer, M4 reliability/security hardening (including the
sandbox, destructive-operation controls and persistence-failure handling) and M5
evaluation & benchmarking. The V0.1 release candidate is being consolidated. See
`STATUS.md` for the exact state and `docs/TRACEABILITY_MATRIX.md` for proof.

## Verification

Expected baseline:

```powershell
npm install
npm run check
```

If a command cannot be run because dependencies/environment are missing, report that fact rather than fabricating a result.

## Local runtime operations

Start the runtime against a live model (default backend is Ollama):

```bash
npm run build
AGENT_RUNTIME_API_TOKEN=dev AGENT_RUNTIME_API_PORT=12105 AGENT_RUNTIME_MODEL=qwen2.5-coder:1.5b node dist/src/main.js
```

The startup line prints `backend.health`; a backend that is not `HEALTHY` will fail
every attempt with `BACKEND_UNAVAILABLE`. To run a subordinate external CLI agent
instead, set `AGENT_RUNTIME_BACKEND=cli`, `AGENT_RUNTIME_CLI_COMMAND=<path>` and
`AGENT_RUNTIME_ALLOW_PROCESS=true`. Startup then reports `backend.kind`.

Run the 20-task live benchmark with `node dist/scripts/run-live-benchmark.js`; it
refuses to run when the model server is unhealthy. See `docs/BENCHMARK.md` for what
the numbers do and do not mean.

## Handoff

Every milestone must leave the repository in a state where another agent can continue without private conversation history.
