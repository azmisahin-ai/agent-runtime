import type { EventSource, RuntimeEvent } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import type { Database } from '../persistence/database.js';

export class EventStore {
  constructor(private readonly db: Database) {}

  append(input: Omit<RuntimeEvent, 'eventId' | 'sequenceNumber' | 'timestamp'> & { timestamp?: string }): RuntimeEvent {
    const row = this.db.raw.prepare('SELECT COALESCE(MAX(sequence_number), 0) + 1 AS n FROM events WHERE project_id IS ?').get(input.projectId) as { n: number };
    const event: RuntimeEvent = {
      eventId: newId('event'), projectId: input.projectId, taskId: input.taskId, attemptId: input.attemptId,
      sequenceNumber: Number(row.n), type: input.type, timestamp: input.timestamp ?? nowIso(),
      source: input.source as EventSource, payload: input.payload
    };
    this.db.raw.prepare(`INSERT INTO events(event_id,project_id,task_id,attempt_id,sequence_number,type,timestamp,source,payload_json) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(event.eventId, event.projectId, event.taskId, event.attemptId, event.sequenceNumber, event.type, event.timestamp, event.source, JSON.stringify(event.payload));
    return event;
  }

  listTask(taskId: string): RuntimeEvent[] {
    const rows = this.db.raw.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY sequence_number ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(row => ({
      eventId: String(row.event_id), projectId: row.project_id ? String(row.project_id) : null,
      taskId: row.task_id ? String(row.task_id) : null, attemptId: row.attempt_id ? String(row.attempt_id) : null,
      sequenceNumber: Number(row.sequence_number), type: String(row.type), timestamp: String(row.timestamp),
      source: row.source as EventSource, payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>
    }));
  }
}
