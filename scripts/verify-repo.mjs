import { existsSync } from 'node:fs';
const required = [
  'package.json', 'tsconfig.json', 'migrations/001_initial.sql',
  'src/domain/types.ts', 'src/domain/state-machine.ts',
  'src/persistence/database.ts', 'src/events/event-store.ts',
  'src/application/task-service.ts', 'tests/unit/state-machine.test.ts'
];
const missing = required.filter(p => !existsSync(p));
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
console.log(`Repository structure OK (${required.length} required files).`);
