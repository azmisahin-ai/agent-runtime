import type { ConfigSnapshot } from '../domain/types.js';
import { newId, nowIso } from '../domain/id.js';
import { canonicalHash } from '../domain/hash.js';
import type { Database } from './database.js';

export class ConfigSnapshotRepository {
  constructor(private readonly db: Database) {}

  create(input: {
    taskId: string;
    attemptId: string;
    schemaVersion: number;
    profile: string;
    effectiveConfig: Record<string, unknown>;
    effectivePolicy: Record<string, unknown>;
    backendId: string;
    model: string;
    policyVersion: number;
  }): ConfigSnapshot {
    const configHash = canonicalHash({
      config: input.effectiveConfig, policy: input.effectivePolicy,
      backendId: input.backendId, model: input.model, profile: input.profile, policyVersion: input.policyVersion
    });
    const snapshot: ConfigSnapshot = {
      configSnapshotId: newId('config'), taskId: input.taskId, attemptId: input.attemptId,
      schemaVersion: input.schemaVersion, profile: input.profile,
      effectiveConfig: input.effectiveConfig, effectivePolicy: input.effectivePolicy,
      backendId: input.backendId, model: input.model, policyVersion: input.policyVersion,
      configHash, createdAt: nowIso()
    };
    this.db.raw.prepare(`INSERT INTO config_snapshots(config_snapshot_id,task_id,attempt_id,schema_version,profile,effective_config_json,effective_policy_json,backend_id,model,policy_version,config_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(snapshot.configSnapshotId, snapshot.taskId, snapshot.attemptId, snapshot.schemaVersion, snapshot.profile,
        JSON.stringify(snapshot.effectiveConfig), JSON.stringify(snapshot.effectivePolicy),
        snapshot.backendId, snapshot.model, snapshot.policyVersion, snapshot.configHash, snapshot.createdAt);
    return snapshot;
  }

  getForAttempt(attemptId: string): ConfigSnapshot | null {
    const row = this.db.raw.prepare('SELECT * FROM config_snapshots WHERE attempt_id = ?').get(attemptId) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }

  private map(row: Record<string, unknown>): ConfigSnapshot {
    return {
      configSnapshotId: String(row.config_snapshot_id),
      taskId: String(row.task_id),
      attemptId: String(row.attempt_id),
      schemaVersion: Number(row.schema_version),
      profile: String(row.profile),
      effectiveConfig: JSON.parse(String(row.effective_config_json)) as Record<string, unknown>,
      effectivePolicy: JSON.parse(String(row.effective_policy_json)) as Record<string, unknown>,
      backendId: String(row.backend_id),
      model: String(row.model),
      policyVersion: Number(row.policy_version),
      configHash: String(row.config_hash),
      createdAt: String(row.created_at)
    };
  }
}
