import { newId } from '../domain/id.js';
import { ProcessSandbox } from '../security/process-sandbox.js';
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

export interface CliBackendOptions {
  // The executable to launch. Never a shell string: argv is passed structurally.
  command: string;
  // Arguments placed before the prompt. The prompt is appended as the final argv.
  args?: string[];
  // Sandbox used for every launch (spec 15 §7). Callers pass the runtime's single
  // execution chokepoint so a CLI agent cannot escape policy.
  sandbox: ProcessSandbox;
  workspaceRoot: string;
  requestTimeoutMs?: number;
}

// Transport adapter for a CLI agent (spec 05 §7). The runtime reserves
// `CLIBackend` alongside `ACPBackend`/`NativeAgentBackend`; this is that adapter.
//
// The CLI is a subordinate execution backend (spec 14 §6): it receives a prompt,
// returns text, and its session id is mapped to a Task/Attempt. It never touches
// durable state, and every launch goes through the sandbox, so no shell, no
// inherited credentials, bounded output and a hard timeout all apply.
export class CliBackend implements AgentBackend {
  private readonly command: string;
  private readonly args: string[];
  private readonly sandbox: ProcessSandbox;
  private readonly workspaceRoot: string;
  private readonly requestTimeoutMs: number;
  private state: 'DISCOVERED' | 'READY' | 'CLOSED' = 'DISCOVERED';
  private readonly sessions = new Map<string, string>();

  constructor(options: CliBackendOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.sandbox = options.sandbox;
    this.workspaceRoot = options.workspaceRoot;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  }

  // Presence is proven by actually launching the executable, not by trusting a
  // path string. A missing or non-executable CLI fails here, before any work.
  async initialize(): Promise<void> {
    try {
      const probe = this.sandbox.run([this.command, '--version'], this.workspaceRoot, 10_000);
      if (probe.timedOut) throw new BackendError('BACKEND_UNAVAILABLE', `CLI ${this.command} did not answer --version`, true);
      if (probe.exitCode !== 0) {
        // Some CLIs reject --version but are still usable; treat a clean launch as
        // proof of presence and let the first real request surface real errors.
        if (probe.stderr.length === 0) throw new BackendError('BACKEND_UNAVAILABLE', `CLI ${this.command} is not executable`, false);
      }
      this.state = 'READY';
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw new BackendError('BACKEND_UNAVAILABLE', `CLI ${this.command} could not be launched: ${error instanceof Error ? error.message : String(error)}`, false);
    }
  }

  async start(request: StartRequest): Promise<ExecutionHandle> {
    this.assertReady();
    // The external session id is recorded for correlation only; it is never
    // runtime authority and never proves an Attempt succeeded (spec 05 §8).
    const externalSessionId = `cli_${this.command.replace(/[^a-z0-9]+/gi, '_')}_${request.attempt_id}`;
    this.sessions.set(request.attempt_id, externalSessionId);
    return { session_id: newId('session'), external_session_id: externalSessionId };
  }

  async send(request: AgentRequest): Promise<AgentResponse> {
    this.assertReady();
    const prompt = buildPrompt(request);
    const result = this.sandbox.run(
      [this.command, ...this.args, prompt],
      this.workspaceRoot,
      request.timeout_ms ?? this.requestTimeoutMs
    );
    if (result.timedOut) throw new BackendError('BACKEND_TIMEOUT', `CLI ${this.command} timed out`, true);
    if (result.exitCode !== 0) {
      throw new BackendError('BACKEND_FAILURE', `CLI ${this.command} exited with ${result.exitCode}: ${result.stderr.slice(0, 500)}`, true);
    }
    // An empty answer is not an answer. Returning it as FINAL would let a CLI that
    // failed silently (bad auth, no output) look like a completed attempt.
    if (result.stdout.trim().length === 0) {
      throw new BackendError('BACKEND_FAILURE', `CLI ${this.command} produced no output: ${result.stderr.slice(0, 500)}`, true);
    }
    return {
      request_id: newId('req'),
      type: 'FINAL',
      content: result.stdout,
      finish_reason: 'stop',
      backend_metadata: {
        provider: 'cli',
        command: this.command,
        external_session_id: this.sessions.get(request.attempt_id) ?? null,
        truncated: result.stderr.includes('ENOBUFS')
      }
    };
  }

  // The CLI transport is request/response; there is no incremental stream to relay.
  async *stream(): AsyncIterable<AgentEvent> {
    this.assertReady();
    throw new BackendCapabilityUnsupportedError('streaming');
  }

  async cancel(): Promise<void> {
    // The sandbox runs synchronously with a hard timeout, so there is no in-flight
    // handle to abort here. Cancellation is enforced by that timeout.
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
      const probe = this.sandbox.run([this.command, '--version'], this.workspaceRoot, 10_000);
      return probe.timedOut ? 'DEGRADED' : 'HEALTHY';
    } catch {
      return 'UNAVAILABLE';
    }
  }

  capabilities(): BackendCapabilities {
    return {
      streaming: false, toolCalling: false, structuredOutput: false, sessionResume: false,
      vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false,
      nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false
    };
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.state = 'CLOSED';
  }

  private assertReady(): void {
    if (this.state !== 'READY') throw new BackendError('BACKEND_UNAVAILABLE', `CLI backend ${this.command} is not initialized`, false);
  }
}

// The prompt is the only thing derived from runtime state, and it is passed as a
// single argv element. The runtime never builds a shell string (spec 15 §7).
function buildPrompt(request: AgentRequest): string {
  const sections = request.context.sections.map(section => `## ${section.type}\n${section.content}`).join('\n\n');
  const instructions = request.instructions ? `\n\n${request.instructions}` : '';
  return `You are a subordinate coding agent. Do not modify the workspace unless explicitly asked.\n\n${sections}${instructions}`;
}
