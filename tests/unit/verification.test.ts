import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { VerificationRepository } from '../../src/persistence/verification-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { TaskService } from '../../src/application/task-service.js';
import { VerificationEngine, aggregate } from '../../src/verification/verification-engine.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-verify-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const events = new EventStore(db);
  const service = new TaskService(db, tasks, events);
  const engine = new VerificationEngine(db, new VerificationRepository(db), events);
  // Verification rows reference real task/attempt records (foreign keys enforced).
  const project = projects.create({ name: 'v', rootPath: dir });
  const task = service.create(project.projectId, 'Verify', 'd');
  const attempt = tasks.createAttempt({ taskId: task.taskId, backendId: 'fake', model: 'm' });
  return { dir, db, tasks, events, engine, task, attempt };
}

function verify(f: ReturnType<typeof fixture>, checks: Parameters<VerificationEngine['verify']>[0]['checks'], allowUnknown = false) {
  return f.engine.verify({ taskId: f.task.taskId, attemptId: f.attempt.attemptId, agentClaim: 'claim', checks, allowUnknown });
}

test('a check receives the agent claim so intent checks can inspect the answer', () => {
  const f = fixture();
  try {
    let seen: string | null = null;
    const result = f.engine.verify({
      taskId: f.task.taskId, attemptId: f.attempt.attemptId, agentClaim: 'I fixed src/math.js',
      checks: [{ name: 'reads-claim', kind: 'INVARIANT', run: claim => { seen = claim; return { status: 'PASS', evidence: 'saw the claim' }; } }],
      allowUnknown: false
    });
    assert.equal(seen, 'I fixed src/math.js');
    assert.equal(result.status, 'PASS');
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('UNKNOWN is never PASS when allow_unknown is false', () => {
  const f = fixture();
  try {
    const result = verify(f, [{ name: 'tests', kind: 'TEST', run: () => ({ status: 'UNKNOWN', evidence: 'runner crashed' }) }]);
    assert.equal(result.status, 'UNKNOWN');
    assert.notEqual(result.status, 'PASS');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a failing check fails the whole verification even if others pass', () => {
  const f = fixture();
  try {
    const result = verify(f, [
      { name: 'build', kind: 'BUILD', run: () => ({ status: 'PASS', evidence: 'ok' }) },
      { name: 'tests', kind: 'TEST', run: () => ({ status: 'FAIL', evidence: '2 failures' }) }
    ]);
    assert.equal(result.status, 'FAIL');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('an exception inside a check becomes UNKNOWN, not PASS', () => {
  const f = fixture();
  try {
    const result = verify(f, [{ name: 'tests', kind: 'TEST', run: () => { throw new Error('boom'); } }]);
    assert.equal(result.status, 'UNKNOWN');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('verification is persisted and emits an event', () => {
  const f = fixture();
  try {
    const result = verify(f, [{ name: 'typecheck', kind: 'TYPECHECK', run: () => ({ status: 'PASS', evidence: 'tsc clean' }) }]);
    assert.equal(result.status, 'PASS');
    const verificationEvents = f.events.listTask(f.task.taskId).filter(e => e.type.startsWith('Verification'));
    assert.equal(verificationEvents.length, 1);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('agent claim alone cannot establish success (no checks means not PASS)', () => {
  const f = fixture();
  try {
    const result = verify(f, []);
    assert.notEqual(result.status, 'PASS');
    assert.equal(result.status, 'FAIL');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('aggregate-and-allowUnknown requires an explicit opt-in', () => {
  assert.equal(aggregate(['PASS', 'UNKNOWN'], false), 'UNKNOWN');
  assert.equal(aggregate(['PASS', 'UNKNOWN'], true), 'PASS');
  assert.equal(aggregate(['PASS', 'FAIL'], true), 'FAIL');
});
