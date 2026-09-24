import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import { INITIAL_SUITE } from '../../src/evaluation/suite.js';
import { RuntimeEvaluationExecutor } from '../../src/evaluation/runtime-executor.js';
import { checksForSuiteTask } from '../../src/evaluation/suite-checks.js';

// Proves the benchmark's real code path end to end: bootstrap -> orchestrator ->
// OllamaBackend -> HTTP -> per-task verificationIntent check -> suite aggregates.
// The model server answers with fixed text, so the result depends on the checks,
// not on a live model's quality. That is the point: it shows the checks can FAIL,
// and that UNKNOWN never becomes PASS.

interface FakeModel { server: Server; url: string; setAnswer: (answer: string) => void }

function startFakeModel(): Promise<FakeModel> {
  let answer = '';
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      if ((request.url ?? '') === '/api/tags') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"models":[]}');
        return;
      }
      if ((request.url ?? '') === '/api/chat') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: { content: answer }, done_reason: 'stop', prompt_eval_count: 5, eval_count: 5 }));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, setAnswer: value => { answer = value; } });
    });
  });
}

// Mirrors the benchmark's seed: a workspace whose baseline contains the defects
// the BUG_FIX task packs describe.
function seedWorkspace(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'math.js'), 'function add(a, b) {\n  return a + b + 1; // off-by-one\n}\n\nmodule.exports = { add };\n');
  writeFileSync(join(root, 'src', 'parse.js'), 'function parse(text) {\n  return text.split(",");\n}\n\nmodule.exports = { parse };\n');
  writeFileSync(join(root, 'src', 'retry.js'), 'function withRetry(fn, attempts) {\n  for (let i = 0; i < attempts; i += 1) { fn(); }\n}\n\nmodule.exports = { withRetry };\n');
  writeFileSync(join(root, 'src', 'state.js'), 'function transition(current, next) {\n  return next;\n}\n\nmodule.exports = { transition };\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'bench', version: '1.0.0' }, null, 2));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-q');
  git('config', 'user.email', 'b@local');
  git('config', 'user.name', 'b');
  git('add', '.');
  git('commit', '-q', '-m', 'seed with defects');
  chmodSync(root, 0o755);
}

test('per-task checks pass or fail from the answer, and UNKNOWN never becomes PASS', async () => {
  const model = await startFakeModel();
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-bench-int-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  seedWorkspace(workspace);

  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: workspace,
    AGENT_RUNTIME_OLLAMA_URL: model.url,
    AGENT_RUNTIME_MODEL: 'fake'
  });

  try {
    await runtime.orchestrator.initializeBackend();
    const executor = new RuntimeEvaluationExecutor(
      runtime,
      workspace,
      definition => checksForSuiteTask(definition, workspace),
      () => {
        execFileSync('git', ['checkout', '--', '.'], { cwd: workspace });
        execFileSync('git', ['clean', '-fd'], { cwd: workspace });
      }
    );

    // A helpful answer naming modules and describing fixes/features. The seeded
    // workspace still has its defects, so file-backed BUG_FIX checks must FAIL even
    // though the model claims a fix.
    model.setAnswer('I would fix src/math.js and parse.js; the fix asserts the default flag is off, adds an endpoint, a metric and a subcommand, and documents the recovery workflow.');
    const suite = { ...INITIAL_SUITE, tasks: INITIAL_SUITE.tasks.slice(0, 12) };
    const result = await runtime.evaluationRunner.runSuite(suite, executor, {
      backendId: 'ollama', provider: 'ollama', model: 'fake', runtimeVersion: 'test',
      contextConfig: {}, memorySnapshot: {}, toolConfig: {}, verificationConfig: {}
    });

    const byId = new Map(result.runs.map(item => [item.run.taskPackId, item.run]));
    // Claim-only analysis task whose answer names a module file: PASS.
    assert.equal(byId.get('repo-analyze-modules')?.verification, 'PASS');
    // The model claims a fix, but src/math.js still returns a + b + 1: FAIL.
    assert.equal(byId.get('bug-fix-off-by-one')?.verification, 'FAIL');
    // retry.js still leaks resources: FAIL.
    assert.equal(byId.get('bug-fix-retry-leak')?.verification, 'FAIL');

    // Aggregates must not treat every run as a pass.
    assert.notEqual(result.aggregates.success_rate, 1, 'a model that only claims a fix must not score 100%');
    assert.ok(result.aggregates.run_count === 12);
  } finally {
    runtime.db.close();
    model.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an answer naming no artifact fails the analysis check rather than scoring UNKNOWN as PASS', async () => {
  const model = await startFakeModel();
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-bench-int-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  seedWorkspace(workspace);

  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: workspace,
    AGENT_RUNTIME_OLLAMA_URL: model.url,
    AGENT_RUNTIME_MODEL: 'fake'
  });

  try {
    await runtime.orchestrator.initializeBackend();
    const executor = new RuntimeEvaluationExecutor(runtime, workspace, d => checksForSuiteTask(d, workspace));
    model.setAnswer('I am not sure, I did not read any files.');
    const firstTask = INITIAL_SUITE.tasks.find(t => t.taskPackId === 'repo-analyze-modules')!;
    const result = await runtime.evaluationRunner.runSuite({ ...INITIAL_SUITE, tasks: [firstTask] }, executor, {
      backendId: 'ollama', provider: 'ollama', model: 'fake', runtimeVersion: 'test',
      contextConfig: {}, memorySnapshot: {}, toolConfig: {}, verificationConfig: {}
    });
    assert.equal(result.runs[0].run.verification, 'FAIL');
    assert.equal(result.runs[0].run.outcome, 'UNKNOWN');
  } finally {
    runtime.db.close();
    model.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
