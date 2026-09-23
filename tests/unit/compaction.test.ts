import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../src/persistence/database.js';
import { ProjectRepository } from '../../src/persistence/project-repository.js';
import { MemoryRepository } from '../../src/persistence/memory-repository.js';
import { EventStore } from '../../src/events/event-store.js';
import { MemoryEngine } from '../../src/memory/memory-engine.js';
import { Compactor } from '../../src/context/compactor.js';
import type { ContextPack, ContextSection } from '../../src/domain/types.js';
import { repoPath } from '../../src/runtime/paths.js';

function packWith(sections: ContextSection[]): ContextPack {
  return {
    contextId: 'ctx', taskId: 't', attemptId: 'a', createdAt: new Date().toISOString(),
    modelContextLimit: 8192, reservedOutputTokens: 1024, systemTokens: 10, toolSchemaTokens: 0,
    retrievalBudget: 100, sections
  };
}

function section(type: ContextSection['type'], content: string, priority: ContextSection['priority'], tokenCost: number): ContextSection {
  return { id: `${type}-${content}`, type, content, source: 'test', priority, tokenCost, relevance: 1, timestamp: new Date().toISOString(), provenance: 'test' };
}

test('compaction preserves critical state sections', () => {
  const compactor = new Compactor();
  const result = compactor.compact(packWith([
    section('SYSTEM', 'runtime notice', 0, 5),
    section('TASK', 'objective', 0, 5),
    section('STATE', 'running', 0, 5),
    section('ERROR', 'latest failure', 1, 5),
    section('FILE', 'x'.repeat(400), 2, 100),
    section('GIT', 'branch main', 3, 100)
  ]), { targetTokens: 50 });
  const types = result.pack.sections.map(s => s.type);
  assert.ok(types.includes('SYSTEM') && types.includes('TASK') && types.includes('STATE') && types.includes('ERROR'));
  assert.ok(result.compacted);
  assert.ok(result.droppedSections > 0);
});

test('compaction deduplicates identical optional sections', () => {
  const compactor = new Compactor();
  const duplicate = section('FILE', 'same content here', 2, 10);
  const result = compactor.compact(packWith([
    section('SYSTEM', 'notice', 0, 1),
    duplicate,
    { ...duplicate, id: 'dup2' }
  ]), { targetTokens: 1000 });
  const fileSections = result.pack.sections.filter(s => s.type === 'FILE');
  assert.equal(fileSections.length, 1);
});

test('memory flush precedes compaction and a failed flush blocks compaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-comp-'));
  const db = new Database(join(dir, 'runtime.db'));
  db.migrate(repoPath('migrations'));
  try {
    const project = new ProjectRepository(db).create({ name: 'p', rootPath: dir });
    const repository = new MemoryRepository(db);
    const events = new EventStore(db);
    const memoryEngine = new MemoryEngine({ db, repository, events });
    const compactor = new Compactor({ memoryEngine });

    const ok = compactor.compact(packWith([section('SYSTEM', 'notice', 0, 1), section('FILE', 'f'.repeat(400), 2, 100)]), {
      memoryCandidates: [{ projectId: project.projectId, scope: 'PROJECT', type: 'PROJECT', content: 'durable fact worth keeping', source: 'USER', confidence: 'HIGH' }],
      targetTokens: 10
    });
    assert.equal(ok.flush!.flushed, 1);
    assert.equal(repository.listByProject(project.projectId).length, 1);

    const failed = compactor.compact(packWith([section('SYSTEM', 'notice', 0, 1), section('FILE', 'f'.repeat(400), 2, 100)]), {
      memoryCandidates: [{ projectId: project.projectId, scope: 'TASK', type: 'PROJECT', content: 'invalid task-scoped fact', source: 'USER', confidence: 'HIGH' }],
      targetTokens: 10
    });
    // A failed flush must not silently proceed to compaction.
    assert.equal(failed.compacted, false);
    assert.equal(failed.flush!.failed.length, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
