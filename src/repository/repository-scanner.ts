import { lstatSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
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
  edges: number;
  tests: number;
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
    let edges = 0;
    let tests = 0;
    try {
      const paths = walk(root, root, maxFiles);
      const known = new Set(paths);
      // A fresh full scan replaces structural edges so the graph reflects exactly
      // one revision (spec 12 §4, §8).
      this.repository.clearEdges(projectId);
      this.repository.clearTests(projectId);

      for (const path of paths) {
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
          edges += this.indexEdges(projectId, path, content, known, revision);
          if (isTestPath(path)) tests += this.indexTests(projectId, path, content, known, revision);
        }
        this.repository.recordEvidence(projectId, `file:${path}`, content, revision);
      }
      this.repository.setIndexState({ projectId, state: 'FRESH', revision, indexedAt: new Date().toISOString(), fileCount: files, symbolCount: symbols });
      return { files, symbols, edges, tests, revision };
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

  // DependencyIndexer (spec 12 §4): resolve import/export specifiers to indexed
  // paths. Unresolved specifiers (packages, dynamic paths) produce no edge, so the
  // graph only contains claims we can justify from the repository.
  private indexEdges(projectId: string, path: string, content: string, known: Set<string>, revision: string | null): number {
    let count = 0;
    const patterns: { kind: 'IMPORTS' | 'EXPORTS'; regex: RegExp }[] = [
      { kind: 'IMPORTS', regex: /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g },
      { kind: 'EXPORTS', regex: /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g }
    ];
    const seen = new Set<string>();
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern.regex)) {
        const target = resolveSpecifier(path, match[1], known);
        if (!target) continue;
        const key = `${pattern.kind}:${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.repository.addEdge({ projectId, kind: pattern.kind, fromPath: path, toPath: target, revision });
        count += 1;
      }
    }
    return count;
  }

  // TestIndexer (spec 12 §5): link a test file to the implementation it exercises
  // when the import graph makes that link explicit. No link is invented otherwise.
  private indexTests(projectId: string, path: string, content: string, known: Set<string>, revision: string | null): number {
    let count = 0;
    const targets = new Set<string>();
    for (const match of content.matchAll(/import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const target = resolveSpecifier(path, match[1], known);
      if (target) targets.add(target);
    }
    const names = [...content.matchAll(/(?:test|it)\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    if (targets.size === 0) {
      this.repository.addTest({ projectId, testPath: path, testName: names[0] ?? null, targetPath: null, revision });
      return 1;
    }
    for (const target of targets) {
      this.repository.addTest({ projectId, testPath: path, testName: names[0] ?? null, targetPath: target, revision });
      count += 1;
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
      // The project root is a hard boundary (spec 12 §12): symlinks are never
      // followed, so an index entry cannot resolve to a file outside the root.
      let info: Stats;
      try { info = lstatSync(absolute); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        stack.push(absolute);
      } else if (info.isFile()) {
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

// Resolve a relative import specifier to an indexed path, trying explicit file
// paths and common source/declaration extensions. Non-relative (package) imports
// never resolve to a repository file, so no edge is recorded for them.
const RESOLUTION_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '/index.ts', '/index.js'];
const DECLARATION_REWRITE: Record<string, string> = { '.js': '.ts', '.mjs': '.ts', '.cjs': '.ts', '.jsx': '.tsx' };

function resolveSpecifier(fromPath: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = posixJoin(posixDirname(fromPath), specifier);
  if (known.has(base)) return base;

  // TypeScript sources commonly import with a .js extension that maps to a .ts file.
  const ext = extname(base);
  if (ext && DECLARATION_REWRITE[ext]) {
    const rewritten = base.slice(0, -ext.length) + DECLARATION_REWRITE[ext];
    if (known.has(rewritten)) return rewritten;
  }
  for (const suffix of RESOLUTION_EXTENSIONS) {
    if (known.has(base + suffix)) return base + suffix;
  }
  return null;
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function posixJoin(base: string, relative: string): string {
  const segments = `${base}/${relative}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

// A test path is a convention, and conventions are signals, not proof (spec 12 §5).
function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)/.test(path) || /\.(test|spec)\.[jt]sx?$/.test(path);
}
