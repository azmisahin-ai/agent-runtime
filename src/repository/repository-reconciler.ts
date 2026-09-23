import type { AffectedScope } from '../domain/types.js';
import type { GitInspector } from '../git/git-inspector.js';
import type { RepositoryIndexRepository } from '../persistence/repository-index-repository.js';
import type { AffectedScopeAnalyzer, RepositorySearch } from './repository-search.js';

export interface ReconciliationResult {
  state: 'FRESH' | 'STALE' | 'UNKNOWN';
  currentRevision: string | null;
  indexedRevision: string | null;
  changedFiles: string[];
  affectedScope: AffectedScope | null;
  staleIndexUsed: boolean;
}

// RepositoryReconciler (spec 12 §11, §12): after external workspace/Git changes,
// reconcile the index with current state. A stale index is historical evidence,
// never current truth, and the caller is told explicitly when it is stale.
export class RepositoryReconciler {
  constructor(
    private readonly repository: RepositoryIndexRepository,
    private readonly git: GitInspector,
    private readonly affectedScope: AffectedScopeAnalyzer,
    private readonly search: RepositorySearch
  ) {}

  reconcile(projectId: string): ReconciliationResult {
    const state = this.repository.getIndexState(projectId);
    const currentRevision = this.git.isRepository() ? this.git.state().head : null;
    const indexedRevision = state?.revision ?? null;

    if (!state) {
      return { state: 'UNKNOWN', currentRevision, indexedRevision: null, changedFiles: [], affectedScope: null, staleIndexUsed: false };
    }

    const changedFiles = indexedRevision ? this.git.changedFiles(indexedRevision) : [];
    const stale = indexedRevision !== currentRevision;
    if (stale) {
      // Mark the index STALE rather than silently trusting it.
      this.repository.setIndexState({
        projectId, state: 'STALE', revision: indexedRevision, indexedAt: state.indexedAt,
        fileCount: state.fileCount, symbolCount: state.symbolCount
      });
    }

    const affectedScope = changedFiles.length > 0 ? this.affectedScope.analyze(projectId, changedFiles) : null;
    return { state: stale ? 'STALE' : 'FRESH', currentRevision, indexedRevision, changedFiles, affectedScope, staleIndexUsed: stale };
  }

  // Git signals combined with the index: changed paths are candidates for ranking
  // (spec 12 §7). Returns the indexed files that the change plausibly touches.
  changedFileHits(projectId: string, changedFiles: string[]): { path: string; reason: string }[] {
    const hits: { path: string; reason: string }[] = [];
    const indexed = new Set(this.repository.listFiles(projectId).map(file => file.path));
    for (const path of changedFiles) {
      if (indexed.has(path)) hits.push({ path, reason: 'indexed' });
      else hits.push({ path, reason: 'unindexed-or-untracked' });
    }
    return hits;
  }

  // Convenience: search restricted to the indexed files touched by a change.
  searchChanged(projectId: string, changedFiles: string[], queryText: string) {
    const scope = new Set(changedFiles);
    return this.search.search(projectId, { queryText }).files.filter(hit => scope.has(hit.file.path));
  }
}
