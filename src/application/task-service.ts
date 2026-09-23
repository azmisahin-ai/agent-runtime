import { EventStore } from '../events/event-store.js';
import type { Task } from '../domain/types.js';
import { TaskRepository } from '../persistence/task-repository.js';
import type { Database } from '../persistence/database.js';

export class TaskService {
  constructor(private readonly db: Database, private readonly tasks: TaskRepository, private readonly events: EventStore) {}

  create(projectId: string, title: string, description: string): Task {
    return this.db.transaction(() => {
      const task = this.tasks.create({ projectId, title, description });
      this.events.append({ projectId, taskId: task.taskId, attemptId: null, type: 'TaskCreated', source: 'RUNTIME', payload: { title } });
      return task;
    });
  }

  transition(taskId: string, to: Task['state']): Task {
    return this.db.transaction(() => {
      const before = this.tasks.get(taskId);
      if (!before) throw new Error(`Task not found: ${taskId}`);
      // Idempotent repeat (spec 13 §7): requesting the state the task already holds
      // must not create a duplicate state-change effect or event.
      if (before.state === to) return before;
      const task = this.tasks.transition(taskId, to);
      this.events.append({ projectId: task.projectId, taskId, attemptId: task.currentAttemptId, type: 'TaskStateChanged', source: 'RUNTIME', payload: { from: before.state, to } });
      return task;
    });
  }
}
