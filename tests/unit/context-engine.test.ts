import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngine, estimateTokens } from '../../src/context/context-engine.js';
import type { ContextSection, Task, GitState } from '../../src/domain/types.js';

const gitState: GitState = { head: 'abc', branch: 'main', dirty: false };

function task(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task_1', projectId: 'project_1', title: 'Change config', description: 'Update the configuration',
    state: 'RUNNING', currentAttemptId: null, currentCheckpointId: null,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), ...overrides
  };
}

test('context pack never exceeds the effective budget', () => {
  const engine = new ContextEngine({ modelContextLimit: 1000, reservedOutputTokens: 200, toolSchemaTokens: 100, safetyMarginTokens: 100 });
  const pack = engine.build({
    task: task(), attemptId: 'attempt_1', model: 'qwen', gitState,
    fileCandidates: Array.from({ length: 50 }, (_, i) => ({
      path: `file_${i}.ts`, content: 'x'.repeat(4000), relevance: 0.5, provenance: `repo:file_${i}.ts`
    }))
  });
  const used = pack.sections.reduce((sum, s) => sum + s.tokenCost, 0);
  assert.ok(used <= pack.retrievalBudget + pack.systemTokens, `used=${used} budget=${pack.retrievalBudget}`);
  assert.equal(pack.retrievalBudget, 1000 - 200 - pack.systemTokens - 100 - 100);
});

test('mandatory P0 sections always survive trimming', () => {
  const engine = new ContextEngine({ modelContextLimit: 300, reservedOutputTokens: 200, safetyMarginTokens: 50 });
  const pack = engine.build({
    task: task(), attemptId: 'attempt_1', model: 'qwen', gitState,
    fileCandidates: [{ path: 'huge.ts', content: 'y'.repeat(100000), relevance: 1, provenance: 'repo:huge.ts' }]
  });
  const types = pack.sections.map(s => s.type);
  assert.ok(types.includes('SYSTEM'));
  assert.ok(types.includes('TASK'));
  assert.ok(types.includes('STATE'));
  assert.ok(!types.includes('FILE'), 'oversized optional file must be dropped');
});

test('untrusted content is bounded and carries provenance', () => {
  const engine = new ContextEngine({ modelContextLimit: 8192, reservedOutputTokens: 1024, safetyMarginTokens: 1024 });
  const pack = engine.build({
    task: task(), attemptId: 'a', model: 'qwen', gitState,
    fileCandidates: [{ path: 'src/x.ts', content: 'export const x = 1;', relevance: 0.9, provenance: 'repo:src/x.ts' }]
  });
  const file = pack.sections.find(s => s.type === 'FILE');
  assert.equal(file?.source, 'src/x.ts');
  assert.equal(file?.provenance, 'repo:src/x.ts');
  const system = pack.sections.find(s => s.type === 'SYSTEM');
  assert.match(system?.content ?? '', /untrusted data/);
});

test('context hash is stable for identical sections', () => {
  const engine = new ContextEngine({ modelContextLimit: 4096, reservedOutputTokens: 512, safetyMarginTokens: 128 });
  const build = () => engine.build({ task: task(), attemptId: 'a', model: 'qwen', gitState });
  assert.equal(ContextEngine.hash(build()), ContextEngine.hash(build()));
});

test('estimateTokens grows with content', () => {
  assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
});
