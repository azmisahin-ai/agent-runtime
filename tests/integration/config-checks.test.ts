import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import { FakeBackend } from '../helpers/fake-backend.js';
import type { ApiContext } from '../../src/api/runtime-api.js';

// These tests prove the production path an operator actually uses: checks declared
// in configuration, bound at bootstrap, executed through the Tool Engine. Before
// this wiring existed the orchestrator's provider defaulted to an empty list, so
// every API-driven attempt was verified with no checks and could never COMPLETE
// (spec 11 §1-3).

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-config-checks-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'math.js'), 'function add(a, b) {\n  return a + b + 1;\n}\n\nmodule.exports = { add };\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'c@local');
  git('config', 'user.name', 'c');
  git('add', '.');
  git('commit', '-q', '-m', 'seed');
  return dir;
}

const CHECKS = JSON.stringify([{
  name: 'add_is_correct', kind: 'TEST',
  argv: ['node', '-e', 'const {add}=require("./src/math.js"); if (add(1,2)!==3) process.exit(1);']
}]);

function fixture(extra: Record<string, string>): { dir: string; runtime: ReturnType<typeof bootstrap> } {
  const dir = workspace();
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_ALLOW_PROCESS: 'true',
    AGENT_RUNTIME_ALLOWED_COMMANDS: 'node',
    ...extra
  });
  return { dir, runtime };
}

test('a configured check drives a real attempt to COMPLETED, and runs through the Tool Engine', async () => {
  const { dir, runtime } = fixture({ AGENT_RUNTIME_VERIFICATION_CHECKS: CHECKS });
  try {
    // The backend only answers; it never touches the file. The check is what proves
    // the task's stated outcome, so a passing run here shows the configured check
    // reached the orchestrator instead of the empty default.
    runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'I fixed add()' } }), 'fake');
    writeFileSync(join(dir, 'src', 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');

    const ctx: ApiContext = { requestId: 'req_1', principal: 'CLIENT' };
    const project = runtime.projects.create({ name: 'cfg', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 'check', 'verify a change');
    // Driven through the API surface, which is where the provider is consumed.
    const result = await runtime.api.runTask(ctx, task.taskId);

    assert.equal(result.verification, 'PASS');
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(result.final_state, 'COMPLETED');

    // The check command is canonical evidence, recorded like any other tool run.
    const attempt = runtime.tasks.listAttempts(task.taskId)[0];
    const runs = runtime.toolRuns.listAttempt(attempt.attemptId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].toolName, 'terminal.exec');
    assert.equal(runs[0].status, 'SUCCEEDED');
  } finally { runtime.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a configured check that fails keeps the attempt out of COMPLETED', async () => {
  const { dir, runtime } = fixture({ AGENT_RUNTIME_VERIFICATION_CHECKS: CHECKS });
  try {
    // The seed still carries the off-by-one, so the check must FAIL even though the
    // backend asserts success. An agent claim never establishes success (spec 11 §1).
    runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'I definitely fixed it' } }), 'fake');

    const ctx: ApiContext = { requestId: 'req_1', principal: 'CLIENT' };
    const project = runtime.projects.create({ name: 'cfg-fail', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 'check', 'verify a change');
    const result = await runtime.api.runTask(ctx, task.taskId);

    assert.equal(result.verification, 'FAIL');
    assert.notEqual(result.final_state, 'COMPLETED');
  } finally { runtime.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a check that the policy denies is UNKNOWN, never PASS', async () => {
  // No AGENT_RUNTIME_ALLOW_PROCESS: process_execute is denied, so the check cannot
  // establish anything and must not read as a green light (spec 11 §2, 15 §3).
  const dir = workspace();
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_VERIFICATION_CHECKS: CHECKS
  });
  try {
    runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'fixed' } }), 'fake');
    const ctx: ApiContext = { requestId: 'req_1', principal: 'CLIENT' };
    const project = runtime.projects.create({ name: 'denied', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 'check', 'verify a change');
    const result = await runtime.api.runTask(ctx, task.taskId);

    assert.equal(result.verification, 'UNKNOWN');
    assert.notEqual(result.final_state, 'COMPLETED');
    const verification = runtime.verifications.listTask(task.taskId)[0];
    assert.match(verification.checks[0].evidence, /denied/i);
  } finally { runtime.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a REPOSITORY check reads repository state, not the agent claim', async () => {
  const { dir, runtime } = fixture({
    AGENT_RUNTIME_VERIFICATION_CHECKS: JSON.stringify([{ name: 'tree_changed', kind: 'REPOSITORY' }])
  });
  try {
    runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'I changed everything' } }), 'fake');
    const ctx: ApiContext = { requestId: 'req_1', principal: 'CLIENT' };
    const project = runtime.projects.create({ name: 'repo', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 'repo', 'change the tree');
    const unchanged = await runtime.api.runTask(ctx, task.taskId);
    assert.equal(unchanged.verification, 'FAIL', 'an unchanged tree cannot prove a change was made');
    // A FAILED verification pauses the task; a terminal attempt is never revived in
    // place, so resuming is the defined way back to RUNNING (spec 13 §5).
    assert.equal(unchanged.final_state, 'PAUSED');

    runtime.taskService.transition(task.taskId, 'RUNNING');
    writeFileSync(join(dir, 'src', 'math.js'), 'function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n');
    const changed = await runtime.api.runTask(ctx, task.taskId);
    assert.equal(changed.verification, 'PASS');
    assert.equal(changed.final_state, 'COMPLETED');
  } finally { runtime.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('an unusable check declaration fails at startup instead of verifying nothing', () => {
  const dir = workspace();
  try {
    assert.throws(() => bootstrap({
      AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
      AGENT_RUNTIME_WORKSPACE: dir,
      AGENT_RUNTIME_VERIFICATION_CHECKS: '[{"name":"broken","kind":"TEST"}]'
    }), /requires an argv/);
    assert.throws(() => bootstrap({
      AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
      AGENT_RUNTIME_WORKSPACE: dir,
      AGENT_RUNTIME_VERIFICATION_CHECKS: 'not json'
    }), /must be valid JSON/);
    assert.throws(() => bootstrap({
      AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
      AGENT_RUNTIME_WORKSPACE: dir,
      AGENT_RUNTIME_VERIFICATION_CHECKS: '[{"name":"weird","kind":"MAGIC","argv":["node"]}]'
    }), /invalid kind/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
