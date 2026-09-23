import type {
  Attempt, AttemptOutcome, ContextPack, FailureCategory,
  Task, ToolRequest, ToolResult, VerificationStatus
} from '../domain/types.js';
import { nowIso } from '../domain/id.js';
import type { Database } from '../persistence/database.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { CheckpointRepository } from '../persistence/checkpoint-repository.js';
import type { ContextSnapshotRepository } from '../persistence/context-snapshot-repository.js';
import type { ConfigSnapshotRepository } from '../persistence/config-snapshot-repository.js';
import type { ToolRunRepository } from '../persistence/tool-run-repository.js';
import type { SessionRepository } from '../persistence/session-repository.js';
import type { EventStore } from '../events/event-store.js';
import type { AgentBackend, AgentResponse } from '../backends/agent-backend.js';
import type { ContextEngine } from '../context/context-engine.js';
import type { ToolEngine } from '../tools/tool-engine.js';
import type { VerificationEngine, VerifyInput } from '../verification/verification-engine.js';
import { decideRecovery, type RecoveryOutcome } from '../recovery/recovery-engine.js';
import type { EvaluationRecorder } from '../evaluation/evaluation-recorder.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { ContextRetriever } from '../context/context-retriever.js';
import { reconcileConfig } from '../config/config-reconciler.js';
import type { StructuredLogger, MetricsRegistry } from '../observability/logger.js';
import { GitInspector } from '../git/git-inspector.js';
import type { RuntimeConfig } from '../config/config.js';

export interface OrchestratorDeps {
  db: Database;
  config: RuntimeConfig;
  tasks: TaskRepository;
  checkpoints: CheckpointRepository;
  contextSnapshots: ContextSnapshotRepository;
  configSnapshots: ConfigSnapshotRepository;
  toolRuns: ToolRunRepository;
  sessions: SessionRepository;
  events: EventStore;
  contextEngine: ContextEngine;
  toolEngine: ToolEngine;
  verificationEngine: VerificationEngine;
  evaluationRecorder: EvaluationRecorder;
  memoryEngine?: MemoryEngine;
  contextRetriever?: ContextRetriever;
  logger?: StructuredLogger;
  metrics?: MetricsRegistry;
}

export interface RunResult {
  taskId: string;
  attemptId: string;
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  finalState: Task['state'];
  response: string | null;
  checkpointId: string;
  toolRuns: ToolResult[];
  recovery: RecoveryOutcome | null;
  failureCategory: FailureCategory | null;
}

// Runtime loop (spec 14 §2-3). The runtime, not the model, owns Task state and
// decides completion. A final model response is never proof of success.
export class RuntimeOrchestrator {
  private currentBackend: AgentBackend;
  private currentBackendId: string;

  constructor(private readonly deps: OrchestratorDeps, backend: AgentBackend, backendId = 'ollama') {
    this.currentBackend = backend;
    this.currentBackendId = backendId;
  }

  // Backend switching is explicit and audited (spec 05 §10, 14 §6).
  setBackend(backend: AgentBackend, backendId: string): void {
    this.currentBackend = backend;
    this.currentBackendId = backendId;
  }

  get backend(): AgentBackend { return this.currentBackend; }

  async run(taskId: string, verification: Omit<VerifyInput, 'taskId' | 'attemptId' | 'agentClaim'>, repositoryRevision: string | null = null): Promise<RunResult> {
    const { db, config, tasks, events } = this.deps;
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // Preconditions: an attempt runs only from QUEUED or RUNNING (spec 14 §3.2).
    if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
      throw new Error(`Task is in terminal state ${task.state} and cannot run; retry creates a new attempt (spec 13 §6)`);
    }
    if (task.state === 'CREATED') this.deps.tasks.transition(taskId, 'QUEUED');
    if (this.deps.tasks.get(taskId)!.state === 'QUEUED') this.deps.tasks.transition(taskId, 'RUNNING');

    const attempt = db.transaction(() => {
      const created = tasks.createAttempt({ taskId, backendId: this.currentBackendId, model: config.backend.model });
      this.deps.configSnapshots.create({
        taskId, attemptId: created.attemptId, schemaVersion: 1, profile: config.profile,
        effectiveConfig: this.effectiveConfig(), effectivePolicy: this.effectivePolicy(),
        backendId: created.backendId, model: created.model, policyVersion: config.policyVersion
      });
      this.deps.sessions.create({ taskId, attemptId: created.attemptId, backendId: created.backendId, externalSessionId: null });
      events.append({ projectId: task.projectId, taskId, attemptId: created.attemptId, type: 'AttemptStarted', source: 'RUNTIME', payload: { attemptNumber: created.attemptNumber } });
      return created;
    });

    const startedAt = nowIso();
    let response: AgentResponse | null = null;
    let responseText: string | null = null;
    let failureCategory: FailureCategory | null = null;
    let toolResults: ToolResult[] = [];

    try {
      response = await this.backend.send({
        task_id: taskId,
        attempt_id: attempt.attemptId,
        context: this.buildContext(tasks.get(taskId)!, attempt.attemptId, config.backend.model),
        response_mode: 'TEXT'
      });
      responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content ?? '');
      toolResults = this.runRequestedTools(task, attempt, response);
    } catch (error) {
      failureCategory = classify(error);
      events.append({ projectId: task.projectId, taskId, attemptId: attempt.attemptId, type: 'BackendRequestFailed', source: 'BACKEND', payload: { category: failureCategory } });
      this.deps.logger?.error('BACKEND', 'backend request failed', { category: failureCategory }, { task_id: taskId, attempt_id: attempt.attemptId });
      this.deps.metrics?.increment('runtime.backend_failures_total', 1, { category: failureCategory });
    }

    // A tool request for a non-existent/invalid tool is not an execution failure of
    // the model itself, but it does not establish success either. Tool denials are
    // recorded as observations and never as authorization.
    this.deps.tasks.transition(taskId, 'VERIFYING');
    const verificationResult = this.deps.verificationEngine.verify({
      taskId,
      attemptId: attempt.attemptId,
      agentClaim: responseText ?? '',
      checks: verification.checks,
      allowUnknown: verification.allowUnknown,
      affectedScope: verification.affectedScope
    });

    // An attempt whose agent execution failed can never be COMPLETED, even if an
    // incidental check passes: there is no valid agent result to verify against.
    const agentExecuted = failureCategory === null;
    const verified = agentExecuted && verificationResult.status === 'PASS';
    const outcome: AttemptOutcome = !agentExecuted ? 'FAILURE' : verificationResult.status === 'PASS' ? 'SUCCESS' : 'UNKNOWN';
    const verificationStatus = verificationResult.status;

    const checkpoint = db.transaction(() => {
      const gitState = new GitInspector(config.workspaceRoot).state();
      const saved = this.deps.checkpoints.create({
        taskId, attemptId: attempt.attemptId, state: verified ? 'COMPLETED' : 'FAILED',
        currentGoal: task.title, currentStep: 'verification', repositoryRevision,
        gitState, contextSnapshotId: null, pendingAction: null
      });
      tasks.endAttempt(attempt.attemptId, outcome, verificationStatus);
      events.append({ projectId: task.projectId, taskId, attemptId: attempt.attemptId, type: 'AttemptCompleted', source: 'RUNTIME', payload: { outcome, verification: verificationStatus } });
      return saved;
    });

    let recovery: RecoveryOutcome | null = null;
    let finalState: Task['state'];
    if (verified) {
      finalState = this.transitionTo(taskId, 'COMPLETED');
    } else {
      recovery = decideRecovery({
        outcome, verification: verificationStatus, failureCategory,
        priorAttempts: tasks.countAttempts(taskId), maxRecoveryAttempts: config.maxRecoveryAttempts,
        securityViolation: failureCategory === 'PERMISSION_FAILURE'
      });
      if (recovery.decision === 'FAIL') finalState = this.transitionTo(taskId, 'FAILED');
      else finalState = this.transitionTo(taskId, 'PAUSED');
      events.append({ projectId: task.projectId, taskId, attemptId: attempt.attemptId, type: 'RecoveryDecisionMade', source: 'RUNTIME', payload: { decision: recovery.decision, reason: recovery.reason } });

      // Persist the failure as durable memory for later attempts (spec 03 §2).
      this.deps.memoryEngine?.recordFailure({
        projectId: task.projectId, taskId, attemptId: attempt.attemptId,
        summary: `Attempt ${attempt.attemptNumber} failed (${failureCategory ?? verificationStatus}): ${task.title}`
      });
    }

    this.deps.metrics?.increment('runtime.attempts_total', 1, { outcome, verification: verificationStatus });
    this.deps.metrics?.observe('runtime.attempt_duration_ms', Date.parse(nowIso()) - Date.parse(startedAt), { backend: this.currentBackendId });
    this.deps.logger?.info('TASK', 'attempt finished', { outcome, verification: verificationStatus, finalState }, { task_id: taskId, attempt_id: attempt.attemptId });

    this.deps.evaluationRecorder.record({
      taskId, attemptId: attempt.attemptId, backendId: attempt.backendId, provider: this.providerName(), model: attempt.model,
      repositoryRevision, runtimeConfig: this.effectiveConfig(), outcome, verification: verificationStatus,
      failureCategory, evidence: { responseId: response?.request_id ?? null, toolRunIds: toolResults.map(t => t.toolRunId) },
      startedAt, endedAt: nowIso()
    });

    return {
      taskId, attemptId: attempt.attemptId, outcome, verification: verificationStatus, finalState,
      response: responseText, checkpointId: checkpoint.checkpointId, toolRuns: toolResults, recovery, failureCategory
    };
  }

  // Resume: rebuild context from the latest checkpoint after reconciling workspace,
  // in-flight tool state and configuration (spec 11 §8, 13 §8, 16 §7). Old context
  // is evidence, not blindly reusable execution input.
  resume(taskId: string): { checkpointId: string | null; reconciledToolRuns: string[]; state: Task['state']; config: ReturnType<typeof reconcileConfig> | null } {
    const task = this.deps.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const checkpoint = this.deps.checkpoints.latest(taskId);
    const reconciled = this.deps.db.transaction(() => {
      const affected = this.deps.toolRuns.markNonTerminalUnknown();
      for (const toolRunId of affected) {
        this.deps.events.append({ projectId: task.projectId, taskId, attemptId: null, type: 'ToolRunReconciledUnknown', source: 'RUNTIME', payload: { toolRunId } });
      }
      return affected;
    });

    // Configuration reconciliation: a semantic change cannot be silently applied
    // to an active Attempt (spec 16 §7).
    let config: ReturnType<typeof reconcileConfig> | null = null;
    const activeAttemptId = task.currentAttemptId ?? checkpoint?.attemptId ?? null;
    if (activeAttemptId) {
      const snapshot = this.deps.configSnapshots.getForAttempt(activeAttemptId);
      if (snapshot) {
        config = reconcileConfig(snapshot, {
          profile: this.deps.config.profile, backendId: this.currentBackendId, model: this.deps.config.backend.model,
          policyVersion: this.deps.config.policyVersion,
          effectiveConfig: this.effectiveConfig(), effectivePolicy: this.effectivePolicy()
        });
        if (!config.compatible) {
          this.deps.events.append({
            projectId: task.projectId, taskId, attemptId: activeAttemptId, type: 'ConfigReconciliationMismatch',
            source: 'RUNTIME', payload: { changedFields: config.changedFields, reason: config.reason }
          });
        }
      }
    }

    // If configuration drifted, PAUSE instead of resuming under different semantics.
    if (config && !config.compatible) {
      if (task.state === 'RUNNING' || task.state === 'WAITING_TOOL') this.deps.tasks.transition(taskId, 'PAUSED');
      const paused = this.deps.tasks.get(taskId)!.state;
      this.deps.metrics?.increment('runtime.config_reconciliation_failures_total', 1);
      return { checkpointId: checkpoint?.checkpointId ?? null, reconciledToolRuns: reconciled, state: paused, config };
    }

    if (task.state === 'PAUSED') this.deps.tasks.transition(taskId, 'RUNNING');
    return { checkpointId: checkpoint?.checkpointId ?? null, reconciledToolRuns: reconciled, state: this.deps.tasks.get(taskId)!.state, config };
  }

  private buildContext(task: Task, attemptId: string, model: string): ContextPack {
    const gitState = new GitInspector(this.deps.config.workspaceRoot).state();
    // Retrieval integration (spec 04 §12, 12 §13): memory + repository results become
    // prioritised context sections. Retrieval is advisory; it cannot alter policy.
    const observations = this.deps.contextRetriever?.retrieve({
      projectId: task.projectId,
      queryText: `${task.title} ${task.description}`.trim()
    }) ?? [];
    const pack = this.deps.contextEngine.build({ task, attemptId, model, gitState, observations });
    this.deps.db.transaction(() => {
      this.deps.contextSnapshots.create({
        taskId: task.taskId, attemptId, model, tokenCount: pack.sections.reduce((sum, s) => sum + s.tokenCost, 0),
        sections: pack.sections, retrievalQuery: task.description || task.title
      });
    });
    return pack;
  }

  private runRequestedTools(task: Task, attempt: Attempt, response: AgentResponse): ToolResult[] {
    if (response.type !== 'TOOL_REQUEST') return [];
    const raw = response.content as Partial<ToolRequest> | undefined;
    if (!raw || typeof raw.tool !== 'string') return [];
    const request: ToolRequest = {
      requestId: raw.requestId ?? response.request_id, taskId: task.taskId, attemptId: attempt.attemptId,
      tool: raw.tool, version: raw.version ?? '1.0.0', arguments: (raw.arguments ?? {}) as Record<string, unknown>, timestamp: nowIso()
    };
    return [this.deps.toolEngine.execute(request)];
  }

  private transitionTo(taskId: string, state: Task['state']): Task['state'] {
    const current = this.deps.tasks.get(taskId)!;
    if (current.state === state) return state;
    const paths: Record<string, Task['state'][]> = {
      COMPLETED: ['VERIFYING', 'COMPLETED'],
      FAILED: ['VERIFYING', 'FAILED'],
      PAUSED: ['VERIFYING', 'PAUSED']
    };
    const path = paths[state] ?? [state];
    let from = current.state;
    for (const target of path) {
      if (from === target) continue;
      this.deps.tasks.transition(taskId, target);
      from = target;
    }
    return this.deps.tasks.get(taskId)!.state;
  }

  private backendId(): string { return this.currentBackendId; }
  private providerName(): string { return 'ollama'; }

  private effectiveConfig(): Record<string, unknown> {
    const { context, tools, maxRecoveryAttempts, profile, workspaceRoot } = this.deps.config;
    return { context, tools, maxRecoveryAttempts, profile, workspaceRoot };
  }

  private effectivePolicy(): Record<string, unknown> {
    const { networkAccess, allowProcessExecution, allowNetworkAccess, grantedCapabilities, allowedCommands, policyVersion } = this.deps.config;
    return { networkAccess, allowProcessExecution, allowNetworkAccess, grantedCapabilities, allowedCommands, policyVersion };
  }
}

function classify(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'TIMEOUT';
  if (/permission|denied|forbidden|EACCES/i.test(message)) return 'PERMISSION_FAILURE';
  if (/sqlite|persist|database|constraint/i.test(message)) return 'PERSISTENCE_FAILURE';
  if (/ENOENT|no such file|git|repo/i.test(message)) return 'REPOSITORY_FAILURE';
  if (/ollama|backend|ECONNREFUSED|network/i.test(message)) return 'BACKEND_FAILURE';
  return 'UNKNOWN_FAILURE';
}
