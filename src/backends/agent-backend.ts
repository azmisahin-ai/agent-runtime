import type { ContextPack, ToolDefinition } from '../domain/types.js';

export type BackendState = 'DISCOVERED' | 'INITIALIZING' | 'READY' | 'RUNNING' | 'PAUSED' | 'CLOSING' | 'CLOSED' | 'ERROR' | 'RECOVERING';
export type BackendHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface BackendCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  sessionResume: boolean;
  vision: boolean;
  largeContext: boolean;
  mcp: boolean;
  acp: boolean;
  nativeFilesystem: boolean;
  nativeTerminal: boolean;
  nativeGit: boolean;
  cancellation: boolean;
  pauseResume: boolean;
}

export interface StartRequest {
  task_id: string;
  attempt_id: string;
}

export interface ExecutionHandle {
  session_id: string;
  external_session_id: string | null;
}

export interface AgentRequest {
  task_id: string;
  attempt_id: string;
  context: ContextPack;
  instructions?: string;
  tools?: ToolDefinition[];
  response_mode: 'TEXT' | 'TOOL_CALL' | 'STRUCTURED';
  timeout_ms?: number;
}

export interface UsageMetrics {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface AgentResponse {
  request_id: string;
  type: 'FINAL' | 'TOOL_REQUEST' | 'PARTIAL' | 'ERROR';
  content?: unknown;
  usage?: UsageMetrics;
  finish_reason?: string;
  backend_metadata?: Record<string, unknown>;
}

export interface AgentEvent {
  type: 'TEXT_DELTA' | 'TOOL_REQUEST' | 'TOOL_RESULT' | 'STATUS' | 'ERROR' | 'DONE';
  content?: unknown;
}

// Canonical runtime contract (spec 05 §3). Backends provide execution capability only;
// they never mutate durable Task state directly.
export interface AgentBackend {
  initialize(): Promise<void>;
  start(request: StartRequest): Promise<ExecutionHandle>;
  send(request: AgentRequest): Promise<AgentResponse>;
  stream(request: AgentRequest): AsyncIterable<AgentEvent>;
  cancel(request: { task_id: string; attempt_id: string }): Promise<void>;
  pause(request: { task_id: string; attempt_id: string }): Promise<void>;
  resume(request: { task_id: string; attempt_id: string }): Promise<void>;
  health(): Promise<BackendHealth>;
  capabilities(): BackendCapabilities;
  close(): Promise<void>;
}

export class BackendError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'BackendError';
  }
}

export class BackendCapabilityUnsupportedError extends BackendError {
  constructor(capability: keyof BackendCapabilities) {
    super('BACKEND_CAPABILITY_UNSUPPORTED', `Backend does not support capability: ${capability}`, false);
    this.name = 'BackendCapabilityUnsupportedError';
  }
}
