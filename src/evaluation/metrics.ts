import type { EvaluationRunRecord } from '../persistence/evaluation-run-repository.js';

export interface AggregateMetrics {
  run_count: number;
  success_rate: number;
  first_attempt_success_rate: number;
  verification_pass_rate: number;
  failure_categories: Record<string, number>;
  mean_latency_ms: number;
  median_latency_ms: number;
  p95_latency_ms: number;
  total_tool_calls: number;
  tool_failures: number;
  tool_denials: number;
  tool_timeouts: number;
  recovery_attempts: number;
  human_interventions: number;
  total_model_tokens: number;
  total_context_tokens: number;
}

export interface RunObservation {
  runId: string;
  attemptOrdinal: number;
  latencyMs: number;
  toolCalls: number;
  toolFailures: number;
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
}

export interface MetricPoint { name: string; value: number | null; unit: string; evidence: Record<string, unknown>; }

// Metrics are per-run and per-suite (spec 06 §5). No single universal score is
// emitted (spec 06 §11): the reporter exposes labelled dimensions side by side.
export function computeAggregate(runs: EvaluationRunRecord[], observations: RunObservation[]): AggregateMetrics {
  const byRun = new Map(observations.map(observation => [observation.runId, observation]));
  const latencies = observations.map(observation => observation.latencyMs).sort((a, b) => a - b);
  const succeeded = runs.filter(run => run.outcome === 'SUCCESS' && run.verification === 'PASS');
  const firstAttempt = runs.filter(run => {
    const observation = byRun.get(run.runId);
    return observation?.attemptOrdinal === 1 && run.outcome === 'SUCCESS' && run.verification === 'PASS';
  });
  const categories: Record<string, number> = {};
  for (const run of runs) {
    const key = run.primaryCause ?? 'NONE';
    categories[key] = (categories[key] ?? 0) + 1;
  }
  return {
    run_count: runs.length,
    success_rate: ratio(succeeded.length, runs.length),
    first_attempt_success_rate: ratio(firstAttempt.length, runs.length),
    verification_pass_rate: ratio(runs.filter(run => run.verification === 'PASS').length, runs.length),
    failure_categories: categories,
    mean_latency_ms: mean(latencies),
    median_latency_ms: percentile(latencies, 0.5),
    p95_latency_ms: percentile(latencies, 0.95),
    total_tool_calls: sum(observations.map(o => o.toolCalls)),
    tool_failures: sum(observations.map(o => o.toolFailures)),
    tool_denials: sum(observations.map(o => o.toolDenials)),
    tool_timeouts: sum(observations.map(o => o.toolTimeouts)),
    recovery_attempts: sum(observations.map(o => o.recoveryAttempts)),
    human_interventions: sum(observations.map(o => o.humanInterventions)),
    total_model_tokens: sum(observations.map(o => o.modelTokens)),
    total_context_tokens: sum(observations.map(o => o.contextTokens))
  };
}

// Per-run metric points persisted for a single evaluation run.
export function runMetricPoints(run: EvaluationRunRecord, observation: RunObservation): MetricPoint[] {
  return [
    { name: 'latency_ms', value: observation.latencyMs, unit: 'ms', evidence: { run_id: run.runId } },
    { name: 'model_tokens', value: observation.modelTokens, unit: 'tokens', evidence: {} },
    { name: 'context_tokens', value: observation.contextTokens, unit: 'tokens', evidence: {} },
    { name: 'tool_calls', value: observation.toolCalls, unit: 'count', evidence: {} },
    { name: 'tool_failures', value: observation.toolFailures, unit: 'count', evidence: {} },
    { name: 'tool_denials', value: observation.toolDenials, unit: 'count', evidence: {} },
    { name: 'tool_timeouts', value: observation.toolTimeouts, unit: 'count', evidence: {} },
    { name: 'recovery_attempts', value: observation.recoveryAttempts, unit: 'count', evidence: {} },
    { name: 'human_interventions', value: observation.humanInterventions, unit: 'count', evidence: {} },
    { name: 'context_relevance_ratio', value: observation.contextRelevanceRatio, unit: 'ratio', evidence: {} },
    { name: 'context_duplication_ratio', value: observation.contextDuplicationRatio, unit: 'ratio', evidence: {} },
    { name: 'memory_hits', value: observation.memoryHits, unit: 'count', evidence: {} },
    { name: 'memory_misses', value: observation.memoryMisses, unit: 'count', evidence: {} },
    { name: 'verified_completion', value: run.outcome === 'SUCCESS' && run.verification === 'PASS' ? 1 : 0, unit: 'boolean', evidence: { outcome: run.outcome, verification: run.verification } }
  ];
}

function sum(values: number[]): number { return values.reduce((a, b) => a + b, 0); }
function mean(values: number[]): number { return values.length === 0 ? 0 : sum(values) / values.length; }
function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 0 : numerator / denominator; }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index];
}
