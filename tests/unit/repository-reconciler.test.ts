import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { RepositoryIndexRepository } from '../../src/persistence/repository-index-repository.js';
import { RepositoryScanner } from '../../src/repository/repository-scanner.js';
import { AffectedScopeAnalyzer, RepositorySearch } from '../../src/repository/repository-search.js';
import { RepositoryReconciler } from '../../src/repository/repository-reconciler.js';
import { GitInspector } from '../../src/git/git-inspector.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-reconcile-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const project = new ProjectRepository(db).create({ name: 'reconcile', rootPath: workspace });
  const repository = new RepositoryIndexRepository(db);
  const scanner = new RepositoryScanner(repository);
  const search = new RepositorySearch(repository);
  const affectedScope = new AffectedScopeAnalyzer(repository);
  const git = new GitInspector(workspace);
  const reconciler = new RepositoryReconciler(repository, git, affectedScope, search);
  return { dir, workspace, db, project, repository, scanner, search, git, reconciler };
}

function git(cwd: string, args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

test('reconcile reports UNKNOWN when no index exists', () => {
  const f = fixture();
  try {
    const result = f.reconciler.reconcile(f.project.projectId);
    assert.equal(result.state, 'UNKNOWN');
    assert.equal(result.staleIndexUsed, false);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('reconcile marks the index STALE when the revision is not current', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.workspace, 'a.ts'), 'export const a = 1;\n');
    f.scanner.index(f.project.projectId, f.workspace, 'rev1');
    // Git inspector reports no HEAD (not a repo), so current revision is null.
    const result = f.reconciler.reconcile(f.project.projectId);
    assert.equal(result.state, 'STALE');
    assert.equal(result.staleIndexUsed, true);
    // The index state is marked STALE rather than silently trusted.
    assert.equal(f.repository.getIndexState(f.project.projectId)?.state, 'STALE');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('reconcile reports FRESH when the indexed revision matches git HEAD', () => {
  const f = fixture();
  try {
    git(f.workspace, ['init', '-q']);
    git(f.workspace, ['config', 'user.email', 'test@example.com']);
    git(f.workspace, ['config', 'user.name', 'Test']);
    writeFileSync(join(f.workspace, 'a.ts'), 'export const a = 1;\n');
    git(f.workspace, ['add', '.']);
    git(f.workspace, ['commit', '-q', '-m', 'first']);
    f.scanner.index(f.project.projectId, f.workspace, f.git.state().head!);
    const result = f.reconciler.reconcile(f.project.projectId);
    assert.equal(result.state, 'FRESH');
    assert.equal(result.staleIndexUsed, false);
    assert.deepEqual(result.changedFiles, []);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('reconcile detects changed files after a git commit', () => {
  const f = fixture();
  try {
    git(f.workspace, ['init', '-q']);
    git(f.workspace, ['config', 'user.email', 'test@example.com']);
    git(f.workspace, ['config', 'user.name', 'Test']);
    writeFileSync(join(f.workspace, 'base.ts'), 'export const base = 1;\n');
    git(f.workspace, ['add', '.']);
    git(f.workspace, ['commit', '-q', '-m', 'first']);
    const rev1 = f.git.state().head!;
    f.scanner.index(f.project.projectId, f.workspace, rev1);

    writeFileSync(join(f.workspace, 'consumer.ts'), "import { base } from './base.js';\nexport const c = base;\n");
    git(f.workspace, ['add', '.']);
    git(f.workspace, ['commit', '-q', '-m', 'second']);

    const result = f.reconciler.reconcile(f.project.projectId);
    assert.equal(result.state, 'STALE');
    assert.ok(result.changedFiles.includes('consumer.ts'));
    assert.equal(result.staleIndexUsed, true);
    // Git signals are inputs, not assumptions: the index still lacks consumer.ts.
    const hits = f.reconciler.changedFileHits(f.project.projectId, result.changedFiles);
    assert.ok(hits.some(hit => hit.path === 'consumer.ts' && hit.reason === 'unindexed-or-untracked'));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('git inspector never uses a shell string', () => {
  const f = fixture();
  try {
    git(f.workspace, ['init', '-q']);
    // A path that would be dangerous in a shell string is passed as a literal argv
    // entry and simply fails to resolve; no command execution occurs.
    assert.doesNotThrow(() => f.git.changedFiles('; rm -rf /'));
    assert.deepEqual(f.git.changedFiles('; rm -rf /'), []);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('recent commits are parsed without a shell', () => {
  const f = fixture();
  try {
    git(f.workspace, ['init', '-q']);
    git(f.workspace, ['config', 'user.email', 'test@example.com']);
    git(f.workspace, ['config', 'user.name', 'Test']);
    writeFileSync(join(f.workspace, 'x.ts'), 'export const x = 1;\n');
    git(f.workspace, ['add', '.']);
    git(f.workspace, ['commit', '-q', '-m', 'initial commit']);
    const commits = f.git.recentCommits(5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, 'initial commit');
    assert.equal(commits[0].author, 'Test');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
