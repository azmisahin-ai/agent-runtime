import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrap } from '../src/runtime/bootstrap.js';
import { INITIAL_SUITE } from '../src/evaluation/suite.js';
import { RuntimeEvaluationExecutor } from '../src/evaluation/runtime-executor.js';
import { checksForSuiteTask } from '../src/evaluation/suite-checks.js';

// Drives the 20-task initial suite through the real runtime against a live model
// server (spec 06). Verification here is deliberately honest: it only asserts what
// the runtime can actually observe, so a model that answers without touching the
// workspace cannot be scored as SUCCESS. This is a measurement harness, not a
// scoring shortcut.

interface Args { model: string; baseUrl: string; outDir: string; limit: number | null; backend: 'ollama' | 'cli'; cliCommand: string | null }

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  const limit = get('--limit', '');
  const backend = get('--backend', 'ollama') === 'cli' ? 'cli' as const : 'ollama' as const;
  const cliCommand = get('--cli-command', '');
  return {
    model: get('--model', 'qwen2.5-coder:1.5b'),
    baseUrl: get('--base-url', 'http://127.0.0.1:11434'),
    outDir: get('--out', join(tmpdir(), 'agent-runtime-benchmark')),
    limit: limit ? Number(limit) : null,
    backend,
    cliCommand: cliCommand.length > 0 ? cliCommand : null
  };
}

// Seed a workspace whose baseline contains the defects the suite's BUG_FIX tasks
// describe, so a passing check means the defect was actually repaired rather than
// that the seed was already correct. It is a real git repository so evaluation
// runs can pin a repository revision and stay reproducible (spec 06 §7). The
// workspace is disposable and the runtime treats its contents as untrusted data.
function seedWorkspace(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'src', 'math.js'), 'function add(a, b) {\n  return a + b + 1; // off-by-one\n}\n\nmodule.exports = { add };\n');
  writeFileSync(join(root, 'src', 'parse.js'), 'function parse(text) {\n  return text.split(",");\n}\n\nmodule.exports = { parse };\n');
  writeFileSync(join(root, 'src', 'retry.js'), 'function withRetry(fn, attempts) {\n  for (let i = 0; i < attempts; i += 1) {\n    fn();\n  }\n}\n\nmodule.exports = { withRetry };\n');
  writeFileSync(join(root, 'src', 'state.js'), 'function transition(current, next) {\n  return next;\n}\n\nmodule.exports = { transition };\n');
  writeFileSync(join(root, 'tests', 'math.test.js'), 'const { add } = require("../src/math.js");\nif (add(2, 3) !== 5) throw new Error("add is wrong");\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'benchmark-workspace', version: '1.0.0', main: 'src/math.js' }, null, 2));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
  git('init', '-q');
  git('config', 'user.email', 'benchmark@local');
  git('config', 'user.name', 'benchmark');
  git('add', '.');
  git('commit', '-q', '-m', 'benchmark workspace with known defects');
}

// Group runs by category for a per-category read of the benchmark. Reporting is a
// description of what happened, never a single universal score (spec 06 §11).
function groupByCategory(runs: { category: string; outcome: string; verification: string }[]): Record<string, { run_count: number; success: number; verification_pass: number }> {
  const grouped: Record<string, { run_count: number; success: number; verification_pass: number }> = {};
  for (const run of runs) {
    const bucket = grouped[run.category] ?? { run_count: 0, success: 0, verification_pass: 0 };
    bucket.run_count += 1;
    if (run.outcome === 'SUCCESS') bucket.success += 1;
    if (run.verification === 'PASS') bucket.verification_pass += 1;
    grouped[run.category] = bucket;
  }
  return grouped;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = mkdtempSync(join(tmpdir(), 'agent-runtime-bench-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  seedWorkspace(workspace);

  const runtime = bootstrap(args.backend === 'cli' ? {
    AGENT_RUNTIME_DB_PATH: join(root, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: workspace,
    AGENT_RUNTIME_BACKEND: 'cli',
    AGENT_RUNTIME_CLI_COMMAND: args.cliCommand ?? '',
    AGENT_RUNTIME_ALLOW_PROCESS: 'true',
    AGENT_RUNTIME_CONTEXT_LIMIT: '4096'
  } : {
    AGENT_RUNTIME_DB_PATH: join(root, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: workspace,
    AGENT_RUNTIME_OLLAMA_URL: args.baseUrl,
    AGENT_RUNTIME_MODEL: args.model,
    AGENT_RUNTIME_CONTEXT_LIMIT: '4096'
  });

  // Health is only meaningful after initialization; a DISCOVERED adapter reports
  // UNKNOWN. Initialize first so the harness sees the real state.
  try {
    await runtime.orchestrator.initializeBackend();
  } catch {
    // Failure is reported through health below rather than thrown here.
  }
  const health = await runtime.backend.health();
  console.log(JSON.stringify({ status: 'BACKEND_HEALTH', backend: args.backend, model: args.model, base_url: args.baseUrl, health }, null, 2));
  if (health !== 'HEALTHY') {
    console.error('Model server is not healthy; refusing to fabricate a benchmark run.');
    runtime.db.close();
    rmSync(root, { recursive: true, force: true });
    process.exit(1);
  }

  // Each task pack is verified against the intent it declares. A check that cannot
  // decide returns UNKNOWN, which is never PASS, so an unscored task is reported as
  // unscored rather than as a pass (spec 06 §6, 11 §1-3).
  const executor = new RuntimeEvaluationExecutor(
    runtime,
    workspace,
    definition => checksForSuiteTask(definition, workspace),
    // Honours the declared EPHEMERAL_COPY isolation: reset to the pristine baseline
    // commit before each task so no task inherits another's changes.
    () => {
      spawnSync('git', ['checkout', '--', '.'], { cwd: workspace, shell: false });
      spawnSync('git', ['clean', '-fd'], { cwd: workspace, shell: false });
    }
  );

  const suite = args.limit ? { ...INITIAL_SUITE, tasks: INITIAL_SUITE.tasks.slice(0, args.limit) } : INITIAL_SUITE;
  const startedAt = Date.now();
  const result = await runtime.evaluationRunner.runSuite(suite, executor, {
    backendId: args.backend,
    provider: args.backend,
    model: args.backend === 'cli' ? (args.cliCommand ?? 'cli') : args.model,
    runtimeVersion: '0.1.0-dev',
    contextConfig: { modelContextLimit: 4096 },
    memorySnapshot: {},
    toolConfig: {},
    verificationConfig: { checks: ['per-task verificationIntent'] }
  });
  const elapsedMs = Date.now() - startedAt;

  const report = {
    suite_id: result.suiteId,
    run_count: result.aggregates.run_count,
    scope_note: 'Live-model run over a seeded workspace with known defects. FIX/ANALYSIS tasks are checked against their declared verificationIntent; UNKNOWN means the host had no check to decide. It still does not prove a model solved a real task on an arbitrary repository.',
    overall: result.aggregates,
    by_category: groupByCategory(result.runs.map(item => item.run)),
    runs: result.runs.map(item => ({
      task_pack_id: item.run.taskPackId,
      category: item.run.category,
      outcome: item.run.outcome,
      verification: item.run.verification,
      failure_category: item.run.failureCategory,
      latency_ms: item.observations.latencyMs,
      reproducible: item.run.reproducible,
      checks: (() => {
        const taskId = item.run.evidence['task_id'];
        if (typeof taskId !== 'string') return [];
        return (runtime.verifications.listTask(taskId).at(-1)?.checks ?? []).map(check => ({ name: check.name, status: check.status }));
      })()
    }))
  };
  mkdirSync(args.outDir, { recursive: true });
  const summaryPath = join(args.outDir, `benchmark-${args.model.replace(/[^a-z0-9]+/gi, '-')}.json`);
  writeFileSync(summaryPath, JSON.stringify({
    suite_id: result.suiteId,
    model: args.model,
    base_url: args.baseUrl,
    elapsed_ms: elapsedMs,
    aggregates: result.aggregates,
    report
  }, null, 2));

  console.log(JSON.stringify({
    status: 'BENCHMARK_COMPLETE',
    suite_id: result.suiteId,
    model: args.model,
    elapsed_ms: elapsedMs,
    aggregates: result.aggregates,
    summary_path: summaryPath
  }, null, 2));

  runtime.db.close();
  rmSync(root, { recursive: true, force: true });
}

await main();
