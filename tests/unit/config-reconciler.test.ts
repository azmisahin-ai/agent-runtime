import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileConfig } from '../../src/config/config-reconciler.js';
import type { ConfigSnapshot } from '../../src/domain/types.js';

function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    configSnapshotId: 'config_1', taskId: 'task_1', attemptId: 'attempt_1', schemaVersion: 1,
    profile: 'local-dev',
    effectiveConfig: { profile: 'local-dev', workspaceRoot: '/ws', maxRecoveryAttempts: 3 },
    effectivePolicy: { networkAccess: 'DENY', allowProcessExecution: false, allowNetworkAccess: false, grantedCapabilities: ['read_only', 'filesystem_read', 'git_access'], policyVersion: 1 },
    backendId: 'ollama', model: 'qwen2.5-coder:7b', policyVersion: 1, configHash: 'h', createdAt: new Date().toISOString(),
    ...overrides
  };
}

const matching = {
  profile: 'local-dev', backendId: 'ollama', model: 'qwen2.5-coder:7b', policyVersion: 1,
  effectiveConfig: { profile: 'local-dev', workspaceRoot: '/ws', maxRecoveryAttempts: 3 },
  effectivePolicy: { networkAccess: 'DENY', allowProcessExecution: false, allowNetworkAccess: false, grantedCapabilities: ['read_only', 'filesystem_read', 'git_access'], policyVersion: 1 }
};

test('matching configuration reconciles without change', () => {
  const result = reconcileConfig(snapshot(), matching);
  assert.equal(result.compatible, true);
  assert.deepEqual(result.changedFields, []);
  assert.equal(result.requiresNewAttempt, false);
});

test('model change requires a new attempt', () => {
  const result = reconcileConfig(snapshot(), { ...matching, model: 'qwen2.5-coder:32b' });
  assert.equal(result.compatible, false);
  assert.ok(result.changedFields.includes('model'));
  assert.equal(result.requiresNewAttempt, true);
  assert.equal(result.requiresPause, true);
});

test('security policy widening is detected', () => {
  const result = reconcileConfig(snapshot(), {
    ...matching,
    effectivePolicy: { ...matching.effectivePolicy, allowNetworkAccess: true, networkAccess: 'ALLOW' }
  });
  assert.equal(result.compatible, false);
  assert.ok(result.changedFields.includes('allowNetworkAccess'));
  assert.ok(result.changedFields.includes('networkAccess'));
});

test('workspace root change is detected', () => {
  const result = reconcileConfig(snapshot(), {
    ...matching,
    effectiveConfig: { ...matching.effectiveConfig, workspaceRoot: '/other' }
  });
  assert.equal(result.compatible, false);
  assert.ok(result.changedFields.includes('workspaceRoot'));
});

test('config hash is stable for identical effective configuration', () => {
  const a = reconcileConfig(snapshot(), matching);
  const b = reconcileConfig(snapshot(), { ...matching });
  assert.equal(a.configHash, b.configHash);
});
