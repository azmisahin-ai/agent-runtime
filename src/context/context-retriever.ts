import type { ContextSection, MemoryRecord } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { estimateTokens } from './context-engine.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { RepositorySearch } from '../repository/repository-search.js';

export interface ContextRetrieverDeps {
  memoryEngine?: MemoryEngine;
  repositorySearch?: RepositorySearch;
}

export interface RetrievalInput {
  projectId: string;
  queryText: string;
  memoryLimit?: number;
  repositoryLimit?: number;
  includeRepository?: boolean;
}

// Context retrieval integration (spec 04 §12, 12 §13): memory and repository
// results become prioritised, explicitly-provenanced context sections. Both are
// untrusted data for instruction purposes; provenance is preserved so verification
// can cite it and staleness is visible.
export class ContextRetriever {
  constructor(private readonly deps: ContextRetrieverDeps) {}

  retrieve(input: RetrievalInput): ContextSection[] {
    const sections: ContextSection[] = [];
    const timestamp = nowIso();

    if (this.deps.memoryEngine) {
      const memories = this.deps.memoryEngine.retrieve({
        projectId: input.projectId, queryText: input.queryText, limit: input.memoryLimit ?? 10
      });
      for (const memory of memories) sections.push(memorySection(memory, timestamp));
    }

    if (this.deps.repositorySearch && input.includeRepository !== false) {
      const result = this.deps.repositorySearch.search(input.projectId, {
        queryText: input.queryText, limit: input.repositoryLimit ?? 10
      });
      for (const hit of result.files) {
        sections.push({
          id: newId('section'), type: 'REPOSITORY',
          content: `path=${hit.file.path} language=${hit.file.language ?? 'unknown'} indexedRev=${hit.file.revision ?? 'none'} reasons=${hit.reasons.join(',')}`,
          source: hit.file.path, priority: 2, tokenCost: estimateTokens(hit.file.path),
          relevance: Math.min(1, hit.score / 5), timestamp, provenance: 'repository:index'
        });
      }
      for (const hit of result.symbols) {
        sections.push({
          id: newId('section'), type: 'SYMBOL',
          content: `${hit.symbol.kind} ${hit.symbol.qualifiedName} @ ${hit.symbol.location}${hit.symbol.signature ? ` :: ${hit.symbol.signature}` : ''}`,
          source: hit.symbol.location, priority: 3, tokenCost: estimateTokens(hit.symbol.qualifiedName),
          relevance: Math.min(1, hit.score / 5), timestamp, provenance: 'repository:index'
        });
      }
    }

    return sections;
  }
}

function memorySection(memory: MemoryRecord, timestamp: string): ContextSection {
  const provenance = `memory:${memory.type.toLowerCase()}:${memory.source.toLowerCase()}`;
  // Conflicts and uncertainties are surfaced explicitly so the model cannot mistake
  // contested memory for settled fact (spec 03 §6).
  const marker = memory.status === 'CONFLICTING' ? '[CONFLICTING] ' : memory.status === 'UNCERTAIN' ? '[UNCERTAIN] ' : '';
  return {
    id: newId('section'), type: 'MEMORY', content: `${marker}${memory.content}`,
    source: memory.memoryId, priority: memory.status === 'CONFLICTING' ? 1 : 2,
    tokenCost: estimateTokens(memory.content), relevance: memory.confidence === 'HIGH' ? 1 : 0.7,
    timestamp, provenance
  };
}
