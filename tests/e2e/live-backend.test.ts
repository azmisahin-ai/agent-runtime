import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap } from '../../src/runtime/bootstrap.js';

// A real HTTP model server, not an injected fake backend. This proves the whole
// chain bootstrap -> orchestrator -> OllamaBackend -> HTTP works, including the
// fact that the adapter refuses to send until it has been initialized (spec 05
// §3). Before that wiring existed the runtime reported BACKEND_UNAVAILABLE for a
// reachable model server.
function startModelServer(): Promise<{ server: Server; url: string; chatCalls: () => number }> {
  let chats = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const path = request.url ?? '/';
      if (path === '/api/tags') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"models":[]}');
        return;
      }
      if (path === '/api/chat') {
        chats += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: { content: 'the file exports add()' }, done_reason: 'stop', prompt_eval_count: 10, eval_count: 5 }));
        return;
      }
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, chatCalls: () => chats });
    });
  });
}

test('the runtime initializes a reachable backend and runs a real HTTP request', async () => {
  const model = await startModelServer();
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-live-'));
  const runtime = bootstrap({
    AGENT_RUNTIME_DB_PATH: join(dir, 'runtime.db'),
    AGENT_RUNTIME_WORKSPACE: dir,
    AGENT_RUNTIME_OLLAMA_URL: model.url
  });
  try {
    const project = runtime.projects.create({ name: 'live', rootPath: dir });
    const task = runtime.taskService.create(project.projectId, 'Explain the file', 'Explain what the file exports');
    const result = await runtime.orchestrator.run(task.taskId, {
      checks: [{ name: 'build', kind: 'BUILD', run: () => ({ status: 'PASS', evidence: 'ok' }) }]
    });

    // A real HTTP call happened; the adapter was initialized rather than reported
    // as unavailable.
    assert.equal(model.chatCalls(), 1, 'the model server must have been called');
    assert.equal(result.failureCategory, null);
    assert.equal(result.response, 'the file exports add()');
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(result.finalState, 'COMPLETED');
  } finally {
    runtime.db.close();
    model.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
