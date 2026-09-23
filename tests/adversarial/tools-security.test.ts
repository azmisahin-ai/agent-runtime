import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { ToolRunRepository } from '../../src/persistence/tool-run-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { TaskService } from '../../src/application/task-service.js';
import { ToolEngine } from '../../src/tools/tool-engine.js';
import { PolicyEngine } from '../../src/tools/policy.js';
import { builtinTools } from '../../src/tools/builtin-tools.js';
import { resolveWorkspacePath, ToolSecurityError } from '../../src/tools/path-guard.js';
import { repoPath } from '../../src/runtime/paths.js';
import { nowIso } from '../../src/domain/id.js';
import type { ToolRequest } from '../../src/domain/types.js';

function fixture(policyOptions: ConstructorParameters<typeof PolicyEngine>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-tools-'));
  writeFileSync(join(dir, 'src.txt'), 'hello world');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'nested.txt'), 'nested content');
  writeFileSync(join(dir, '.env'), 'SECRET_TOKEN=xyz');
  const outside = mkdtempSync(join(tmpdir(), 'agent-runtime-outside-'));
  writeFileSync(join(outside, 'secret.txt'), 'outside secret');
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const toolRuns = new ToolRunRepository(db);
  const events = new EventStore(db);
  const service = new TaskService(db, tasks, events);
  const policy = new PolicyEngine(policyOptions);
  const engine = new ToolEngine(db, toolRuns, events, {
    workspaceRoot: dir, pathGuard: { workspaceRoot: dir }, policy
  });
  for (const tool of builtinTools()) engine.register(tool);
  // Tool runs reference real task/attempt rows (foreign keys are enforced).
  const project = projects.create({ name: 'tools', rootPath: dir });
  const task = service.create(project.projectId, 'Tool work', 'd');
  const attempt = tasks.createAttempt({ taskId: task.taskId, backendId: 'fake', model: 'm' });
  return { dir, outside, db, toolRuns, engine, task, attempt };
}

function req(f: { task: { taskId: string }; attempt: { attemptId: string } }, tool: string, args: Record<string, unknown>): ToolRequest {
  return { requestId: `req_${Math.random().toString(36).slice(2)}`, taskId: f.task.taskId, attemptId: f.attempt.attemptId, tool, version: '1.0.0', arguments: args, timestamp: nowIso() };
}

test('read_file works inside the workspace and is persisted', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'read_file', { path: 'src.txt' }));
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(result.output, 'hello world');
    assert.equal(f.toolRuns.listAttempt(f.attempt.attemptId).length, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('path traversal is denied and recorded as DENIED, not FAILED', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'read_file', { path: '../../etc/passwd' }));
    assert.equal(result.status, 'DENIED');
    assert.match(String(result.error), /escapes workspace root/);
    assert.equal(f.toolRuns.listAttempt(f.attempt.attemptId)[0]?.status, 'DENIED');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('symlink escape is denied', () => {
  const f = fixture();
  try {
    symlinkSync(join(f.outside, 'secret.txt'), join(f.dir, 'link.txt'));
    const result = f.engine.execute(req(f, 'read_file', { path: 'link.txt' }));
    assert.equal(result.status, 'DENIED');
    assert.match(String(result.error), /symlink|outside/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('sensitive paths are denied by baseline policy', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'read_file', { path: '.env' }));
    assert.equal(result.status, 'DENIED');
    assert.match(String(result.error), /sensitive/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('unknown tool is rejected and recorded', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'terminal.exec', { argv: ['rm', '-rf', '/'] }));
    assert.equal(result.status, 'DENIED');
    assert.match(String(result.error), /unknown tool/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('invalid arguments fail schema validation before execution', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'read_file', { path: 123 }));
    assert.equal(result.status, 'FAILED');
    assert.equal((result.metadata as Record<string, unknown>).phase, 'VALIDATION');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('schema validation rejects unexpected properties', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'read_file', { path: 'src.txt', extra: 'no' }));
    assert.equal(result.status, 'FAILED');
    assert.equal((result.metadata as Record<string, unknown>).phase, 'VALIDATION');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('search_files finds matches without escaping the workspace', () => {
  const f = fixture();
  try {
    const result = f.engine.execute(req(f, 'search_files', { query: 'nested' }));
    assert.equal(result.status, 'SUCCEEDED');
    assert.match(String(result.output), /sub\/nested.txt/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});

test('process execution is denied by baseline policy', () => {
  assert.equal(new PolicyEngine().authorizeCommand(['ls']).allowed, false);
});

test('network capability is denied by baseline policy', () => {
  const decision = new PolicyEngine().evaluate({ toolName: 'fetch', capabilities: ['network_access'], permission: 'NETWORK_ACCESS' });
  assert.equal(decision.allowed, false);
});

test('resolveWorkspacePath rejects absolute paths outside the root', () => {
  const f = fixture();
  try {
    assert.throws(() => resolveWorkspacePath({ workspaceRoot: f.dir }, f.outside), ToolSecurityError);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); rmSync(f.outside, { recursive: true, force: true }); }
});
