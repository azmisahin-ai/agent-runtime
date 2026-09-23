import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ToolDefinition, PermissionLevel } from '../domain/types.js';
import { resolveWorkspacePath, type PathGuardOptions } from './path-guard.js';

export interface ToolExecutionContext {
  workspaceRoot: string;
  pathGuard: PathGuardOptions;
  maxOutputBytes: number;
  gitRunner?: (args: string[]) => string;
}

export interface ToolImplementation {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): string;
}

const READ_ONLY: PermissionLevel = 'READ_ONLY';
const GIT_READ: PermissionLevel = 'READ_ONLY';

export const MAX_DEFAULT_OUTPUT = 262_144;

function truncate(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  return { text: `${buffer.subarray(0, maxBytes).toString('utf8')}\n...[truncated at ${maxBytes} bytes]`, truncated: true };
}

function readFileTool(): ToolImplementation {
  return {
    definition: {
      name: 'read_file', version: '1.0.0',
      description: 'Read a UTF-8 file inside the workspace root.',
      capabilities: ['read_only', 'filesystem_read'], permission: READ_ONLY,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['path'],
        properties: { path: { type: 'string', minLength: 1, maxLength: 4096 } }
      },
      limits: { maxBytes: MAX_DEFAULT_OUTPUT }
    },
    execute(args, context) {
      const target = resolveWorkspacePath(context.pathGuard, String(args.path));
      const size = statSync(target.absolutePath).size;
      if (size > (context.maxOutputBytes || MAX_DEFAULT_OUTPUT)) {
        throw new Error(`file exceeds read limit: ${size} bytes`);
      }
      return readFileSync(target.absolutePath, 'utf8');
    }
  };
}

function listDirectoryTool(): ToolImplementation {
  return {
    definition: {
      name: 'list_directory', version: '1.0.0',
      description: 'List entries in a workspace directory.',
      capabilities: ['read_only', 'filesystem_read'], permission: READ_ONLY,
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string', maxLength: 4096 }, recursive: { type: 'boolean' } }
      }
    },
    execute(args, context) {
      const target = resolveWorkspacePath(context.pathGuard, args.path ? String(args.path) : '.');
      const entries: string[] = [];
      walk(target.absolutePath, context.workspaceRoot, entries, Boolean(args.recursive), 0);
      return entries.sort().join('\n');
    }
  };
}

function walk(dir: string, root: string, out: string[], recursive: boolean, depth: number): void {
  if (depth > 8) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const absolute = join(dir, entry.name);
    const rel = relative(root, absolute).split(sep).join('/');
    out.push(entry.isDirectory() ? `${rel}/` : rel);
    if (recursive && entry.isDirectory()) walk(absolute, root, out, recursive, depth + 1);
  }
}

function searchFilesTool(): ToolImplementation {
  return {
    definition: {
      name: 'search_files', version: '1.0.0',
      description: 'Search workspace files for a literal substring.',
      capabilities: ['read_only', 'filesystem_read'], permission: READ_ONLY,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 512 },
          path: { type: 'string', maxLength: 4096 },
          maxResults: { type: 'integer', minimum: 1, maximum: 500 }
        }
      }
    },
    execute(args, context) {
      const query = String(args.query);
      const start = resolveWorkspacePath(context.pathGuard, args.path ? String(args.path) : '.');
      const max = Number(args.maxResults ?? 100);
      const files: string[] = [];
      walk(start.absolutePath, context.workspaceRoot, files, true, 0);
      const matches: string[] = [];
      for (const file of files) {
        if (matches.length >= max) break;
        if (file.endsWith('/')) continue;
        let content: string;
        try {
          content = readFileSync(join(context.workspaceRoot, file), 'utf8');
        } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < max; i += 1) {
          if (lines[i].includes(query)) matches.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
      return matches.join('\n');
    }
  };
}

function gitTool(name: 'git.status' | 'git.diff' | 'git.log' | 'git.branch'): ToolImplementation {
  const gitArgs: Record<string, string[]> = {
    'git.status': ['status', '--porcelain'],
    'git.diff': ['diff'],
    'git.log': ['log', '--oneline', '-n', '20'],
    'git.branch': ['branch', '--show-current']
  };
  return {
    definition: {
      name, version: '1.0.0', description: `Read-only ${name} inspection.`,
      capabilities: ['read_only', 'git_access'], permission: GIT_READ,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    execute(_args, context) {
      if (!context.gitRunner) throw new Error('git runner is not configured');
      return context.gitRunner(gitArgs[name]);
    }
  };
}

export function builtinTools(): ToolImplementation[] {
  return [readFileTool(), listDirectoryTool(), searchFilesTool(), gitTool('git.status'), gitTool('git.diff'), gitTool('git.log'), gitTool('git.branch')];
}
