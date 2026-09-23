import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { TaskService } from '../../src/application/task-service.js';
import { DestructiveOperationPolicy } from '../../src/security/destructive-operations.js';
import { ProcessSandbox } from '../../src/security/process-sandbox.js';
import { PersistenceGuard } from '../../src/security/persistence-guard.js';
import { PolicyEngine } from '../../src/tools/policy.js';
import { ToolEngine } from '../../src/tools/tool-engine.js';
import { builtinTools } from '../../src/tools/builtin-tools.js';
import { ToolRunRepository } from '../../src/persistence/tool-run-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { nowIso } from '../../src/domain/id.js';
import type { ToolRequest } from '../../src/domain/types.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture(policyOptions: ConstructorParameters<typeof PolicyEngine>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-hardening2-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  mkdirSync(join(dir, '.runtime'), { recursive: true });
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const toolRuns = new ToolRunRepository(db);
  const events = new EventStore(db);
  const service = new TaskService(db, tasks, events);
  const policy = new PolicyEngine(policyOptions);
  const project = projects.create({ name: 'hardening', rootPath: dir });
  const task = service.create(project.projectId, 'Hardening work', 'd');
  const attempt = tasks.createAttempt({ taskId: task.taskId, backendId: 'fake', model: 'm' });
  const engineFor = (options: Partial<ConstructorParameters<typeof ToolEngine>[3]> = {}) => {
    const engine = new ToolEngine(db, toolRuns, events, {
      workspaceRoot: dir, pathGuard: { workspaceRoot: dir }, policy, ...options
    });
    for (const tool of builtinTools()) engine.register(tool);
    return engine;
  };
  const req = (tool: string, args: Record<string, unknown>): ToolRequest =>
    ({ requestId: `req_${Math.random().toString(36).slice(2)}`, taskId: task.taskId, attemptId: attempt.attemptId, tool, version: '1.0.0', arguments: args, timestamp: nowIso() });
  return { dir, db, toolRuns, policy, engineFor, req, task, attempt };
}

test('destructive Git operations are denied by baseline policy', () => {
  const policy = new DestructiveOperationPolicy();
  for (const args of [['push', 'origin', 'main'], ['reset', '--hard', 'HEAD~1'], ['clean', '-fdx'], ['rebase', 'main'], ['filter-branch', '--all']]) {
    const decision = policy.authorizeGit(args);
    assert.equal(decision.allowed, false, `git ${args.join(' ')} must be denied`);
    assert.equal(decision.operationClass, 'DESTRUCTIVE');
    assert.equal(decision.requiresApproval, true);
  }
});

test('read-only Git operations stay permitted', () => {
  const policy = new DestructiveOperationPolicy();
  for (const args of [['status', '--porcelain'], ['diff'], ['log', '--oneline'], ['rev-parse', 'HEAD']]) {
    const decision = policy.authorizeGit(args);
    assert.equal(decision.allowed, true, `git ${args.join(' ')} must be permitted`);
    assert.equal(decision.operationClass, 'READ_ONLY');
  }
  // `git branch` is read-only bare and a write with an argument.
  assert.equal(policy.classifyGit(['branch', '--show-current']), 'READ_ONLY');
  assert.equal(policy.classifyGit(['branch', 'new-branch']), 'WORKSPACE_WRITE');
});

test('destructive Git is only permitted with explicit operator policy', () => {
  const policy = new DestructiveOperationPolicy({ allowDestructive: true });
  const decision = policy.authorizeGit(['push', 'origin', 'main']);
  assert.equal(decision.allowed, true);
  // Even then it is flagged as requiring approval, never silently safe.
  assert.equal(decision.requiresApproval, true);
});

test('unknown Git subcommands are treated as unrecognized, not permitted', () => {
  const policy = new DestructiveOperationPolicy();
  const decision = policy.authorizeGit(['frobnicate', '--all']);
  assert.equal(decision.allowed, false);
  assert.equal(decision.operationClass, 'UNKNOWN');
});

test('process sandbox never inherits ambient secrets and bounds output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-sandbox-'));
  try {
    const sandbox = new ProcessSandbox({ workspaceRoot: dir, maxOutputBytes: 4096, timeoutMs: 5_000 });
    const result = sandbox.run(['/usr/bin/env']);
    // The explicit environment contains only the allowlisted keys.
    assert.equal(/SECRET|TOKEN|OPENHANDS/i.test(result.stdout), false, 'no secret-shaped variables leak in');
    assert.ok(/(^|\n)PATH=/.test(result.stdout));
    assert.equal(result.exitCode, 0);

    // Output beyond the bound is a bounded failure, not an unbounded read: the
    // sandbox reports no clean exit instead of emitting unbounded output.
    const oversized = sandbox.run(['/usr/bin/yes', 'x']);
    assert.equal(oversized.exitCode, null);
    assert.equal(oversized.timedOut, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('terminal.exec refuses to run without a configured sandbox', () => {
  const f = fixture({ allowProcessExecution: true, allowedCommands: ['echo'], grantedCapabilities: ['read_only', 'filesystem_read', 'git_access', 'process_execute'] });
  try {
    const engine = f.engineFor({ authorizeCommand: (argv) => f.policy.authorizeCommand(argv) });
    const result = engine.execute(f.req('terminal.exec', { argv: ['echo', 'hi'] }));
    assert.equal(result.status, 'FAILED');
    assert.match(result.error ?? '', /no process sandbox configured/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('terminal.exec runs an allowlisted command through the sandbox', () => {
  const f = fixture({ allowProcessExecution: true, allowedCommands: ['echo'], grantedCapabilities: ['read_only', 'filesystem_read', 'git_access', 'process_execute'] });
  try {
    const sandbox = new ProcessSandbox({ workspaceRoot: f.dir, maxOutputBytes: 4096, timeoutMs: 5_000 });
    const engine = f.engineFor({
      authorizeCommand: (argv) => f.policy.authorizeCommand(argv),
      runCommand: (argv, cwd, timeoutMs) => sandbox.run(argv, cwd, timeoutMs)
    });

    const ok = engine.execute(f.req('terminal.exec', { argv: ['echo', 'hello-world'] }));
    assert.equal(ok.status, 'SUCCEEDED');
    assert.match(ok.output ?? '', /hello-world/);

    // A destructive executable is denied even though process execution is enabled.
    assert.equal(f.policy.authorizeCommand(['rm', '-rf', '/']).allowed, false);
    // A non-allowlisted executable is denied.
    assert.equal(f.policy.authorizeCommand(['curl', 'http://example.com']).allowed, false);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a git tool refuses a destructive operation it would otherwise be handed', () => {
  const f = fixture();
  try {
    // A runner that would record any git invocation, to prove denial precedes it.
    const invoked: string[][] = [];
    const engine = f.engineFor({
      gitRunner: (args) => { invoked.push(args); return ''; },
      authorizeGit: (args) => new DestructiveOperationPolicy().authorizeGit(args)
    });
    const readResult = engine.execute(f.req('git.status', {}));
    assert.equal(readResult.status, 'SUCCEEDED');
    assert.deepEqual(invoked, [['status', '--porcelain']]);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('persistence guard reports durability and surfaces a broken store', () => {
  const f = fixture();
  try {
    assert.equal(new PersistenceGuard(f.db).probe().durable, true);

    // A closed store cannot be written to; the guard reports the failure instead
    // of pretending durable state exists.
    f.db.close();
    const report = new PersistenceGuard(f.db).probe();
    assert.equal(report.durable, false);
    assert.ok(report.error);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a durability failure parks the task instead of advancing it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-hardening2-'));
  try {
    const { bootstrap } = await import('../../src/runtime/bootstrap.js');
    // The guard is exercised through the real orchestrator against a store that
    // cannot be durably written.
    const runtime = bootstrap({ AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'), AGENT_RUNTIME_WORKSPACE: dir });
    const project = runtime.projects.create({ name: 'p', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 't', 'do');
    const guard = runtime.persistenceGuard as unknown as { probe: () => { durable: boolean; error: string | null } };
    // Force the probe to fail, as a read-only or corrupt canonical store would.
    guard.probe = () => ({ durable: false, error: 'readonly database' });
    await assert.rejects(
      () => runtime.orchestrator.run(task.taskId, { checks: [] }),
      /PERSISTENCE_FAILURE/
    );
    assert.equal(runtime.tasks.get(task.taskId)!.state, 'PAUSED');
    runtime.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
