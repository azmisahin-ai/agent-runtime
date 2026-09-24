import type { VerificationCheck, VerificationResult, VerificationStatus } from '../domain/types.js';
import { nowIso } from '../domain/id.js';
import type { Database } from '../persistence/database.js';
import type { VerificationRepository } from '../persistence/verification-repository.js';
import type { EventStore } from '../events/event-store.js';

export interface VerificationCommandResult {
  status: VerificationStatus;
  evidence: string;
}

// A check runs against the attempt it is verifying, so a check that executes a
// command can be recorded as a tool run under the same task/attempt (spec 10 §3,
// 11 §3). The context is runtime-supplied; it never comes from the model.
export interface CheckRunContext {
  taskId: string;
  attemptId: string;
}

export type VerificationRunnerFn = (agentClaim: string, context: CheckRunContext) => VerificationCommandResult;

export interface VerifyInput {
  taskId: string;
  attemptId: string;
  agentClaim: string;
  checks: { name: string; kind: VerificationCheck['kind']; run: VerificationRunnerFn }[];
  allowUnknown?: boolean;
  // Affected-scope evidence (spec 12 §13): the repository surfaces that a change
  // can reach. It informs the reviewer and is persisted, but it never turns a
  // failing or absent check into PASS.
  affectedScope?: { roots: string[]; direct: string[]; transitive: string[]; tests: string[]; truncated: boolean };
}

// Verification is independent of agent claims (spec 11 §1-3).
// UNKNOWN is never PASS. Success requires the required checks to pass.
export class VerificationEngine {
  constructor(
    private readonly db: Database,
    private readonly verifications: VerificationRepository,
    private readonly events: EventStore
  ) {}

  verify(input: VerifyInput): VerificationResult {
    const startedAt = nowIso();
    const checks: VerificationCheck[] = [];
    const context: CheckRunContext = { taskId: input.taskId, attemptId: input.attemptId };
    for (const check of input.checks) {
      let outcome: VerificationCommandResult;
      try {
        outcome = check.run(input.agentClaim, context);
      } catch (error) {
        // A check that cannot run produces UNKNOWN, never PASS.
        outcome = { status: 'UNKNOWN', evidence: error instanceof Error ? error.message : String(error) };
      }
      checks.push({ name: check.name, kind: check.kind, status: outcome.status, evidence: outcome.evidence });
    }

    const status = aggregate(checks.map(c => c.status), input.allowUnknown ?? false);
    const result = this.db.transaction(() => {
      const saved = this.verifications.create({
        taskId: input.taskId, attemptId: input.attemptId,
        status, checks, evidence: { agentClaim: input.agentClaim, affectedScope: input.affectedScope ?? null }, startedAt, endedAt: nowIso()
      });
      this.events.append({
        projectId: null, taskId: input.taskId, attemptId: input.attemptId,
        type: `Verification${status.charAt(0)}${status.slice(1).toLowerCase()}`,
        source: 'RUNTIME', payload: { verificationId: saved.verificationId, status, checks: checks.map(c => ({ name: c.name, status: c.status })) }
      });
      return saved;
    });
    return result;
  }
}

export function aggregate(statuses: VerificationStatus[], allowUnknown: boolean): VerificationStatus {
  if (statuses.length === 0) return allowUnknown ? 'UNKNOWN' : 'FAIL';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return allowUnknown ? 'PASS' : 'UNKNOWN';
  return 'PASS';
}
