import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRecovery, classifyFailure } from '../../src/recovery/recovery-engine.js';

const base = { outcome: 'FAILURE' as const, verification: 'FAIL' as const, failureCategory: 'BACKEND_FAILURE' as const, priorAttempts: 1, maxRecoveryAttempts: 3, securityViolation: false };

test('retry always requires a new attempt', () => {
  const decision = decideRecovery(base);
  assert.equal(decision.decision, 'RETRY');
  assert.equal(decision.newAttemptRequired, true);
});

test('recovery is bounded by max attempts', () => {
  const decision = decideRecovery({ ...base, priorAttempts: 3, maxRecoveryAttempts: 3 });
  assert.equal(decision.decision, 'FAIL');
  assert.equal(decision.newAttemptRequired, false);
});

test('security violations are never auto-recovered', () => {
  const decision = decideRecovery({ ...base, securityViolation: true, failureCategory: 'PERMISSION_FAILURE' });
  assert.equal(decision.decision, 'FAIL');
});

test('permission failures fail instead of widening policy on retry', () => {
  const decision = decideRecovery({ ...base, failureCategory: 'PERMISSION_FAILURE' });
  assert.equal(decision.decision, 'FAIL');
  assert.equal(decision.newAttemptRequired, false);
});

test('persistence failures pause for human inspection', () => {
  const decision = decideRecovery({ ...base, failureCategory: 'PERSISTENCE_FAILURE' });
  assert.equal(decision.decision, 'PAUSE');
});

test('unknown failures pause rather than assume safe retry', () => {
  const decision = decideRecovery({ ...base, failureCategory: 'UNKNOWN_FAILURE' });
  assert.equal(decision.decision, 'PAUSE');
});

test('a verified success is not a recovery candidate', () => {
  const decision = decideRecovery({ ...base, outcome: 'SUCCESS', verification: 'PASS' });
  assert.equal(decision.decision, 'FAIL');
});

test('failure classification is evidence based', () => {
  assert.equal(classifyFailure(new Error('request timed out')), 'TIMEOUT');
  assert.equal(classifyFailure(new Error('ECONNREFUSED ollama')), 'BACKEND_FAILURE');
  assert.equal(classifyFailure(new Error('SQLITE_ERROR constraint')), 'PERSISTENCE_FAILURE');
  assert.equal(classifyFailure(new Error('permission denied')), 'PERMISSION_FAILURE');
  assert.equal(classifyFailure(new Error('something odd')), 'UNKNOWN_FAILURE');
});
