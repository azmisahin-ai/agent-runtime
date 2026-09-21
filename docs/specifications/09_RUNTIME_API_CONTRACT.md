# 09 — Runtime API Contract

**Status:** NORMATIVE

## 1. Transport

V0.1 exposes HTTP+JSON under `/api/v1` with SSE for event streaming. API DTOs are separate from domain entities.

## 2. Project endpoints

- `POST /api/v1/projects`
- `GET /api/v1/projects/{project_id}`
- `GET /api/v1/projects`

## 3. Task endpoints

- `POST /api/v1/tasks`
- `GET /api/v1/tasks/{task_id}`
- `POST /api/v1/tasks/{task_id}/start`
- `POST /api/v1/tasks/{task_id}/pause`
- `POST /api/v1/tasks/{task_id}/resume`
- `POST /api/v1/tasks/{task_id}/cancel`
- `POST /api/v1/tasks/{task_id}/retry`
- `GET /api/v1/tasks/{task_id}/events`
- `GET /api/v1/tasks/{task_id}/events/stream`
- `GET /api/v1/tasks/{task_id}/checkpoints`
- `GET /api/v1/tasks/{task_id}/attempts`
- `GET /api/v1/tasks/{task_id}/tools`
- `GET /api/v1/tasks/{task_id}/evaluations`

## 4. Supporting endpoints

Checkpoint/context retrieval, repository status/diff/tree, project/task memories and backend capability listing are exposed under the versioned API.

## 5. State-changing operations

Start, pause, resume, cancel and retry are asynchronous and idempotency-key protected. The API never directly updates DB state; the state machine owns transitions.

## 6. SSE

Events use a monotonic sequence number. Clients can reconnect after the last received sequence.

## 7. Error contract

```json
{
  "error": {
    "code": "TASK_INVALID_STATE",
    "message": "...",
    "retryable": false,
    "details": {},
    "request_id": "..."
  }
}
```

Core codes include INVALID_REQUEST, VALIDATION_ERROR, NOT_FOUND, CONFLICT, TASK_INVALID_STATE, TASK_ALREADY_RUNNING, TASK_NOT_RESUMABLE, BACKEND_UNAVAILABLE, BACKEND_CAPABILITY_UNSUPPORTED, TOOL_DENIED, TOOL_INVALID_REQUEST, TOOL_TIMEOUT, VERIFICATION_FAILED, VERIFICATION_UNKNOWN, PERSISTENCE_ERROR, MIGRATION_ERROR, PERMISSION_DENIED and INTERNAL_ERROR.

HTTP mapping follows 400/403/404/409/422/429/500/503 as appropriate.

## 8. Restart/resume

After runtime restart, API requests operate on persisted state. Resume requires checkpoint/repository reconciliation and a newly built context. If an in-flight tool cannot be proven complete, its state is UNKNOWN and must not be assumed successful.

## 9. Security

Authentication/authorization is distinct from model identity. The API cannot weaken runtime policy or grant a tool capability merely because a client requests it.

## 10. Acceptance scenario

Create project → create task → start → observe events → pause/resume or complete → inspect checkpoint/attempt/evaluation. Restart the runtime between steps to prove durable continuity.
