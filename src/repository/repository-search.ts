import type { AffectedScope, RepositoryEdgeRecord, RepositoryFileRecord, RepositorySymbolRecord, RepositoryTestRecord } from '../domain/types.js';
import type { RepositoryIndexRepository } from '../persistence/repository-index-repository.js';

export interface RepositorySearchQuery {
  queryText: string;
  limit?: number;
  kinds?: string[];
}

export interface RankedFile {
  file: RepositoryFileRecord;
  score: number;
  reasons: string[];
}

export interface RankedSymbol {
  symbol: RepositorySymbolRecord;
  score: number;
  reasons: string[];
}

export interface RepositorySearchResult {
  files: RankedFile[];
  symbols: RankedSymbol[];
}

// RepositorySearch + SymbolSearch (spec 12 §6): path, filename, lexical content
// and symbol search combined into ranked results. Ranking is evidence-weighted,
// deterministic and never depends on a model.
export class RepositorySearch {
  constructor(private readonly repository: RepositoryIndexRepository) {}

  search(projectId: string, query: RepositorySearchQuery): RepositorySearchResult {
    const limit = Math.max(1, Math.min(query.limit ?? 25, 100));
    const terms = tokenize(query.queryText);
    const files: RankedFile[] = [];
    const symbols: RankedSymbol[] = [];

    for (const file of this.repository.listFiles(projectId)) {
      const reasons: string[] = [];
      let score = 0;
      const name = basename(file.path).toLowerCase();
      const stem = name.replace(/\.[^.]+$/, '');
      const path = file.path.toLowerCase();
      for (const term of terms) {
        // An exact filename stem is the strongest signal, then a filename
        // containing the term, then a directory/path component (spec 12 §6).
        if (stem === term) { score += 5; reasons.push(`filename:${term}`); }
        else if (name.includes(term)) { score += 3; reasons.push(`filename~${term}`); }
        else if (path.includes(term)) { score += 1; reasons.push(`path~${term}`); }
      }
      if (score > 0) files.push({ file, score, reasons });
    }

    const kinds = query.kinds ? new Set(query.kinds) : null;
    for (const term of terms) {
      for (const symbol of this.repository.searchSymbols(projectId, term, limit)) {
        if (kinds && !kinds.has(symbol.kind)) continue;
        const qualified = symbol.qualifiedName.toLowerCase();
        const score = qualified === term ? 5 : qualified.startsWith(term) ? 4 : 3;
        symbols.push({ symbol, score, reasons: [`symbol:${term}`] });
      }
    }

    // Collapse duplicate symbol hits, keeping the strongest reason set.
    const best = new Map<string, RankedSymbol>();
    for (const candidate of symbols) {
      const existing = best.get(candidate.symbol.symbolId);
      if (!existing || candidate.score > existing.score) best.set(candidate.symbol.symbolId, candidate);
    }

    return {
      files: files.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path)).slice(0, limit),
      symbols: [...best.values()].sort((a, b) => b.score - a.score || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName)).slice(0, limit)
    };
  }
}

// AffectedScopeAnalyzer (spec 12 §11): given changed roots, determine the bounded
// set of files, transitive dependents and tests that a change can plausibly reach.
export class AffectedScopeAnalyzer {
  constructor(private readonly repository: RepositoryIndexRepository) {}

  analyze(projectId: string, changedPaths: string[], maxNodes = 200): AffectedScope {
    return this.repository.affectedScope(projectId, changedPaths, maxNodes);
  }

  // Changed symbols for the roots, resolved from the index (spec 12 §7).
  changedSymbols(projectId: string, changedPaths: string[]): RepositorySymbolRecord[] {
    const roots = new Set(changedPaths);
    const symbols = new Map<string, RepositorySymbolRecord>();
    for (const file of this.repository.listFiles(projectId)) {
      if (!roots.has(file.path)) continue;
      for (const symbol of this.repository.listSymbolsByFile(projectId, file.fileId)) {
        symbols.set(symbol.symbolId, symbol);
      }
    }
    return [...symbols.values()];
  }

  // Ranking input for Git signals: changed paths are candidates, not automatically
  // relevant (spec 12 §7). Callers combine this with task intent.
  gitSignal(projectId: string, changedPaths: string[]): { edges: RepositoryEdgeRecord[]; tests: RepositoryTestRecord[] } {
    const edges: RepositoryEdgeRecord[] = [];
    const tests: RepositoryTestRecord[] = [];
    for (const path of changedPaths) {
      edges.push(...this.repository.listIncoming(projectId, path));
      tests.push(...this.repository.testsForTarget(projectId, path));
    }
    return { edges, tests };
  }
}

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9_$]+/).filter(term => term.length > 1))];
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}
