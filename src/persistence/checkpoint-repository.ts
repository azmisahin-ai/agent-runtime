import type { Checkpoint, GitState, TaskState } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import type { Database } from './database.js';

export class CheckpointRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    taskId: string;
    attemptId: string | null;
    state: TaskState;
    currentGoal: string;
    currentStep: string;
    repositoryRevision: string | null;
    gitState: GitState;
    memoryRefs?: string[];
    contextSnapshotId?: string | null;
    pendingAction?: Record<string, unknown> | null;
  }): Checkpoint {
    const checkpoint: Checkpoint = {
      checkpointId: newId('checkpoint'),
      taskId: input.taskId,
      attemptId: input.attemptId,
      state: input.state,
      currentGoal: input.currentGoal,
      currentStep: input.currentStep,
      repositoryRevision: input.repositoryRevision,
      gitState: input.gitState,
      memoryRefs: input.memoryRefs ?? [],
      contextSnapshotId: input.contextSnapshotId ?? null,
      pendingAction: input.pendingAction ?? null,
      createdAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO checkpoints(checkpoint_id,task_id,attempt_id,state,current_goal,current_step,repository_revision,git_state_json,memory_refs_json,context_snapshot_id,pending_action_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        checkpoint.checkpointId, checkpoint.taskId, checkpoint.attemptId, checkpoint.state,
        checkpoint.currentGoal, checkpoint.currentStep, checkpoint.repositoryRevision,
        JSON.stringify(checkpoint.gitState), JSON.stringify(checkpoint.memoryRefs),
        checkpoint.contextSnapshotId, JSON.stringify(checkpoint.pendingAction), checkpoint.createdAt
      );
    return checkpoint;
  }

  latest(taskId: string): Checkpoint | null {
    const row = this.db.raw.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1').get(taskId) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  list(taskId: string): Checkpoint[] {
    const rows = this.db.raw.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY created_at ASC, checkpoint_id ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  private map(row: Record<string, unknown>): Checkpoint {
    return {
      checkpointId: String(row.checkpoint_id),
      taskId: String(row.task_id),
      attemptId: row.attempt_id ? String(row.attempt_id) : null,
      state: row.state as TaskState,
      currentGoal: String(row.current_goal),
      currentStep: String(row.current_step),
      repositoryRevision: row.repository_revision ? String(row.repository_revision) : null,
      gitState: JSON.parse(String(row.git_state_json)) as GitState,
      memoryRefs: JSON.parse(String(row.memory_refs_json)) as string[],
      contextSnapshotId: row.context_snapshot_id ? String(row.context_snapshot_id) : null,
      pendingAction: JSON.parse(String(row.pending_action_json)) as Record<string, unknown> | null,
      createdAt: String(row.created_at)
    };
  }
}
