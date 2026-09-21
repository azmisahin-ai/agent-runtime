import { bootstrap } from './runtime/bootstrap.js';

const runtime = bootstrap();
console.log(JSON.stringify({ status: 'READY', dbPath: runtime.config.dbPath }, null, 2));
runtime.db.close();
