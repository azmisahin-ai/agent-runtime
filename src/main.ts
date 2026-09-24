import { bootstrap } from './runtime/bootstrap.js';
import { ApiServer } from './api/server.js';

// The runtime owns continuity; the API is a transport over persisted state (spec 09 §8).
const runtime = bootstrap();

// Initialize the backend before accepting work so the operator sees real backend
// health at startup. An unreachable model server does not stop the runtime: the
// API stays up and each attempt fails honestly as BACKEND_UNAVAILABLE.
let backendHealth: string;
try {
  await runtime.orchestrator.initializeBackend();
  backendHealth = await runtime.backend.health();
} catch (error) {
  backendHealth = 'UNAVAILABLE';
  console.error(JSON.stringify({ status: 'BACKEND_UNREACHABLE', base_url: runtime.config.backend.baseUrl, error: error instanceof Error ? error.message : String(error) }));
}

const server = new ApiServer(runtime.api, {
  port: runtime.config.api.port,
  host: runtime.config.api.host,
  token: runtime.config.api.token
});

// A runtime whose backend cannot serve work is not ready to serve work, even though
// the API is listening. Reporting a flat READY here hid a missing model behind a
// healthy-looking banner; the top-level status now reflects the backend.
const { host, port } = await server.listen();
console.log(JSON.stringify({
  status: backendHealth === 'HEALTHY' ? 'READY' : 'DEGRADED',
  db_path: runtime.config.dbPath,
  api_base: `http://${host}:${port}/api/v1`,
  mutations_enabled: runtime.config.api.token !== null,
  network_policy: runtime.config.networkAccess,
  backend: runtime.config.backendKind === 'cli'
    ? { kind: 'cli', command: runtime.config.cli.command, health: backendHealth }
    : { kind: 'ollama', model: runtime.config.backend.model, base_url: runtime.config.backend.baseUrl, health: backendHealth }
}, null, 2));

const shutdown = async (signal: string) => {
  console.log(JSON.stringify({ status: 'SHUTTING_DOWN', signal }));
  await server.close();
  runtime.workspaceLock.release();
  runtime.db.close();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
