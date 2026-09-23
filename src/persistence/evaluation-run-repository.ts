import type { AttemptOutcome, FailureCategory, VerificationStatus } from '../domain/types.js';
import type { Database } from './database.js';
import { newId } from '../domain/id.js';

export interface EvaluationRunRecord {
  runId: string;
  suiteId: string;
  suiteVersion: string;
  taskPackId: string;
  category: string;
  expectedBehavior: string;
  constraints: string[];
  isolation: Record<string, unknown>;
  repositoryRevision: string | null;
  backendId: string;
  provider: string;
  model: string;
  runtimeVersion: string;
  contextConfig: Record<string, unknown>;
  memorySnapshot: Record<string, unknown>;
  toolConfig: Record<string, unknown>;
  verificationConfig: Record<string, unknown>;
  baselineHash: string;
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  failureCategory: FailureCategory | null;
  primaryCause: FailureCategory | null;
  secondaryCauses: FailureCategory[];
  attributionEvidence: Record<string, unknown>;
  reproducible: boolean;
  startedAt: string;
  endedAt: string;
  evidence: Record<string, unknown>;
}

export interface EvaluationMetricRecord {
  metricId: string;
  runId: string;
  name: string;
  value: number | null;
  unit: string;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface EvaluationArtifactRecord {
  artifactId: string;
  runId: string;
  kind: string;
  reference: string;
  contentHash: string;
  size: number;
  createdAt: string;
}

export interface IntegrityRecord {
  integrityId: string;
  runId: string;
  kind: string;
  detail: string;
  detected: boolean;
  evidence: Record<string, unknown>;
  createdAt: string;
}

// Append-only evaluation persistence (spec 06 §10-11). Records are immutable; the
// store offers no update or delete path for run evidence.
export class EvaluationRunRepository {
  constructor(private readonly db: Database) {}

  createRun(input: Omit<EvaluationRunRecord, 'runId'>): EvaluationRunRecord {
    const runId = newId('evalrun');
    this.db.raw.prepare(`INSERT INTO evaluation_runs(
      run_id,suite_id,suite_version,task_pack_id,category,expected_behavior,constraints_json,isolation_json,
      repository_revision,backend_id,provider,model,runtime_version,context_config_json,memory_snapshot_json,
      tool_config_json,verification_config_json,baseline_hash,outcome,verification,failure_category,
      primary_cause,secondary_causes_json,attribution_evidence_json,reproducible,started_at,ended_at,evidence_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      runId, input.suiteId, input.suiteVersion, input.taskPackId, input.category, input.expectedBehavior,
      JSON.stringify(input.constraints), JSON.stringify(input.isolation), input.repositoryRevision, input.backendId,
      input.provider, input.model, input.runtimeVersion, JSON.stringify(input.contextConfig),
      JSON.stringify(input.memorySnapshot), JSON.stringify(input.toolConfig), JSON.stringify(input.verificationConfig),
      input.baselineHash, input.outcome, input.verification, input.failureCategory, input.primaryCause,
      JSON.stringify(input.secondaryCauses), JSON.stringify(input.attributionEvidence), input.reproducible ? 1 : 0,
      input.startedAt, input.endedAt, JSON.stringify(input.evidence)
    );
    return { runId, ...input };
  }

  getRun(runId: string): EvaluationRunRecord | null {
    const row = this.db.raw.prepare('SELECT * FROM evaluation_runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(filter: { suiteId?: string; category?: string } = {}): EvaluationRunRecord[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filter.suiteId) { clauses.push('suite_id = ?'); params.push(filter.suiteId); }
    if (filter.category) { clauses.push('category = ?'); params.push(filter.category); }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.raw.prepare(`SELECT * FROM evaluation_runs${where} ORDER BY started_at ASC`).all(...params) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  addMetric(input: Omit<EvaluationMetricRecord, 'metricId'>): EvaluationMetricRecord {
    const metricId = newId('metric');
    this.db.raw.prepare('INSERT INTO evaluation_metrics(metric_id,run_id,name,value,unit,evidence_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(metricId, input.runId, input.name, input.value, input.unit, JSON.stringify(input.evidence), input.createdAt);
    return { metricId, ...input };
  }

  listMetrics(runId: string): EvaluationMetricRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM evaluation_metrics WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Record<string, unknown>[];
    return rows.map(row => ({
      metricId: String(row.metric_id), runId: String(row.run_id), name: String(row.name),
      value: row.value === null ? null : Number(row.value), unit: String(row.unit),
      evidence: parseJson(row.evidence_json), createdAt: String(row.created_at)
    }));
  }

  addArtifact(input: Omit<EvaluationArtifactRecord, 'artifactId'>): EvaluationArtifactRecord {
    const artifactId = newId('artifact');
    this.db.raw.prepare('INSERT INTO evaluation_artifacts(artifact_id,run_id,kind,reference,content_hash,size,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(artifactId, input.runId, input.kind, input.reference, input.contentHash, input.size, input.createdAt);
    return { artifactId, ...input };
  }

  listArtifacts(runId: string): EvaluationArtifactRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM evaluation_artifacts WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Record<string, unknown>[];
    return rows.map(row => ({
      artifactId: String(row.artifact_id), runId: String(row.run_id), kind: String(row.kind),
      reference: String(row.reference), contentHash: String(row.content_hash), size: Number(row.size), createdAt: String(row.created_at)
    }));
  }

  addIntegrity(input: Omit<IntegrityRecord, 'integrityId'>): IntegrityRecord {
    const integrityId = newId('integrity');
    this.db.raw.prepare('INSERT INTO evaluation_integrity(integrity_id,run_id,kind,detail,detected,evidence_json,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(integrityId, input.runId, input.kind, input.detail, input.detected ? 1 : 0, JSON.stringify(input.evidence), input.createdAt);
    return { integrityId, ...input };
  }

  listIntegrity(runId: string): IntegrityRecord[] {
    const rows = this.db.raw.prepare('SELECT * FROM evaluation_integrity WHERE run_id = ? ORDER BY created_at ASC').all(runId) as Record<string, unknown>[];
    return rows.map(row => ({
      integrityId: String(row.integrity_id), runId: String(row.run_id), kind: String(row.kind),
      detail: String(row.detail), detected: Number(row.detected) === 1,
      evidence: parseJson(row.evidence_json), createdAt: String(row.created_at)
    }));
  }
}

function mapRun(row: Record<string, unknown>): EvaluationRunRecord {
  return {
    runId: String(row.run_id), suiteId: String(row.suite_id), suiteVersion: String(row.suite_version),
    taskPackId: String(row.task_pack_id), category: String(row.category), expectedBehavior: String(row.expected_behavior),
    constraints: parseStringArray(row.constraints_json), isolation: parseJson(row.isolation_json),
    repositoryRevision: row.repository_revision === null ? null : String(row.repository_revision),
    backendId: String(row.backend_id), provider: String(row.provider), model: String(row.model),
    runtimeVersion: String(row.runtime_version), contextConfig: parseJson(row.context_config_json),
    memorySnapshot: parseJson(row.memory_snapshot_json), toolConfig: parseJson(row.tool_config_json),
    verificationConfig: parseJson(row.verification_config_json), baselineHash: String(row.baseline_hash),
    outcome: row.outcome as AttemptOutcome, verification: row.verification as VerificationStatus,
    failureCategory: (row.failure_category as FailureCategory | null) ?? null,
    primaryCause: (row.primary_cause as FailureCategory | null) ?? null,
    secondaryCauses: parseStringArray(row.secondary_causes_json) as FailureCategory[],
    attributionEvidence: parseJson(row.attribution_evidence_json), reproducible: Number(row.reproducible) === 1,
    startedAt: String(row.started_at), endedAt: String(row.ended_at), evidence: parseJson(row.evidence_json)
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  try { return JSON.parse(String(value)) as Record<string, unknown>; } catch { return {}; }
}

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}
