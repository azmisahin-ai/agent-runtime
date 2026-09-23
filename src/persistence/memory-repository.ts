import type {
  MemoryCandidate, MemoryConfidence, MemoryEvidence, MemoryRecord, MemoryRelation,
  MemoryRelationType, MemoryScope, MemorySource, MemoryStatus, MemoryType
} from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { canonicalHash } from '../domain/hash.js';
import { redactSecrets } from '../security/secret-redaction.js';
import type { Database } from './database.js';

export interface MemoryQuery {
  projectId: string;
  scopes?: MemoryScope[];
  types?: MemoryType[];
  statuses?: MemoryStatus[];
  text?: string;
  limit?: number;
}

export class MemoryRepository {
  constructor(private readonly db: Database) {}

  // Durable memory is never raw model output; content is redacted before insert
  // and provenance is mandatory (spec 03 §4, §11).
  create(input: MemoryCandidate & { status?: MemoryStatus; validFrom?: string; validUntil?: string | null }): MemoryRecord {
    const timestamp = nowIso();
    const record: MemoryRecord = {
      memoryId: newId('memory'),
      projectId: input.projectId,
      scope: input.scope,
      type: input.type,
      content: redactSecrets(input.content).text,
      source: input.source,
      createdAt: timestamp,
      updatedAt: timestamp,
      confidence: input.confidence,
      status: input.status ?? 'ACTIVE',
      validFrom: input.validFrom ?? timestamp,
      validUntil: input.validUntil ?? null,
      supersedes: input.supersedes ?? null,
      supersededBy: null,
      relatedTaskId: input.relatedTaskId ?? null,
      relatedAttemptId: input.relatedAttemptId ?? null,
      relatedFiles: input.relatedFiles ?? [],
      relatedSymbols: input.relatedSymbols ?? []
    };
    this.db.raw.prepare(`INSERT INTO memories(memory_id,project_id,scope,type,content,source,confidence,status,valid_from,valid_until,supersedes,superseded_by,related_task_id,related_attempt_id,related_files_json,related_symbols_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        record.memoryId, record.projectId, record.scope, record.type, record.content, record.source,
        record.confidence, record.status, record.validFrom, record.validUntil, record.supersedes,
        record.supersededBy, record.relatedTaskId, record.relatedAttemptId,
        JSON.stringify(record.relatedFiles), JSON.stringify(record.relatedSymbols), record.createdAt, record.updatedAt
      );
    for (const evidence of input.evidence ?? []) {
      this.addEvidence(record.memoryId, input.source, evidence.reference, evidence.contentHash, evidence.revision ?? null);
    }
    return record;
  }

  get(memoryId: string): MemoryRecord | null {
    const row = this.db.raw.prepare('SELECT * FROM memories WHERE memory_id = ?').get(memoryId) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  // Project isolation is enforced at the query boundary (spec 03 §11).
  query(query: MemoryQuery): MemoryRecord[] {
    const clauses = ['project_id = ?'];
    const params: (string | number)[] = [query.projectId];
    if (query.scopes?.length) { clauses.push(`scope IN (${query.scopes.map(() => '?').join(',')})`); params.push(...query.scopes); }
    if (query.types?.length) { clauses.push(`type IN (${query.types.map(() => '?').join(',')})`); params.push(...query.types); }
    if (query.statuses?.length) { clauses.push(`status IN (${query.statuses.map(() => '?').join(',')})`); params.push(...query.statuses); }
    if (query.text) { clauses.push('content LIKE ?'); params.push(`%${query.text}%`); }
    const limit = Math.max(1, Math.min(query.limit ?? 50, 500));
    const rows = this.db.raw.prepare(`SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit}`).all(...params) as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  listByProject(projectId: string): MemoryRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM memories WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as Record<string, unknown>[];
    return rows.map(row => this.map(row));
  }

  addEvidence(memoryId: string, source: MemorySource, reference: string, contentHash: string, revision: string | null): MemoryEvidence {
    const evidence: MemoryEvidence = {
      memoryEvidenceId: newId('memevidence'), memoryId, source, reference, contentHash, revision, createdAt: nowIso()
    };
    this.db.raw.prepare('INSERT INTO memory_evidence(memory_evidence_id,memory_id,source,reference,content_hash,revision,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(evidence.memoryEvidenceId, evidence.memoryId, evidence.source, evidence.reference, evidence.contentHash, evidence.revision, evidence.createdAt);
    return evidence;
  }

  listEvidence(memoryId: string): MemoryEvidence[] {
    const rows = this.db.raw.prepare('SELECT * FROM memory_evidence WHERE memory_id = ? ORDER BY created_at ASC').all(memoryId) as Record<string, unknown>[];
    return rows.map(row => ({
      memoryEvidenceId: String(row.memory_evidence_id), memoryId: String(row.memory_id),
      source: row.source as MemorySource, reference: String(row.reference), contentHash: String(row.content_hash),
      revision: row.revision ? String(row.revision) : null, createdAt: String(row.created_at)
    }));
  }

  setStatus(memoryId: string, status: MemoryStatus): void {
    this.db.raw.prepare('UPDATE memories SET status = ?, updated_at = ? WHERE memory_id = ?').run(status, nowIso(), memoryId);
  }

  // Supersession marks the old record but never deletes it: history stays
  // available for audit (spec 03 §6, §11).
  supersede(oldMemoryId: string, newMemoryId: string): void {
    const timestamp = nowIso();
    this.db.raw.prepare("UPDATE memories SET status = 'SUPERSEDED', superseded_by = ?, valid_until = ?, updated_at = ? WHERE memory_id = ?")
      .run(newMemoryId, timestamp, timestamp, oldMemoryId);
    this.db.raw.prepare('UPDATE memories SET supersedes = ?, updated_at = ? WHERE memory_id = ?')
      .run(oldMemoryId, timestamp, newMemoryId);
    this.addRelation(newMemoryId, oldMemoryId, 'supersedes');
  }

  addRelation(fromMemoryId: string, toMemoryId: string, relation: MemoryRelationType): MemoryRelation {
    const record: MemoryRelation = { memoryRelationId: newId('memrelation'), fromMemoryId, toMemoryId, relation, createdAt: nowIso() };
    this.db.raw.prepare('INSERT OR IGNORE INTO memory_relations(memory_relation_id,from_memory_id,to_memory_id,relation,created_at) VALUES (?,?,?,?,?)')
      .run(record.memoryRelationId, record.fromMemoryId, record.toMemoryId, record.relation, record.createdAt);
    return record;
  }

  listRelations(memoryId: string): MemoryRelation[] {
    const rows = this.db.raw.prepare('SELECT * FROM memory_relations WHERE from_memory_id = ? OR to_memory_id = ? ORDER BY created_at ASC').all(memoryId, memoryId) as Record<string, unknown>[];
    return rows.map(row => ({
      memoryRelationId: String(row.memory_relation_id), fromMemoryId: String(row.from_memory_id),
      toMemoryId: String(row.to_memory_id), relation: row.relation as MemoryRelationType, createdAt: String(row.created_at)
    }));
  }

  private map(row: Record<string, unknown>): MemoryRecord {
    return {
      memoryId: String(row.memory_id), projectId: String(row.project_id), scope: row.scope as MemoryScope,
      type: row.type as MemoryType, content: String(row.content), source: row.source as MemorySource,
      confidence: row.confidence as MemoryConfidence, status: row.status as MemoryStatus,
      validFrom: String(row.valid_from), validUntil: row.valid_until ? String(row.valid_until) : null,
      supersedes: row.supersedes ? String(row.supersedes) : null,
      supersededBy: row.superseded_by ? String(row.superseded_by) : null,
      relatedTaskId: row.related_task_id ? String(row.related_task_id) : null,
      relatedAttemptId: row.related_attempt_id ? String(row.related_attempt_id) : null,
      relatedFiles: JSON.parse(String(row.related_files_json)) as string[],
      relatedSymbols: JSON.parse(String(row.related_symbols_json)) as string[],
      createdAt: String(row.created_at), updatedAt: String(row.updated_at)
    };
  }

  static contentHash(content: string): string { return canonicalHash(content); }
}
