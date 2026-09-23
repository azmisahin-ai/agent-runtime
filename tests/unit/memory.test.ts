import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { MemoryRepository } from '../../src/persistence/memory-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { MemoryEngine } from '../../src/memory/memory-engine.js';
import { shouldPersist } from '../../src/memory/memory-policy.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-mem-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const projects = new ProjectRepository(db);
  const repository = new MemoryRepository(db);
  const events = new EventStore(db);
  const engine = new MemoryEngine({ db, repository, events });
  const project = projects.create({ name: 'mem', rootPath: dir });
  return { dir, db, project, repository, events, engine };
}

test('durable memory persists across a database reopen', () => {
  const f = fixture();
  const dbPath = join(f.dir, 'runtime.db');
  let memoryId: string;
  try {
    const result = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'The runtime owns task state, not the model.',
      source: 'USER', confidence: 'HIGH'
    });
    assert.equal(result.persisted, true);
    memoryId = result.memoryId!;
  } finally { f.db.close(); }

  const reopened = new Database(dbPath);
  reopened.migrate(repoPath('migrations'));
  try {
    const repository = new MemoryRepository(reopened);
    const record = repository.get(memoryId);
    assert.ok(record);
    assert.equal(record!.status, 'ACTIVE');
    assert.equal(record!.source, 'USER');
  } finally { reopened.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('secrets are never persisted as durable memory', () => {
  const f = fixture();
  try {
    const result = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'api_key = "sk-abcdefghijklmnopqrstuvwxyz0123456789"',
      source: 'MODEL', confidence: 'HIGH'
    });
    assert.equal(result.persisted, false);
    assert.match(result.decision.reason, /secret/);
    assert.equal(f.repository.listByProject(f.project.projectId).length, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('the persistence gate rejects non-durable, unprovenanced and low-value candidates', () => {
  assert.equal(shouldPersist({ projectId: 'p', scope: 'TASK', type: 'WORKING', content: 'scratch note text', source: 'MODEL', confidence: 'HIGH' }).persist, false);
  assert.equal(shouldPersist({ projectId: 'p', scope: 'PROJECT', type: 'PROJECT', content: '', source: 'USER', confidence: 'HIGH' }).persist, false);
  const lowConfidence = shouldPersist({ projectId: 'p', scope: 'PROJECT', type: 'SEMANTIC', content: 'maybe the config lives here', source: 'MODEL', confidence: 'LOW' });
  assert.equal(lowConfidence.persist, false);
});

test('supersession retains the old record for audit', () => {
  const f = fixture();
  try {
    const first = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'Build command is npm run build:old', source: 'REPOSITORY', confidence: 'MEDIUM'
    });
    const second = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'Build command is npm run build:new', source: 'REPOSITORY', confidence: 'HIGH',
      supersedes: first.memoryId
    });
    assert.equal(second.superseded, first.memoryId);
    const old = f.repository.get(first.memoryId!)!;
    assert.equal(old.status, 'SUPERSEDED');
    assert.equal(old.supersededBy, second.memoryId);
    // Old record is retained, not deleted.
    assert.equal(f.repository.listByProject(f.project.projectId).length, 2);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('superseded memory is filtered from retrieval', () => {
  const f = fixture();
  try {
    const first = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'Test runner is jest', source: 'REPOSITORY', confidence: 'MEDIUM'
    });
    f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT',
      content: 'Test runner is node --test', source: 'REPOSITORY', confidence: 'HIGH', supersedes: first.memoryId
    });
    const retrieved = f.engine.retrieve({ projectId: f.project.projectId, queryText: 'test runner' });
    assert.equal(retrieved.length, 1);
    assert.match(retrieved[0].content, /node --test/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('contradictions create an explicit conflict and preserve both sides', () => {
  const f = fixture();
  try {
    const a = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'SEMANTIC',
      content: 'network access is denied', source: 'SYSTEM', confidence: 'HIGH'
    });
    const b = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'SEMANTIC',
      content: 'network access is allowed', source: 'MODEL', confidence: 'HIGH'
    });
    assert.equal(b.conflictWith, a.memoryId);
    assert.equal(f.repository.get(a.memoryId!)!.status, 'CONFLICTING');
    assert.equal(f.repository.get(b.memoryId!)!.status, 'CONFLICTING');
    const relations = f.repository.listRelations(b.memoryId!);
    assert.ok(relations.some(r => r.relation === 'contradicts'));
    // Both remain retrievable as explicit conflict evidence.
    assert.equal(f.repository.listByProject(f.project.projectId).length, 2);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('project isolation is enforced on retrieval', () => {
  const f = fixture();
  try {
    const other = new ProjectRepository(f.db).create({ name: 'other', rootPath: f.dir });
    f.engine.persist({ projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT', content: 'alpha project fact here', source: 'USER', confidence: 'HIGH' });
    const retrieved = f.engine.retrieve({ projectId: other.projectId, queryText: 'alpha' });
    assert.equal(retrieved.length, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('flush failure is explicit and observable', () => {
  const f = fixture();
  try {
    const result = f.engine.flush([
      { projectId: f.project.projectId, scope: 'PROJECT', type: 'PROJECT', content: 'valid durable fact', source: 'USER', confidence: 'HIGH' },
      // TASK-scoped without a task id fails validation inside the flush.
      { projectId: f.project.projectId, scope: 'TASK', type: 'PROJECT', content: 'invalid scoped fact', source: 'USER', confidence: 'HIGH' }
    ], { taskId: null });
    assert.equal(result.flushed, 1);
    assert.equal(result.failed.length, 1);
    const projectEvents = f.db.raw.prepare('SELECT type FROM events WHERE project_id = ? ORDER BY sequence_number ASC').all(f.project.projectId) as { type: string }[];
    assert.ok(projectEvents.some(e => e.type === 'MemoryFlushFailed'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('revalidation does not automatically invalidate on UNKNOWN', () => {
  const f = fixture();
  try {
    const result = f.engine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROCEDURAL',
      content: 'run npm run check before committing', source: 'USER', confidence: 'HIGH'
    });
    const kept = f.engine.revalidate(result.memoryId!, 'keep');
    assert.equal(kept!.status, 'ACTIVE');
    const uncertain = f.engine.revalidate(result.memoryId!, 'uncertain');
    assert.equal(uncertain!.status, 'UNCERTAIN');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('failure memory is recorded with provenance', () => {
  const f = fixture();
  try {
    const tasks = new TaskRepository(f.db);
    const task = tasks.create({ projectId: f.project.projectId, title: 'fix import', description: 'd' });
    const attempt = tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' });
    const result = f.engine.recordFailure({
      projectId: f.project.projectId, taskId: task.taskId, attemptId: attempt.attemptId,
      summary: 'Typecheck failed because of a missing import'
    });
    assert.equal(result.persisted, true);
    const record = f.repository.get(result.memoryId!)!;
    assert.equal(record.type, 'FAILURE');
    assert.equal(record.status, 'ACTIVE');
    assert.equal(record.relatedTaskId, task.taskId);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
