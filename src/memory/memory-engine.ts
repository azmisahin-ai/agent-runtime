import type { MemoryCandidate, MemoryRecord } from '../domain/types.js';

import type { Database } from '../persistence/database.js';
import type { MemoryRepository, MemoryQuery } from '../persistence/memory-repository.js';
import type { EventStore } from '../events/event-store.js';
import {
  rankMemory, RETRIEVABLE_STATUSES, shouldPersist, validateCandidate, type PersistenceDecision
} from './memory-policy.js';

export interface PersistResult {
  persisted: boolean;
  memoryId: string | null;
  decision: PersistenceDecision;
  superseded: string | null;
  conflictWith: string | null;
}

export interface MemoryEngineDeps {
  db: Database;
  repository: MemoryRepository;
  events: EventStore;
  // Current repository truth, used to reconcile memory against the workspace
  // (spec 03 §7, 12 §13). Optional so memory works without an index.
  repositoryTruth?: RepositoryTruthProvider;
}

// A minimal read interface: memory reconciliation needs current content hashes for
// the files a memory references, not the whole index.
export interface RepositoryTruthProvider {
  contentHashFor(projectId: string, path: string): string | null;
}

// Memory Engine (spec 03). Owns the OBSERVE -> UNDERSTAND -> PERSIST -> RETRIEVE
// -> RECONCILE -> UPDATE lifecycle. Retrieval never mutates memory.
export class MemoryEngine {
  constructor(private readonly deps: MemoryEngineDeps) {}

  // Persistence gate + supersession/conflict reconciliation in one transaction.
  persist(candidate: MemoryCandidate, context: { taskId?: string | null; attemptId?: string | null } = {}): PersistResult {
    // The gate runs first: a candidate it rejects (e.g. a secret) is a normal
    // "not persisted" outcome, not an error (spec 03 §4).
    const decision = shouldPersist(candidate);
    this.deps.events.append({
      projectId: candidate.projectId, taskId: context.taskId ?? candidate.relatedTaskId ?? null,
      attemptId: context.attemptId ?? candidate.relatedAttemptId ?? null,
      type: 'MemoryCandidateCreated', source: 'SYSTEM',
      payload: { type: candidate.type, scope: candidate.scope, source: candidate.source, persist: decision.persist, reason: decision.reason }
    });
    if (!decision.persist) {
      return { persisted: false, memoryId: null, decision, superseded: null, conflictWith: null };
    }
    // Structural validation applies only to candidates that will be written.
    validateCandidate(candidate);

    let superseded: string | null = null;
    let conflictWith: string | null = null;

    const memoryId = this.deps.db.transaction(() => {
      // Explicit supersession request.
      if (candidate.supersedes) {
        const target = this.deps.repository.get(candidate.supersedes);
        if (!target || target.projectId !== candidate.projectId) {
          throw new Error(`cannot supersede memory outside project: ${candidate.supersedes}`);
        }
      }

      const record = this.deps.repository.create(candidate);
      this.deps.events.append({
        projectId: candidate.projectId, taskId: record.relatedTaskId, attemptId: record.relatedAttemptId,
        type: 'MemoryValidated', source: 'SYSTEM', payload: { memoryId: record.memoryId }
      });

      if (candidate.supersedes) {
        this.deps.repository.supersede(candidate.supersedes, record.memoryId);
        superseded = candidate.supersedes;
        this.deps.events.append({
          projectId: candidate.projectId, taskId: record.relatedTaskId, attemptId: record.relatedAttemptId,
          type: 'MemorySuperseded', source: 'SYSTEM', payload: { oldMemoryId: candidate.supersedes, newMemoryId: record.memoryId }
        });
      }

      // Contradiction detection against active memories of the same type/scope.
      const peers = this.deps.repository.query({
        projectId: candidate.projectId, types: [candidate.type], scopes: [candidate.scope], statuses: ['ACTIVE']
      }).filter(existing => existing.memoryId !== record.memoryId);
      const contradictory = peers.find(existing => isContradiction(existing.content, record.content));
      if (contradictory) {
        conflictWith = contradictory.memoryId;
        // Conflicts preserve both sides; neither is silently deleted (spec 03 §6, §11).
        this.deps.repository.setStatus(record.memoryId, 'CONFLICTING');
        this.deps.repository.setStatus(contradictory.memoryId, 'CONFLICTING');
        this.deps.repository.addRelation(record.memoryId, contradictory.memoryId, 'contradicts');
        this.deps.events.append({
          projectId: candidate.projectId, taskId: record.relatedTaskId, attemptId: record.relatedAttemptId,
          type: 'MemoryConflictDetected', source: 'SYSTEM', payload: { memoryId: record.memoryId, conflictsWith: contradictory.memoryId }
        });
      }

      this.deps.events.append({
        projectId: candidate.projectId, taskId: record.relatedTaskId, attemptId: record.relatedAttemptId,
        type: 'MemoryPersisted', source: 'SYSTEM', payload: { memoryId: record.memoryId, type: record.type, scope: record.scope }
      });
      return record.memoryId;
    });

    return { persisted: true, memoryId, decision, superseded, conflictWith };
  }

  // Retrieval: scope/type/status filters -> ranking -> bounded result. Superseded
  // and expired records are excluded by default (spec 03 §5, 04 §12).
  retrieve(query: MemoryQuery & { queryText?: string; limit?: number }): MemoryRecord[] {
    const records = this.deps.repository.query({
      ...query,
      statuses: query.statuses ?? RETRIEVABLE_STATUSES,
      limit: query.limit ?? 50
    });
    const nowMs = Date.now();
    const ranked = records
      .map(record => ({ record, score: rankMemory({ record, queryText: query.queryText, nowMs }) }))
      .sort((a, b) => b.score - a.score)
      .map(entry => entry.record);

    this.deps.events.append({
      projectId: query.projectId, taskId: null, attemptId: null,
      type: 'MemoryRetrieved', source: 'SYSTEM',
      payload: { queryText: query.queryText ?? null, requested: query.limit ?? 50, returned: ranked.length }
    });
    return ranked;
  }

  // Revalidation: UNKNOWN does not automatically invalidate memory (spec 03 §6).
  revalidate(memoryId: string, decision: 'keep' | 'expire' | 'uncertain'): MemoryRecord | null {
    const record = this.deps.repository.get(memoryId);
    if (!record) return null;
    const status = decision === 'expire' ? 'EXPIRED' : decision === 'uncertain' ? 'UNCERTAIN' : record.status;
    this.deps.db.transaction(() => {
      if (status !== record.status) this.deps.repository.setStatus(memoryId, status);
      this.deps.events.append({
        projectId: record.projectId, taskId: record.relatedTaskId, attemptId: record.relatedAttemptId,
        type: 'MemoryRevalidated', source: 'SYSTEM', payload: { memoryId, decision, status }
      });
    });
    return this.deps.repository.get(memoryId);
  }

  // Memory flush precedes context compaction (spec 03 §8). Flush failure is
  // explicit: it is surfaced, never silently ignored.
  flush(candidates: MemoryCandidate[], context: { taskId?: string | null; attemptId?: string | null } = {}): { flushed: number; failed: { index: number; reason: string }[] } {
    const projectId = candidates[0]?.projectId ?? 'unknown';
    this.deps.events.append({
      projectId, taskId: context.taskId ?? null, attemptId: context.attemptId ?? null,
      type: 'MemoryFlushStarted', source: 'RUNTIME', payload: { candidates: candidates.length }
    });
    let flushed = 0;
    const failed: { index: number; reason: string }[] = [];
    candidates.forEach((candidate, index) => {
      try {
        const result = this.persist(candidate, context);
        if (result.persisted) flushed += 1;
      } catch (error) {
        failed.push({ index, reason: error instanceof Error ? error.message : String(error) });
      }
    });
    if (failed.length > 0) {
      this.deps.events.append({
        projectId, taskId: context.taskId ?? null, attemptId: context.attemptId ?? null,
        type: 'MemoryFlushFailed', source: 'RUNTIME', payload: { failed }
      });
    } else {
      this.deps.events.append({
        projectId, taskId: context.taskId ?? null, attemptId: context.attemptId ?? null,
        type: 'MemoryFlushCompleted', source: 'RUNTIME', payload: { flushed }
      });
    }
    return { flushed, failed };
  }

  // Repository-backed truth reconciliation (spec 03 §7): a memory that references a
  // repository file is marked UNCERTAIN when the file's current content no longer
  // matches what the memory was recorded against. It is never silently deleted, and
  // an UNKNOWN repository state does not invalidate memory (spec 03 §6).
  reconcileWithRepository(projectId: string): { checked: number; markedUncertain: string[]; unknown: number } {
    const truth = this.deps.repositoryTruth;
    if (!truth) return { checked: 0, markedUncertain: [], unknown: 0 };

    const records = this.deps.repository.query({ projectId, statuses: RETRIEVABLE_STATUSES });
    const markedUncertain: string[] = [];
    let checked = 0;
    let unknown = 0;

    for (const record of records) {
      const evidence = this.deps.repository.listEvidence(record.memoryId);
      const fileEvidence = evidence.filter(item => item.reference.startsWith('file:') && item.contentHash.length > 0);
      if (fileEvidence.length === 0) continue;
      checked += 1;

      let drifted = false;
      let sawUnknown = false;
      for (const item of fileEvidence) {
        const path = item.reference.slice('file:'.length);
        const current = truth.contentHashFor(projectId, path);
        if (current === null) { sawUnknown = true; continue; }
        if (current !== item.contentHash) drifted = true;
      }
      if (drifted) {
        this.deps.repository.setStatus(record.memoryId, 'UNCERTAIN');
        markedUncertain.push(record.memoryId);
      } else if (sawUnknown) {
        unknown += 1;
      }
    }

    if (markedUncertain.length > 0 || checked > 0) {
      this.deps.events.append({
        projectId, taskId: null, attemptId: null, type: 'MemoryReconciled', source: 'RUNTIME',
        payload: { checked, markedUncertain, unknown }
      });
    }
    return { checked, markedUncertain, unknown };
  }

  // Convert a verified failure into durable FAILURE memory (spec 03 §2).
  recordFailure(input: { projectId: string; taskId: string; attemptId: string; summary: string; files?: string[] }): PersistResult {
    return this.persist({
      projectId: input.projectId, scope: 'PROJECT', type: 'FAILURE', content: input.summary,
      source: 'SYSTEM', confidence: 'HIGH', relatedTaskId: input.taskId, relatedAttemptId: input.attemptId,
      relatedFiles: input.files ?? [], evidence: [{ reference: `attempt:${input.attemptId}`, contentHash: '', revision: null }]
    }, { taskId: input.taskId, attemptId: input.attemptId });
  }
}

// A deterministic polarity-based contradiction heuristic. It only reports a
// conflict when two statements share the same subject but carry opposite,
// explicitly-stated polarity, so it never invents conflicts from unrelated text
// (spec 03 §6). Similarity is not authority: this is an explicit lexical rule.
const POSITIVE_POLARITY = new Set(['allowed', 'allow', 'enabled', 'enable', 'permitted', 'permit', 'true', 'yes', 'granted', 'grant', 'on']);
const NEGATIVE_POLARITY = new Set(['denied', 'deny', 'disabled', 'disable', 'forbidden', 'forbid', 'false', 'no', 'off', 'rejected', 'reject', 'prohibited', 'not', 'never', "can't", 'cannot']);
// Low-information filler removed before comparing subjects.
const FILLER_WORDS = new Set(['access', 'is', 'are', 'was', 'were', 'be', 'the', 'a', 'an', 'to', 'of', 'in', 'for', 'and', 'or', 'it', 'this', 'that', 'we', 'i', 'you']);

function polarityOf(text: string): { subject: string; polarity: number } {
  const tokens = text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  const subject: string[] = [];
  let polarity = 0;
  for (const token of tokens) {
    if (POSITIVE_POLARITY.has(token)) { polarity += 1; continue; }
    if (NEGATIVE_POLARITY.has(token)) { polarity -= 1; continue; }
    if (FILLER_WORDS.has(token)) continue;
    subject.push(token);
  }
  // Return an empty subject when there is no polarity signal: no claim to compare.
  return { subject: polarity === 0 ? '' : subject.join(' '), polarity: Math.sign(polarity) };
}

function isContradiction(existing: string, incoming: string): boolean {
  const a = polarityOf(existing);
  const b = polarityOf(incoming);
  if (!a.subject || !b.subject) return false;
  return a.subject === b.subject && a.polarity !== b.polarity;
}

