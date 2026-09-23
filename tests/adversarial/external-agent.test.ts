import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveExternalBoundary, ExternalSessionRegistry, ownershipTable, RUNTIME_OWNED_CAPABILITIES
} from '../../src/security/external-agent.js';
import type { ToolCapability } from '../../src/domain/types.js';

const granted: ToolCapability[] = ['read_only', 'filesystem_read', 'git_access'];

test('an external agent cannot raise the runtime capability ceiling', () => {
  const boundary = resolveExternalBoundary({
    profile: {
      agentId: 'acp-1', kind: 'ACP',
      // It claims far more than the operator granted.
      declaredCapabilities: ['read_only', 'filesystem_read', 'filesystem_write', 'process_execute', 'network_access'] as ToolCapability[],
      tools: [{ name: 'shell', ownership: 'EXTERNAL', capabilities: ['process_execute'] }]
    },
    runtimeGranted: granted
  });

  // Effective = what is both granted by the operator and usable by the agent.
  assert.deepEqual(boundary.effectiveCapabilities.sort(), ['filesystem_read', 'read_only']);
  const overclaimed = boundary.denied.map(d => d.capability);
  assert.ok(overclaimed.includes('process_execute'));
  assert.ok(overclaimed.includes('network_access'));
  assert.ok(boundary.denied.every(d => d.declaredButNotGranted && !d.allowed));
  // A capability the runtime grants but the agent does not declare is simply
  // unusable by that agent; it is neither an overclaim nor an expansion.
  assert.ok(boundary.effectiveCapabilities.includes('git_access') === false);
});

test('an externally-owned tool needing an ungranted capability is not callable', () => {
  const boundary = resolveExternalBoundary({
    profile: {
      agentId: 'cli-1', kind: 'CLI',
      declaredCapabilities: granted,
      tools: [
        { name: 'read', ownership: 'EXTERNAL', capabilities: ['filesystem_read'] },
        { name: 'shell', ownership: 'EXTERNAL', capabilities: ['process_execute'] }
      ]
    },
    runtimeGranted: granted
  });

  const byName = Object.fromEntries(boundary.tools.map(t => [t.name, t]));
  assert.equal(byName.read.callable, true);
  assert.equal(byName.shell.callable, false);
  assert.match(byName.shell.reason, /capabilities outside the grant/);
});

test('ownership is explicit for every tool the external agent brings', () => {
  const table = ownershipTable({
    agentId: 'native-1', kind: 'NATIVE',
    declaredCapabilities: ['filesystem_read'],
    tools: [
      { name: 'read_file', ownership: 'RUNTIME', capabilities: ['filesystem_read'] },
      { name: 'agent_edit', ownership: 'EXTERNAL', capabilities: ['filesystem_write'] }
    ]
  });
  assert.equal(table.read_file, 'RUNTIME');
  assert.equal(table.agent_edit, 'EXTERNAL');
  assert.equal(RUNTIME_OWNED_CAPABILITIES.includes('process_execute'), true);
});

test('an external session id maps to a task/attempt but is never authority', () => {
  const registry = new ExternalSessionRegistry();
  registry.map({ externalSessionId: 'ext-9', taskId: 'task-1', attemptId: 'attempt-1', resumeSupported: false });

  const mapping = registry.resolve('ext-9');
  assert.equal(mapping?.taskId, 'task-1');
  assert.equal(mapping?.attemptId, 'attempt-1');

  // A non-resumable external session cannot block durable continuation: the same
  // attempt is kept and a fresh backend session is started (spec 05 §8).
  const decision = registry.resumeOrReplace('attempt-1');
  assert.equal(decision.resumable, false);
  assert.match(decision.reason, /start a new backend session/);
  assert.equal(registry.forAttempt('attempt-1')?.attemptId, 'attempt-1');

  assert.equal(registry.resumeOrReplace('missing').resumable, false);
});
