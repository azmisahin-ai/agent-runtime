import type { AttemptOutcome, FailureCategory, TaskState, VerificationStatus } from '../domain/types.js';

export interface AttributionInput {
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  taskState: TaskState;
  runtimeCategory: FailureCategory | null;
  toolRuns: { status: string; error: string | null; tool: string }[];
  hadVerificationFailure: boolean;
  errorMessage?: string | null;
}

export interface Attribution {
  primary: FailureCategory | null;
  secondary: FailureCategory[];
  evidence: Record<string, unknown>;
}

// Failure attribution is evidence-based (spec 06 §8). It cites the observations
// that justify the category and never invents a cause it cannot point to.
export class FailureClassifier {
  classify(input: AttributionInput): Attribution {
    // A verified success has no failure cause, regardless of noisy tool output.
    if (input.outcome === 'SUCCESS' && input.verification === 'PASS') {
      return { primary: null, secondary: [], evidence: { reason: 'verified success' } };
    }

    const secondary: FailureCategory[] = [];
    const evidence: Record<string, unknown> = {
      outcome: input.outcome, verification: input.verification, task_state: input.taskState,
      runtime_category: input.runtimeCategory
    };

    const toolProblems = input.toolRuns.filter(run => run.status === 'FAILED' || run.status === 'TIMEOUT' || run.status === 'DENIED');
    if (toolProblems.length > 0) evidence.tool_problems = toolProblems.map(run => ({ tool: run.tool, status: run.status, error: run.error }));

    let primary: FailureCategory | null = null;
    if (input.runtimeCategory) {
      primary = input.runtimeCategory;
    } else if (input.outcome === 'TIMEOUT') {
      primary = 'TIMEOUT';
      evidence.reason = 'attempt timed out';
    } else if (input.outcome === 'CANCELLED') {
      primary = 'UNKNOWN_FAILURE';
      evidence.reason = 'attempt cancelled by operator';
    } else if (input.verification === 'FAIL' || input.hadVerificationFailure) {
      primary = 'VERIFICATION_FAILURE';
      evidence.reason = 'required verification did not pass';
    } else if (input.verification === 'UNKNOWN') {
      primary = 'VERIFICATION_FAILURE';
      evidence.reason = 'verification indeterminate; UNKNOWN is not PASS';
    } else if (input.outcome === 'UNKNOWN') {
      primary = 'UNKNOWN_FAILURE';
      evidence.reason = 'outcome unknown';
    } else if (input.outcome === 'FAILURE') {
      primary = 'MODEL_FAILURE';
      evidence.reason = 'attempt failed with no stronger evidence';
    }

    // Secondary causes are only added when their evidence is present.
    if (toolProblems.some(run => run.status === 'DENIED') && primary !== 'PERMISSION_FAILURE') secondary.push('PERMISSION_FAILURE');
    if (toolProblems.some(run => run.status === 'FAILED') && primary !== 'TOOL_FAILURE') secondary.push('TOOL_FAILURE');
    if (input.verification === 'FAIL' && primary !== 'VERIFICATION_FAILURE') secondary.push('VERIFICATION_FAILURE');

    return { primary, secondary, evidence };
  }
}
