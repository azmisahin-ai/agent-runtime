import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { OllamaBackend } from '../../src/backends/ollama-backend.js';
import { BackendCapabilityUnsupportedError } from '../../src/backends/agent-backend.js';
import type { ContextPack } from '../../src/domain/types.js';

function contextPack(): ContextPack {
  return {
    contextId: 'c1', taskId: 'task_1', attemptId: 'attempt_1', createdAt: new Date(0).toISOString(),
    modelContextLimit: 8192, reservedOutputTokens: 1024, systemTokens: 10, toolSchemaTokens: 0, retrievalBudget: 7000,
    sections: [{ id: 's1', type: 'TASK', content: 'Fix the bug', source: 'task', priority: 0, tokenCost: 3, relevance: 1, timestamp: new Date(0).toISOString(), provenance: 'task' }]
  };
}

// A minimal Ollama-compatible server so the adapter is tested against the real
// HTTP protocol, not a stubbed function.
function startServer(handler: (path: string) => { status: number; body: string }): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      const result = handler(request.url ?? '/');
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(result.body);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('ollama backend initializes and completes a chat request', async () => {
  const { server, url } = await startServer(path => path === '/api/tags' ? { status: 200, body: '{"models":[{"name":"qwen"}]}' } : { status: 200, body: JSON.stringify({ message: { content: 'done' }, done_reason: 'stop', prompt_eval_count: 12, eval_count: 4 }) });
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    assert.equal(await backend.health(), 'HEALTHY');
    const handle = await backend.start({ task_id: 'task_1', attempt_id: 'attempt_1' });
    assert.ok(handle.session_id.startsWith('session_'));
    const response = await backend.send({ task_id: 'task_1', attempt_id: 'attempt_1', context: contextPack(), response_mode: 'TEXT' });
    assert.equal(response.type, 'FINAL');
    assert.equal(response.content, 'done');
    assert.equal(response.usage?.completion_tokens, 4);
    await backend.close();
  } finally { server.close(); }
});

test('unreachable ollama reports unavailable and is not healthy', async () => {
  const backend = new OllamaBackend({ baseUrl: 'http://127.0.0.1:1', model: 'qwen' });
  await assert.rejects(() => backend.initialize(), /not reachable/);
  assert.equal(await backend.health(), 'UNKNOWN');
  await backend.close();
});

// A reachable server with an unpulled model used to report HEALTHY, so the operator
// only discovered the mistake when a real attempt failed. Startup must refuse it.
test('a server without the configured model fails initialization and is not healthy', async () => {
  const { server, url } = await startServer(() => ({ status: 200, body: '{"models":[{"name":"llama3.2:latest"}]}' }));
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen2.5-coder:7b' });
    await assert.rejects(() => backend.initialize(), /Model qwen2\.5-coder:7b is not available/);
    assert.equal(await backend.health(), 'UNKNOWN');
    await backend.close();
  } finally { server.close(); }
});

// A model can disappear after a successful startup (removed, or the server swapped).
// health() must then report DEGRADED rather than keep claiming HEALTHY.
test('a model that disappears after startup reports degraded, never healthy', async () => {
  let models = '{"models":[{"name":"qwen"}]}';
  const { server, url } = await startServer(() => ({ status: 200, body: models }));
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    assert.equal(await backend.health(), 'HEALTHY');
    models = '{"models":[]}';
    assert.equal(await backend.health(), 'DEGRADED');
    await backend.close();
  } finally { server.close(); }
});

test('a missing model during send is not retryable', async () => {
  const { server, url } = await startServer(path => path === '/api/tags'
    ? { status: 200, body: '{"models":[{"name":"qwen"}]}' }
    : { status: 404, body: '{"error":"model \'qwen\' not found"}' });
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    await assert.rejects(
      () => backend.send({ task_id: 't', attempt_id: 'a', context: contextPack(), response_mode: 'TEXT' }),
      (error: Error & { retryable?: boolean }) => /is not available/.test(error.message) && error.retryable === false
    );
    await backend.close();
  } finally { server.close(); }
});

test('unsupported pause/resume fails explicitly', async () => {
  const { server, url } = await startServer(() => ({ status: 200, body: '{"models":[{"name":"qwen"}]}' }));
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    await assert.rejects(() => backend.pause(), BackendCapabilityUnsupportedError);
    await assert.rejects(() => backend.resume(), BackendCapabilityUnsupportedError);
    assert.equal(backend.capabilities().pauseResume, false);
    await backend.close();
  } finally { server.close(); }
});

test('backend errors are classified as retryable backend failures', async () => {
  const { server, url } = await startServer(path => path === '/api/tags' ? { status: 200, body: '{"models":[{"name":"qwen"}]}' } : { status: 500, body: '{"error":"boom"}' });
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    await assert.rejects(() => backend.send({ task_id: 't', attempt_id: 'a', context: contextPack(), response_mode: 'TEXT' }), /Ollama returned 500/);
    await backend.close();
  } finally { server.close(); }
});

test('streaming yields text deltas and a done event', async () => {
  const { server, url } = await startServer(path => path === '/api/tags'
    ? { status: 200, body: '{"models":[{"name":"qwen"}]}' }
    : { status: 200, body: '{"message":{"content":"he"}}\n{"message":{"content":"llo"},"done":true}\n' });
  try {
    const backend = new OllamaBackend({ baseUrl: url, model: 'qwen' });
    await backend.initialize();
    const events: string[] = [];
    for await (const event of backend.stream({ task_id: 't', attempt_id: 'a', context: contextPack(), response_mode: 'TEXT' })) {
      if (event.type === 'TEXT_DELTA') events.push(String(event.content));
      if (event.type === 'DONE') events.push('DONE');
    }
    assert.deepEqual(events, ['he', 'llo', 'DONE']);
    await backend.close();
  } finally { server.close(); }
});
