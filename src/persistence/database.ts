import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Database {
  readonly raw: DatabaseSync;

  constructor(dbPath: string) {
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.raw = new DatabaseSync(absolute);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }

  // Apply every pending migration found in `migrationsDir` in numeric order.
  // Each file's leading number (e.g. 002_name.sql) is its immutable version.
  migrate(migrationsDir: string): number[] {
    const absolute = resolve(migrationsDir);
    // The migration ledger must exist before any version lookup; migrations also
    // declare it with IF NOT EXISTS, so this is safe on a fresh database.
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const files = readdirSync(absolute)
      .filter(file => /^\d+_.*\.sql$/.test(file))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    const applied: number[] = [];
    for (const file of files) {
      const version = Number.parseInt(file, 10);
      const already = this.raw.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
      if (already) continue;
      const sql = readFileSync(join(absolute, file), 'utf8');
      this.raw.exec(sql);
      this.raw.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      applied.push(version);
    }
    return applied;
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
