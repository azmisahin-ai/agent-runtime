# 05 — Agent Backend Protocol

**Status:** NORMATIVE

## 1. Purpose

Provide one runtime contract for local models, API models, native agents, CLI agents and ACP-integrated agents.

## 2. Separation

`MODEL = inference capability`, `AGENT = execution behavior`, `RUNTIME = continuity authority`.

## 3. Canonical interface

```typescript
interface AgentBackend {
  initialize(): Promise<void>;
  start(request: StartRequest): Promise<ExecutionHandle>;
  send(request: AgentRequest): Promise<AgentResponse>;
  stream(request: AgentRequest): AsyncIterable<AgentEvent>;
  cancel(request: CancelRequest): Promise<void>;
  pause(request: PauseRequest): Promise<void>;
  resume(request: ResumeRequest): Promise<void>;
  health(): Promise<BackendHealth>;
  capabilities(): BackendCapabilities;
  close(): Promise<void>;
}
```

## 4. Lifecycle

`DISCOVERED → INITIALIZING → READY → RUNNING ↔ PAUSED → CLOSING → CLOSED`; failures may enter `ERROR/RECOVERING`.

Health: HEALTHY, DEGRADED, UNAVAILABLE, UNKNOWN. UNKNOWN is not healthy.

## 5. Capabilities

Streaming, tool calling, structured output, session resume, vision, large context, MCP, ACP, native filesystem/terminal/Git, cancellation and pause/resume are explicit capabilities.

## 6. Request/response

```typescript
interface AgentRequest {
  task_id: string;
  attempt_id: string;
  context: ContextPack;
  instructions?: string;
  tools?: ToolDefinition[];
  response_mode: "TEXT" | "TOOL_CALL" | "STRUCTURED";
  timeout_ms?: number;
}

interface AgentResponse {
  request_id: string;
  type: "FINAL" | "TOOL_REQUEST" | "PARTIAL" | "ERROR";
  content?: unknown;
  usage?: UsageMetrics;
  finish_reason?: string;
  backend_metadata?: Record<string, unknown>;
}
```

Streaming events include text delta, tool request/result, status, error and done.

## 7. Adapters

V0.1 begins with `OllamaBackend`. The architecture also reserves `OpenAICompatibleBackend`, `ACPBackend`, `CLIBackend` and `NativeAgentBackend`.

Ollama calls must be isolated behind the adapter; direct provider calls must not leak through unrelated subsystems.

## 8. External agents

External session IDs are mapped to Task/Attempt IDs but never become runtime authority. If a backend cannot resume its session, the runtime starts a new backend session while preserving durable Task continuity.

MCP is treated as a tool/context integration protocol; ACP as agent communication/integration. Neither replaces runtime persistence.

## 9. Security

Backend responses are untrusted intent. Tool requests always pass through runtime validation/policy/execution. CWD, environment, timeout and cancellation are runtime controlled.

## 10. Failure/recovery

Failures include network, model unavailable, process exit, timeout, protocol, auth, capability and unknown errors. Retryability is explicit. Backend switching is auditable and causes context budget recalculation.

## 11. Events

BackendInitialized, BackendReady, BackendRequestStarted, BackendRequestCompleted, BackendRequestFailed, BackendStreamStarted, BackendStreamCompleted, BackendTimeout, BackendCancelled, BackendPaused, BackendResumed, BackendHealthChanged, BackendChanged, BackendClosed.

## 12. Invariants

Runtime remains independent of provider; backend cannot directly mutate durable Task state; responses are untrusted; unsupported capabilities fail explicitly; failures persist; backend switches are auditable; context is rebuilt/re-budgeted when needed; external sessions do not equal Tasks; final response does not equal success without verification.
