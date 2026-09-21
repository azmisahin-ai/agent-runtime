# 02 — System Architecture

**Status:** NORMATIVE

## 1. Goal

Build a model-agnostic Agent Runtime / Harness for coding agents. It must work with local Ollama models, API models, external coding agents, ACP agents and CLI agents without allowing any model or external agent to become the authority for continuity, persistence, security, or success.

## 2. Core separation

```text
MODEL ≠ AGENT ≠ RUNTIME ≠ UI
```

- **MODEL:** inference capability.
- **AGENT:** model plus agent behavior, tools and execution loop.
- **RUNTIME:** task lifecycle, state, context, memory, repository, tools, persistence, verification, recovery and evaluation.
- **UI:** client of the runtime.

## 3. High-level architecture

```text
USER
  ↓
UI / CLI / API CLIENT
  ↓
AGENT API
  ↓
AGENT RUNTIME
  ├── Task Engine
  ├── Execution State Machine
  ├── Context Engine
  ├── Memory Engine
  ├── Tool Engine
  ├── Repository Intelligence
  ├── Verification
  ├── Recovery
  ├── Persistence / Event Store
  ├── Configuration / Policy
  ├── Observability
  └── Evaluation
  ↓
BACKEND LAYER
  ├── Ollama
  ├── OpenAI-compatible APIs
  ├── ACP
  ├── CLI agents
  └── Native agents
```

## 4. Task and Attempt

A **Task** is the durable user objective. An **Attempt** is one execution attempt.

```text
Task #42
  Attempt #1 → failed
  Attempt #2 → failed
  Attempt #3 → completed
```

Terminal Task states are `COMPLETED`, `FAILED`, `CANCELLED`. A terminal task cannot spontaneously return to `RUNNING`; recovery/retry creates a new attempt through the state machine.

## 5. Task states

`CREATED → QUEUED → RUNNING → WAITING_TOOL / WAITING_USER / VERIFYING → COMPLETED | FAILED | PAUSED | CANCELLED`

Every transition is validated, persisted and auditable.

## 6. Agent loop

```text
TASK
 ↓
LOAD STATE
 ↓
BUILD CONTEXT
 ↓
SEND TO BACKEND
 ↓
MODEL / AGENT RESPONSE
 ↓
TOOL ACTION or FINAL
 ↓
VALIDATE / VERIFY
 ↓
EXECUTE
 ↓
OBSERVATION
 ↓
UPDATE STATE
 ↓
NEXT ITERATION
```

## 7. ContextPack

The Context Engine builds a bounded `ContextPack` from Task, state, repository evidence, Git state, memory, previous observations, tool state and backend context limits. The runtime does not blindly replay conversation history.

## 8. Persistence

Canonical entities: Projects, Tasks, Attempts, Sessions, Events, Memories, Tool Runs, Context Snapshots, Checkpoints and Evaluations. SQLite is the V0.1 canonical store.

## 9. Checkpoint/resume

```text
LOAD TASK
 ↓
LOAD LAST CHECKPOINT
 ↓
CHECK CURRENT REPOSITORY
 ↓
CHECK GIT CHANGES
 ↓
RECONCILE STATE
 ↓
BUILD NEW CONTEXT
 ↓
RESUME
```

A backend session may disappear while Task continuity remains.

## 10. Verification and recovery

Agent claims are untrusted. `UNKNOWN` is never `PASS`; task success requires required verification to pass. Recovery is bounded and evidence-driven and must not weaken security policy.

## 11. Security boundary

```text
MODEL
 ↓ untrusted intent
TOOL POLICY
 ↓
PERMISSION
 ↓
EXECUTION
 ↓
EVIDENCE
```

The repository, model output and external agent output are data/intent, not policy authority.

## 12. V0.1 scope

Required: durable Task lifecycle, SQLite persistence, state machine, Ollama backend, baseline Context Engine, file search/read/edit tooling, Git read tools, memory, checkpoints, resume, verification, recovery, repository intelligence, security policy, API, observability and evaluation. Advanced multi-agent orchestration, distributed execution and autonomous deployment remain out of scope.

## 13. Core invariants

1. `UNKNOWN != SUCCESS`.
2. Model != Runtime.
3. Agent != Runtime.
4. External agent != Runtime authority.
5. Tool request != tool execution.
6. Task != Attempt.
7. Terminal state != RUNNING.
8. Retry = new Attempt.
9. Verification PASS is required for SUCCESS.
10. Default security policy is deny.
11. Most restrictive applicable policy wins.
12. Secrets are not context or telemetry.
13. Execution history is append-only.
14. Runtime owns continuity.
15. Evidence outranks claims.
