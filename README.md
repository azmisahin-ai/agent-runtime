# Agent Runtime

Model-agnostic coding Agent Runtime / Harness.

> **The model is not the agent. The agent is not the runtime. The runtime owns continuity.**

## Repository handoff map

| Need | File |
|---|---|
| Start working | `AGENTS.md` |
| Current state | `STATUS.md` |
| Architecture | `docs/specifications/01_ARCHITECTURE_MATRIX.md` through `17_OBSERVABILITY_TELEMETRY_AUDIT_SPEC.md` |
| Implementation order | `docs/roadmap/18_IMPLEMENTATION_DELIVERY_ROADMAP.md` |
| Requirement proof | `docs/TRACEABILITY_MATRIX.md` |
| Project intent | `docs/PROJECT_CHARTER.md` |
| Current code | `src/` |
| Tests | `tests/` |
| Database | `migrations/` |

## Architecture

```text
USER
 ↓
UI / CLI / API
 ↓
AGENT RUNTIME
 ├─ Task / Attempt / State
 ├─ Context
 ├─ Memory
 ├─ Repository Intelligence
 ├─ Tools + Policy
 ├─ Backend Adapters
 ├─ Verification
 ├─ Recovery
 ├─ Persistence / Events
 ├─ Observability
 └─ Evaluation
 ↓
MODEL / AGENT BACKENDS
```

The model is never the authority for state, security, tool execution or success.

## Current status

M0–M5 are implemented and verified: foundation, vertical slice, durable runtime,
intelligence layer, reliability/security hardening (API, locking, idempotency,
tamper-evident audit, destructive-operation controls, process sandbox,
persistence-failure handling) and evaluation & benchmarking. The V0.1 release
candidate is assembled; the remaining gaps are live-model benchmark
execution, stronger OS-level isolation and external-agent adapters (see
`docs/TRACEABILITY_MATRIX.md`). This repository intentionally
distinguishes **specified**, **implemented**, **verified** and **planned** work —
see `STATUS.md` for the exact boundary.

## Requirements

- Node.js >= 22.5
- npm

## Verify

```bash
npm install
npm run check
```

## How a new coding agent should continue

```text
AGENTS.md
  ↓
STATUS.md
  ↓
TRACEABILITY_MATRIX.md
  ↓
relevant specification 01–17
  ↓
roadmap 18
  ↓
source + tests
  ↓
implement next milestone
```

Do not start a new architecture-planning loop unless an explicit architecture change is requested.
