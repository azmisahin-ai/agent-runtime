import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { TaskRepository } from '../../src/persistence/task-repository.js';
import { CheckpointRepository } from '../../src/persistence/checkpoint-repository.js';
import { ConfigSnapshotRepository } from '../../src/persistence/config-snapshot-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { TaskService } from '../../src/application/task-service.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-m1-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const checkpoints = new CheckpointRepository(db);
  const configSnapshots = new ConfigSnapshotRepository(db);
  const events = new EventStore(db);
  const service = new TaskService(db, tasks, events);
  return { dir, db, projects, tasks, checkpoints, configSnapshots, events, service };
}

test('checkpoint captures task, git state and pending action', () => {
  const f = fixture();
  try {
    const project = f.projects.create({ name: 'p', rootPath: f.dir });
    const task = f.service.create(project.projectId, 'Checkpoint', 'd');
    f.service.transition(task.taskId, 'QUEUED');
    const attempt = f.tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' });
    const checkpoint = f.checkpoints.create({
      taskId: task.taskId, attemptId: attempt.attemptId, state: 'RUNNING',
      currentGoal: 'Find config', currentStep: 'read_file', repositoryRevision: 'abc123',
      gitState: { head: 'abc123', branch: 'main', dirty: true },
      memoryRefs: ['mem_1'], pendingAction: { tool: 'read_file' }
    });
    const latest = f.checkpoints.latest(task.taskId);
    assert.equal(latest?.checkpointId, checkpoint.checkpointId);
    assert.equal(latest?.gitState.head, 'abc123');
    assert.equal(latest?.gitState.dirty, true);
    assert.deepEqual(latest?.memoryRefs, ['mem_1']);
    assert.deepEqual(latest?.pendingAction, { tool: 'read_file' });
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('latest checkpoint returns the most recent by creation order', () => {
  const f = fixture();
  try {
    const project = f.projects.create({ name: 'p', rootPath: f.dir });
    const task = f.service.create(project.projectId, 'Ordered', 'd');
    const base = { taskId: task.taskId, attemptId: null, state: 'RUNNING' as const, repositoryRevision: null, gitState: { head: null, branch: null, dirty: false } };
    const first = f.checkpoints.create({ ...base, currentGoal: 'g', currentStep: 's1' });
    const second = f.checkpoints.create({ ...base, currentGoal: 'g', currentStep: 's2' });
    assert.equal(f.checkpoints.list(task.taskId).length, 2);
    assert.equal(f.checkpoints.latest(task.taskId)?.checkpointId, second.checkpointId);
    assert.notEqual(first.checkpointId, second.checkpointId);
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('config snapshot is immutable and hash is stable across serialization order', () => {
  const f = fixture();
  try {
    const project = f.projects.create({ name: 'p', rootPath: f.dir });
    const task = f.service.create(project.projectId, 'Config', 'd');
    const attempt = f.tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' });
    const snapshot = f.configSnapshots.create({
      taskId: task.taskId, attemptId: attempt.attemptId, schemaVersion: 1, profile: 'local-dev',
      effectiveConfig: { context: { limit: 8192 }, tools: { maxOutputBytes: 100 } },
      effectivePolicy: { networkAccess: 'DENY' }, backendId: 'ollama', model: 'qwen', policyVersion: 1
    });
    const reloaded = f.configSnapshots.getForAttempt(attempt.attemptId);
    assert.equal(reloaded?.configHash, snapshot.configHash);
    assert.equal(reloaded?.effectiveConfig.context && (reloaded.effectiveConfig.context as Record<string, unknown>).limit, 8192);
    const same = f.configSnapshots.create({
      taskId: task.taskId, attemptId: f.tasks.createAttempt({ taskId: task.taskId, backendId: 'ollama', model: 'qwen' }).attemptId,
      schemaVersion: 1, profile: 'local-dev',
      effectiveConfig: { tools: { maxOutputBytes: 100 }, context: { limit: 8192 } },
      effectivePolicy: { networkAccess: 'DENY' }, backendId: 'ollama', model: 'qwen', policyVersion: 1
    });
    assert.equal(same.configHash, snapshot.configHash, 'key order must not change the hash');
  } finally {
    f.db.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
