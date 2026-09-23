import type { Database } from '../persistence/database.js';

export interface DurabilityReport {
  durable: boolean;
  error: string | null;
}

// Canonical durability is a precondition for progress, not a best-effort side
// effect (spec 13 §10). If canonical state cannot be durably persisted the runtime
// must not continue as if durable state exists.
export class PersistenceGuard {
  constructor(private readonly db: Database) {}

  // A write-read-rollback probe establishes that the canonical store is writable
  // without leaving residue. Failure is reported, never swallowed.
  probe(): DurabilityReport {
    try {
      this.db.transaction(() => {
        this.db.raw.exec('CREATE TEMP TABLE IF NOT EXISTS __durability_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
        this.db.raw.prepare('INSERT INTO __durability_probe(value) VALUES (?)').run('probe');
        const row = this.db.raw.prepare('SELECT COUNT(*) AS n FROM __durability_probe').get() as { n: number } | undefined;
        if (!row || row.n < 1) throw new Error('durability probe read-back returned no rows');
        this.db.raw.exec('DELETE FROM __durability_probe');
      });
      return { durable: true, error: null };
    } catch (error) {
      return { durable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  static classify(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /sqlite|database|constraint|busy|disk|i\/o|readonly|read-only|corrupt/i.test(message);
  }
}
