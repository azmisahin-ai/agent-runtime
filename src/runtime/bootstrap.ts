import { resolve } from 'node:path';
import { Database } from '../persistence/database.js';
import { ProjectRepository } from '../persistence/project-repository.js';
import { TaskRepository } from '../persistence/task-repository.js';
import { EventStore } from '../events/event-store.js';
import { TaskService } from '../application/task-service.js';
import { loadConfig } from '../config/config.js';

export function bootstrap() {
  const config = loadConfig();
  const db = new Database(config.dbPath);
  db.migrate(resolve('migrations/001_initial.sql'));
  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const events = new EventStore(db);
  const taskService = new TaskService(db, tasks, events);
  return { config, db, projects, tasks, events, taskService };
}
