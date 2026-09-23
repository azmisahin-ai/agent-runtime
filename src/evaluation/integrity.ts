import { canonicalHash } from '../domain/hash.js';

export interface IntegrityObservation {
  kind: 'TEST_TAMPER' | 'VERIFICATION_BYPASS' | 'SIDE_EFFECT' | 'BASELINE_MISMATCH';
  detail: string;
  detected: boolean;
  evidence: Record<string, unknown>;
}

export interface IntegrityInput {
  // Hash of the test/verification files as captured before the attempt.
  baselineTestHashes: Record<string, string>;
  // Hash of the same files observed after the attempt.
  observedTestHashes: Record<string, string>;
  // Whether a verification run reported PASS while a required check was skipped.
  verificationSkippedCheck?: boolean;
  verificationStatus?: string;
  skippedChecks?: string[];
  // Files changed outside the declared affected scope.
  declaredScope?: string[];
  changedFiles?: string[];
  baselineHashExpected?: string;
  baselineHashObserved?: string;
}

// Integrity detection (spec 06 §9). It observes; it does not silently repair or
// overrule the runtime, and a detection never converts UNKNOWN into PASS.
export class IntegrityChecker {
  inspect(input: IntegrityInput): IntegrityObservation[] {
    const observations: IntegrityObservation[] = [];

    for (const [path, expected] of Object.entries(input.baselineTestHashes)) {
      const observed = input.observedTestHashes[path];
      if (observed === undefined) continue;
      if (observed !== expected) {
        observations.push({ kind: 'TEST_TAMPER', detail: `test file modified during attempt: ${path}`, detected: true, evidence: { path, expected, observed } });
      }
    }

    if (input.verificationSkippedCheck && input.verificationStatus === 'PASS') {
      observations.push({
        kind: 'VERIFICATION_BYPASS', detail: 'verification reported PASS with skipped required checks', detected: true,
        evidence: { skipped: input.skippedChecks ?? [], verification: input.verificationStatus }
      });
    }

    if (input.baselineHashExpected && input.baselineHashObserved && input.baselineHashExpected !== input.baselineHashObserved) {
      observations.push({
        kind: 'BASELINE_MISMATCH', detail: 'evaluation baseline changed since the run', detected: true,
        evidence: { expected: input.baselineHashExpected, observed: input.baselineHashObserved }
      });
    }

    if (input.declaredScope && input.changedFiles) {
      const declared = new Set(input.declaredScope);
      const outside = input.changedFiles.filter(file => !declared.has(file));
      if (outside.length > 0) {
        observations.push({ kind: 'SIDE_EFFECT', detail: 'files changed outside the declared affected scope', detected: true, evidence: { outside } });
      }
    }

    if (observations.length === 0) {
      observations.push({ kind: 'SIDE_EFFECT', detail: 'no integrity issues observed', detected: false, evidence: {} });
    }
    return observations;
  }

  // A baseline digest allows later re-verification of the recorded conditions.
  baselineHash(parts: Record<string, unknown>): string {
    return canonicalHash(parts);
  }
}
