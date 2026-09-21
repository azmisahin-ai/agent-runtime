# 14 — Runtime Orchestration Specification

**Status:** NORMATIVE

## 1. Purpose

Orchestration binds the independent subsystems into one deterministic execution flow without allowing any subsystem to bypass runtime authority.

## 2. Canonical flow

```text
CLIENT
 ↓
Task Service
 ↓
State Machine
 ↓
Attempt creation
 ↓
Config/Policy snapshot
 ↓
Repository reconciliation
 ↓
Context Engine
 ↓
Backend
 ↓
Agent response
 ├─ TOOL REQUEST → Tool Engine → observation → Context update
 └─ FINAL → Verification
                ├─ PASS → COMPLETED
                ├─ FAIL → Recovery
                └─ UNKNOWN → PAUSE/FAIL according to policy
```

## 3. Runtime loop

1. Load Task and current state.
2. Validate execution preconditions.
3. Create or load Attempt.
4. Snapshot effective configuration/policy.
5. Reconcile repository/workspace.
6. Build ContextPack.
7. Invoke backend.
8. Persist backend evidence.
9. Validate any tool request.
10. Execute authorized tools and persist results.
11. Rebuild context from observations.
12. On final response, enter VERIFYING.
13. Run independent verification.
14. Complete, recover, pause or fail through state machine.
15. Create checkpoint at defined durability boundaries.

## 4. Authority rules

- Runtime owns Task state.
- Policy engine owns authorization decisions.
- Tool engine owns actual tool execution.
- Context engine owns what the model sees.
- Memory engine owns durable memory lifecycle.
- Repository intelligence owns index/evidence representation, not mutation.
- Verification owns evidence-based success determination.
- Evaluation records what happened; it does not alter outcome.

## 5. Tool loop

Tool requests are never directly executed from model output. Every request receives a ToolRun ID and moves through validation, policy, permission, execution and evidence persistence.

## 6. Recovery orchestration

Failures enter classification and recovery decision. Retry means a new Attempt. Backend switch is explicit. Security capabilities cannot be widened during recovery. Context is rebuilt using the latest evidence.

## 7. Resume orchestration

```text
LOAD TASK
 → LOAD CHECKPOINT
 → RECONCILE REPOSITORY/GIT
 → RECONCILE TOOL/BACKEND STATE
 → LOAD MEMORY
 → BUILD NEW CONTEXT
 → START/RESUME BACKEND
```

## 8. External agents

ACP/CLI/native agents are subordinate execution backends. Their session state is mapped to runtime IDs. They cannot bypass runtime persistence, policy or verification.

## 9. Event discipline

Every authoritative boundary produces structured events. Canonical state change + event persistence is transactional where possible. Observability failure must not silently corrupt canonical state.

## 10. Determinism and idempotency

State-changing commands require idempotency. Duplicate requests must not duplicate attempts, tool effects or checkpoints. Non-idempotent external actions require explicit policy/approval boundaries.

## 11. Core orchestration invariant

**No subsystem may silently become an alternative runtime authority.**
