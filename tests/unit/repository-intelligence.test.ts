import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { RepositoryIndexRepository } from '../../src/persistence/repository-index-repository.js';
import { RepositoryScanner } from '../../src/repository/repository-scanner.js';
import { AffectedScopeAnalyzer, RepositorySearch } from '../../src/repository/repository-search.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-intel-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const project = new ProjectRepository(db).create({ name: 'intel', rootPath: workspace });
  const repository = new RepositoryIndexRepository(db);
  const scanner = new RepositoryScanner(repository);
  const search = new RepositorySearch(repository);
  const affectedScope = new AffectedScopeAnalyzer(repository);
  return { dir, workspace, db, project, repository, scanner, search, affectedScope };
}

function write(workspace: string, path: string, content: string) {
  const absolute = join(workspace, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

test('imports create forward and reverse dependency edges', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/util.ts', 'export function helper(): number { return 1; }\n');
    write(f.workspace, 'src/service.ts', "import { helper } from './util.js';\nexport const value = helper();\n");
    const result = f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.ok(result.edges >= 1);

    const outgoing = f.repository.listOutgoing(f.project.projectId, 'src/service.ts');
    assert.ok(outgoing.some(edge => edge.kind === 'IMPORTS' && edge.toPath === 'src/util.ts'));
    const incoming = f.repository.listIncoming(f.project.projectId, 'src/util.ts');
    assert.ok(incoming.some(edge => edge.fromPath === 'src/service.ts'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('package imports do not create edges (no unjustified claims)', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/app.ts', "import test from 'node:test';\nimport { z } from 'zod';\nexport const ok = true;\n");
    const result = f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.equal(result.edges, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('affected scope follows reverse dependencies transitively and finds tests', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/base.ts', 'export const base = 1;\n');
    write(f.workspace, 'src/middle.ts', "import { base } from './base.js';\nexport const middle = base + 1;\n");
    write(f.workspace, 'src/top.ts', "import { middle } from './middle.js';\nexport const top = middle + 1;\n");
    write(f.workspace, 'tests/base.test.ts', "import { base } from '../src/base.js';\ntest('base works', () => {});\n");
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');

    const scope = f.affectedScope.analyze(f.project.projectId, ['src/base.ts']);
    assert.deepEqual(scope.direct.sort(), ['src/middle.ts', 'tests/base.test.ts'].sort());
    assert.ok(scope.transitive.includes('src/top.ts'));
    assert.ok(scope.tests.includes('tests/base.test.ts'));
    assert.equal(scope.truncated, false);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('cyclic dependencies do not cause unbounded traversal', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/a.ts', "import { b } from './b.js';\nexport const a = b;\n");
    write(f.workspace, 'src/b.ts', "import { a } from './a.js';\nexport const b = a;\n");
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    const scope = f.affectedScope.analyze(f.project.projectId, ['src/a.ts'], 50);
    assert.ok(scope.direct.includes('src/b.ts'));
    // Terminates without hanging and does not duplicate a path.
    assert.equal(new Set([...scope.direct, ...scope.transitive]).size, scope.direct.length + scope.transitive.length);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('affected scope truncates at the bound instead of exploding', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 30; i += 1) {
      const next = i + 1 < 30 ? `import { v${i + 1} } from './f${i + 1}.js';\n` : '';
      write(f.workspace, `src/f${i}.ts`, `${next}export const v${i} = ${i};\n`);
    }
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    const scope = f.affectedScope.analyze(f.project.projectId, ['src/f29.ts'], 5);
    assert.equal(scope.truncated, true);
    assert.ok(scope.direct.length + scope.transitive.length <= 10);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('test discovery links tests to implementation via imports', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/calc.ts', 'export function sum(a: number, b: number): number { return a + b; }\n');
    write(f.workspace, 'tests/calc.test.ts', "import { sum } from '../src/calc.js';\ntest('sum adds', () => {});\n");
    const result = f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    assert.ok(result.tests >= 1);
    const tests = f.repository.testsForTarget(f.project.projectId, 'src/calc.ts');
    assert.ok(tests.some(record => record.testPath === 'tests/calc.test.ts'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('repository search ranks filename matches above path matches', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/checkout/checkout.ts', 'export const checkout = true;\n');
    write(f.workspace, 'src/other.ts', 'export const other = true;\n');
    write(f.workspace, 'docs/checkout-notes.md', '# checkout notes\n');
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');

    const result = f.search.search(f.project.projectId, { queryText: 'checkout' });
    assert.ok(result.files.length >= 1);
    assert.equal(result.files[0].file.path, 'src/checkout/checkout.ts');
    assert.ok(result.files[0].reasons.some(reason => reason.startsWith('filename')));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('repository search returns symbols for matching queries', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/api.ts', 'export class PaymentGateway {}\nexport function processPayment(): void {}\n');
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    const result = f.search.search(f.project.projectId, { queryText: 'payment' });
    assert.ok(result.symbols.some(hit => hit.symbol.qualifiedName === 'PaymentGateway'));
    assert.ok(result.symbols.some(hit => hit.symbol.qualifiedName === 'processPayment'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('re-indexing replaces edges rather than accumulating revisions', () => {
  const f = fixture();
  try {
    write(f.workspace, 'src/a.ts', 'export const a = 1;\n');
    write(f.workspace, 'src/b.ts', "import { a } from './a.js';\nexport const b = a;\n");
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    const first = f.repository.listEdges(f.project.projectId).length;

    write(f.workspace, 'src/b.ts', 'export const b = 2;\n');
    f.scanner.index(f.project.projectId, f.workspace, 'rev2');
    const second = f.repository.listEdges(f.project.projectId).length;
    assert.ok(first >= 1);
    assert.equal(second, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
