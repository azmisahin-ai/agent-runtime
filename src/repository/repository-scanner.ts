import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { canonicalHash } from '../domain/hash.js';
import type { RepositoryIndexRepository } from '../persistence/repository-index-repository.js';
import { isInside } from '../tools/path-guard.js';

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', '.runtime', '.agent_tmp']);
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.md': 'markdown', '.sql': 'sql', '.yml': 'yaml', '.yaml': 'yaml',
  '.py': 'python', '.java': 'java', '.cs': 'csharp', '.go': 'go', '.rs': 'rust'
};

export interface ScanOptions {
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface ScanResult {
  files: number;
  symbols: number;
  revision: string | null;
}

// A language-agnostic symbol extractor. It recognizes common declaration forms as
// evidence for retrieval; it is not a compiler and does not claim full accuracy.
const SYMBOL_PATTERNS: { kind: string; regex: RegExp }[] = [
  { kind: 'Function', regex: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'Class', regex: /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'Interface', regex: /(?:^|\n)\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'Type', regex: /(?:^|\n)\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'Enum', regex: /(?:^|\n)\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g },
  { kind: 'Constant', regex: /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/g },
  { kind: 'Method', regex: /(?:^|\n)\s{2,}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;]+)?\{/g }
];

// RepositoryScanner + FileIndexer + SymbolIndexer + GitInspector (spec 12 §11).
// The scanner never mutates the repository and treats project root as a hard boundary.
export class RepositoryScanner {
  constructor(private readonly repository: RepositoryIndexRepository) {}

  index(projectId: string, root: string, revision: string | null, options: ScanOptions = {}): ScanResult {
    const maxFiles = options.maxFiles ?? 5000;
    const maxFileBytes = options.maxFileBytes ?? 1_000_000;
    this.repository.setIndexState({ projectId, state: 'BUILDING', revision, indexedAt: null, fileCount: 0, symbolCount: 0 });

    let files = 0;
    let symbols = 0;
    try {
      for (const path of walk(root, root, maxFiles)) {
        const absolute = join(root, path);
        let size: number;
        try { size = statSync(absolute).size; } catch { continue; }
        if (size > maxFileBytes) continue;
        let content: string;
        try { content = readFileSync(absolute, 'utf8'); } catch { continue; }
        const language = LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
        const file = this.repository.upsertFile({ projectId, path, language, size, contentHash: canonicalHash(content), revision });
        files += 1;
        if (language === 'typescript' || language === 'javascript') {
          symbols += this.indexSymbols(projectId, file.fileId, path, content);
        }
        this.repository.recordEvidence(projectId, `file:${path}`, content, revision);
      }
      this.repository.setIndexState({ projectId, state: 'FRESH', revision, indexedAt: new Date().toISOString(), fileCount: files, symbolCount: symbols });
      return { files, symbols, revision };
    } catch (error) {
      // Indexing failure is explicit: the index is left FAILED, never treated as truth.
      this.repository.setIndexState({ projectId, state: 'FAILED', revision, indexedAt: null, fileCount: files, symbolCount: symbols });
      throw error;
    }
  }

  // Freshness check: an index is STALE when the recorded revision is not the
  // current one (spec 12 §8). A stale index is historical evidence, not truth.
  checkFreshness(projectId: string, currentRevision: string | null): 'FRESH' | 'STALE' | 'UNKNOWN' {
    const state = this.repository.getIndexState(projectId);
    if (!state || state.state === 'UNKNOWN') return 'UNKNOWN';
    if (state.state !== 'FRESH') return 'STALE';
    return state.revision === currentRevision ? 'FRESH' : 'STALE';
  }

  private indexSymbols(projectId: string, fileId: string, path: string, content: string): number {
    let count = 0;
    const seen = new Set<string>();
    for (const pattern of SYMBOL_PATTERNS) {
      for (const match of content.matchAll(pattern.regex)) {
        const name = match[1];
        if (!name || seen.has(`${pattern.kind}:${name}`)) continue;
        seen.add(`${pattern.kind}:${name}`);
        const location = `${path}:${lineOf(content, match.index ?? 0)}`;
        this.repository.upsertSymbol({
          projectId, fileId, kind: pattern.kind, qualifiedName: name, location,
          signature: match[0].split('\n').pop()?.trim().slice(0, 200) ?? null,
          contentHash: canonicalHash(match[0])
        });
        count += 1;
      }
    }
    return count;
  }
}

function walk(root: string, current: string, maxFiles: number): string[] {
  const found: string[] = [];
  const stack = [current];
  while (stack.length > 0 && found.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      const absolute = join(dir, entry);
      if (!isInside(root, absolute)) continue;
      let isDirectory: boolean;
      try { isDirectory = statSync(absolute).isDirectory(); } catch { continue; }
      if (isDirectory) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        stack.push(absolute);
      } else {
        found.push(relative(root, absolute).split(sep).join('/'));
        if (found.length >= maxFiles) break;
      }
    }
  }
  return found;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}
