import type { Database } from '../persistence/database.js';
import { canonicalHash } from '../domain/hash.js';
import { nowIso } from '../domain/id.js';

// Security-relevant decisions and policy changes form an immutable, hash-chained
// audit trail (spec 15 §13). Rows are append-only; nothing here is updated.
export interface AuditRecord {
  auditId: string;
  projectId: string | null;
  taskId: string | null;
  attemptId: string | null;
  eventType: string;
  decision: 'ALLOW' | 'DENY' | 'INFO';
  principal: string | null;
  toolName: string | null;
  details: Record<string, unknown>;
  previousHash: string | null;
  recordHash: string;
  createdAt: string;
}

export class SecurityAudit {
  constructor(private readonly db: Database) {}

  append(input: {
    projectId?: string | null; taskId?: string | null; attemptId?: string | null;
    eventType: string; decision: AuditRecord['decision']; principal?: string | null;
    toolName?: string | null; details?: Record<string, unknown>;
  }): AuditRecord {
    const previousHash = (this.db.raw.prepare('SELECT record_hash FROM security_audit ORDER BY rowid DESC LIMIT 1').get() as { record_hash: string } | undefined)?.record_hash ?? null;
    const createdAt = nowIso();
    const auditId = canonicalHash(`audit:${input.eventType}:${createdAt}:${previousHash ?? ''}`).slice(0, 32);
    const details = input.details ?? {};
    const recordHash = canonicalHash(JSON.stringify({
      auditId, projectId: input.projectId ?? null, taskId: input.taskId ?? null, attemptId: input.attemptId ?? null,
      eventType: input.eventType, decision: input.decision, principal: input.principal ?? null,
      toolName: input.toolName ?? null, details, previousHash, createdAt
    }));
    const record: AuditRecord = {
      auditId, projectId: input.projectId ?? null, taskId: input.taskId ?? null, attemptId: input.attemptId ?? null,
      eventType: input.eventType, decision: input.decision, principal: input.principal ?? null,
      toolName: input.toolName ?? null, details, previousHash, recordHash, createdAt
    };
    this.db.raw.prepare(`INSERT INTO security_audit(audit_id,project_id,task_id,attempt_id,event_type,decision,principal,tool_name,details_json,previous_hash,record_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(record.auditId, record.projectId, record.taskId, record.attemptId, record.eventType, record.decision,
        record.principal, record.toolName, JSON.stringify(record.details), record.previousHash, record.recordHash, record.createdAt);
    return record;
  }

  listTask(taskId: string): AuditRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM security_audit WHERE task_id = ? ORDER BY rowid ASC').all(taskId) as Record<string, unknown>[];
    return rows.map(mapAudit);
  }

  // Tamper evidence: recompute the chain and report the first broken link.
  verifyChain(): { valid: boolean; brokenAt: string | null } {
    const rows = this.db.raw.prepare('SELECT * FROM security_audit ORDER BY rowid ASC').all() as Record<string, unknown>[];
    let previous: string | null = null;
    for (const row of rows) {
      const record = mapAudit(row);
      if (record.previousHash !== previous) return { valid: false, brokenAt: record.auditId };
      const expected = canonicalHash(JSON.stringify({
        auditId: record.auditId, projectId: record.projectId, taskId: record.taskId, attemptId: record.attemptId,
        eventType: record.eventType, decision: record.decision, principal: record.principal,
        toolName: record.toolName, details: record.details, previousHash: record.previousHash, createdAt: record.createdAt
      }));
      if (expected !== record.recordHash) return { valid: false, brokenAt: record.auditId };
      previous = record.recordHash;
    }
    return { valid: true, brokenAt: null };
  }
}

function mapAudit(row: Record<string, unknown>): AuditRecord {
  return {
    auditId: String(row.audit_id), projectId: row.project_id ? String(row.project_id) : null,
    taskId: row.task_id ? String(row.task_id) : null, attemptId: row.attempt_id ? String(row.attempt_id) : null,
    eventType: String(row.event_type), decision: String(row.decision) as AuditRecord['decision'],
    principal: row.principal ? String(row.principal) : null, toolName: row.tool_name ? String(row.tool_name) : null,
    details: JSON.parse(String(row.details_json)) as Record<string, unknown>,
    previousHash: row.previous_hash ? String(row.previous_hash) : null,
    recordHash: String(row.record_hash), createdAt: String(row.created_at)
  };
}
