import type { EvaluationRunRepository } from '../persistence/evaluation-run-repository.js';
import { FailureClassifier, type AttributionInput } from './failure-classifier.js';
import { computeAggregate, type RunObservation } from './metrics.js';

export interface RegressionBaseline {
  suiteId: string;
  successRate: number;
  verificationPassRate: number;
  recordedAt: string;
  revision: string | null;
}

export interface RegressionFinding {
  kind: 'SUCCESS_RATE_DROP' | 'VERIFICATION_DROP' | 'NEW_FAILURE_CATEGORY';
  detail: string;
  baseline: number | string | null;
  current: number | string | null;
}

export interface RegressionReport {
  suite_id: string;
  regressed: boolean;
  findings: RegressionFinding[];
}

// Regression detection compares a suite's current aggregate against a stored
// baseline (spec 06 §12). It reports; it never rewrites history or hides a drop.
export class RegressionRunner {
  constructor(
    private readonly repository: EvaluationRunRepository,
    private readonly classifier: FailureClassifier
  ) {}

  detect(baseline: RegressionBaseline, tolerance = 0.0): RegressionReport {
    const runs = this.repository.listRuns({ suiteId: baseline.suiteId });
    const observations: RunObservation[] = runs.map(run => ({
      runId: run.runId, attemptOrdinal: 1, latencyMs: 0, toolCalls: 0, toolFailures: 0, toolDenials: 0,
      toolTimeouts: 0, recoveryAttempts: 0, humanInterventions: 0, modelTokens: 0, contextTokens: 0,
      contextRelevanceRatio: null, contextDuplicationRatio: null, memoryHits: 0, memoryMisses: 0
    }));
    const aggregate = computeAggregate(runs, observations);
    const findings: RegressionFinding[] = [];

    if (aggregate.success_rate < baseline.successRate - tolerance) {
      findings.push({ kind: 'SUCCESS_RATE_DROP', detail: 'success rate fell below baseline', baseline: baseline.successRate, current: aggregate.success_rate });
    }
    if (aggregate.verification_pass_rate < baseline.verificationPassRate - tolerance) {
      findings.push({ kind: 'VERIFICATION_DROP', detail: 'verification pass rate fell below baseline', baseline: baseline.verificationPassRate, current: aggregate.verification_pass_rate });
    }

    return { suite_id: baseline.suiteId, regressed: findings.length > 0, findings };
  }

  // Recompute attribution for a run's stored evidence, so a regression's cause is
  // re-derived rather than trusted from a label a caller supplied.
  reattribute(runId: string): { primary: string | null } {
    const run = this.repository.getRun(runId);
    if (!run) return { primary: null };
    const input: AttributionInput = {
      outcome: run.outcome, verification: run.verification, taskState: 'COMPLETED',
      runtimeCategory: run.failureCategory, toolRuns: [], hadVerificationFailure: run.verification === 'FAIL', errorMessage: null
    };
    return { primary: this.classifier.classify(input).primary };
  }
}
