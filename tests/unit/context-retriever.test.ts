import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { MemoryRepository } from '../../src/persistence/memory-repository.js';
import { RepositoryIndexRepository } from '../../src/persistence/repository-index-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { MemoryEngine } from '../../src/memory/memory-engine.js';
import { RepositoryScanner } from '../../src/repository/repository-scanner.js';
import { RepositorySearch } from '../../src/repository/repository-search.js';
import { ContextRetriever } from '../../src/context/context-retriever.js';
import { repoPath } from '../../src/runtime/paths.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-retr-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'config.ts'), 'export const defaultConfig = { retries: 3 };\n');
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  const project = new ProjectRepository(db).create({ name: 'retr', rootPath: workspace });
  const memories = new MemoryRepository(db);
  const events = new EventStore(db);
  const memoryEngine = new MemoryEngine({ db, repository: memories, events });
  const repositoryIndex = new RepositoryIndexRepository(db);
  const scanner = new RepositoryScanner(repositoryIndex);
  const search = new RepositorySearch(repositoryIndex);
  const retriever = new ContextRetriever({ memoryEngine, repositorySearch: search });
  scanner.index(project.projectId, workspace, 'rev1');
  return { dir, workspace, db, project, memoryEngine, retriever, scanner, repositoryIndex };
}

test('retrieval surfaces memory and repository sections with provenance', () => {
  const f = fixture();
  try {
    f.memoryEngine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROCEDURAL',
      content: 'default config retries should be three', source: 'USER', confidence: 'HIGH'
    });
    const sections = f.retriever.retrieve({ projectId: f.project.projectId, queryText: 'config retries' });
    const memorySections = sections.filter(section => section.type === 'MEMORY');
    const repositorySections = sections.filter(section => section.type === 'REPOSITORY');
    assert.ok(memorySections.length >= 1);
    assert.ok(repositorySections.length >= 1);
    assert.ok(memorySections[0].provenance.startsWith('memory:'));
    assert.equal(repositorySections[0].provenance, 'repository:index');
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('conflicting memory is marked explicitly in context', () => {
  const f = fixture();
  try {
    f.memoryEngine.persist({ projectId: f.project.projectId, scope: 'PROJECT', type: 'SEMANTIC', content: 'feature flag enabled for beta', source: 'SYSTEM', confidence: 'HIGH' });
    f.memoryEngine.persist({ projectId: f.project.projectId, scope: 'PROJECT', type: 'SEMANTIC', content: 'feature flag disabled for beta', source: 'MODEL', confidence: 'HIGH' });
    const sections = f.retriever.retrieve({ projectId: f.project.projectId, queryText: 'feature flag beta' });
    const memorySections = sections.filter(section => section.type === 'MEMORY');
    assert.ok(memorySections.some(section => section.content.includes('[CONFLICTING]')));
    // Conflicting memory is elevated in priority so it is not dropped silently.
    assert.ok(memorySections.some(section => section.priority === 1));
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('retrieval can omit repository sections', () => {
  const f = fixture();
  try {
    const sections = f.retriever.retrieve({ projectId: f.project.projectId, queryText: 'config', includeRepository: false });
    assert.equal(sections.filter(section => section.type === 'REPOSITORY').length, 0);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
