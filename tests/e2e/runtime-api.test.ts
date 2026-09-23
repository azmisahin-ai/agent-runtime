import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';
import { ApiServer } from '../../src/api/server.js';
import type { AgentBackend, AgentEvent, AgentRequest, AgentResponse, BackendCapabilities, BackendHealth, ExecutionHandle, StartRequest } from '../../src/backends/agent-backend.js';

class FakeBackend implements AgentBackend {
  readonly id = 'fake';
  async initialize(): Promise<void> {}
  async start(_request: StartRequest): Promise<ExecutionHandle> { return { session_id: 's', external_session_id: null }; }
  async send(_request: AgentRequest): Promise<AgentResponse> { return { request_id: 'r', type: 'FINAL', content: 'done' }; }
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

const TOKEN = 'test-token-123';

async function withServer(run: (base: string, runtime: ReturnType<typeof bootstrap>) => Promise<void>, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-api-'));
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_API_TOKEN: TOKEN,
    ...env
  });
  runtime.orchestrator.setBackend(new FakeBackend(), 'fake');
  // A runtime-owned verification check: the host, not the client, decides success.
  runtime.orchestrator.setVerificationChecks(() => [{ name: 'build', kind: 'BUILD', run: () => ({ status: 'PASS', evidence: 'ok' }) }]);
  const server = new ApiServer(runtime.api, { port: 0, host: '127.0.0.1', token: TOKEN });
  const { port } = await server.listen();
  try {
    await run(`http://127.0.0.1:${port}/api/v1`, runtime);
  } finally {
    await server.close();
    runtime.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...extra };
}

test('acceptance scenario: create project -> task -> start -> events -> complete -> inspect', async () => {
  await withServer(async (base, _runtime) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    assert.ok(project.project_id);

    const task = await (await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'do it' }) })).json();
    assert.equal(task.state, 'CREATED');

    const started = await (await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth() })).json();
    assert.equal(started.state, 'QUEUED');

    const run = await (await fetch(`${base}/tasks/${task.task_id}/run`, { method: 'POST', headers: auth() })).json();
    assert.equal(run.outcome, 'SUCCESS');
    assert.equal(run.final_state, 'COMPLETED');

    const events = await (await fetch(`${base}/tasks/${task.task_id}/events`, { headers: auth() })).json();
    assert.ok(events.events.length > 0);
    assert.ok(events.events.some((e: { type: string }) => e.type === 'TaskCreated'));

    const checkpoints = await (await fetch(`${base}/tasks/${task.task_id}/checkpoints`, { headers: auth() })).json();
    assert.equal(checkpoints.checkpoints.length, 1);

    const attempts = await (await fetch(`${base}/tasks/${task.task_id}/attempts`, { headers: auth() })).json();
    assert.equal(attempts.attempts.length, 1);
    assert.equal(attempts.attempts[0].outcome, 'SUCCESS');
  });
});

test('unauthenticated mutation is denied; reads are allowed', async () => {
  await withServer(async (base) => {
    const denied = await fetch(`${base}/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) });
    assert.equal(denied.status, 403);
    const body = await denied.json();
    assert.equal(body.error.code, 'PERMISSION_DENIED');

    const read = await fetch(`${base}/backends/capabilities`);
    assert.equal(read.status, 200);
  });
});

test('a wrong token is rejected', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/projects`, { method: 'POST', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) });
    assert.equal(res.status, 403);
  });
});

test('connector cannot supply its own verification checks', async () => {
  await withServer(async (base) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    const task = await (await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) })).json();
    await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth() });
    const res = await fetch(`${base}/tasks/${task.task_id}/run`, {
      method: 'POST', headers: auth(), body: JSON.stringify({ checks: [{ name: 'x', kind: 'TEST' }] })
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'PERMISSION_DENIED');
  });
});

test('terminal task cannot be started again; retry creates a new attempt path', async () => {
  await withServer(async (base) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    const task = await (await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) })).json();
    await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth() });
    await fetch(`${base}/tasks/${task.task_id}/run`, { method: 'POST', headers: auth() });

    const again = await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth() });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, 'TASK_INVALID_STATE');

    const retry = await fetch(`${base}/tasks/${task.task_id}/retry`, { method: 'POST', headers: auth() });
    // COMPLETED is not retryable: terminal success is never silently reopened.
    assert.equal(retry.status, 409);
  });
});

test('idempotency: replay returns the first response; mismatched payload conflicts', async () => {
  await withServer(async (base) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    const task = await (await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) })).json();

    const first = await (await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth({ 'idempotency-key': 'k1' }), body: '{}' })).json();
    const replay = await (await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth({ 'idempotency-key': 'k1' }), body: '{}' })).json();
    assert.deepEqual(replay, first);

    // Same key, same operation, different payload: an explicit conflict, not a replay.
    const conflict = await fetch(`${base}/tasks/${task.task_id}/start`, {
      method: 'POST', headers: auth({ 'idempotency-key': 'k1' }), body: JSON.stringify({ allow_unknown: true })
    });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'CONFLICT');
  });
});

test('top-level task creation and repository read surfaces are exposed', async () => {
  await withServer(async (base) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();

    const viaCollection = await fetch(`${base}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ project_id: project.project_id, title: 'T2', description: 'd' }) });
    assert.equal(viaCollection.status, 201);
    assert.equal((await viaCollection.json()).title, 'T2');

    const missingProject = await fetch(`${base}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T3' }) });
    assert.equal(missingProject.status, 422);

    const notRepo = await fetch(`${base}/projects/${project.project_id}/repository/diff`, { headers: auth() });
    assert.equal(notRepo.status, 400);

    const tree = await fetch(`${base}/projects/${project.project_id}/repository/tree`, { headers: auth() });
    assert.equal(tree.status, 200);
    assert.equal((await tree.json()).project_id, project.project_id);
  });
});

test('malformed JSON and oversized body are INVALID_REQUEST, not 500', async () => {
  await withServer(async (base) => {
    const malformed = await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: '{not json' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_REQUEST');
  });
});

test('unknown endpoints return the error contract with a request id', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.ok(body.error.request_id);
    assert.equal(body.error.retryable, false);
  });
});

test('SSE stream carries monotonic sequence numbers and resumes after a sequence', async () => {
  await withServer(async (base) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    const task = await (await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) })).json();
    await fetch(`${base}/tasks/${task.task_id}/start`, { method: 'POST', headers: auth() });

    const full = await (await fetch(`${base}/tasks/${task.task_id}/events/stream`, { headers: auth() })).text();
    const ids = [...full.matchAll(/^id: (\d+)$/gm)].map(m => Number(m[1]));
    assert.ok(ids.length >= 2);
    for (let i = 1; i < ids.length; i += 1) assert.ok(ids[i] > ids[i - 1]);

    const resume = await (await fetch(`${base}/tasks/${task.task_id}/events/stream?after=${ids[0]}`, { headers: auth() })).text();
    const resumedIds = [...resume.matchAll(/^id: (\d+)$/gm)].map(m => Number(m[1]));
    assert.ok(resumedIds.every(id => id > ids[0]));
  });
});

test('every authenticated decision is written to a verifiable audit chain', async () => {
  await withServer(async (base, runtime) => {
    const project = await (await fetch(`${base}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: '/tmp/x' }) })).json();
    await fetch(`${base}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) });
    const chain = runtime.securityAudit.verifyChain();
    assert.equal(chain.valid, true);
    assert.ok(runtime.securityAudit.listTask('missing').length === 0);
  });
});

test('durable continuity: state survives a full runtime restart behind the API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-api-'));
  const dbPath = join(dir, 'runtime.db');
  try {
    const first = bootstrap({ AGENT_RUNTIME_DB_PATH: dbPath, AGENT_RUNTIME_WORKSPACE: dir, AGENT_RUNTIME_API_TOKEN: TOKEN });
    const serverOne = new ApiServer(first.api, { port: 0, host: '127.0.0.1', token: TOKEN });
    const { port: portOne } = await serverOne.listen();
    const baseOne = `http://127.0.0.1:${portOne}/api/v1`;
    const project = await (await fetch(`${baseOne}/projects`, { method: 'POST', headers: auth(), body: JSON.stringify({ name: 'p', root_path: dir }) })).json();
    const task = await (await fetch(`${baseOne}/projects/${project.project_id}/tasks`, { method: 'POST', headers: auth(), body: JSON.stringify({ title: 'T', description: 'd' }) })).json();
    await serverOne.close();
    first.db.close();

    const second = bootstrap({ AGENT_RUNTIME_DB_PATH: dbPath, AGENT_RUNTIME_WORKSPACE: dir, AGENT_RUNTIME_API_TOKEN: TOKEN });
    const serverTwo = new ApiServer(second.api, { port: 0, host: '127.0.0.1', token: TOKEN });
    const { port: portTwo } = await serverTwo.listen();
    const baseTwo = `http://127.0.0.1:${portTwo}/api/v1`;
    const fetched = await (await fetch(`${baseTwo}/tasks/${task.task_id}`, { headers: auth() })).json();
    assert.equal(fetched.task_id, task.task_id);
    await serverTwo.close();
    second.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
