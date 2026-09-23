import type { AttemptOutcome, FailureCategory, VerificationStatus } from '../domain/types.js';

export interface RecoveryInput {
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  failureCategory: FailureCategory | null;
  priorAttempts: number;
  maxRecoveryAttempts: number;
  securityViolation: boolean;
}

export type RecoveryDecision = 'RETRY' | 'RESUME' | 'SWITCH' | 'PAUSE' | 'FAIL';

export interface RecoveryOutcome {
  decision: RecoveryDecision;
  reason: string;
  newAttemptRequired: boolean;
}

// Recovery is bounded and evidence-driven and must never widen security policy
// (spec 11 §5-7, 14 §6). A terminal failed Attempt is never restarted in place.
export function decideRecovery(input: RecoveryInput): RecoveryOutcome {
  if (input.securityViolation) {
    return { decision: 'FAIL', reason: 'security violation cannot be autonomously recovered', newAttemptRequired: false };
  }
  if (input.outcome === 'SUCCESS' && input.verification === 'PASS') {
    return { decision: 'FAIL', reason: 'recovery not applicable to a verified success', newAttemptRequired: false };
  }
  if (input.priorAttempts >= input.maxRecoveryAttempts) {
    return { decision: 'FAIL', reason: `recovery attempt budget exhausted (${input.priorAttempts}/${input.maxRecoveryAttempts})`, newAttemptRequired: false };
  }
  switch (input.failureCategory) {
    case 'BACKEND_FAILURE':
    case 'MODEL_FAILURE':
      return { decision: 'RETRY', reason: 'transient model/backend failure', newAttemptRequired: true };
    case 'TIMEOUT':
      return { decision: 'RETRY', reason: 'timeout is retryable within bounds', newAttemptRequired: true };
    case 'PERMISSION_FAILURE':
      return { decision: 'FAIL', reason: 'permission failures are not retried and never widen policy', newAttemptRequired: false };
    case 'VERIFICATION_FAILURE':
      return { decision: 'RETRY', reason: 'verification failed; a new attempt may correct it', newAttemptRequired: true };
    case 'CONTEXT_FAILURE':
    case 'TOOL_FAILURE':
      return { decision: 'RETRY', reason: 'context/tool failure is retryable within bounds', newAttemptRequired: true };
    case 'PERSISTENCE_FAILURE':
    case 'REPOSITORY_FAILURE':
    case 'MEMORY_FAILURE':
      return { decision: 'PAUSE', reason: `${input.failureCategory} requires human inspection`, newAttemptRequired: false };
    default:
      return { decision: 'PAUSE', reason: 'unknown failure cannot be assumed safe to retry', newAttemptRequired: false };
  }
}

export function classifyFailure(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort/i.test(message)) return 'TIMEOUT';
  if (/ENOENT|no such file|repo|git/i.test(message)) return 'REPOSITORY_FAILURE';
  if (/permission|denied|forbidden|EACCES/i.test(message)) return 'PERMISSION_FAILURE';
  if (/sqlite|persist|database|constraint/i.test(message)) return 'PERSISTENCE_FAILURE';
  if (/ollama|backend|network|ECONNREFUSED/i.test(message)) return 'BACKEND_FAILURE';
  if (/tool/i.test(message)) return 'TOOL_FAILURE';
  return 'UNKNOWN_FAILURE';
}

export class MaxRecoveryAttemptsError extends Error {
  constructor(public readonly attempts: number) {
    super(`Maximum recovery attempts reached: ${attempts}`);
    this.name = 'MaxRecoveryAttemptsError';
  }
}
