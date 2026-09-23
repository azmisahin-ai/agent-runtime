import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export class ToolSecurityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ToolSecurityError';
  }
}

// Sensitive paths are denied by default (spec 10 §5, 15 §6). Matched against the
// workspace-relative normalized path.
const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.git\/config$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|p12|pfx|key)$/i,
  /(^|\/)(credentials|secrets?)(\.|$)/i,
];

export interface PathGuardOptions {
  workspaceRoot: string;
  sensitivePatterns?: RegExp[];
}

// Resolve `candidate` strictly inside the workspace root, rejecting traversal and
// symlink escapes. Returns a workspace-relative POSIX-style path.
export function resolveWorkspacePath(options: PathGuardOptions, candidate: string): { relativePath: string; absolutePath: string } {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new ToolSecurityError('TOOL_INVALID_REQUEST', 'path must be a non-empty string');
  }
  const root = realpathSync(options.workspaceRoot);
  const candidateAbsolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);

  // Reject before touching the filesystem: a lexical escape is always invalid.
  if (!isInside(root, candidateAbsolute) && candidateAbsolute !== root) {
    throw new ToolSecurityError('TOOL_DENIED', `path escapes workspace root: ${candidate}`);
  }

  // Reject symlink escapes by resolving the nearest existing ancestor's real path.
  const realTarget = realpathNearestExisting(candidateAbsolute);
  if (realTarget !== root && !isInside(root, realTarget)) {
    throw new ToolSecurityError('TOOL_DENIED', `path resolves outside workspace root via symlink: ${candidate}`);
  }

  const relativePath = relative(root, candidateAbsolute).split(sep).join('/');
  const patterns = options.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;
  if (patterns.some(pattern => pattern.test(relativePath))) {
    throw new ToolSecurityError('TOOL_DENIED', `path is sensitive and denied by baseline policy: ${relativePath}`);
  }

  return { relativePath, absolutePath: candidateAbsolute };
}

export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realpathNearestExisting(target: string): string {
  let current = target;
  for (;;) {
    try {
      return realpathSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}
