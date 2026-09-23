import { canonicalHash } from '../domain/hash.js';
import type { ConfigSnapshot } from '../domain/types.js';

export interface ReconciliationResult {
  compatible: boolean;
  changedFields: string[];
  requiresNewAttempt: boolean;
  requiresPause: boolean;
  reason: string;
  configHash: string;
}

// Execution-sensitive settings. A change to any of these cannot be silently
// applied to an active Attempt (spec 16 §6, §7): it requires PAUSE and/or a new
// Attempt. Safe observability changes may remain live.
const EXECUTION_SENSITIVE_FIELDS = [
  'model', 'backendId', 'profile', 'policyVersion',
  'networkAccess', 'allowProcessExecution', 'allowNetworkAccess', 'grantedCapabilities', 'allowedCommands',
  'context', 'workspaceRoot', 'verificationPolicy', 'recoveryPolicy'
];

export function reconcileConfig(
  snapshot: ConfigSnapshot,
  effective: {
    profile: string;
    backendId: string;
    model: string;
    policyVersion: number;
    effectiveConfig: Record<string, unknown>;
    effectivePolicy: Record<string, unknown>;
  }
): ReconciliationResult {
  const changed: string[] = [];
  if (snapshot.profile !== effective.profile) changed.push('profile');
  if (snapshot.backendId !== effective.backendId) changed.push('backendId');
  if (snapshot.model !== effective.model) changed.push('model');
  if (snapshot.policyVersion !== effective.policyVersion) changed.push('policyVersion');

  for (const [key, value] of Object.entries(effective.effectivePolicy)) {
    if (!EXECUTION_SENSITIVE_FIELDS.includes(key)) continue;
    const previous = snapshot.effectivePolicy[key];
    if (canonicalHash(previous) !== canonicalHash(value)) changed.push(key);
  }
  for (const [key, value] of Object.entries(effective.effectiveConfig)) {
    if (!EXECUTION_SENSITIVE_FIELDS.includes(key)) continue;
    const previous = snapshot.effectiveConfig[key];
    if (canonicalHash(previous) !== canonicalHash(value)) changed.push(key);
  }

  const unique = [...new Set(changed)];
  const configHash = canonicalHash({
    config: effective.effectiveConfig, policy: effective.effectivePolicy,
    backendId: effective.backendId, model: effective.model, profile: effective.profile, policyVersion: effective.policyVersion
  });

  if (unique.length === 0) {
    return { compatible: true, changedFields: [], requiresNewAttempt: false, requiresPause: false, reason: 'effective configuration matches the Attempt snapshot', configHash };
  }
  return {
    compatible: false, changedFields: unique, requiresNewAttempt: true, requiresPause: true,
    reason: `execution-sensitive configuration changed: ${unique.join(', ')}`,
    configHash
  };
}
