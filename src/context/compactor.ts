import type { ContextPack, ContextSection, ContextSectionType, MemoryCandidate } from '../domain/types.js';
import { canonicalHash } from '../domain/hash.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import { estimateTokens } from './context-engine.js';

export interface CompactionResult {
  pack: ContextPack;
  compacted: boolean;
  droppedSections: number;
  flush: { flushed: number; failed: { index: number; reason: string }[] } | null;
  dropped: ContextSection[];
}

// Sections that carry critical execution state and must survive compaction
// (spec 04 §7): objective/state, decisions, unresolved issues, affected files,
// latest failures, successful fixes, pending actions.
const CRITICAL_TYPES: ContextSectionType[] = ['SYSTEM', 'TASK', 'STATE', 'ERROR'];
// Sections safely droppable first: duplicates, obsolete hypotheses, history.
const DROPPABLE_TYPES: ContextSectionType[] = ['MEMORY', 'REPOSITORY', 'FILE', 'SYMBOL', 'GIT', 'OBSERVATION', 'TEST', 'INSTRUCTION', 'TOOL'];

export interface CompactorDeps {
  memoryEngine?: MemoryEngine;
}

// Context compaction. Memory flush must precede compaction, and a flush failure
// is surfaced rather than ignored (spec 03 §8, 04 §7).
export class Compactor {
  constructor(private readonly deps: CompactorDeps = {}) {}

  compact(
    pack: ContextPack,
    options: { memoryCandidates?: MemoryCandidate[]; taskId?: string | null; attemptId?: string | null; targetTokens?: number } = {}
  ): CompactionResult {
    const target = options.targetTokens ?? pack.retrievalBudget;

    // Step 1: flush durable facts BEFORE touching context.
    let flush: CompactionResult['flush'] = null;
    if (this.deps.memoryEngine && options.memoryCandidates?.length) {
      flush = this.deps.memoryEngine.flush(options.memoryCandidates, { taskId: options.taskId, attemptId: options.attemptId });
      if (flush.failed.length > 0) {
        // Do not compact on a failed flush: the durable-fact write is incomplete.
        return { pack, compacted: false, droppedSections: 0, flush, dropped: [] };
      }
    }

    const sections = [...pack.sections];
    const critical = sections.filter(section => CRITICAL_TYPES.includes(section.type));
    const optional = sections.filter(section => !CRITICAL_TYPES.includes(section.type));
    const criticalTokens = critical.reduce((sum, section) => sum + section.tokenCost, 0);

    // Deduplicate optional content by canonical hash before dropping anything.
    const deduped: ContextSection[] = [];
    const seen = new Set<string>();
    const dropped: ContextSection[] = [];
    for (const section of [...optional].sort((a, b) => a.priority - b.priority || b.relevance - a.relevance)) {
      const hash = canonicalHash({ type: section.type, content: section.content });
      if (seen.has(hash)) { dropped.push(section); continue; }
      seen.add(hash);
      deduped.push(section);
    }

    // Drop lowest-priority, least-relevant optional sections until within target.
    const sorted = [...deduped].sort((a, b) => dropOrder(b) - dropOrder(a));
    const kept = [...deduped];
    let used = criticalTokens + kept.reduce((sum, section) => sum + section.tokenCost, 0);
    for (const candidate of sorted) {
      if (used <= target) break;
      if (CRITICAL_TYPES.includes(candidate.type)) continue;
      const index = kept.indexOf(candidate);
      if (index >= 0) { kept.splice(index, 1); dropped.push(candidate); used -= candidate.tokenCost; }
    }

    const compacted = dropped.length > 0;
    const next: ContextPack = {
      ...pack,
      sections: [...critical, ...kept].sort((a, b) => a.priority - b.priority || a.type.localeCompare(b.type)),
      createdAt: pack.createdAt
    };
    return { pack: next, compacted, droppedSections: dropped.length, flush, dropped };
  }
}

// Higher value = dropped earlier: P4/P3 history before P2/P1 content, and
// non-essential section types before critical ones (spec 04 §4, §7).
function dropOrder(section: ContextSection): number {
  const typeBias = DROPPABLE_TYPES.includes(section.type) ? 1 : 0;
  return section.priority * 2 + typeBias;
}

export function summarizeDropped(dropped: ContextSection[]): string {
  return dropped.map(section => `${section.type}:${section.source} (${estimateTokens(section.content)} tok)`).join(', ');
}
