import type {
  AffectedScope, IndexState, RepositoryEdgeKind, RepositoryEdgeRecord, RepositoryFileRecord,
  RepositoryIndexStateRecord, RepositorySymbolRecord, RepositoryTestRecord
} from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { canonicalHash } from '../domain/hash.js';
import type { Database } from './database.js';

// Repository index persistence (spec 12 §10). Index accelerates retrieval;
// the current workspace state remains authoritative for current truth.
export class RepositoryIndexRepository {
  constructor(private readonly db: Database) {}

  upsertFile(input: { projectId: string; path: string; language: string | null; size: number; contentHash: string; revision: string | null }): RepositoryFileRecord {
    const indexedAt = nowIso();
    const existing = this.getFile(input.projectId, input.path);
    const record: RepositoryFileRecord = {
      fileId: existing?.fileId ?? newId('file'), projectId: input.projectId, path: input.path,
      language: input.language, size: input.size, contentHash: input.contentHash, revision: input.revision, indexedAt
    };
    this.db.raw.prepare(`INSERT INTO repository_files(file_id,project_id,path,language,size,content_hash,revision,indexed_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,path) DO UPDATE SET language=excluded.language,size=excluded.size,content_hash=excluded.content_hash,revision=excluded.revision,indexed_at=excluded.indexed_at`)
      .run(record.fileId, record.projectId, record.path, record.language, record.size, record.contentHash, record.revision, record.indexedAt);
    return record;
  }

  getFile(projectId: string, path: string): RepositoryFileRecord | null {
    const row = this.db.raw.prepare('SELECT * FROM repository_files WHERE project_id = ? AND path = ?').get(projectId, path) as Record<string, unknown> | undefined;
    return row ? mapFile(row) : null;
  }

  listFiles(projectId: string): RepositoryFileRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_files WHERE project_id = ? ORDER BY path ASC').all(projectId) as Record<string, unknown>[];
    return rows.map(mapFile);
  }

  // Symbol identity is project + file + kind + qualified name (spec 12 §3).
  upsertSymbol(input: { projectId: string; fileId: string; kind: string; qualifiedName: string; location: string; signature: string | null; contentHash: string }): RepositorySymbolRecord {
    const indexedAt = nowIso();
    const record: RepositorySymbolRecord = {
      symbolId: newId('symbol'), projectId: input.projectId, fileId: input.fileId, kind: input.kind,
      qualifiedName: input.qualifiedName, location: input.location, signature: input.signature,
      contentHash: input.contentHash, indexedAt
    };
    this.db.raw.prepare(`INSERT INTO repository_symbols(symbol_id,project_id,file_id,kind,qualified_name,location,signature,content_hash,indexed_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,file_id,kind,qualified_name) DO UPDATE SET location=excluded.location,signature=excluded.signature,content_hash=excluded.content_hash,indexed_at=excluded.indexed_at`)
      .run(record.symbolId, record.projectId, record.fileId, record.kind, record.qualifiedName, record.location, record.signature, record.contentHash, record.indexedAt);
    return record;
  }

  searchSymbols(projectId: string, query: string, limit = 50): RepositorySymbolRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_symbols WHERE project_id = ? AND qualified_name LIKE ? ORDER BY qualified_name ASC LIMIT ?')
      .all(projectId, `%${query}%`, Math.max(1, Math.min(limit, 200))) as Record<string, unknown>[];
    return rows.map(mapSymbol);
  }

  listSymbolsByFile(projectId: string, fileId: string): RepositorySymbolRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_symbols WHERE project_id = ? AND file_id = ? ORDER BY location ASC')
      .all(projectId, fileId) as Record<string, unknown>[];
    return rows.map(mapSymbol);
  }

  // Repository evidence is immutable: name is derived from content hash (spec 12 §9).
  recordEvidence(projectId: string, reference: string, content: string, revision: string | null): { evidenceId: string; contentHash: string } {
    const contentHash = canonicalHash(content);
    const evidenceId = `evidence_${canonicalHash({ projectId, reference, contentHash }).slice(0, 32)}`;
    this.db.raw.prepare('INSERT OR IGNORE INTO repository_evidence(evidence_id,project_id,reference,content_hash,revision,created_at) VALUES (?,?,?,?,?,?)')
      .run(evidenceId, projectId, reference, contentHash, revision, nowIso());
    return { evidenceId, contentHash };
  }

  setIndexState(input: { projectId: string; state: IndexState; revision: string | null; indexedAt: string | null; fileCount: number; symbolCount: number }): RepositoryIndexStateRecord {
    const record: RepositoryIndexStateRecord = { ...input, updatedAt: nowIso() };
    this.db.raw.prepare(`INSERT INTO repository_index_state(project_id,state,revision,indexed_at,file_count,symbol_count,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET state=excluded.state,revision=excluded.revision,indexed_at=excluded.indexed_at,file_count=excluded.file_count,symbol_count=excluded.symbol_count,updated_at=excluded.updated_at`)
      .run(record.projectId, record.state, record.revision, record.indexedAt, record.fileCount, record.symbolCount, record.updatedAt);
    return record;
  }

  getIndexState(projectId: string): RepositoryIndexStateRecord | null {
    const row = this.db.raw.prepare('SELECT * FROM repository_index_state WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      projectId: String(row.project_id), state: row.state as IndexState,
      revision: row.revision ? String(row.revision) : null, indexedAt: row.indexed_at ? String(row.indexed_at) : null,
      fileCount: Number(row.file_count), symbolCount: Number(row.symbol_count), updatedAt: String(row.updated_at)
    };
  }

  listEvidence(projectId: string): { evidenceId: string; reference: string; contentHash: string; revision: string | null; createdAt: string }[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_evidence WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as Record<string, unknown>[];
    return rows.map(row => ({
      evidenceId: String(row.evidence_id), reference: String(row.reference), contentHash: String(row.content_hash),
      revision: row.revision ? String(row.revision) : null, createdAt: String(row.created_at)
    }));
  }

  // Edges are appended as evidence of the current revision's structure. Re-indexing
  // clears the project's edges so the graph always reflects one revision (spec 12 §4).
  addEdge(input: { projectId: string; kind: RepositoryEdgeKind; fromPath: string; toPath: string; fromSymbolId?: string | null; toSymbolId?: string | null; revision: string | null }): RepositoryEdgeRecord {
    const record: RepositoryEdgeRecord = {
      edgeId: newId('edge'), projectId: input.projectId, kind: input.kind, fromPath: input.fromPath,
      toPath: input.toPath, fromSymbolId: input.fromSymbolId ?? null, toSymbolId: input.toSymbolId ?? null,
      revision: input.revision, indexedAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO repository_edges(edge_id,project_id,kind,from_path,to_path,from_symbol_id,to_symbol_id,revision,indexed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(record.edgeId, record.projectId, record.kind, record.fromPath, record.toPath,
        record.fromSymbolId, record.toSymbolId, record.revision, record.indexedAt);
    return record;
  }

  clearEdges(projectId: string): void {
    this.db.raw.prepare('DELETE FROM repository_edges WHERE project_id = ?').run(projectId);
  }

  clearTests(projectId: string): void {
    this.db.raw.prepare('DELETE FROM repository_tests WHERE project_id = ?').run(projectId);
  }

  listEdges(projectId: string): RepositoryEdgeRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_edges WHERE project_id = ? ORDER BY from_path ASC').all(projectId) as Record<string, unknown>[];
    return rows.map(mapEdge);
  }

  // Forward dependencies of a path; reverse dependencies are the same list of
  // EdgeRows filtered by to_path (spec 12 §4).
  listOutgoing(projectId: string, fromPath: string): RepositoryEdgeRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_edges WHERE project_id = ? AND from_path = ? ORDER BY kind ASC').all(projectId, fromPath) as Record<string, unknown>[];
    return rows.map(mapEdge);
  }

  listIncoming(projectId: string, toPath: string): RepositoryEdgeRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_edges WHERE project_id = ? AND to_path = ? ORDER BY kind ASC').all(projectId, toPath) as Record<string, unknown>[];
    return rows.map(mapEdge);
  }

  addTest(input: { projectId: string; testPath: string; testName: string | null; targetPath: string | null; targetSymbolId?: string | null; revision: string | null }): RepositoryTestRecord {
    const record: RepositoryTestRecord = {
      testId: newId('test'), projectId: input.projectId, testPath: input.testPath, testName: input.testName,
      targetPath: input.targetPath, targetSymbolId: input.targetSymbolId ?? null, revision: input.revision, indexedAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO repository_tests(test_id,project_id,test_path,test_name,target_path,target_symbol_id,revision,indexed_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(record.testId, record.projectId, record.testPath, record.testName, record.targetPath, record.targetSymbolId, record.revision, record.indexedAt);
    return record;
  }

  listTests(projectId: string): RepositoryTestRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_tests WHERE project_id = ? ORDER BY test_path ASC').all(projectId) as Record<string, unknown>[];
    return rows.map(mapTest);
  }

  testsForTarget(projectId: string, targetPath: string): RepositoryTestRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM repository_tests WHERE project_id = ? AND target_path = ? ORDER BY test_path ASC').all(projectId, targetPath) as Record<string, unknown>[];
    return rows.map(mapTest);
  }

  // Bounded transitive closure over reverse dependencies (spec 12 §6: dependency
  // expansion is bounded to prevent context explosion). Cycles are tolerated by
  // tracking visited paths rather than recursing unbounded.
  affectedScope(projectId: string, roots: string[], maxNodes = 200): AffectedScope {
    const rootSet = [...new Set(roots)];
    const direct = new Set<string>();
    for (const root of rootSet) {
      for (const edge of this.listIncoming(projectId, root)) direct.add(edge.fromPath);
    }

    const transitive = new Set<string>();
    const queue = [...direct];
    let truncated = false;
    while (queue.length > 0) {
      if (transitive.size + direct.size > maxNodes) { truncated = true; break; }
      const current = queue.shift()!;
      for (const edge of this.listIncoming(projectId, current)) {
        if (rootSet.includes(edge.fromPath) || direct.has(edge.fromPath) || transitive.has(edge.fromPath)) continue;
        transitive.add(edge.fromPath);
        queue.push(edge.fromPath);
      }
    }

    const affectedFiles = [...rootSet, ...direct, ...transitive];
    const tests = new Set<string>();
    for (const file of affectedFiles) {
      for (const test of this.testsForTarget(projectId, file)) tests.add(test.testPath);
    }

    return { roots: rootSet, direct: [...direct], transitive: [...transitive], tests: [...tests], truncated };
  }
}

function mapFile(row: Record<string, unknown>): RepositoryFileRecord {
  return {
    fileId: String(row.file_id), projectId: String(row.project_id), path: String(row.path),
    language: row.language ? String(row.language) : null, size: Number(row.size),
    contentHash: String(row.content_hash), revision: row.revision ? String(row.revision) : null,
    indexedAt: String(row.indexed_at)
  };
}

function mapSymbol(row: Record<string, unknown>): RepositorySymbolRecord {
  return {
    symbolId: String(row.symbol_id), projectId: String(row.project_id), fileId: String(row.file_id),
    kind: String(row.kind), qualifiedName: String(row.qualified_name), location: String(row.location),
    signature: row.signature ? String(row.signature) : null, contentHash: String(row.content_hash),
    indexedAt: String(row.indexed_at)
  };
}

function mapEdge(row: Record<string, unknown>): RepositoryEdgeRecord {
  return {
    edgeId: String(row.edge_id), projectId: String(row.project_id), kind: row.kind as RepositoryEdgeKind,
    fromPath: String(row.from_path), toPath: String(row.to_path),
    fromSymbolId: row.from_symbol_id ? String(row.from_symbol_id) : null,
    toSymbolId: row.to_symbol_id ? String(row.to_symbol_id) : null,
    revision: row.revision ? String(row.revision) : null, indexedAt: String(row.indexed_at)
  };
}

function mapTest(row: Record<string, unknown>): RepositoryTestRecord {
  return {
    testId: String(row.test_id), projectId: String(row.project_id), testPath: String(row.test_path),
    testName: row.test_name ? String(row.test_name) : null, targetPath: row.target_path ? String(row.target_path) : null,
    targetSymbolId: row.target_symbol_id ? String(row.target_symbol_id) : null,
    revision: row.revision ? String(row.revision) : null, indexedAt: String(row.indexed_at)
  };
}
