import type { ToolDefinition, ToolRequest, ToolResult } from '../domain/types.js';
import { nowIso } from '../domain/id.js';
import type { Database } from '../persistence/database.js';
import type { ToolRunRepository } from '../persistence/tool-run-repository.js';
import type { EventStore } from '../events/event-store.js';
import { PolicyEngine } from './policy.js';
import { validateArguments } from './schema-validator.js';
import { type PathGuardOptions, ToolSecurityError } from './path-guard.js';
import { MAX_DEFAULT_OUTPUT, type ToolExecutionContext, type ToolImplementation } from './builtin-tools.js';

export interface ToolEngineOptions {
  workspaceRoot: string;
  pathGuard: PathGuardOptions;
  policy: PolicyEngine;
  maxOutputBytes?: number;
  gitRunner?: (args: string[]) => string;
  authorizeCommand?: (argv: string[]) => { allowed: boolean; reason: string };
  commandTimeoutMs?: number;
}

// The single authorized path for tool execution (spec 10 §1, 14 §5):
// REQUESTED -> VALIDATING -> VALIDATED -> AUTHORIZED -> RUNNING -> SUCCEEDED/FAILED/TIMEOUT/DENIED.
export class ToolEngine {
  private readonly registry = new Map<string, ToolImplementation>();
  private readonly maxOutputBytes: number;

  constructor(
    private readonly db: Database,
    private readonly toolRuns: ToolRunRepository,
    private readonly events: EventStore,
    private readonly options: ToolEngineOptions
  ) {
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_DEFAULT_OUTPUT;
  }

  register(tool: ToolImplementation): void {
    this.registry.set(tool.definition.name, tool);
  }

  list(): ToolDefinition[] {
    return [...this.registry.values()].map(tool => tool.definition).sort((a, b) => a.name.localeCompare(b.name));
  }

  execute(request: ToolRequest): ToolResult {
    const startedAt = nowIso();
    const tool = this.registry.get(request.tool);
    const definition = tool?.definition ?? {
      name: request.tool, version: request.version, description: '', capabilities: [],
      permission: 'READ_ONLY' as const, inputSchema: {}
    };

    // Every tool attempt is persisted, including denials (spec 10 §4, §12).
    const run = this.db.transaction(() =>
      this.toolRuns.create({
        taskId: request.taskId, attemptId: request.attemptId, requestId: request.requestId,
        toolName: request.tool, toolVersion: request.version, arguments: request.arguments,
        permission: definition.permission
      })
    );

    const finish = (status: ToolResult['status'], output: string | null, error: string | null, metadata: Record<string, unknown>): ToolResult => {
      const endedAt = nowIso();
      this.db.transaction(() => {
        this.toolRuns.setStatus(run.toolRunId, status, { output, error, metadata, startedAt, endedAt });
        this.events.append({
          projectId: null, taskId: request.taskId, attemptId: request.attemptId,
          type: `ToolRun${status.charAt(0)}${status.slice(1).toLowerCase()}`,
          source: 'TOOL',
          payload: { toolRunId: run.toolRunId, tool: request.tool, status, error }
        });
      });
      return { toolRunId: run.toolRunId, status, output, error, metadata, startedAt, endedAt };
    };

    if (!tool) return finish('DENIED', null, `unknown tool: ${request.tool}`, { phase: 'UNKNOWN_TOOL' });

    try {
      validateArguments(tool.definition.inputSchema, request.arguments);
    } catch (error) {
      return finish('FAILED', null, error instanceof Error ? error.message : String(error), { phase: 'VALIDATION' });
    }

    const policy = this.options.policy.evaluate({
      toolName: definition.name, capabilities: definition.capabilities, permission: definition.permission
    });
    if (!policy.allowed) return finish('DENIED', null, policy.reason, { phase: 'POLICY' });

    this.db.transaction(() => this.toolRuns.setStatus(run.toolRunId, 'RUNNING', { startedAt }));
    try {
      const context: ToolExecutionContext = {
        workspaceRoot: this.options.workspaceRoot,
        pathGuard: this.options.pathGuard,
        maxOutputBytes: this.maxOutputBytes,
        gitRunner: this.options.gitRunner,
        authorizeCommand: this.options.authorizeCommand,
        commandTimeoutMs: this.options.commandTimeoutMs
      };
      const raw = tool.execute(request.arguments, context);
      const { text, truncated } = truncateOutput(raw, this.maxOutputBytes);
      return finish('SUCCEEDED', text, null, { phase: 'EXECUTION', truncated });
    } catch (error) {
      if (error instanceof ToolSecurityError) {
        return finish('DENIED', null, error.message, { phase: 'SECURITY', code: error.code });
      }
      return finish('FAILED', null, error instanceof Error ? error.message : String(error), { phase: 'EXECUTION' });
    }
  }
}

function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  return { text: `${buffer.subarray(0, maxBytes).toString('utf8')}\n...[truncated at ${maxBytes} bytes]`, truncated: true };
}
