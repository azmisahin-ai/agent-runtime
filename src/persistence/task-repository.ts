import type { Task, Attempt } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { transitionTask } from '../domain/state-machine.js';
import type { Database } from './database.js';

export class TaskRepository {
  constructor(private readonly db: Database) {}

  create(input: { projectId: string; title: string; description: string }): Task {
    const task: Task = {
      taskId: newId('task'), projectId: input.projectId, title: input.title,
      description: input.description, state: 'CREATED', currentAttemptId: null,
      currentCheckpointId: null, createdAt: nowIso(), updatedAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO tasks(task_id,project_id,title,description,state,current_attempt_id,current_checkpoint_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(task.taskId, task.projectId, task.title, task.description, task.state, null, null, task.createdAt, task.updatedAt);
    return task;
  }

  get(taskId: string): Task | null {
    const row = this.db.raw.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
    return row ? {
      taskId: String(row.task_id), projectId: String(row.project_id), title: String(row.title), description: String(row.description),
      state: row.state as Task['state'], currentAttemptId: row.current_attempt_id ? String(row.current_attempt_id) : null,
      currentCheckpointId: row.current_checkpoint_id ? String(row.current_checkpoint_id) : null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    } : null;
  }

  transition(taskId: string, to: Task['state']): Task {
    const task = this.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const state = transitionTask(task.state, to);
    const updatedAt = nowIso();
    this.db.raw.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE task_id = ?').run(state, updatedAt, taskId);
    return { ...task, state, updatedAt };
  }

  createAttempt(input: { taskId: string; backendId: string; model: string }): Attempt {
    const row = this.db.raw.prepare('SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM attempts WHERE task_id = ?').get(input.taskId) as { n: number };
    const attempt: Attempt = {
      attemptId: newId('attempt'), taskId: input.taskId, attemptNumber: Number(row.n),
      backendId: input.backendId, model: input.model, startedAt: nowIso(), endedAt: null,
      outcome: null, verification: null
    };
    this.db.raw.prepare(`INSERT INTO attempts(attempt_id,task_id,attempt_number,backend_id,model,started_at,ended_at,outcome,verification) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(attempt.attemptId, attempt.taskId, attempt.attemptNumber, attempt.backendId, attempt.model, attempt.startedAt, null, null, null);
    this.db.raw.prepare('UPDATE tasks SET current_attempt_id=?, updated_at=? WHERE task_id=?').run(attempt.attemptId, nowIso(), input.taskId);
    return attempt;
  }

  getAttempt(attemptId: string): Attempt | null {
    const row = this.db.raw.prepare('SELECT * FROM attempts WHERE attempt_id = ?').get(attemptId) as Record<string, unknown> | undefined;
    return row ? this.mapAttempt(row) : null;
  }

  listAttempts(taskId: string): Attempt[] {
    const rows = this.db.raw.prepare('SELECT * FROM attempts WHERE task_id = ? ORDER BY attempt_number ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(row => this.mapAttempt(row));
  }

  countAttempts(taskId: string): number {
    const row = this.db.raw.prepare('SELECT COUNT(*) AS n FROM attempts WHERE task_id = ?').get(taskId) as { n: number };
    return Number(row.n);
  }

  endAttempt(attemptId: string, outcome: Attempt['outcome'], verification: Attempt['verification']): Attempt {
    const attempt = this.getAttempt(attemptId);
    if (!attempt) throw new Error(`Attempt not found: ${attemptId}`);
    if (attempt.endedAt) throw new Error(`Attempt already ended: ${attemptId}`);
    const endedAt = nowIso();
    this.db.raw.prepare('UPDATE attempts SET ended_at=?, outcome=?, verification=? WHERE attempt_id=?').run(endedAt, outcome, verification, attemptId);
    return { ...attempt, endedAt, outcome, verification };
  }

  private mapAttempt(row: Record<string, unknown>): Attempt {
    return {
      attemptId: String(row.attempt_id), taskId: String(row.task_id), attemptNumber: Number(row.attempt_number),
      backendId: String(row.backend_id), model: String(row.model), startedAt: String(row.started_at),
      endedAt: row.ended_at ? String(row.ended_at) : null,
      outcome: row.outcome === null || row.outcome === undefined ? null : row.outcome as Attempt['outcome'],
      verification: row.verification === null || row.verification === undefined ? null : row.verification as Attempt['verification']
    };
  }
}
