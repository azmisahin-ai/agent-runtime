import type { RuntimeApiService, ApiContext } from '../api/runtime-api.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { StructuredLogger } from '../observability/logger.js';

export interface TaskQueueDrainerOptions {
  tasks: TaskRepository;
  api: RuntimeApiService;
  intervalMs: number;
  logger?: StructuredLogger;
}

// The drainer turns an accepted `POST /tasks/{id}/start` into an attempt without a
// client calling `/run`. It is a scheduler, not an authority: it holds no state of
// its own, re-reads the queue each pass, and delegates to the API service so the
// same state machine, policy and verification path is used as a synchronous run
// (spec 09 §5, 14 §3). Draining is skipped while the workspace lock is held, and a
// failed task is never retried by the queue — that requires an explicit retry.
export class TaskQueueDrainer {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(private readonly options: TaskQueueDrainerOptions) {}

  // One pass. Sequential by design: concurrent attempts on one workspace are not
  // safe, and the workspace lock would reject the second writer anyway.
  async drainOnce(): Promise<string[]> {
    if (this.draining) return [];
    this.draining = true;
    const drained: string[] = [];
    try {
      for (const task of this.options.tasks.listByState('QUEUED')) {
        const ctx: ApiContext = { requestId: `drain:${task.taskId}`, principal: 'RUNTIME' };
        try {
          const result = await this.options.api.runTask(ctx, task.taskId);
          drained.push(task.taskId);
          this.options.logger?.info('TASK', 'queue drained a task', { outcome: result.outcome, verification: result.verification }, { task_id: task.taskId });
        } catch (error) {
          // A task that cannot start stays QUEUED; leaving it in place is better than
          // dropping it. It is not retried forever within one pass because the list
          // was taken at entry.
          this.options.logger?.error('TASK', 'queue could not start a task', { error: error instanceof Error ? error.message : String(error) }, { task_id: task.taskId });
        }
      }
    } finally {
      this.draining = false;
    }
    return drained;
  }

  start(): void {
    if (this.timer || this.options.intervalMs <= 0) return;
    this.timer = setInterval(() => { void this.drainOnce(); }, this.options.intervalMs);
    // Never hold the process open just for the queue.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
