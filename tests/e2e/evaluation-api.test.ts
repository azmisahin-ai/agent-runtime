import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import { ApiServer } from '../../src/api/server.js';
import { INITIAL_SUITE } from '../../src/evaluation/suite.js';
import { RuntimeEvaluationExecutor } from '../../src/evaluation/runtime-executor.js';
import { makeFakeBackend } from '../helpers/fake-backend.js';

const TOKEN = 'eval-token-456';

async function withServer(run: (base: string, runtime: ReturnType<typeof bootstrap>, dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-eval-api-'));
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_API_TOKEN: TOKEN
  });
  runtime.orchestrator.setBackend(makeFakeBackend(), 'fake');
  const server = new ApiServer(runtime.api, { port: 0, host: '127.0.0.1', token: TOKEN });
  const { port } = await server.listen();
  try {
    await run(`http://127.0.0.1:${port}/api/v1`, runtime, dir);
  } finally {
    await server.close();
    runtime.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function auth(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
}

test('evaluation suite metadata is exposed without authentication secrets', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/evaluations/suite`, { headers: auth() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.suite_id, INITIAL_SUITE.suiteId);
    assert.equal(body.task_count, 20);
    assert.deepEqual(body.by_category, { REPOSITORY_ANALYSIS: 5, BUG_FIX: 5, TEST_FIX: 5, FEATURE: 5 });
  });
});

test('a suite driven through the real runtime records verifiable runs, metrics and integrity', async () => {
  await withServer(async (base, runtime, dir) => {
    const executor = new RuntimeEvaluationExecutor(runtime, dir, () => [
      { name: 'build', kind: 'BUILD' as const, run: () => ({ status: 'PASS' as const, evidence: 'ok' }) }
    ]);
    // A small slice of the suite keeps this test bounded while exercising every layer.
    const suite = { ...INITIAL_SUITE, tasks: INITIAL_SUITE.tasks.slice(0, 4) };
    const result = await runtime.evaluationRunner.runSuite(suite, executor, {
      backendId: 'fake', provider: 'local', model: 'test-model', runtimeVersion: '0.1.0-dev',
      contextConfig: {}, memorySnapshot: {}, toolConfig: {}, verificationConfig: { checks: ['build'] }
    });

    assert.equal(result.aggregates.run_count, 4);

    const runs = await (await fetch(`${base}/evaluations/runs?suite_id=${INITIAL_SUITE.suiteId}`, { headers: auth() })).json();
    assert.equal(runs.runs.length, 4);

    const runId = result.runs[0].run.runId;
    const detail = await (await fetch(`${base}/evaluations/runs/${runId}`, { headers: auth() })).json();
    assert.equal(detail.run_id, runId);
    assert.ok(detail.metrics.length > 0);
    assert.ok(detail.artifacts.length > 0);
    assert.ok(detail.integrity.length > 0);
    assert.ok(detail.baseline_hash.length > 0);

    const report = await (await fetch(`${base}/evaluations/report/${INITIAL_SUITE.suiteId}`, { headers: auth() })).json();
    assert.equal(report.run_count, 4);
    assert.equal('score' in report.overall, false);

    const compare = await fetch(`${base}/evaluations/compare?left=${INITIAL_SUITE.suiteId}&right=missing-suite`, { headers: auth() });
    assert.equal(compare.status, 400);

    const missing = await fetch(`${base}/evaluations/runs/evalrun_does_not_exist`, { headers: auth() });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');
  });
});

test('evaluation reads are allowed like other reads, and never expose secrets', async () => {
  await withServer(async (base) => {
    // Reads are read-only and permitted; no authoring path exists for evaluation
    // evidence, so there is no unauthenticated mutation surface to guard.
    const unauthenticated = await fetch(`${base}/evaluations/suite`);
    assert.equal(unauthenticated.status, 200);

    const body = await unauthenticated.json();
    assert.equal(JSON.stringify(body).includes(TOKEN), false);
    assert.equal(JSON.stringify(body).toLowerCase().includes('secret'), false);

    const wrongToken = await fetch(`${base}/evaluations/suite`, { headers: { authorization: 'Bearer nope' } });
    assert.equal(wrongToken.status, 200, 'read remains allowed; token is only required for mutations');
  });
});
