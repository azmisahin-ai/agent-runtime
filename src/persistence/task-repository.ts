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
}
