import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Database {
  readonly raw: DatabaseSync;

  constructor(dbPath: string) {
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.raw = new DatabaseSync(absolute);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }

  migrate(sqlPath: string): void {
    const sql = readFileSync(sqlPath, 'utf8');
    this.raw.exec(sql);
    const exists = this.raw.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
    if (!exists) {
      this.raw.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
    }
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.raw.close(); }
}
