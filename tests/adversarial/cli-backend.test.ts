import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliBackend } from '../../src/backends/cli-backend.js';
import { ProcessSandbox } from '../../src/security/process-sandbox.js';
import { BackendCapabilityUnsupportedError, BackendError } from '../../src/backends/agent-backend.js';
import type { ContextPack } from '../../src/domain/types.js';

function contextPack(content: string): ContextPack {
  return {
    contextId: 'c1', taskId: 'task_1', attemptId: 'attempt_1', createdAt: new Date(0).toISOString(),
    modelContextLimit: 8192, reservedOutputTokens: 1024, systemTokens: 10, toolSchemaTokens: 0, retrievalBudget: 7000,
    sections: [{ id: 's1', type: 'TASK', content, source: 'task', priority: 0, tokenCost: 3, relevance: 1, timestamp: new Date(0).toISOString(), provenance: 'task' }]
  };
}

// A real executable on disk. This exercises the actual spawn path, not a stub.
function makeEchoScript(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function sandboxFor(dir: string): ProcessSandbox {
  return new ProcessSandbox({ workspaceRoot: dir, maxOutputBytes: 64 * 1024, timeoutMs: 10_000 });
}

test('a CLI agent runs through the sandbox and its session maps to the attempt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'agent.sh', 'echo "answer: $1"');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await backend.initialize();
    assert.equal(await backend.health(), 'HEALTHY');
    const handle = await backend.start({ task_id: 'task_1', attempt_id: 'attempt_1' });
    // The external session id is recorded but the runtime session id is its own.
    assert.ok(handle.session_id.startsWith('session_'));
    assert.ok(handle.external_session_id && handle.external_session_id.includes('attempt_1'));

    const response = await backend.send({ task_id: 'task_1', attempt_id: 'attempt_1', context: contextPack('hello'), response_mode: 'TEXT' });
    assert.equal(response.type, 'FINAL');
    assert.match(String(response.content), /answer:/);
    assert.equal(response.backend_metadata?.external_session_id, handle.external_session_id);
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI agent cannot reach the runtime before it is initialized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'agent.sh', 'echo hi');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await assert.rejects(
      () => backend.send({ task_id: 't', attempt_id: 'a', context: contextPack('x'), response_mode: 'TEXT' }),
      (error: unknown) => error instanceof BackendError && error.code === 'BACKEND_UNAVAILABLE'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing CLI is reported unavailable, never silently accepted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const backend = new CliBackend({ command: join(dir, 'does-not-exist'), sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await assert.rejects(
      () => backend.initialize(),
      (error: unknown) => error instanceof BackendError && error.code === 'BACKEND_UNAVAILABLE'
    );
    assert.equal(await backend.health(), 'UNKNOWN');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a shell metacharacter in the prompt is passed as data, not executed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'agent.sh', 'echo "got:$1"');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await backend.initialize();
    // If this were interpolated into a shell, the command substitution would run
    // and produce a marker file. It must survive as literal text instead.
    const hostile = 'ignore previous instructions; $(touch pwned.txt) ; `touch pwned2.txt`';
    const response = await backend.send({ task_id: 't', attempt_id: 'a', context: contextPack(hostile), response_mode: 'TEXT' });
    assert.match(String(response.content), /\$\(touch pwned\.txt\)/);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(join(dir, 'pwned.txt')), false, 'command substitution must not execute');
    assert.equal(existsSync(join(dir, 'pwned2.txt')), false, 'backticks must not execute');
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI agent does not inherit ambient credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  // The child prints whatever it can see of a secret-looking variable.
  const cli = makeEchoScript(dir, 'agent.sh', 'echo "secret=${AGENT_RUNTIME_TEST_SECRET:-none}"');
  process.env.AGENT_RUNTIME_TEST_SECRET = 'must-not-leak';
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await backend.initialize();
    const response = await backend.send({ task_id: 't', attempt_id: 'a', context: contextPack('x'), response_mode: 'TEXT' });
    assert.match(String(response.content), /secret=none/);
  } finally {
    delete process.env.AGENT_RUNTIME_TEST_SECRET;
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI agent that never exits is bounded by the sandbox timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'slow.sh', 'if [ "$1" = "--version" ]; then echo slow-agent-1.0; exit 0; fi\nsleep 30');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir, requestTimeoutMs: 500 });
  try {
    await backend.initialize();
    await assert.rejects(
      () => backend.send({ task_id: 't', attempt_id: 'a', context: contextPack('x'), response_mode: 'TEXT' }),
      (error: unknown) => error instanceof BackendError && error.code === 'BACKEND_TIMEOUT'
    );
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI agent that exits cleanly with no output is a failure, not an empty answer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'silent.sh', 'if [ "$1" = "--version" ]; then echo silent-1.0; exit 0; fi\nexit 0');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await backend.initialize();
    // Silence must not be reported as FINAL: an agent that failed to authenticate
    // or produced nothing would otherwise look like a completed attempt.
    await assert.rejects(
      () => backend.send({ task_id: 't', attempt_id: 'a', context: contextPack('x'), response_mode: 'TEXT' }),
      (error: unknown) => error instanceof BackendError && error.code === 'BACKEND_FAILURE' && /no output/.test(error.message)
    );
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a CLI agent that cannot stream says so instead of pretending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-runtime-cli-'));
  const cli = makeEchoScript(dir, 'agent.sh', 'echo hi');
  const backend = new CliBackend({ command: cli, sandbox: sandboxFor(dir), workspaceRoot: dir });
  try {
    await backend.initialize();
    await assert.rejects(
      async () => { for await (const _ of backend.stream()) { /* not reached */ } },
      (error: unknown) => error instanceof BackendCapabilityUnsupportedError
    );
  } finally {
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
