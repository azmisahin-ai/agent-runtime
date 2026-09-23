import { bootstrap } from './runtime/bootstrap.js';
import { ApiServer } from './api/server.js';

// The runtime owns continuity; the API is a transport over persisted state (spec 09 §8).
const runtime = bootstrap();
const server = new ApiServer(runtime.api, {
  port: runtime.config.api.port,
  host: runtime.config.api.host,
  token: runtime.config.api.token
});

const { host, port } = await server.listen();
console.log(JSON.stringify({
  status: 'READY',
  db_path: runtime.config.dbPath,
  api_base: `http://${host}:${port}/api/v1`,
  mutations_enabled: runtime.config.api.token !== null,
  network_policy: runtime.config.networkAccess
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
