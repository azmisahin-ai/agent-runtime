import type { AttemptOutcome, FailureCategory, VerificationCheck, VerificationResult, VerificationStatus } from '../domain/types.js';
import { newId } from '../domain/id.js';
import type { Database } from './database.js';

export class VerificationRepository {
  constructor(private readonly db: Database) {}

  create(input: { taskId: string; attemptId: string; status: VerificationStatus; checks: VerificationCheck[]; evidence: Record<string, unknown>; startedAt: string; endedAt: string }): VerificationResult {
    const result: VerificationResult = {
      verificationId: newId('verification'), taskId: input.taskId, attemptId: input.attemptId,
      status: input.status, checks: input.checks, evidence: input.evidence,
      startedAt: input.startedAt, endedAt: input.endedAt
    };
    this.db.raw.prepare(`INSERT INTO verifications(verification_id,task_id,attempt_id,status,checks_json,evidence_json,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(result.verificationId, result.taskId, result.attemptId, result.status, JSON.stringify(result.checks), JSON.stringify(result.evidence), result.startedAt, result.endedAt);
    return result;
  }

  listAttempt(attemptId: string): VerificationResult[] {
    const rows = this.db.raw.prepare('SELECT * FROM verifications WHERE attempt_id = ? ORDER BY started_at ASC').all(attemptId) as Record<string, unknown>[];
    return rows.map(row => ({
      verificationId: String(row.verification_id), taskId: String(row.task_id), attemptId: String(row.attempt_id),
      status: row.status as VerificationStatus, checks: JSON.parse(String(row.checks_json)) as VerificationCheck[],
      evidence: JSON.parse(String(row.evidence_json)) as Record<string, unknown>,
      startedAt: String(row.started_at), endedAt: String(row.ended_at)
    }));
  }
}

export class EvaluationRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    taskId: string; attemptId: string; backendId: string; provider: string; model: string;
    repositoryRevision: string | null; runtimeConfig: Record<string, unknown>;
    outcome: AttemptOutcome; verification: VerificationStatus; failureCategory: FailureCategory | null;
    evidence: Record<string, unknown>; startedAt: string; endedAt: string;
  }): string {
    const evaluationId = newId('evaluation');
    this.db.raw.prepare(`INSERT INTO evaluations(evaluation_id,task_id,attempt_id,backend_id,provider,model,repository_revision,runtime_config_json,outcome,verification,failure_category,evidence_json,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(evaluationId, input.taskId, input.attemptId, input.backendId, input.provider, input.model,
        input.repositoryRevision, JSON.stringify(input.runtimeConfig), input.outcome, input.verification,
        input.failureCategory, JSON.stringify(input.evidence), input.startedAt, input.endedAt);
    return evaluationId;
  }

  listTask(taskId: string): { evaluationId: string; outcome: AttemptOutcome; verification: VerificationStatus }[] {
    const rows = this.db.raw.prepare('SELECT evaluation_id, outcome, verification FROM evaluations WHERE task_id = ? ORDER BY started_at ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(row => ({ evaluationId: String(row.evaluation_id), outcome: row.outcome as AttemptOutcome, verification: row.verification as VerificationStatus }));
  }
}
