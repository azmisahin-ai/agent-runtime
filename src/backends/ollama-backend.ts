import type { ContextPack } from '../domain/types.js';
import { newId } from '../domain/id.js';
import {
  BackendCapabilityUnsupportedError,
  BackendError,
  type AgentBackend,
  type AgentEvent,
  type AgentRequest,
  type AgentResponse,
  type BackendCapabilities,
  type BackendHealth,
  type ExecutionHandle,
  type StartRequest
} from './agent-backend.js';

export interface OllamaBackendOptions {
  baseUrl: string;
  model: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OllamaChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

// Isolated Ollama adapter (spec 05 §7). Provider specifics never leak into the runtime core.
export class OllamaBackend implements AgentBackend {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly requestTimeoutMs: number;
  private readonly doFetch: typeof fetch;
  private state: 'DISCOVERED' | 'READY' | 'CLOSED' = 'DISCOVERED';
  private readonly inflight = new Map<string, AbortController>();

  constructor(options: OllamaBackendOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  // A server that answers is not a server that can serve this model. Checking only
  // `/api/tags` reported HEALTHY for a model that was never pulled, so the operator
  // learned about the mistake from a failed attempt instead of from startup.
  private async modelPresent(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.doFetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) throw new BackendError('BACKEND_UNAVAILABLE', `Ollama returned ${response.status}`, true);
      const payload = await response.json() as { models?: { name?: string; model?: string }[] };
      const names = (payload.models ?? []).flatMap(entry => [entry.name, entry.model]).filter((name): name is string => typeof name === 'string');
      return names.includes(this.model);
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError('BACKEND_UNAVAILABLE', `Ollama is not reachable at ${this.baseUrl}`, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize(): Promise<void> {
    const present = await this.modelPresent();
    if (!present) {
      throw new BackendError('BACKEND_UNAVAILABLE', `Model ${this.model} is not available at ${this.baseUrl}; pull it before starting the runtime`, false);
    }
    this.state = 'READY';
  }

  async start(_request: StartRequest): Promise<ExecutionHandle> {
    this.assertReady();
    return { session_id: newId('session'), external_session_id: null };
  }

  async send(request: AgentRequest): Promise<AgentResponse> {
    this.assertReady();
    const key = request.attempt_id;
    const controller = new AbortController();
    this.inflight.set(key, controller);
    const timer = setTimeout(() => controller.abort(), request.timeout_ms ?? this.requestTimeoutMs);
    try {
      const response = await this.doFetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, stream: false, messages: this.buildMessages(request.context) })
      });
      if (!response.ok) {
        // A missing model will not fix itself on retry, so it must not be retryable;
        // a transient server error still is.
        if (response.status === 404) {
          throw new BackendError('BACKEND_UNAVAILABLE', `Model ${this.model} is not available at ${this.baseUrl}`, false);
        }
        throw new BackendError('BACKEND_UNAVAILABLE', `Ollama returned ${response.status}`, true);
      }
      const payload = await response.json() as { message?: { content?: string }; done_reason?: string; prompt_eval_count?: number; eval_count?: number };
      return {
        request_id: newId('req'),
        type: 'FINAL',
        content: payload.message?.content ?? '',
        finish_reason: payload.done_reason,
        usage: { prompt_tokens: payload.prompt_eval_count, completion_tokens: payload.eval_count },
        backend_metadata: { provider: 'ollama', model: this.model }
      };
    } catch (error) {
      if (controller.signal.aborted) throw new BackendError('BACKEND_TIMEOUT', 'Ollama request timed out', true);
      if (error instanceof BackendError) throw error;
      throw new BackendError('BACKEND_FAILURE', `Ollama request failed: ${String(error)}`, true);
    } finally {
      clearTimeout(timer);
      this.inflight.delete(key);
    }
  }

  async *stream(request: AgentRequest): AsyncIterable<AgentEvent> {
    this.assertReady();
    if (!this.capabilities().streaming) throw new BackendCapabilityUnsupportedError('streaming');
    const key = request.attempt_id;
    const controller = new AbortController();
    this.inflight.set(key, controller);
    const timer = setTimeout(() => controller.abort(), request.timeout_ms ?? this.requestTimeoutMs);
    try {
      const response = await this.doFetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model: this.model, stream: true, messages: this.buildMessages(request.context) })
      });
      if (!response.ok) throw new BackendError('BACKEND_UNAVAILABLE', `Ollama returned ${response.status}`, true);
      if (!response.body) throw new BackendError('BACKEND_FAILURE', 'Ollama stream had no body', true);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) {
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (parsed.message?.content) yield { type: 'TEXT_DELTA', content: parsed.message.content };
            if (parsed.done) yield { type: 'DONE' };
          }
          index = buffer.indexOf('\n');
        }
      }
    } catch (error) {
      if (controller.signal.aborted) throw new BackendError('BACKEND_TIMEOUT', 'Ollama stream timed out', true);
      if (error instanceof BackendError) throw error;
      throw new BackendError('BACKEND_FAILURE', `Ollama stream failed: ${String(error)}`, true);
    } finally {
      clearTimeout(timer);
      this.inflight.delete(key);
    }
  }

  async cancel(request: { task_id: string; attempt_id: string }): Promise<void> {
    this.inflight.get(request.attempt_id)?.abort();
    this.inflight.delete(request.attempt_id);
  }

  async pause(): Promise<void> {
    throw new BackendCapabilityUnsupportedError('pauseResume');
  }

  async resume(): Promise<void> {
    throw new BackendCapabilityUnsupportedError('pauseResume');
  }

  async health(): Promise<BackendHealth> {
    if (this.state === 'CLOSED') return 'UNAVAILABLE';
    if (this.state === 'DISCOVERED') return 'UNKNOWN';
    try {
      // The server answering is not enough; a missing model is DEGRADED, not HEALTHY.
      return await this.modelPresent() ? 'HEALTHY' : 'DEGRADED';
    } catch {
      return 'UNAVAILABLE';
    }
  }

  capabilities(): BackendCapabilities {
    return {
      streaming: true, toolCalling: false, structuredOutput: false, sessionResume: false,
      vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false,
      nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false
    };
  }

  async close(): Promise<void> {
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    this.state = 'CLOSED';
  }

  private assertReady(): void {
    if (this.state !== 'READY') throw new BackendError('BACKEND_UNAVAILABLE', 'Ollama backend is not initialized', false);
  }

  private buildMessages(context: ContextPack): OllamaChatMessage[] {
    const messages: OllamaChatMessage[] = [];
    const ordered = [...context.sections].sort((a, b) => a.priority - b.priority);
    for (const section of ordered) {
      messages.push({ role: section.type === 'SYSTEM' || section.type === 'INSTRUCTION' ? 'system' : 'user', content: `[${section.type}] ${section.content}` });
    }
    return messages;
  }
}
