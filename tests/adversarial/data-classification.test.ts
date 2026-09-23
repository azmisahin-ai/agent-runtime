import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyData, canEgress, policyFor, mostRestrictive, rankOf
} from '../../src/security/data-classification.js';
import { shouldPersist } from '../../src/memory/memory-policy.js';
import { StructuredLogger } from '../../src/observability/logger.js';
import { ContextEngine } from '../../src/context/context-engine.js';
import { ArtifactStore } from '../../src/evaluation/artifact-store.js';
import { Database } from '../../src/persistence/database.js';
import { EvaluationRunRepository } from '../../src/persistence/evaluation-run-repository.js';
import type { ContextSection, Task, GitState } from '../../src/domain/types.js';
import { repoPath } from '../../src/runtime/paths.js';

const SECRET_TEXT = 'api_key = "sk-abcdefghijklmnopqrstuvwxyz0123456789"';

// --- Classification itself ---------------------------------------------------

test('a declared PUBLIC label cannot downgrade content that is actually SECRET', () => {
  const classification = classifyData({ content: `token ${SECRET_TEXT}`, declared: 'PUBLIC' });
  assert.equal(classification, 'SECRET');
});

test('sensitive paths and patterns are classified SENSITIVE, not PROJECT', () => {
  assert.equal(classifyData({ path: '.env.production', content: 'PORT=8080' }), 'SENSITIVE');
  assert.equal(classifyData({ content: 'Authorization: Bearer abcdef', path: null }), 'SENSITIVE');
  assert.equal(classifyData({ content: 'normal project note', path: 'src/index.ts' }), 'PROJECT');
});

test('merging labels keeps the most restrictive one', () => {
  assert.equal(mostRestrictive('PUBLIC', 'SENSITIVE', 'PROJECT'), 'SENSITIVE');
  assert.equal(mostRestrictive('SENSITIVE', 'SECRET'), 'SECRET');
  assert.ok(rankOf('SECRET') > rankOf('SENSITIVE'));
  assert.ok(rankOf('SENSITIVE') > rankOf('PROJECT'));
});

test('SECRET is refused by every egress channel; SENSITIVE never reaches log or artifact', () => {
  for (const channel of ['persist', 'context', 'log', 'artifact'] as const) {
    assert.equal(canEgress(channel, 'SECRET').allowed, false, `SECRET must not enter ${channel}`);
  }
  assert.equal(canEgress('log', 'SENSITIVE').allowed, false);
  assert.equal(canEgress('artifact', 'SENSITIVE').allowed, false);
  assert.equal(canEgress('persist', 'PROJECT').allowed, true);
  assert.equal(policyFor('SECRET').context, false);
});

// --- Persistence channel -----------------------------------------------------

test('SENSITIVE-but-not-secret content is refused durable memory', () => {
  const decision = shouldPersist({
    projectId: 'p', scope: 'PROJECT', type: 'PROJECT',
    content: 'the deployment file .env.production holds PORT=8080',
    source: 'MODEL', confidence: 'HIGH'
  });
  assert.equal(decision.persist, false);
  assert.match(decision.reason, /SENSITIVE/);
});

// --- Context channel ---------------------------------------------------------

const gitState: GitState = { head: 'abc', branch: 'main', dirty: false };
function task(): Task {
  return {
    taskId: 'task_1', projectId: 'project_1', title: 't', description: 'd',
    state: 'RUNNING', currentAttemptId: null, currentCheckpointId: null,
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
  };
}
function obs(content: string, priority: ContextSection['priority'] = 1): ContextSection {
  return { id: 's', type: 'OBSERVATION', content, source: 'tool', priority, tokenCost: 1, relevance: 1, timestamp: new Date(0).toISOString(), provenance: 'tool:read_file' };
}

test('a SECRET observation is dropped from context even at mandatory priority', () => {
  const engine = new ContextEngine({ modelContextLimit: 8192, reservedOutputTokens: 512, safetyMarginTokens: 128 });
  const pack = engine.build({
    task: task(), attemptId: 'a', model: 'qwen', gitState,
    observations: [obs(`read_file -> ${SECRET_TEXT}`, 0), obs('ordinary observation', 1)]
  });
  const joined = pack.sections.map(s => s.content).join('\n');
  assert.equal(joined.includes('sk-'), false, 'secret must not appear in context');
  assert.ok(joined.includes('ordinary observation'), 'non-secret mandatory section must survive');
});

// --- Log channel -------------------------------------------------------------

test('a SENSITIVE log payload is withheld, while an ordinary record is written', () => {
  const logger = new StructuredLogger('debug');
  logger.info('TOOL', 'loaded .env.production', { key: 'Authorization: Bearer xyz' });
  logger.info('TOOL', 'read src/index.ts');

  const entries = logger.entries();
  assert.equal(entries.length, 2);
  assert.match(entries[0].message, /WITHHELD:SENSITIVE/);
  assert.equal(JSON.stringify(entries[0].data).includes('Bearer'), false);
  assert.equal(entries[1].message, 'read src/index.ts');
});

// --- Artifact channel --------------------------------------------------------

test('an artifact carrying SENSITIVE content is refused and never written to disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-classification-'));
  const db = new Database(join(dir, 'eval.db'));
  db.migrate(repoPath('migrations'));
  try {
    const repository = new EvaluationRunRepository(db);
    const run = repository.createRun({
      suiteId: 's', suiteVersion: '1', taskPackId: 't', category: 'BUG_FIX',
      expectedBehavior: 'x', constraints: [], isolation: {}, repositoryRevision: null,
      backendId: 'fake', provider: 'local', model: 'm', runtimeVersion: '0.1.0-dev',
      contextConfig: {}, memorySnapshot: {}, toolConfig: {}, verificationConfig: {},
      baselineHash: 'h', outcome: 'SUCCESS', verification: 'PASS', failureCategory: null,
      primaryCause: null, secondaryCauses: [], attributionEvidence: {}, reproducible: false,
      startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(), evidence: {}
    });
    const store = new ArtifactStore(repository, join(dir, 'artifacts'));

    assert.throws(() => store.write(run.runId, 'log', 'secret.txt', 'token sk-abcdefghijklmnopqrstuvwxyz0123456789'), /artifact refused/);
    assert.equal(repository.listArtifacts(run.runId).length, 0, 'no artifact row for refused content');
    assert.equal(existsSync(join(dir, 'artifacts', run.runId.replace(/[^A-Za-z0-9_.-]/g, '_'), 'secret.txt')), false);

    // Ordinary content still flows.
    const written = store.write(run.runId, 'summary', 'run.json', '{"ok":true}');
    assert.equal(readFileSync(join(dir, 'artifacts', written.reference), 'utf8'), '{"ok":true}');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
