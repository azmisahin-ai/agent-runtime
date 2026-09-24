import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import type { ApiContext } from '../../src/api/runtime-api.js';
import type { AgentBackend, AgentEvent, AgentRequest, AgentResponse, BackendCapabilities, BackendHealth, ExecutionHandle, StartRequest } from '../../src/backends/agent-backend.js';

class FakeBackend implements AgentBackend {
  readonly id = 'fake';
  constructor(private readonly behavior: { response?: AgentResponse } = {}) {}
  async initialize(): Promise<void> {}
  async start(_request: StartRequest): Promise<ExecutionHandle> { return { session_id: 'session_fake', external_session_id: null }; }
  async send(_request: AgentRequest): Promise<AgentResponse> {
    return this.behavior.response ?? { request_id: 'req_1', type: 'FINAL', content: 'done' };
  }
  async *stream(_request: AgentRequest): AsyncIterable<AgentEvent> { yield { type: 'DONE' }; }
  async cancel(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async health(): Promise<BackendHealth> { return 'HEALTHY'; }
  capabilities(): BackendCapabilities {
    return { streaming: true, toolCalling: false, structuredOutput: false, sessionResume: false, vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false, nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false };
  }
  async close(): Promise<void> {}
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-queue-'));
  writeFileSync(join(dir, 'target.txt'), 'content to read');
  const runtime = bootstrap({ AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'), AGENT_RUNTIME_WORKSPACE: dir });
  runtime.orchestrator.setBackend(new FakeBackend(), 'fake');
  runtime.orchestrator.setVerificationChecks(() => [{ name: 'build', kind: 'BUILD', run: () => ({ status: 'PASS' as const, evidence: 'ok' }) }]);
  const project = runtime.projects.create({ name: 'queue', rootPath: dir });
  const task = runtime.taskService.create(project.projectId, 'Queued work', 'Do the queued work');
  return { dir, runtime, project, task };
}

const ctx: ApiContext = { requestId: 'test', principal: 'CLIENT' };

test('a queued task is drained without a client calling run', async () => {
  const f = fixture();
  try {
    // `start` accepts the request and queues it; the drainer is what turns that into
    // an executed attempt, using the same API path a synchronous run would.
    f.runtime.api.startTask(ctx, f.task.taskId);
    assert.equal(f.runtime.tasks.get(f.task.taskId)!.state, 'QUEUED');

    const drained = await f.runtime.queueDrainer.drainOnce();
    assert.deepEqual(drained, [f.task.taskId]);
    assert.equal(f.runtime.tasks.get(f.task.taskId)!.state, 'COMPLETED');
    assert.equal(f.runtime.tasks.listAttempts(f.task.taskId).length, 1);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('draining an empty queue is a no-op', async () => {
  const f = fixture();
  try {
    assert.deepEqual(await f.runtime.queueDrainer.drainOnce(), []);
    assert.equal(f.runtime.tasks.listAttempts(f.task.taskId).length, 0);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('the queue does not resurrect a failed task', async () => {
  const f = fixture();
  try {
    // A failure needs an explicit retry; the queue must not silently re-run it.
    f.runtime.orchestrator.setVerificationChecks(() => [{ name: 'tests', kind: 'TEST', run: () => ({ status: 'FAIL' as const, evidence: 'broken' }) }]);
    f.runtime.api.startTask(ctx, f.task.taskId);
    await f.runtime.queueDrainer.drainOnce();
    assert.equal(f.runtime.tasks.get(f.task.taskId)!.state, 'PAUSED');
    assert.deepEqual(await f.runtime.queueDrainer.drainOnce(), []);
    assert.equal(f.runtime.tasks.listAttempts(f.task.taskId).length, 1);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('the drainer is inert until an operator enables it', async () => {
  const f = fixture();
  try {
    assert.equal(f.runtime.config.api.queueDrainIntervalMs, 0);
    f.runtime.queueDrainer.start();
    f.runtime.api.startTask(ctx, f.task.taskId);
    // A zero interval means no timer was armed, so the task stays queued.
    assert.equal(f.runtime.tasks.get(f.task.taskId)!.state, 'QUEUED');
    f.runtime.queueDrainer.stop();
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
