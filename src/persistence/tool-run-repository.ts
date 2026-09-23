import type { PermissionLevel, ToolRun, ToolRunStatus } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import type { Database } from './database.js';

export class ToolRunRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    taskId: string;
    attemptId: string;
    requestId: string;
    toolName: string;
    toolVersion: string;
    arguments: Record<string, unknown>;
    permission: PermissionLevel;
  }): ToolRun {
    const run: ToolRun = {
      toolRunId: newId('toolrun'), taskId: input.taskId, attemptId: input.attemptId,
      requestId: input.requestId, toolName: input.toolName, toolVersion: input.toolVersion,
      arguments: input.arguments, status: 'REQUESTED', permission: input.permission,
      output: null, error: null, metadata: {}, startedAt: null, endedAt: null, createdAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO tool_runs(tool_run_id,task_id,attempt_id,request_id,tool_name,tool_version,arguments_json,status,permission,output,error,metadata_json,started_at,ended_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(run.toolRunId, run.taskId, run.attemptId, run.requestId, run.toolName, run.toolVersion,
        JSON.stringify(run.arguments), run.status, run.permission, null, null, '{}', null, null, run.createdAt);
    return run;
  }

  setStatus(toolRunId: string, status: ToolRunStatus, patch: { output?: string | null; error?: string | null; metadata?: Record<string, unknown>; startedAt?: string; endedAt?: string } = {}): void {
    const current = this.get(toolRunId);
    if (!current) throw new Error(`ToolRun not found: ${toolRunId}`);
    this.db.raw.prepare('UPDATE tool_runs SET status=?, output=?, error=?, metadata_json=?, started_at=?, ended_at=? WHERE tool_run_id=?')
      .run(
        status,
        patch.output !== undefined ? patch.output : current.output,
        patch.error !== undefined ? patch.error : current.error,
        JSON.stringify(patch.metadata ?? current.metadata),
        patch.startedAt ?? current.startedAt,
        patch.endedAt ?? current.endedAt,
        toolRunId
      );
  }

  get(toolRunId: string): ToolRun | null {
    const row = this.db.raw.prepare('SELECT * FROM tool_runs WHERE tool_run_id = ?').get(toolRunId) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  listAttempt(attemptId: string): ToolRun[] {
    const rows = this.db.raw.prepare('SELECT * FROM tool_runs WHERE attempt_id = ? ORDER BY created_at ASC').all(attemptId) as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  // Any tool left non-terminal after a crash is UNKNOWN, never assumed successful (spec 11 §8).
  listNonTerminal(): ToolRun[] {
    const rows = this.db.raw.prepare("SELECT * FROM tool_runs WHERE status IN ('REQUESTED','VALIDATING','VALIDATED','AUTHORIZED','RUNNING') ORDER BY created_at ASC").all() as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  // Reconcile in-flight tool runs to UNKNOWN on restart. Returns affected run IDs.
  markNonTerminalUnknown(): string[] {
    const affected = this.listNonTerminal();
    for (const run of affected) {
      this.db.raw.prepare("UPDATE tool_runs SET status='UNKNOWN', error=?, ended_at=? WHERE tool_run_id=?")
        .run('interrupted: completion could not be proven after restart', new Date().toISOString(), run.toolRunId);
    }
    return affected.map(run => run.toolRunId);
  }

  private map(row: Record<string, unknown>): ToolRun {
    return {
      toolRunId: String(row.tool_run_id),
      taskId: String(row.task_id),
      attemptId: String(row.attempt_id),
      requestId: String(row.request_id),
      toolName: String(row.tool_name),
      toolVersion: String(row.tool_version),
      arguments: JSON.parse(String(row.arguments_json)) as Record<string, unknown>,
      status: row.status as ToolRunStatus,
      permission: row.permission as PermissionLevel,
      output: row.output === null || row.output === undefined ? null : String(row.output),
      error: row.error === null || row.error === undefined ? null : String(row.error),
      metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
      startedAt: row.started_at ? String(row.started_at) : null,
      endedAt: row.ended_at ? String(row.ended_at) : null,
      createdAt: String(row.created_at)
    };
  }
}
