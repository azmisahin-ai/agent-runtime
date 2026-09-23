import type { EvaluationRunRepository, EvaluationRunRecord } from '../persistence/evaluation-run-repository.js';
import { computeAggregate, type AggregateMetrics, type RunObservation } from './metrics.js';

export interface ComparisonReport {
  left_label: string;
  right_label: string;
  metrics: Record<string, { left: number | null; right: number | null; delta: number | null }>;
  left_run_count: number;
  right_run_count: number;
}

// Reports expose labelled metrics and comparisons (spec 06 §5, §11). There is no
// universal score; callers read the dimension they care about.
export class EvaluationReporter {
  constructor(private readonly repository: EvaluationRunRepository) {}

  aggregateFor(suiteId: string, observations: Map<string, RunObservation> = new Map()): AggregateMetrics {
    const runs = this.repository.listRuns({ suiteId });
    const observationRecords = runs.map(run => observations.get(run.runId) ?? zeroObservation(run.runId));
    return computeAggregate(runs, observationRecords);
  }

  summarize(suiteId: string): { suite_id: string; run_count: number; by_category: Record<string, AggregateMetrics>; overall: AggregateMetrics } {
    const runs = this.repository.listRuns({ suiteId });
    const categories = [...new Set(runs.map(run => run.category))];
    const byCategory: Record<string, AggregateMetrics> = {};
    for (const category of categories) {
      byCategory[category] = computeAggregate(runs.filter(run => run.category === category), runs.filter(run => run.category === category).map(run => zeroObservation(run.runId)));
    }
    return { suite_id: suiteId, run_count: runs.length, by_category: byCategory, overall: computeAggregate(runs, runs.map(run => zeroObservation(run.runId))) };
  }

  compare(left: { label: string; suiteId: string }, right: { label: string; suiteId: string }): ComparisonReport {
    const leftAggregate = this.aggregateFor(left.suiteId);
    const rightAggregate = this.aggregateFor(right.suiteId);
    const keys: (keyof AggregateMetrics)[] = ['success_rate', 'first_attempt_success_rate', 'verification_pass_rate', 'mean_latency_ms', 'p95_latency_ms', 'tool_failures', 'tool_denials', 'recovery_attempts'];
    const metrics: ComparisonReport['metrics'] = {};
    for (const key of keys) {
      const leftValue = leftAggregate[key];
      const rightValue = rightAggregate[key];
      const l = typeof leftValue === 'number' ? leftValue : null;
      const r = typeof rightValue === 'number' ? rightValue : null;
      metrics[String(key)] = { left: l, right: r, delta: l !== null && r !== null ? r - l : null };
    }
    return { left_label: left.label, right_label: right.label, metrics, left_run_count: leftAggregate.run_count, right_run_count: rightAggregate.run_count };
  }

  runs(suiteId: string): EvaluationRunRecord[] { return this.repository.listRuns({ suiteId }); }
}

function zeroObservation(runId: string): RunObservation {
  return {
    runId, attemptOrdinal: 1, latencyMs: 0, toolCalls: 0, toolFailures: 0, toolDenials: 0, toolTimeouts: 0,
    recoveryAttempts: 0, humanInterventions: 0, modelTokens: 0, contextTokens: 0,
    contextRelevanceRatio: null, contextDuplicationRatio: null, memoryHits: 0, memoryMisses: 0
  };
}
