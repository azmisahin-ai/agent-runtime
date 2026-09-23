import type { AttemptOutcome, FailureCategory, VerificationStatus } from '../domain/types.js';
import { nowIso } from '../domain/id.js';
import type { EvaluationRunRepository, EvaluationRunRecord, EvaluationMetricRecord } from '../persistence/evaluation-run-repository.js';
import type { EvaluationTaskDefinition, EvaluationSuite } from './suite.js';
import { FailureClassifier } from './failure-classifier.js';
import { IntegrityChecker, type IntegrityObservation } from './integrity.js';
import { ArtifactStore } from './artifact-store.js';
import { computeAggregate, runMetricPoints, type AggregateMetrics, type RunObservation } from './metrics.js';

// What an executor observes while running one suite task. The runner owns
// evaluation bookkeeping; the executor only reports what happened.
export interface ExecutionObservation {
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  attemptOrdinal: number;
  latencyMs: number;
  runtimeCategory: FailureCategory | null;
  errorMessage?: string | null;
  toolRuns: { status: string; error: string | null; tool: string }[];
  toolDenials: number;
  toolTimeouts: number;
  recoveryAttempts: number;
  humanInterventions: number;
  modelTokens: number;
  contextTokens: number;
  contextRelevanceRatio: number | null;
  contextDuplicationRatio: number | null;
  memoryHits: number;
  memoryMisses: number;
  changedFiles: string[];
  declaredScope: string[];
  baselineTestHashes: Record<string, string>;
  observedTestHashes: Record<string, string>;
  verificationSkippedCheck: boolean;
  skippedChecks: string[];
  artifacts: { kind: string; name: string; content: string }[];
  repositoryRevision: string | null;
  evidence: Record<string, unknown>;
}

export interface EvaluationExecutor {
  execute(definition: EvaluationTaskDefinition, context: { runId: string }): Promise<ExecutionObservation> | ExecutionObservation;
}

export interface EvaluationContext {
  backendId: string;
  provider: string;
  model: string;
  runtimeVersion: string;
  contextConfig: Record<string, unknown>;
  memorySnapshot: Record<string, unknown>;
  toolConfig: Record<string, unknown>;
  verificationConfig: Record<string, unknown>;
}

export interface EvaluatedRun {
  run: EvaluationRunRecord;
  metrics: EvaluationMetricRecord[];
  observations: RunObservation;
  integrity: IntegrityObservation[];
}

export interface SuiteEvaluation {
  suiteId: string;
  aggregates: AggregateMetrics;
  runs: EvaluatedRun[];
}

// EvaluationRunner drives a suite through an executor and records immutable runs,
// per-run metrics, artifacts and integrity observations (spec 06 §7-10). It never
// changes task or verification outcomes; it measures them.
export class EvaluationRunner {
  constructor(
    private readonly repository: EvaluationRunRepository,
    private readonly artifacts: ArtifactStore,
    private readonly classifier: FailureClassifier,
    private readonly integrity: IntegrityChecker
  ) {}

  async runSuite(suite: EvaluationSuite, executor: EvaluationExecutor, context: EvaluationContext): Promise<SuiteEvaluation> {
    const evaluated: EvaluatedRun[] = [];
    for (const definition of suite.tasks) {
      evaluated.push(await this.runTask(suite, definition, executor, context));
    }
    const runs = evaluated.map(item => item.run);
    const observations = evaluated.map(item => item.observations);
    return { suiteId: suite.suiteId, aggregates: computeAggregate(runs, observations), runs: evaluated };
  }

  async runTask(suite: EvaluationSuite, definition: EvaluationTaskDefinition, executor: EvaluationExecutor, context: EvaluationContext): Promise<EvaluatedRun> {
    const startedAt = nowIso();
    const dryRunId = `evalrun_pending_${definition.taskPackId}`;
    const observation = await executor.execute(definition, { runId: dryRunId });
    const endedAt = nowIso();

    const attribution = this.classifier.classify({
      outcome: observation.outcome, verification: observation.verification, taskState: 'COMPLETED',
      runtimeCategory: observation.runtimeCategory, toolRuns: observation.toolRuns,
      hadVerificationFailure: observation.verification === 'FAIL', errorMessage: observation.errorMessage ?? null
    });

    const baselineHash = this.integrity.baselineHash({
      suite: suite.suiteId, version: suite.version, task: definition.taskPackId,
      revision: observation.repositoryRevision, context, tool: context.toolConfig, verification: context.verificationConfig
    });

    const run = this.repository.createRun({
      suiteId: suite.suiteId, suiteVersion: suite.version, taskPackId: definition.taskPackId,
      category: definition.category, expectedBehavior: definition.expectedBehavior,
      constraints: definition.constraints, isolation: definition.isolation,
      repositoryRevision: observation.repositoryRevision,
      backendId: context.backendId, provider: context.provider, model: context.model, runtimeVersion: context.runtimeVersion,
      contextConfig: context.contextConfig, memorySnapshot: context.memorySnapshot, toolConfig: context.toolConfig,
      verificationConfig: context.verificationConfig, baselineHash,
      outcome: observation.outcome, verification: observation.verification,
      failureCategory: attribution.primary, primaryCause: attribution.primary, secondaryCauses: attribution.secondary,
      attributionEvidence: attribution.evidence,
      reproducible: observation.repositoryRevision !== null,
      startedAt, endedAt, evidence: observation.evidence
    });

    const runObservation: RunObservation = {
      runId: run.runId, attemptOrdinal: observation.attemptOrdinal, latencyMs: observation.latencyMs,
      toolCalls: observation.toolRuns.length, toolFailures: observation.toolRuns.filter(r => r.status === 'FAILED').length,
      toolDenials: observation.toolDenials, toolTimeouts: observation.toolTimeouts,
      recoveryAttempts: observation.recoveryAttempts, humanInterventions: observation.humanInterventions,
      modelTokens: observation.modelTokens, contextTokens: observation.contextTokens,
      contextRelevanceRatio: observation.contextRelevanceRatio, contextDuplicationRatio: observation.contextDuplicationRatio,
      memoryHits: observation.memoryHits, memoryMisses: observation.memoryMisses
    };

    const metrics = runMetricPoints(run, runObservation).map(point =>
      this.repository.addMetric({ runId: run.runId, name: point.name, value: point.value, unit: point.unit, evidence: point.evidence, createdAt: nowIso() })
    );

    for (const artifact of observation.artifacts) {
      this.artifacts.write(run.runId, artifact.kind, artifact.name, artifact.content);
    }

    const integrityObservations = this.integrity.inspect({
      baselineTestHashes: observation.baselineTestHashes, observedTestHashes: observation.observedTestHashes,
      verificationSkippedCheck: observation.verificationSkippedCheck, verificationStatus: observation.verification,
      skippedChecks: observation.skippedChecks, declaredScope: observation.declaredScope, changedFiles: observation.changedFiles,
      baselineHashExpected: undefined, baselineHashObserved: undefined
    });
    for (const record of integrityObservations) {
      this.repository.addIntegrity({ runId: run.runId, kind: record.kind, detail: record.detail, detected: record.detected, evidence: record.evidence, createdAt: nowIso() });
    }

    return { run, metrics, observations: runObservation, integrity: integrityObservations };
  }
}
