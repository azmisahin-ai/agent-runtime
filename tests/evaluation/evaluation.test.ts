import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { EvaluationRunRepository } from '../../src/persistence/evaluation-run-repository.js';
import { EvaluationRunner, type EvaluationExecutor, type ExecutionObservation } from '../../src/evaluation/evaluation-runner.js';
import { EvaluationReporter } from '../../src/evaluation/reporter.js';
import { RegressionRunner } from '../../src/evaluation/regression-runner.js';
import { FailureClassifier } from '../../src/evaluation/failure-classifier.js';
import { IntegrityChecker } from '../../src/evaluation/integrity.js';
import { ArtifactStore } from '../../src/evaluation/artifact-store.js';
import { INITIAL_SUITE, categoryCounts } from '../../src/evaluation/suite.js';
import type { EvaluationTaskDefinition, EvaluationSuite } from '../../src/evaluation/suite.js';
import { repoPath } from '../../src/runtime/paths.js';

function withStore<T>(fn: (ctx: { db: Database; repository: EvaluationRunRepository; dir: string }) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-eval-'));
  const db = new Database(join(dir, 'eval.db'));
  db.migrate(repoPath('migrations'));
  const repository = new EvaluationRunRepository(db);
  const cleanup = () => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  let result: T | Promise<T>;
  try {
    result = fn({ db, repository, dir });
  } catch (error) {
    cleanup();
    return Promise.reject(error);
  }
  return Promise.resolve(result).finally(cleanup);
}

function observation(overrides: Partial<ExecutionObservation> = {}): ExecutionObservation {
  return {
    outcome: 'SUCCESS', verification: 'PASS', attemptOrdinal: 1, latencyMs: 100, runtimeCategory: null,
    toolRuns: [], toolDenials: 0, toolTimeouts: 0, recoveryAttempts: 0, humanInterventions: 0,
    modelTokens: 10, contextTokens: 20, contextRelevanceRatio: 0.8, contextDuplicationRatio: 0.1,
    memoryHits: 1, memoryMisses: 0, changedFiles: [], declaredScope: [],
    baselineTestHashes: {}, observedTestHashes: {}, verificationSkippedCheck: false, skippedChecks: [],
    artifacts: [], repositoryRevision: 'abc123', evidence: {}, ...overrides
  };
}

class ScriptedExecutor implements EvaluationExecutor {
  constructor(private readonly script: (definition: EvaluationTaskDefinition) => ExecutionObservation) {}
  execute(definition: EvaluationTaskDefinition): ExecutionObservation { return this.script(definition); }
}

const context = {
  backendId: 'fake', provider: 'local', model: 'test-model', runtimeVersion: '0.1.0-dev',
  contextConfig: {}, memorySnapshot: {}, toolConfig: {}, verificationConfig: {}
};

function makeRunner(repository: EvaluationRunRepository, dir: string) {
  const classifier = new FailureClassifier();
  const integrity = new IntegrityChecker();
  const artifacts = new ArtifactStore(repository, join(dir, 'artifacts'));
  return { runner: new EvaluationRunner(repository, artifacts, classifier, integrity), classifier, integrity, artifacts };
}

test('initial suite has 20 tasks across the four required categories', () => {
  assert.equal(INITIAL_SUITE.tasks.length, 20);
  assert.deepEqual(categoryCounts(INITIAL_SUITE), {
    REPOSITORY_ANALYSIS: 5, BUG_FIX: 5, TEST_FIX: 5, FEATURE: 5
  });
  const ids = new Set(INITIAL_SUITE.tasks.map(task => task.taskPackId));
  assert.equal(ids.size, 20, 'task pack ids must be unique');
  for (const task of INITIAL_SUITE.tasks) {
    assert.ok(task.expectedBehavior.length > 0);
    assert.ok(task.verificationIntent.length > 0);
    assert.equal(task.isolation.network, 'DENY');
  }
});

test('runner records an immutable run with metrics, artifacts and reproducible conditions', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const suite: EvaluationSuite = { suiteId: 'suite-a', version: '1', tasks: [INITIAL_SUITE.tasks[0]] };
    const executor = new ScriptedExecutor(() => observation({ artifacts: [{ kind: 'summary', name: 'run.json', content: '{"ok":true}' }] }));

    const result = await runner.runSuite(suite, executor, context);
    assert.equal(result.aggregates.run_count, 1);
    assert.equal(result.aggregates.success_rate, 1);
    assert.equal(result.aggregates.verification_pass_rate, 1);

    const run = result.runs[0].run;
    assert.equal(run.outcome, 'SUCCESS');
    assert.equal(run.verification, 'PASS');
    assert.equal(run.primaryCause, null);
    assert.equal(run.reproducible, true);
    assert.ok(run.baselineHash.length > 0);

    const metrics = repository.listMetrics(run.runId);
    assert.ok(metrics.length > 0);
    assert.ok(metrics.some(metric => metric.name === 'latency_ms' && metric.value === 100));

    const artifacts = repository.listArtifacts(run.runId);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].reference, `${run.runId.replace(/[^A-Za-z0-9_.-]/g, '_')}/run.json`);
  });
});

test('a run the runtime marks UNKNOWN is never counted as success or verification PASS', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const suite: EvaluationSuite = { suiteId: 'suite-unknown', version: '1', tasks: [INITIAL_SUITE.tasks[0]] };
    const executor = new ScriptedExecutor(() => observation({ outcome: 'UNKNOWN', verification: 'UNKNOWN', runtimeCategory: null }));

    const result = await runner.runSuite(suite, executor, context);
    const run = result.runs[0].run;
    assert.equal(run.outcome, 'UNKNOWN');
    assert.equal(run.verification, 'UNKNOWN');
    assert.equal(run.primaryCause, 'VERIFICATION_FAILURE');
    assert.equal(result.aggregates.success_rate, 0);
    assert.equal(result.aggregates.verification_pass_rate, 0);
  });
});

test('failure attribution is evidence-based and cites observations', () => {
  const classifier = new FailureClassifier();

  const verified = classifier.classify({
    outcome: 'SUCCESS', verification: 'PASS', taskState: 'COMPLETED', runtimeCategory: null,
    toolRuns: [{ status: 'FAILED', error: 'noise', tool: 'grep' }], hadVerificationFailure: false
  });
  assert.equal(verified.primary, null, 'a verified success has no failure cause');

  const verificationFailure = classifier.classify({
    outcome: 'FAILURE', verification: 'FAIL', taskState: 'FAILED', runtimeCategory: null,
    toolRuns: [], hadVerificationFailure: true
  });
  assert.equal(verificationFailure.primary, 'VERIFICATION_FAILURE');

  const timeout = classifier.classify({
    outcome: 'TIMEOUT', verification: 'UNKNOWN', taskState: 'FAILED', runtimeCategory: null,
    toolRuns: [], hadVerificationFailure: false
  });
  assert.equal(timeout.primary, 'TIMEOUT');

  const denied = classifier.classify({
    outcome: 'FAILURE', verification: 'FAIL', taskState: 'FAILED', runtimeCategory: null,
    toolRuns: [{ status: 'DENIED', error: 'policy', tool: 'write_file' }], hadVerificationFailure: true
  });
  assert.equal(denied.primary, 'VERIFICATION_FAILURE');
  assert.ok(denied.secondary.includes('PERMISSION_FAILURE'));
  assert.ok((denied.evidence.tool_problems as unknown[]).length === 1);
});

test('integrity detection reports test tampering and verification bypass', () => {
  const integrity = new IntegrityChecker();
  const observations = integrity.inspect({
    baselineTestHashes: { 'tests/a.test.ts': 'hash-1' },
    observedTestHashes: { 'tests/a.test.ts': 'hash-2' },
    verificationSkippedCheck: true, verificationStatus: 'PASS', skippedChecks: ['integration'],
    declaredScope: ['src/a.ts'], changedFiles: ['src/a.ts', 'src/b.ts']
  });
  const kinds = observations.map(observation => observation.kind);
  assert.ok(kinds.includes('TEST_TAMPER'));
  assert.ok(kinds.includes('VERIFICATION_BYPASS'));
  assert.ok(kinds.includes('SIDE_EFFECT'));
  assert.ok(observations.every(observation => observation.detected));
});

test('reporter exposes per-category dimensions without a universal score', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const suite: EvaluationSuite = {
      suiteId: 'suite-multi', version: '1',
      tasks: [INITIAL_SUITE.tasks[0], INITIAL_SUITE.tasks[5], INITIAL_SUITE.tasks[10], INITIAL_SUITE.tasks[15]]
    };
    const executor = new ScriptedExecutor(definition => definition.category === 'BUG_FIX'
      ? observation({ outcome: 'FAILURE', verification: 'FAIL' })
      : observation());
    await runner.runSuite(suite, executor, context);

    const reporter = new EvaluationReporter(repository);
    const summary = reporter.summarize('suite-multi');
    assert.equal(summary.run_count, 4);
    assert.equal(summary.by_category.REPOSITORY_ANALYSIS.success_rate, 1);
    assert.equal(summary.by_category.BUG_FIX.success_rate, 0);
    assert.equal(summary.overall.success_rate, 0.75);
    assert.equal('score' in summary.overall, false, 'no universal score field');
  });
});

test('reporter compares two suite runs per dimension with signed deltas, no universal score', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const tasks = [INITIAL_SUITE.tasks[0], INITIAL_SUITE.tasks[1]];

    // Left: both succeed. Right: one succeeds, one fails.
    await runner.runSuite(
      { suiteId: 'suite-left', version: '1', tasks },
      new ScriptedExecutor(() => observation()),
      context
    );
    await runner.runSuite(
      { suiteId: 'suite-right', version: '1', tasks },
      new ScriptedExecutor(definition => definition.taskPackId === 'repo-analyze-entrypoints'
        ? observation({ outcome: 'FAILURE', verification: 'FAIL' })
        : observation()),
      context
    );

    const reporter = new EvaluationReporter(repository);
    const report = reporter.compare({ label: 'left', suiteId: 'suite-left' }, { label: 'right', suiteId: 'suite-right' });

    assert.equal(report.left_run_count, 2);
    assert.equal(report.right_run_count, 2);
    // Right regressed on success and verification; the delta is signed (right - left).
    assert.equal(report.metrics.success_rate.left, 1);
    assert.equal(report.metrics.success_rate.right, 0.5);
    assert.equal(report.metrics.success_rate.delta, -0.5);
    assert.equal(report.metrics.verification_pass_rate.delta, -0.5);
    // A dimension equal on both sides has a zero delta, not a missing one.
    assert.equal(report.metrics.mean_latency_ms.left, report.metrics.mean_latency_ms.right);
    assert.equal(report.metrics.mean_latency_ms.delta, 0);
    // Comparison reports labelled metrics; it never collapses to a single score.
    assert.equal('score' in report, false);
  });
});

test('regression runner reports a drop against a baseline and re-derives attribution', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const suite: EvaluationSuite = { suiteId: 'suite-reg', version: '1', tasks: [INITIAL_SUITE.tasks[0], INITIAL_SUITE.tasks[1]] };
    const executor = new ScriptedExecutor(definition => definition.taskPackId === 'repo-analyze-entrypoints'
      ? observation({ outcome: 'FAILURE', verification: 'FAIL' })
      : observation());
    await runner.runSuite(suite, executor, context);

    const classifier = new FailureClassifier();
    const regression = new RegressionRunner(repository, classifier);
    const clean = regression.detect({ suiteId: 'suite-reg', successRate: 0.5, verificationPassRate: 0.5, recordedAt: 'now', revision: null });
    assert.equal(clean.regressed, false);

    const regressed = regression.detect({ suiteId: 'suite-reg', successRate: 1, verificationPassRate: 1, recordedAt: 'now', revision: null });
    assert.equal(regressed.regressed, true);
    assert.ok(regressed.findings.some(finding => finding.kind === 'SUCCESS_RATE_DROP'));

    const firstRun = repository.listRuns({ suiteId: 'suite-reg' })[0];
    assert.equal(regression.reattribute(firstRun.runId).primary !== undefined, true);
  });
});

test('evaluation evidence is append-only: no update or delete path exists', async () => {
  await withStore(async ({ repository, dir }) => {
    const { runner } = makeRunner(repository, dir);
    const suite: EvaluationSuite = { suiteId: 'suite-immutable', version: '1', tasks: [INITIAL_SUITE.tasks[0]] };
    await runner.runSuite(suite, new ScriptedExecutor(() => observation()), context);
    const run = repository.listRuns({ suiteId: 'suite-immutable' })[0];

    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repository)).filter(name => name !== 'constructor');
    assert.deepEqual(methods.sort(), [
      'addArtifact', 'addIntegrity', 'addMetric', 'createRun', 'getRun', 'listArtifacts',
      'listIntegrity', 'listMetrics', 'listRuns'
    ]);
    assert.equal(methods.some(name => /^(update|delete|remove|set)/.test(name)), false);
    assert.ok(repository.getRun(run.runId));
  });
});
