import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import type { AgentBackend, AgentEvent, AgentRequest, AgentResponse, BackendCapabilities, BackendHealth, ExecutionHandle, StartRequest } from '../../src/backends/agent-backend.js';

// A scripted backend: it exercises the runtime contract without a live model. A
// `responses` sequence models a conversation (tool request, then final); the last
// entry repeats once exhausted.
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
    return { streaming: true, toolCalling: false, structuredOutput: false, sessionResume: false, vision: false, largeContext: false, mcp: false, acp: false, nativeFilesystem: false, nativeTerminal: false, nativeGit: false, cancellation: true, pauseResume: false };
  }
  async close(): Promise<void> {}
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-e2e-'));
  writeFileSync(join(dir, 'target.txt'), 'content to read');
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_MAX_RECOVERY_ATTEMPTS: '2'
  });
  const project = runtime.projects.create({ name: 'e2e', rootPath: dir });
  const task = runtime.taskService.create(project.projectId, 'Read target', 'Read target.txt');
  return { dir, runtime, project, task };
}

function passingChecks() {
  return [{ name: 'build', kind: 'BUILD' as const, run: () => ({ status: 'PASS' as const, evidence: 'ok' }) }];
}

function failingChecks() {
  return [{ name: 'tests', kind: 'TEST' as const, run: () => ({ status: 'FAIL' as const, evidence: 'broken' }) }];
}

test('vertical slice: task runs, verifies, completes and records evaluation', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'I read the file' } }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(result.verification, 'PASS');
    assert.equal(result.finalState, 'COMPLETED');
    assert.equal(f.runtime.tasks.get(f.task.taskId)?.state, 'COMPLETED');
    assert.equal(f.runtime.evaluations.listTask(f.task.taskId).length, 1);
    assert.equal(f.runtime.checkpoints.latest(f.task.taskId)?.state, 'COMPLETED');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('final model response alone does not complete the task when verification fails', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'I am completely done, trust me' } }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: failingChecks() });
    assert.equal(result.verification, 'FAIL');
    assert.notEqual(result.finalState, 'COMPLETED');
    assert.equal(result.outcome, 'UNKNOWN');
    assert.ok(result.recovery);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('terminal task cannot run again in place', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'done' } }), 'fake');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(f.runtime.tasks.get(f.task.taskId)?.state, 'COMPLETED');
    await assert.rejects(() => f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() }), /terminal state/);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a failed attempt is followed by a new attempt, never an in-place restart', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'attempt' } }), 'fake');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: failingChecks() });
    assert.equal(f.runtime.tasks.get(f.task.taskId)?.state, 'PAUSED');
    assert.equal(f.runtime.tasks.listAttempts(f.task.taskId).length, 1);

    const resumed = f.runtime.orchestrator.resume(f.task.taskId);
    assert.equal(resumed.state, 'RUNNING');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    const attempts = f.runtime.tasks.listAttempts(f.task.taskId);
    assert.equal(attempts.length, 2, 'retry must create a new attempt');
    assert.equal(attempts[0].outcome, 'UNKNOWN');
    assert.notEqual(attempts[0].endedAt, null);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('backend failure is classified and recorded as evaluation evidence', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ fail: new Error('ECONNREFUSED ollama') }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(result.failureCategory, 'BACKEND_FAILURE');
    assert.equal(result.outcome, 'FAILURE');
    assert.notEqual(result.finalState, 'COMPLETED');
    assert.equal(f.runtime.evaluations.listTask(f.task.taskId).length, 1);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('tool requests from the model pass through the tool engine, not direct execution', async () => {
  const f = fixture();
  try {
    // The model reads a file, then answers. The loop must execute the tool through
    // the Tool Engine, feed the observation back, and stop on the FINAL turn.
    f.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'read_file', version: '1.0.0', arguments: { path: 'target.txt' } } },
        { request_id: 'r2', type: 'FINAL', content: 'the file says: content to read' }
      ]
    }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(result.toolRuns.length, 1);
    assert.equal(result.toolRuns[0].status, 'SUCCEEDED');
    assert.equal(result.toolRuns[0].output, 'content to read');
    assert.equal(f.runtime.toolRuns.listAttempt(result.attemptId).length, 1);
    assert.equal(result.finalState, 'COMPLETED');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a tool observation is fed back into the next model turn', async () => {
  const f = fixture();
  try {
    // The second turn's context must carry what the first turn's tool returned;
    // otherwise the model would have to guess the result it just asked for.
    let secondContext = '';
    class CapturingBackend extends FakeBackend {
      private turns = 0;
      override async send(request: AgentRequest): Promise<AgentResponse> {
        this.turns += 1;
        if (this.turns === 1) {
          return { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'read_file', version: '1.0.0', arguments: { path: 'target.txt' } } };
        }
        secondContext = request.context.sections.map(s => s.content).join('\n');
        return { request_id: 'r2', type: 'FINAL', content: 'done' };
      }
    }
    f.runtime.orchestrator.setBackend(new CapturingBackend({}), 'fake');
    await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.match(secondContext, /tool=read_file status=SUCCEEDED/);
    assert.match(secondContext, /content to read/);
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a model that never stops requesting tools is bounded, not looped forever', async () => {
  const f = fixture();
  try {
    // Every turn asks for the same tool. Without a bound this would never end, and
    // the attempt has no final answer, so it must fail rather than be COMPLETED.
    f.runtime.orchestrator.setBackend(new FakeBackend({
      response: { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'read_file', version: '1.0.0', arguments: { path: 'target.txt' } } }
    }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(result.outcome, 'FAILURE');
    assert.notEqual(result.finalState, 'COMPLETED');
    assert.ok(f.runtime.events.listTask(f.task.taskId).some(e => e.type === 'ToolLoopExhausted'));
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('a model-requested tool cannot escape policy (denied, not executed)', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({
      responses: [
        { request_id: 'r1', type: 'TOOL_REQUEST', content: { requestId: 'r1', tool: 'read_file', version: '1.0.0', arguments: { path: '../../etc/passwd' } } },
        { request_id: 'r2', type: 'FINAL', content: 'could not read it' }
      ]
    }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });
    assert.equal(result.toolRuns[0].status, 'DENIED');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('an attempt emits a causal trace while canonical state stays in the event store', async () => {
  const f = fixture();
  try {
    f.runtime.orchestrator.setBackend(new FakeBackend({ response: { request_id: 'r1', type: 'FINAL', content: 'done' } }), 'fake');
    const result = await f.runtime.orchestrator.run(f.task.taskId, { checks: passingChecks() });

    const spans = f.runtime.tracer.completed();
    const attempt = spans.find(s => s.name === 'attempt');
    const child = spans.find(s => s.name === 'backend_request');
    assert.ok(attempt, 'attempt must be traced');
    assert.ok(child, 'backend request must be traced');
    assert.equal(child?.traceId, attempt?.traceId);
    assert.equal(child?.parentSpanId, attempt?.spanId);
    assert.equal(f.runtime.tracer.openSpanCount(), 0, 'no span may leak open');

    // The trace is timing evidence, not the completion record: the append-only
    // event store remains the canonical history (spec 17 §7).
    const attemptEvents = f.runtime.events.listTask(f.task.taskId).filter(e => e.type === 'AttemptCompleted');
    assert.equal(attemptEvents.length, 1);
    assert.equal(result.finalState, 'COMPLETED');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('resume reconciles in-flight tool runs to UNKNOWN', async () => {
  const f = fixture();
  try {
    const attempt = f.runtime.tasks.createAttempt({ taskId: f.task.taskId, backendId: 'fake', model: 'm' });
    const run = f.runtime.toolRuns.create({ taskId: f.task.taskId, attemptId: attempt.attemptId, requestId: 'r', toolName: 'read_file', toolVersion: '1.0.0', arguments: {}, permission: 'READ_ONLY' });
    f.runtime.toolRuns.setStatus(run.toolRunId, 'RUNNING', { startedAt: new Date().toISOString() });
    const result = f.runtime.orchestrator.resume(f.task.taskId);
    assert.deepEqual(result.reconciledToolRuns, [run.toolRunId]);
    assert.equal(f.runtime.toolRuns.get(run.toolRunId)?.status, 'UNKNOWN');
  } finally { f.runtime.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
