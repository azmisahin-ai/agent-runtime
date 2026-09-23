import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalHash } from '../domain/hash.js';
import type { EvaluationRunRepository } from '../persistence/evaluation-run-repository.js';
import { nowIso } from '../domain/id.js';

// Artifact store for evaluation evidence (spec 06 §10). Artifacts are written into
// a dedicated directory and recorded by content hash so their integrity is
// checkable later. Secrets are never written here; callers pass redacted content.
export class ArtifactStore {
  constructor(
    private readonly repository: EvaluationRunRepository,
    private readonly rootDir: string
  ) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  write(runId: string, kind: string, name: string, content: string): { artifactId: string; reference: string; contentHash: string; size: number } {
    const safeRun = runId.replace(/[^A-Za-z0-9_.-]/g, '_');
    const safeName = name.replace(/[^A-Za-z0-9_.-]/g, '_');
    const dir = join(this.rootDir, safeRun);
    mkdirSync(dir, { recursive: true });
    const absolute = resolve(dir, safeName);
    if (!absolute.startsWith(resolve(this.rootDir))) throw new Error('artifact path escapes store root');
    writeFileSync(absolute, content);
    const contentHash = canonicalHash(content);
    const reference = join(safeRun, safeName);
    const record = this.repository.addArtifact({ runId, kind, reference, contentHash, size: Buffer.byteLength(content), createdAt: nowIso() });
    return { artifactId: record.artifactId, reference, contentHash, size: record.size };
  }

  verify(artifactId: string, runId: string, reference: string, expectedHash: string): boolean {
    const absolute = resolve(this.rootDir, reference);
    if (!absolute.startsWith(resolve(this.rootDir))) return false;
    if (!existsSync(absolute)) return false;
    void artifactId;
    void runId;
    return canonicalHash(readFileSync(absolute, 'utf8')) === expectedHash;
  }
}
