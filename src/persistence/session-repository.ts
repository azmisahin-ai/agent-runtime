import { newId, nowIso } from '../domain/id.js';
import type { Database } from './database.js';

export interface SessionRecord {
  sessionId: string;
  taskId: string;
  attemptId: string;
  backendId: string;
  externalSessionId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(input: { taskId: string; attemptId: string; backendId: string; externalSessionId: string | null }): SessionRecord {
    const record: SessionRecord = {
      sessionId: newId('session'), taskId: input.taskId, attemptId: input.attemptId,
      backendId: input.backendId, externalSessionId: input.externalSessionId,
      status: 'ACTIVE', createdAt: nowIso(), updatedAt: nowIso()
    };
    this.db.raw.prepare('INSERT INTO sessions(session_id,task_id,attempt_id,backend_id,external_session_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(record.sessionId, record.taskId, record.attemptId, record.backendId, record.externalSessionId, record.status, record.createdAt, record.updatedAt);
    return record;
  }
}
