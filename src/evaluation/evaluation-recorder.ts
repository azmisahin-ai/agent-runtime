import type { AttemptOutcome, FailureCategory, VerificationStatus } from '../domain/types.js';
import type { Database } from '../persistence/database.js';
import type { EvaluationRepository } from '../persistence/verification-repository.js';
import type { EventStore } from '../events/event-store.js';

export interface EvaluationRecordInput {
  taskId: string;
  attemptId: string;
  backendId: string;
  provider: string;
  model: string;
  repositoryRevision: string | null;
  runtimeConfig: Record<string, unknown>;
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  failureCategory: FailureCategory | null;
  evidence: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
}

// Evaluation records what happened; it never alters the outcome (spec 14 §4).
export class EvaluationRecorder {
  constructor(
    private readonly db: Database,
    private readonly evaluations: EvaluationRepository,
    private readonly events: EventStore
  ) {}

  record(input: EvaluationRecordInput): string {
    return this.db.transaction(() => {
      const evaluationId = this.evaluations.create(input);
      this.events.append({
        projectId: null, taskId: input.taskId, attemptId: input.attemptId,
        type: 'EvaluationRecorded', source: 'SYSTEM',
        payload: { evaluationId, outcome: input.outcome, verification: input.verification, failureCategory: input.failureCategory }
      });
      return evaluationId;
    });
  }
}
