# 13 — Lifecycle & State Machine Specification

**Status:** NORMATIVE

## 1. Objective

Define deterministic lifecycle semantics for Tasks and Attempts so that restart, pause, retry, cancellation and terminal outcomes remain durable and auditable.

## 2. States

`CREATED`, `QUEUED`, `RUNNING`, `WAITING_TOOL`, `WAITING_USER`, `VERIFYING`, `COMPLETED`, `FAILED`, `PAUSED`, `CANCELLED`.

Terminal: `COMPLETED`, `FAILED`, `CANCELLED`.

## 3. Task vs Attempt

Task is the durable objective. Attempt is one execution history. Sessions and backend sessions are subordinate and cannot become Task authority.

## 4. Transition authority

Only the centralized state machine can transition Task state. Each transition validates source state, target state, actor/request and required evidence. State change + canonical event must be atomic.

## 5. Key transitions

```text
CREATED → QUEUED
QUEUED → RUNNING
RUNNING → WAITING_TOOL | WAITING_USER | VERIFYING | PAUSED | CANCELLED
WAITING_TOOL → RUNNING | PAUSED | FAILED
WAITING_USER → RUNNING | PAUSED | CANCELLED
VERIFYING → COMPLETED | FAILED | PAUSED
PAUSED → RUNNING | CANCELLED
```

Invalid transitions are rejected and audited.

## 6. Terminal semantics

A terminal Task cannot return to RUNNING in place. Retry/recovery creates a new Attempt under explicit runtime control. Historical Attempts remain immutable evidence.

## 7. Idempotency

Repeated start/pause/resume/cancel/retry requests with the same idempotency key must not create duplicate execution effects.

## 8. Checkpoints

A checkpoint captures task state, goal, step, repository revision, Git state, relevant memory, context snapshot and pending action. Resume always revalidates current workspace state.

## 9. Crash semantics

An in-flight operation whose completion cannot be proven is UNKNOWN. The runtime must not mark it successful merely because the process ended after the request.

## 10. Persistence failure

If canonical state cannot be durably persisted, the runtime must not silently continue as if durable state exists. Baseline response is PAUSE/FAIL according to the failure context and emit diagnostic evidence if possible.

## 11. Workspace concurrency

Only one active execution writer per workspace by default. External changes trigger reconciliation before resume.

## 12. Invariants

State transitions are centralized, persisted and ordered; terminal states remain terminal; retries create Attempts; session state is not Task authority; unknown work is not success; state/event writes are atomic; resume checks repository state.
