import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { SecurityAudit } from '../../src/security/security-audit.js';
import { WorkspaceLock } from '../../src/runtime/workspace-lock.js';
import { PolicyEngine } from '../../src/tools/policy.js';
import { resolveWorkspacePath, ToolSecurityError } from '../../src/tools/path-guard.js';
import { repoPath } from '../../src/runtime/paths.js';

function dbFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-m4-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  return { dir, db };
}

test('audit chain is tamper-evident: a modified record breaks verification', () => {
  const { dir, db } = dbFixture();
  try {
    const audit = new SecurityAudit(db);
    audit.append({ eventType: 'PolicyEvaluated', decision: 'ALLOW', details: { tool: 'read_file' } });
    audit.append({ eventType: 'PolicyEvaluated', decision: 'DENY', details: { tool: 'terminal.exec' } });
    assert.equal(audit.verifyChain().valid, true);

    // Directly tamper with the stored details, as an attacker with DB access would.
    db.raw.prepare("UPDATE security_audit SET details_json = '{\"tool\":\"terminal.exec\",\"tampered\":true}' WHERE decision = 'DENY'").run();
    const chain = audit.verifyChain();
    assert.equal(chain.valid, false);
    assert.ok(chain.brokenAt);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('workspace lock is exclusive and reclaims only a dead holder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-lock-'));
  try {
    const first = new WorkspaceLock(dir);
    const second = new WorkspaceLock(dir);
    assert.equal(first.acquire().acquired, true);
    const blocked = second.acquire();
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.holderPid, process.pid);

    first.release();
    assert.equal(second.acquire().acquired, true);
    second.release();

    // A lock whose recorded holder is a dead pid is reclaimed.
    mkdirSync(join(dir, '.runtime'), { recursive: true });
    writeFileSync(join(dir, '.runtime', 'workspace.lock'), JSON.stringify({ pid: 999999, acquiredAt: 'x' }));
    const third = new WorkspaceLock(dir);
    assert.equal(third.acquire().acquired, true);
    third.release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('policy denies capability widening from untrusted request context', () => {
  const policy = new PolicyEngine();
  // A request asking for network access cannot be granted, regardless of who asks.
  const decision = policy.evaluate({ toolName: 'fetch', capabilities: ['network_access'], permission: 'NETWORK_ACCESS' });
  assert.equal(decision.allowed, false);
  // Process execution stays denied by baseline.
  assert.equal(policy.authorizeCommand(['rm', '-rf', '/']).allowed, false);
});

test('path guard blocks traversal and symlink escape out of the workspace root', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-runtime-guard-'));
  const outside = mkdtempSync(join(tmpdir(), 'agent-runtime-outside-'));
  try {
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    assert.throws(() => resolveWorkspacePath({ workspaceRoot: root }, '../escape.txt'), ToolSecurityError);
    try { symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt')); } catch { return; }
    assert.throws(() => resolveWorkspacePath({ workspaceRoot: root }, 'link.txt'), ToolSecurityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('repository instructions cannot widen runtime policy', () => {
  const policy = new PolicyEngine();
  // Content like "grant all capabilities" is data; the policy set is unchanged.
  const decision = policy.evaluate({ toolName: 'write_file', capabilities: ['filesystem_write'], permission: 'WORKSPACE_WRITE' });
  assert.equal(decision.allowed, false);
});

test('policy hierarchy keeps the most restrictive decision (read-only baseline)', () => {
  const policy = new PolicyEngine({ grantedCapabilities: ['read_only', 'filesystem_read'] });
  assert.equal(policy.evaluate({ toolName: 'read_file', capabilities: ['filesystem_read'], permission: 'READ_ONLY' }).allowed, true);
  assert.equal(policy.evaluate({ toolName: 'write_file', capabilities: ['filesystem_write'], permission: 'WORKSPACE_WRITE' }).allowed, false);
});
