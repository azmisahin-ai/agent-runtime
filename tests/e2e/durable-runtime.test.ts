import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import type { AgentBackend, AgentEvent, AgentRequest, AgentResponse, BackendCapabilities, BackendHealth, ExecutionHandle, StartRequest } from '../../src/backends/agent-backend.js';

class FakeBackend implements AgentBackend {
  readonly id = 'fake';
  private sent = 0;
  constructor(private readonly behavior: { response?: AgentResponse; responses?: AgentResponse[]; fail?: Error }) {}
  async initialize(): Promise<void> {}
  async start(_request: StartRequest): Promise<ExecutionHandle> { return { session_id: 'session_fake', external_session_id: null }; }
  async send(_request: AgentRequest): Promise<AgentResponse> {
    if (this.behavior.fail) throw this.behavior.fail;
    const sequence = this.behavior.responses;
    if (sequence && sequence.length > 0) {
      const response = sequence[Math.min(this.sent, sequence.length - 1)];
      this.sent += 1;
      return response;
    }
    return this.behavior.response ?? { request_id: 'req_1', type: 'FINAL', content: 'done' };
  }
  async *stream(_request: AgentRequest): AsyncIterable<AgentEvent> { yield { type: 'DONE' }; }
  async cancel(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async health(): Promise<BackendHealth> { return 'HEALTHY'; }
  capabilities(): BackendCapabilities {
    return { streaming: true, toolCalling: true, structuredOutput: false, sessionResume: false, vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false, nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false };
  }
  async close(): Promise<void> {}
}

function fixture(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-m2-'));
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_MAX_RECOVERY_ATTEMPTS: '2',
    ...env
  });
  const project = runtime.projects.create({ name: 'm2', rootPath: dir });
  const task = runtime.taskService.create(project.projectId, 'M2 task', 'exercise durable runtime');
  return { dir, runtime, project, task };
}

function passing() { return [{ name: 'build', kind: 'BUILD' as const, run: () => ({ status: 'PASS' as const, evidence: 'ok' }) }]; }
function failing() { return [{ name: 'tests', kind: 'TEST' as const, run: () => ({ status: 'FAIL' as const, evidence: 'broken' }) }]; }

test('a failed attempt writes durable failure memory retrievable by the next attempt', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'claiming success' } }), 'fake');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: failing() });

    const memories = f.runtime.memories.query({ projectId: f.project.projectId, types: ['FAILURE'], statuses: ['ACTIVE'] });
    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /failed/i);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('memory survives a full runtime restart', () => {
  const f = fixture();
  const dbPath = join(f.dir, 'runtime.db');
  let memoryId: string;
  try {
    const result = f.runtime.memoryEngine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROCEDURAL',
      content: 'Always run npm run check before committing', source: 'USER', confidence: 'HIGH'
    });
    memoryId = result.memoryId!;
  } finally { f.runtime.db.close(); }

  const restarted = bootstrap({ AGENT_RUNTIME_DB_PATH: dbPath, AGENT_RUNTIME_WORKSPACE: f.dir });
  try {
    const record = restarted.memories.get(memoryId);
    assert.ok(record);
    assert.equal(record!.content, 'Always run npm run check before committing');
    const retrieved = restarted.memoryEngine.retrieve({ projectId: f.project.projectId, queryText: 'check before committing' });
    assert.equal(retrieved[0].memoryId, memoryId);
  } finally { restarted.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('write_file is denied by default and succeeds only when explicitly granted', async () => {
  const denied = fixture();
  try {
    denied.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'write_file', version: '1.0.0', arguments: { path: 'out.txt', content: 'hello' } } },
        { request_id: 'r2', type: 'FINAL', content: 'wrote out.txt' }
      ]
    }), 'fake');
    const result = await denied.runtime.orchestrator.run(denied.task.taskId, { checks: passing() });
    assert.equal(result.toolRuns[0].status, 'DENIED');
    assert.equal(existsSync(join(denied.dir, 'out.txt')), false);
  } finally { denied.runtime.db.close(); rmSync(denied.dir, { recursive: true, force: true }); }

  const granted = fixture({ AGENT_RUNTIME_GRANTED_CAPABILITIES: 'filesystem_write' });
  try {
    granted.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'write_file', version: '1.0.0', arguments: { path: 'out.txt', content: 'hello' } } },
        { request_id: 'r2', type: 'FINAL', content: 'wrote out.txt' }
      ]
    }), 'fake');
    const result = await granted.runtime.orchestrator.run(granted.task.taskId, { checks: passing() });
    assert.equal(result.toolRuns[0].status, 'SUCCEEDED');
    assert.equal(readFileSync(join(granted.dir, 'out.txt'), 'utf8'), 'hello');
  } finally { granted.runtime.db.close(); rmSync(granted.dir, { recursive: true, force: true }); }
});

test('terminal.exec runs arbitrary commands only after explicit allowlisting', async () => {
  const denied = fixture();
  try {
    denied.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'terminal.exec', version: '1.0.0', arguments: { argv: ['node', '--version'] } } },
        { request_id: 'r2', type: 'FINAL', content: 'checked the runtime' }
      ]
    }), 'fake');
    const result = await denied.runtime.orchestrator.run(denied.task.taskId, { checks: passing() });
    assert.equal(result.toolRuns[0].status, 'DENIED');
  } finally { denied.runtime.db.close(); rmSync(denied.dir, { recursive: true, force: true }); }

  const granted = fixture({ AGENT_RUNTIME_ALLOW_PROCESS: 'true', AGENT_RUNTIME_ALLOWED_COMMANDS: 'node' });
  try {
    granted.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'terminal.exec', version: '1.0.0', arguments: { argv: ['node', '--version'] } } },
        { request_id: 'r2', type: 'FINAL', content: 'checked the runtime' }
      ]
    }), 'fake');
    const result = await granted.runtime.orchestrator.run(granted.task.taskId, { checks: passing() });
    assert.equal(result.toolRuns[0].status, 'SUCCEEDED');
    assert.match(String(result.toolRuns[0].output), /v\d+\./);
  } finally { granted.runtime.db.close(); rmSync(granted.dir, { recursive: true, force: true }); }
});

test('resume pauses the task when execution-sensitive configuration drifted', async () => {
  const f = fixture();
  const dbPath = join(f.dir, 'runtime.db');
  let taskId = f.task.taskId;
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'noop' } }), 'fake');
    await f.runtime.orchestrator.run(taskId, { checks: failing() });
    assert.equal(f.runtime.tasks.get(taskId)?.state, 'PAUSED');
    f.runtime.orchestrator.resume(taskId); // becomes RUNNING with matching config
  } finally { f.runtime.db.close(); }

  // Restart under a different model: an active attempt cannot silently continue.
  const restarted = bootstrap({ AGENT_RUNTIME_DB_PATH: dbPath, AGENT_RUNTIME_WORKSPACE: f.dir, AGENT_RUNTIME_MODEL: 'different-model' });
  try {
    const result = restarted.orchestrator.resume(taskId);
    assert.equal(result.config?.compatible, false);
    assert.ok(result.config?.changedFields.includes('model'));
    assert.equal(result.state, 'PAUSED');
    const events = restarted.events.listTask(taskId).map(e => e.type);
    assert.ok(events.includes('ConfigReconciliationMismatch'));
  } finally { restarted.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('repository intelligence indexes the workspace as evidence', () => {
  const f = fixture();
  try {
    const result = f.runtime.repositoryScanner.index(f.project.projectId, f.dir, 'rev1');
    assert.ok(result.files >= 1);
    assert.equal(f.runtime.repositoryScanner.checkFreshness(f.project.projectId, 'rev1'), 'FRESH');
    assert.equal(f.runtime.repositoryScanner.checkFreshness(f.project.projectId, 'rev2'), 'STALE');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('retrieved memory and repository context reach the model context pack', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'helper.ts'), 'export function helper(): number { return 1; }\n');
    f.runtime.repositoryScanner.index(f.project.projectId, f.dir, 'rev1');
    f.runtime.memoryEngine.persist({
      projectId: f.project.projectId, scope: 'PROJECT', type: 'PROCEDURAL',
      content: 'helper returns one and is used by the runtime', source: 'USER', confidence: 'HIGH'
    });
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'done' } }), 'fake');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: passing() });

    const snapshots = f.runtime.contextSnapshots.listTask(f.task.taskId);
    assert.ok(snapshots.length >= 1);
    const types = snapshots[0].sections.map(section => section.type);
    assert.ok(types.includes('MEMORY'));
    assert.ok(types.includes('REPOSITORY'));
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('affected scope from the repository index is persisted as verification evidence', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'base.ts'), 'export const base = 1;\n');
    writeFileSync(join(f.dir, 'consumer.ts'), "import { base } from './base.js';\nexport const c = base;\n");
    f.runtime.repositoryScanner.index(f.project.projectId, f.dir, 'rev1');
    const scope = f.runtime.affectedScope.analyze(f.project.projectId, ['base.ts']);
    assert.ok(scope.direct.includes('consumer.ts'));

    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'done' } }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passing(), affectedScope: scope });
    assert.equal(result.verification, 'PASS');
    const verification = f.runtime.verifications.listTask(f.task.taskId)[0];
    assert.equal(((verification.evidence as Record<string, unknown>).affectedScope as { direct: string[] }).direct.includes('consumer.ts'), true);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
