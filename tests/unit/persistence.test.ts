import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { TaskService } from '../../src/application/task-service.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(resolve('migrations/001_initial.sql'));
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const events = new EventStore(db);
  const service = new TaskService(db, tasks, events);
  return { dir, db, projects, tasks, events, service };
}

test('project/task/event lifecycle persists atomically', () => {
  const f = fixture();
  try {
    const project = f.projects.create({ name: 'fixture', rootPath: f.dir });
    const task = f.service.create(project.projectId, 'Find config', 'Find a config value');
    assert.equal(f.tasks.get(task.taskId)?.state, 'CREATED');
    f.service.transition(task.taskId, 'QUEUED');
    f.service.transition(task.taskId, 'RUNNING');
    const events = f.events.listTask(task.taskId);
    assert.deepEqual(events.map(e => e.type), ['TaskCreated', 'TaskStateChanged', 'TaskStateChanged']);
    assert.deepEqual(events.map(e => e.sequenceNumber), [1, 2, 3]);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('attempt numbers are monotonic per task', () => {
  const f = fixture();
  try {
    const project = f.projects.create({ name: 'fixture', rootPath: f.dir });
    const task = f.tasks.create({ projectId: project.projectId, title: 't', description: 'd' });
    const a1 = f.tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' });
    const a2 = f.tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' });
    assert.equal(a1.attemptNumber, 1);
    assert.equal(a2.attemptNumber, 2);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
