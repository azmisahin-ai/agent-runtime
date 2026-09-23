import type { Database } from '../persistence/database.js';

export interface IdempotencyEntry {
  key: string;
  operation: string;
  requestHash: string;
  response: Record<string, unknown>;
  createdAt: string;
}

// Idempotency for asynchronous state-changing operations (spec 09 §5). A repeated
// request with the same key and identical payload returns the first result; the same
// key with a different payload is a conflict. This never bypasses the state machine:
// it only replays a previously persisted response.
export class IdempotencyStore {
  constructor(private readonly db: Database) {}

  lookup(key: string, operation: string, requestHash: string): { hit: IdempotencyEntry | null; conflict: boolean } {
    const row = this.db.raw.prepare('SELECT * FROM idempotency_keys WHERE idempotency_key = ? AND operation = ?').get(key, operation) as Record<string, unknown> | undefined;
    if (!row) return { hit: null, conflict: false };
    if (String(row.request_hash) !== requestHash) return { hit: null, conflict: true };
    return {
      hit: {
        key: String(row.idempotency_key), operation: String(row.operation), requestHash: String(row.request_hash),
        response: JSON.parse(String(row.response_json)) as Record<string, unknown>, createdAt: String(row.created_at)
      },
      conflict: false
    };
  }

  record(key: string, operation: string, requestHash: string, response: Record<string, unknown>, createdAt: string): void {
    this.db.raw.prepare('INSERT OR REPLACE INTO idempotency_keys(idempotency_key,operation,request_hash,response_json,created_at) VALUES (?,?,?,?,?)')
      .run(key, operation, requestHash, JSON.stringify(response), createdAt);
  }
}
