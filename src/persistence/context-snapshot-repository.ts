import type { ContextSection, ContextSnapshot } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { canonicalHash } from '../domain/hash.js';
import type { Database } from './database.js';

export class ContextSnapshotRepository {
  constructor(private readonly db: Database) {}

  create(input: { taskId: string; attemptId: string; model: string; tokenCount: number; sections: ContextSection[]; retrievalQuery: string }): ContextSnapshot {
    const snapshot: ContextSnapshot = {
      contextSnapshotId: newId('context'), taskId: input.taskId, attemptId: input.attemptId,
      model: input.model, tokenCount: input.tokenCount, contextHash: canonicalHash(input.sections),
      sections: input.sections, retrievalQuery: input.retrievalQuery, createdAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO context_snapshots(context_snapshot_id,task_id,attempt_id,model,token_count,context_hash,sections_json,retrieval_query,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(snapshot.contextSnapshotId, snapshot.taskId, snapshot.attemptId, snapshot.model, snapshot.tokenCount,
        snapshot.contextHash, JSON.stringify(snapshot.sections), snapshot.retrievalQuery, snapshot.createdAt);
    return snapshot;
  }

  get(contextSnapshotId: string): ContextSnapshot | null {
    const row = this.db.raw.prepare('SELECT * FROM context_snapshots WHERE context_snapshot_id = ?').get(contextSnapshotId) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  listTask(taskId: string): ContextSnapshot[] {
    const rows = this.db.raw.prepare('SELECT * FROM context_snapshots WHERE task_id = ? ORDER BY created_at ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  private map(row: Record<string, unknown>): ContextSnapshot {
    return {
      contextSnapshotId: String(row.context_snapshot_id), taskId: String(row.task_id), attemptId: String(row.attempt_id),
      model: String(row.model), tokenCount: Number(row.token_count), contextHash: String(row.context_hash),
      sections: JSON.parse(String(row.sections_json)) as ContextSection[],
      retrievalQuery: String(row.retrieval_query), createdAt: String(row.created_at)
    };
  }
}
