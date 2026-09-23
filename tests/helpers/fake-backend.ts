import type { AgentBackend, AgentEvent, AgentRequest, AgentResponse, BackendCapabilities, BackendHealth, ExecutionHandle, StartRequest } from '../../src/backends/agent-backend.js';

// A scripted backend shared by e2e tests: it exercises the runtime contract
// without a live model, and never claims success on the model's behalf.
export class FakeBackend implements AgentBackend {
  readonly id = 'fake';
  constructor(private readonly behavior: { response?: AgentResponse; fail?: Error } = {}) {}
  async initialize(): Promise<void> {}
  async start(_request: StartRequest): Promise<ExecutionHandle> { return { session_id: 'session_fake', external_session_id: null }; }
  async send(_request: AgentRequest): Promise<AgentResponse> {
    if (this.behavior.fail) throw this.behavior.fail;
    return this.behavior.response ?? { request_id: 'req_1', type: 'FINAL', content: 'done' };
  }
  async *stream(_request: AgentRequest): AsyncIterable<AgentEvent> { yield { type: 'DONE' }; }
  async cancel(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async health(): Promise<BackendHealth> { return 'HEALTHY'; }
  capabilities(): BackendCapabilities {
    return { streaming: true, toolCalling: false, structuredOutput: false, sessionResume: false, vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false, nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false };
  }
  async close(): Promise<void> {}
}

export function makeFakeBackend(behavior: { response?: AgentResponse; fail?: Error } = {}): AgentBackend {
  return new FakeBackend(behavior);
}
