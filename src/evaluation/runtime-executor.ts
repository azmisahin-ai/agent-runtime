import type { Runtime } from '../runtime/bootstrap.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AttemptOutcome, FailureCategory } from '../domain/types.js';
import { ProjectRepository } from '../persistence/project-repository.js';
import { canonicalHash } from '../domain/hash.js';
import type { EvaluationExecutor, ExecutionObservation } from './evaluation-runner.js';
import type { EvaluationTaskDefinition } from './suite.js';
import { GitInspector } from '../git/git-inspector.js';

// Runs a suite task through the real runtime so evaluation measures actual
// execution behavior (spec 06 §1-2). It copies nothing into the runtime's
// authority: the orchestrator still owns state, verification and success.
export class RuntimeEvaluationExecutor implements EvaluationExecutor {
  constructor(
    private readonly runtime: Runtime,
    private readonly workspaceRoot: string,
    // Host-declared verification. Only the host may decide what proves success.
    private readonly checksFor: (definition: EvaluationTaskDefinition) => { name: string; kind: 'TEST' | 'BUILD' | 'LINT' | 'TYPECHECK' | 'INVARIANT' | 'CUSTOM'; run: () => { status: 'PASS' | 'FAIL' | 'UNKNOWN'; evidence: string } }[]
  ) {}

  async execute(definition: EvaluationTaskDefinition, _context: { runId: string }): Promise<ExecutionObservation> {
    const projects = new ProjectRepository(this.runtime.db);
    const project = projects.create({ name: `eval:${definition.taskPackId}`, rootPath: this.workspaceRoot });
    const task = this.runtime.taskService.create(project.projectId, definition.title, definition.description);

    const git = new GitInspector(this.workspaceRoot);
    const revision = git.isRepository() ? git.state().head : null;
    const baselineTestHashes = snapshotHashes(git.changedFiles(null), this.workspaceRoot);

    const startedAt = Date.now();
    let outcome: AttemptOutcome = 'UNKNOWN';
    let verification: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN';
    let runtimeCategory: FailureCategory | null = null;
    let errorMessage: string | null = null;
    const toolRuns: { status: string; error: string | null; tool: string }[] = [];

    try {
      const result = await this.runtime.orchestrator.run(task.taskId, { checks: this.checksFor(definition), allowUnknown: false }, revision);
      outcome = result.outcome;
      verification = result.verification;
      runtimeCategory = result.failureCategory;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      outcome = 'FAILURE';
      verification = 'UNKNOWN';
      runtimeCategory = 'UNKNOWN_FAILURE';
    }
    const latencyMs = Date.now() - startedAt;

    const attempt = this.runtime.tasks.listAttempts(task.taskId)[0];
    const persistedToolRuns = attempt ? this.runtime.toolRuns.listAttempt(attempt.attemptId) : [];
    for (const run of persistedToolRuns) toolRuns.push({ status: run.status, error: run.error, tool: run.toolName });

    const observedTestHashes = snapshotHashes(git.changedFiles(null), this.workspaceRoot);

    return {
      outcome, verification, attemptOrdinal: attempt?.attemptNumber ?? 1, latencyMs, runtimeCategory, errorMessage, toolRuns,
      toolDenials: persistedToolRuns.filter(run => run.status === 'DENIED').length,
      toolTimeouts: persistedToolRuns.filter(run => run.status === 'TIMEOUT').length,
      recoveryAttempts: 0, humanInterventions: 0,
      modelTokens: 0, contextTokens: 0, contextRelevanceRatio: null, contextDuplicationRatio: null,
      memoryHits: 0, memoryMisses: 0, changedFiles: git.changedFiles(null), declaredScope: definition.constraints,
      baselineTestHashes, observedTestHashes,
      verificationSkippedCheck: false, skippedChecks: [],
      artifacts: [{ kind: 'summary', name: `${definition.taskPackId}.json`, content: JSON.stringify({ outcome, verification, latencyMs }) }],
      repositoryRevision: revision, evidence: { task_id: task.taskId, project_id: project.projectId, error: errorMessage }
    };
  }
}

function snapshotHashes(files: string[], root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    // Only test-like paths participate in tamper detection.
    if (!(/(^|\/)(test|tests|spec)(\/|$)/i.test(file) || /\.test\./.test(file))) continue;
    try { hashes[file] = canonicalHash(readFileSync(resolve(root, file), 'utf8')); } catch { hashes[file] = 'UNREADABLE'; }
  }
  return hashes;
}
