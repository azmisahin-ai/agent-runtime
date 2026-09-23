import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_DEPTH = 6;

// Resolve a repository file independently of the process working directory,
// so the runtime behaves the same from src/ (tsx) and dist/ (node).
export function repoPath(relativePath: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(relativePath);
}
