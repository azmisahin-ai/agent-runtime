import type {
  MemoryCandidate, MemoryConfidence, MemoryRecord, MemoryScope, MemoryStatus, MemoryType
} from '../domain/types.js';
import { containsSecret } from '../security/secret-redaction.js';

export interface PersistenceDecision {
  persist: boolean;
  reason: string;
}

const DURABLE_TYPES: MemoryType[] = ['SEMANTIC', 'PROJECT', 'PROCEDURAL', 'FAILURE', 'EPISODIC'];

// The model never inserts durable memory directly. ShouldPersist() is the gate
// (spec 03 §4): it evaluates durability, reuse value, project relevance,
// information value, decision/failure relevance and provenance.
export interface PersistenceGateOptions {
  minContentLength?: number;
}

export function shouldPersist(candidate: MemoryCandidate, options: PersistenceGateOptions = {}): PersistenceDecision {
  const minLength = options.minContentLength ?? 8;
  const content = candidate.content?.trim() ?? '';

  // Secrets never enter durable memory (spec 03 §11).
  if (containsSecret(candidate.content ?? '')) {
    return { persist: false, reason: 'candidate contains a secret and must not be persisted' };
  }
  if (!DURABLE_TYPES.includes(candidate.type)) {
    return { persist: false, reason: `memory type ${candidate.type} is not durable` };
  }
  if (!candidate.source) {
    return { persist: false, reason: 'provenance (source) is required' };
  }
  if (content.length < minLength) {
    return { persist: false, reason: 'candidate has insufficient information value' };
  }
  // Low-confidence working noise is not durable context for later attempts.
  if (candidate.confidence === 'LOW' && !candidate.evidence?.length && candidate.type === 'SEMANTIC') {
    return { persist: false, reason: 'low-confidence semantic claim without evidence' };
  }
  return { persist: true, reason: 'candidate is durable, relevant and provenance-backed' };
}

// Validator rejects malformed/expired/secret-bearing records and enforces scope
// compatibility (spec 03 V0.1 components: MemoryValidator).
export function validateCandidate(candidate: MemoryCandidate): void {
  if (!candidate.projectId) throw new Error('memory candidate requires a projectId');
  if (!candidate.content || candidate.content.trim().length === 0) throw new Error('memory candidate requires content');
  if (candidate.scope === 'TASK' && !candidate.relatedTaskId) throw new Error('TASK-scoped memory requires relatedTaskId');
  if (candidate.scope === 'ATTEMPT' && !candidate.relatedAttemptId) throw new Error('ATTEMPT-scoped memory requires relatedAttemptId');
  if (containsSecret(candidate.content)) throw new Error('memory candidate contains a secret');
}

// Ranking combines relevance, scope, validity, confidence, recency and source
// quality (spec 03 §5). Vector/similarity is never authoritative.
const SOURCE_QUALITY: Record<string, number> = {
  USER: 1.0, TEST: 0.95, REPOSITORY: 0.9, GIT: 0.85, TOOL: 0.8, SYSTEM: 0.8, DERIVED: 0.7, MODEL: 0.6
};
const CONFIDENCE_SCORE: Record<MemoryConfidence, number> = { HIGH: 1.0, MEDIUM: 0.7, LOW: 0.4 };
const SCOPE_SCORE: Record<MemoryScope, number> = { ATTEMPT: 1.0, TASK: 0.95, SESSION: 0.9, PROJECT: 0.85, GLOBAL: 0.6 };

export interface RankInput {
  record: MemoryRecord;
  queryText?: string;
  nowMs?: number;
}

export function rankMemory(input: RankInput): number {
  const { record } = input;
  const nowMs = input.nowMs ?? Date.now();
  const lexical = input.queryText
    ? lexicalOverlap(input.queryText, `${record.content} ${record.relatedFiles.join(' ')} ${record.relatedSymbols.join(' ')}`)
    : 0.5;
  const recency = recencyScore(Date.parse(record.createdAt), nowMs);
  const validity = record.validUntil && Date.parse(record.validUntil) < nowMs ? 0 : 1;
  const statusPenalty = record.status === 'CONFLICTING' ? 0.6 : record.status === 'UNCERTAIN' ? 0.8 : 1;
  return (
    lexical * 2.0 +
    SOURCE_QUALITY[record.source] * 1.2 +
    CONFIDENCE_SCORE[record.confidence] * 1.0 +
    SCOPE_SCORE[record.scope] * 0.8 +
    recency * 0.6
  ) * validity * statusPenalty;
}

function recencyScore(createdMs: number, nowMs: number): number {
  if (!Number.isFinite(createdMs)) return 0.5;
  const ageDays = Math.max(0, (nowMs - createdMs) / 86_400_000);
  return 1 / (1 + ageDays / 30);
}

function lexicalOverlap(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter(term => term.length > 2);
  if (terms.length === 0) return 0.5;
  const haystack = text.toLowerCase();
  const hits = terms.filter(term => haystack.includes(term)).length;
  return hits / terms.length;
}

// Retrieval default filters out superseded/expired memory (spec 04 §12:
// superseded memory is filtered from context).
export const RETRIEVABLE_STATUSES: MemoryStatus[] = ['ACTIVE', 'UNCERTAIN', 'CONFLICTING'];
