import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { RepositoryIndexRepository } from '../../src/persistence/repository-index-repository.js';
import { RepositoryScanner } from '../../src/repository/repository-scanner.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-repo-'));
  // The workspace being scanned is a subdirectory so runtime artifacts (the
  // SQLite file) do not pollute the index, matching real deployments.
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const project = new ProjectRepository(db).create({ name: 'repo', rootPath: workspace });
  const repository = new RepositoryIndexRepository(db);
  const scanner = new RepositoryScanner(repository);
  return { dir, workspace, db, project, repository, scanner };
}

test('scanner indexes files and extracts symbols', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.workspace, 'src'), { recursive: true });
    writeFileSync(join(f.workspace, 'src', 'math.ts'), 'export function add(a: number, b: number): number { return a + b; }\nexport class Calculator {}\n');
    writeFileSync(join(f.workspace, 'README.md'), '# docs\n');
    const result = f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.equal(result.files, 2);
    assert.ok(result.symbols >= 2);
    const files = f.repository.listFiles(f.project.projectId);
    assert.ok(files.some(file => file.path === 'src/math.ts' && file.language === 'typescript'));
    const symbols = f.repository.searchSymbols(f.project.projectId, 'add');
    assert.ok(symbols.some(symbol => symbol.qualifiedName === 'add'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('index freshness is STALE when the revision differs', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.workspace, 'a.ts'), 'export const A = 1;\n');
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.equal(f.scanner.checkFreshness(f.project.projectId, 'rev1'), 'FRESH');
    assert.equal(f.scanner.checkFreshness(f.project.projectId, 'rev2'), 'STALE');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('index freshness is UNKNOWN when never indexed', () => {
  const f = fixture();
  try {
    assert.equal(f.scanner.checkFreshness(f.project.projectId, 'rev1'), 'UNKNOWN');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('node_modules and .git are not indexed', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.workspace, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(f.workspace, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
    writeFileSync(join(f.workspace, 'app.ts'), 'export const app = true;\n');
    const result = f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.equal(result.files, 1);
    assert.ok(f.repository.listFiles(f.project.projectId).every(file => !file.path.includes('node_modules')));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('repository evidence is immutable and content-addressed', () => {
  const f = fixture();
  try {
    const first = f.repository.recordEvidence(f.project.projectId, 'file:src/a.ts', 'const a = 1;', 'rev1');
    const second = f.repository.recordEvidence(f.project.projectId, 'file:src/a.ts', 'const a = 1;', 'rev1');
    assert.equal(first.evidenceId, second.evidenceId);
    const changed = f.repository.recordEvidence(f.project.projectId, 'file:src/a.ts', 'const a = 2;', 'rev1');
    assert.notEqual(first.contentHash, changed.contentHash);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
