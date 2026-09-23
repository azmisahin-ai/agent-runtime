import type { Runtime } from '../runtime/bootstrap.js';
import { ApiError, notFound } from './errors.js';
import { canonicalHash } from '../domain/hash.js';
import { nowIso } from '../domain/id.js';
import {
  toAttemptDto, toCheckpointDto, toEventDto, toProjectDto, toTaskDto, toToolRunDto, toVerificationDto
} from './dto.js';
import { SecurityAudit } from '../security/security-audit.js';
import { IdempotencyStore } from '../persistence/idempotency-store.js';
import { GitInspector } from '../git/git-inspector.js';

// Explicit principal identities. A caller can never become an authority merely by
// asserting a model identity (spec 09 §9). Model output is untrusted data.
export type Principal = 'CLIENT' | 'MODEL' | 'RUNTIME' | 'SYSTEM';

export interface ApiContext {
  requestId: string;
  principal: Principal;
  idempotencyKey?: string | null;
}

export interface RunOptions {
  // Verification checks are runtime-owned. A client cannot supply executable
  // checks, because that would let untrusted input define its own success
  // criteria (spec 11 §2, 15 §10). Only the unknown policy is request-scoped.
  allowUnknown?: boolean;
}

// API application layer (spec 09). It validates input, enforces the state machine
// through existing services, records idempotency and audit, and returns DTOs. It
// never writes DB state directly and never weakens runtime policy.
export class RuntimeApiService {
  readonly audit: SecurityAudit;
  private readonly idempotency: IdempotencyStore;

  constructor(private readonly runtime: Runtime) {
    this.audit = new SecurityAudit(runtime.db);
    this.idempotency = new IdempotencyStore(runtime.db);
  }

  // ---- Projects ----

  createProject(ctx: ApiContext, body: Record<string, unknown>) {
    const name = asNonEmptyString(body.name, 'name');
    const rootPath = asNonEmptyString(body.root_path ?? body.rootPath, 'root_path');
    const project = this.runtime.projects.create({ name, rootPath });
    this.audit.append({ projectId: project.projectId, eventType: 'ProjectCreated', decision: 'INFO', principal: ctx.principal, details: { name } });
    return toProjectDto(project);
  }

  getProject(ctx: ApiContext, projectId: string) {
    const project = this.runtime.projects.get(projectId);
    if (!project) throw notFound('project', projectId);
    return toProjectDto(project);
  }

  listProjects() {
    return this.runtime.db.raw.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()
      .map(row => toProjectDto(mapProject(row as Record<string, unknown>)));
  }

  // ---- Tasks ----

  createTask(ctx: ApiContext, projectId: string, body: Record<string, unknown>) {
    if (!this.runtime.projects.get(projectId)) throw notFound('project', projectId);
    const title = asNonEmptyString(body.title, 'title');
    const description = typeof body.description === 'string' ? body.description : '';
    const task = this.runtime.taskService.create(projectId, title, description);
    this.audit.append({ projectId, taskId: task.taskId, eventType: 'TaskCreated', decision: 'INFO', principal: ctx.principal, details: { title } });
    return toTaskDto(task);
  }

  getTask(ctx: ApiContext, taskId: string) {
    const task = this.runtime.tasks.get(taskId);
    if (!task) throw notFound('task', taskId);
    return toTaskDto(task);
  }

  // Asynchronous, idempotency-key protected state changes (spec 09 §5). The state
  // machine owns transitions; this layer only requests them.
  startTask(ctx: ApiContext, taskId: string, options: RunOptions = {}) {
    return this.idempotent(ctx, 'startTask', { taskId, options }, () => {
      const task = this.requireTask(taskId);
      if (task.state === 'RUNNING' || task.state === 'WAITING_TOOL') {
        throw new ApiError('TASK_ALREADY_RUNNING', 'Task is already running', false, { task_id: taskId });
      }
      if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
        throw new ApiError('TASK_INVALID_STATE', `Task is in terminal state ${task.state}`, false, { task_id: taskId });
      }
      if (task.state === 'CREATED') this.runtime.taskService.transition(taskId, 'QUEUED');
      return { task_id: taskId, state: this.runtime.tasks.get(taskId)!.state, accepted: true };
    });
  }

  pauseTask(ctx: ApiContext, taskId: string) {
    return this.idempotent(ctx, 'pauseTask', { taskId }, () => {
      const task = this.requireTask(taskId);
      if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
        throw new ApiError('TASK_INVALID_STATE', `Cannot pause task in terminal state ${task.state}`, false, { task_id: taskId });
      }
      this.runtime.taskService.transition(taskId, 'PAUSED');
      return { task_id: taskId, state: this.runtime.tasks.get(taskId)!.state };
    });
  }

  resumeTask(ctx: ApiContext, taskId: string) {
    return this.idempotent(ctx, 'resumeTask', { taskId }, () => {
      const task = this.requireTask(taskId);
      if (task.state !== 'PAUSED') {
        throw new ApiError('TASK_NOT_RESUMABLE', `Task is not paused (state ${task.state})`, false, { task_id: taskId });
      }
      const result = this.runtime.orchestrator.resume(taskId);
      // A configuration mismatch keeps the task PAUSED rather than silently resuming.
      if (result.config && !result.config.compatible) {
        throw new ApiError('CONFLICT', 'Configuration changed; resume requires reconciliation', false, { changed_fields: result.config.changedFields });
      }
      return { task_id: taskId, state: result.state, checkpoint_id: result.checkpointId, reconciled_tool_runs: result.reconciledToolRuns };
    });
  }

  cancelTask(ctx: ApiContext, taskId: string) {
    return this.idempotent(ctx, 'cancelTask', { taskId }, () => {
      const task = this.requireTask(taskId);
      if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
        throw new ApiError('TASK_INVALID_STATE', `Task is already terminal (${task.state})`, false, { task_id: taskId });
      }
      this.runtime.taskService.transition(taskId, 'CANCELLED');
      return { task_id: taskId, state: this.runtime.tasks.get(taskId)!.state };
    });
  }

  retryTask(ctx: ApiContext, taskId: string) {
    return this.idempotent(ctx, 'retryTask', { taskId }, () => {
      const task = this.requireTask(taskId);
      if (task.state !== 'FAILED' && task.state !== 'PAUSED' && task.state !== 'CANCELLED') {
        throw new ApiError('TASK_INVALID_STATE', `Retry is not valid from ${task.state}`, false, { task_id: taskId });
      }
      // A retry creates a new Attempt; it never revives the terminal Attempt (spec 13 §6).
      this.runtime.taskService.transition(taskId, 'QUEUED');
      return { task_id: taskId, state: this.runtime.tasks.get(taskId)!.state, new_attempt: true };
    });
  }

  // Executes one attempt. Kept separate from the async control verbs so the state
  // machine's VERIFYING transition is never driven directly by a client.
  async runTask(ctx: ApiContext, taskId: string, options: RunOptions = {}) {
    const task = this.requireTask(taskId);
    const checks = this.runtime.orchestrator.verificationChecksFor(task);
    // The runtime, not the client, decides what proves success. A client may only
    // relax UNKNOWN handling, never supply executable checks (spec 11 §2, 15 §10).
    const result = await this.runtime.orchestrator.run(taskId, { checks, allowUnknown: options.allowUnknown === true });
    this.audit.append({
      projectId: task.projectId, taskId, attemptId: result.attemptId, eventType: 'AttemptFinished',
      decision: result.outcome === 'SUCCESS' ? 'ALLOW' : 'DENY', principal: ctx.principal,
      details: { outcome: result.outcome, verification: result.verification, final_state: result.finalState }
    });
    return {
      task_id: result.taskId, attempt_id: result.attemptId, outcome: result.outcome,
      verification: result.verification, final_state: result.finalState, response: result.response,
      checkpoint_id: result.checkpointId, tool_run_ids: result.toolRuns.map(tool => tool.toolRunId),
      failure_category: result.failureCategory
    };
  }

  listEvents(ctx: ApiContext, taskId: string, afterSeq = 0) {
    this.requireTask(taskId);
    return this.runtime.events.listTask(taskId).filter(event => event.sequenceNumber > afterSeq).map(toEventDto);
  }

  listAttempts(ctx: ApiContext, taskId: string) {
    this.requireTask(taskId);
    return this.runtime.tasks.listAttempts(taskId).map(toAttemptDto);
  }

  listCheckpoints(ctx: ApiContext, taskId: string) {
    this.requireTask(taskId);
    return this.runtime.checkpoints.list(taskId).map(toCheckpointDto);
  }

  listToolRuns(ctx: ApiContext, taskId: string, attemptId?: string | null) {
    this.requireTask(taskId);
    const attempt = attemptId ?? this.runtime.tasks.get(taskId)!.currentAttemptId;
    if (!attempt) return [];
    return this.runtime.toolRuns.listAttempt(attempt).map(toToolRunDto);
  }

  listEvaluations(ctx: ApiContext, taskId: string) {
    this.requireTask(taskId);
    return this.runtime.verifications.listTask(taskId).map(toVerificationDto);
  }

  listMemories(ctx: ApiContext, projectId: string) {
    if (!this.runtime.projects.get(projectId)) throw notFound('project', projectId);
    return this.runtime.memories.query({ projectId }).map(record => ({
      memory_id: record.memoryId, scope: record.scope, type: record.type, content: record.content,
      source: record.source, confidence: record.confidence, status: record.status, created_at: record.createdAt
    }));
  }

  backendCapabilities() {
    return {
      backend_id: 'ollama',
      model: this.runtime.config.backend.model,
      capabilities: ['text', 'tool_request'],
      network_policy: this.runtime.config.networkAccess,
      process_execution: this.runtime.config.allowProcessExecution
    };
  }

  repositoryStatus(ctx: ApiContext, projectId: string) {
    if (!this.runtime.projects.get(projectId)) throw notFound('project', projectId);
    return this.runtime.repositoryReconciler.reconcile(projectId);
  }

  // Repository read surfaces (spec 09 §4). These are read-only and never mutate
  // the workspace or policy.
  repositoryTree(ctx: ApiContext, projectId: string) {
    const project = this.runtime.projects.get(projectId);
    if (!project) throw notFound('project', projectId);
    const index = this.runtime.repositoryIndex.getIndexState(projectId);
    const files = this.runtime.repositoryIndex.listFiles(projectId);
    return {
      project_id: projectId,
      state: index?.state ?? 'UNKNOWN',
      revision: index?.revision ?? null,
      indexed_at: index?.indexedAt ?? null,
      file_count: files.length,
      entries: files.slice(0, 500).map(file => ({
        path: file.path, language: file.language, size: file.size, content_hash: file.contentHash, revision: file.revision
      }))
    };
  }

  repositoryDiff(ctx: ApiContext, projectId: string, against: string | null) {
    const project = this.runtime.projects.get(projectId);
    if (!project) throw notFound('project', projectId);
    const git = new GitInspector(project.rootPath);
    if (!git.isRepository()) throw new ApiError('INVALID_REQUEST', 'Project root is not a git repository', false, { project_id: projectId });
    return { project_id: projectId, against, changed_files: git.changedFiles(against), diff: git.diff(against), commits: git.recentCommits(10) };
  }

  // ---- helpers ----

  private requireTask(taskId: string) {
    const task = this.runtime.tasks.get(taskId);
    if (!task) throw notFound('task', taskId);
    return task;
  }

  // Idempotency wrapper (spec 09 §5). The operation is keyed and its request hashed;
  // a replay returns the stored response, a mismatched payload is a conflict.
  private idempotent<T>(ctx: ApiContext, operation: string, request: unknown, action: () => T): T {
    const key = ctx.idempotencyKey ?? null;
    const requestHash = canonicalHash(JSON.stringify(request));
    if (key) {
      const { hit, conflict } = this.idempotency.lookup(key, operation, requestHash);
      if (conflict) throw new ApiError('CONFLICT', 'Idempotency key reused with a different payload', false, { operation });
      if (hit) return hit.response as T;
    }
    const result = action();
    if (key) this.idempotency.record(key, operation, requestHash, result as Record<string, unknown>, nowIso());
    return result;
  }
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('VALIDATION_ERROR', `Field '${field}' must be a non-empty string`, false, { field });
  }
  return value;
}

function mapProject(row: Record<string, unknown>) {
  return {
    projectId: String(row.project_id), name: String(row.name), rootPath: String(row.root_path),
    status: String(row.status) as 'ACTIVE' | 'ARCHIVED', createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}
