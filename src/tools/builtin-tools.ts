import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { ToolDefinition, PermissionLevel } from '../domain/types.js';
import { redactSecrets } from '../security/secret-redaction.js';
import { resolveWorkspacePath, type PathGuardOptions } from './path-guard.js';

export interface ToolExecutionContext {
  workspaceRoot: string;
  pathGuard: PathGuardOptions;
  maxOutputBytes: number;
  gitRunner?: (args: string[]) => string;
  authorizeCommand?: (argv: string[]) => { allowed: boolean; reason: string };
  commandTimeoutMs?: number;
  // Process execution happens only through the sandbox (spec 15 §7). When absent,
  // terminal.exec refuses to run rather than falling back to ambient execution.
  runCommand?: (argv: string[], cwd: string, timeoutMs: number) => { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean };
  // Git operations are classified before execution; destructive ones are denied by
  // baseline policy (spec 15 §9).
  authorizeGit?: (args: string[]) => { allowed: boolean; reason: string; operationClass: string };
}

export interface ToolImplementation {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolExecutionContext): string;
}

const READ_ONLY: PermissionLevel = 'READ_ONLY';
const GIT_READ: PermissionLevel = 'READ_ONLY';
const WORKSPACE_WRITE: PermissionLevel = 'WORKSPACE_WRITE';
const PROCESS_EXEC: PermissionLevel = 'PROCESS_EXECUTION';

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

function writeFileTool(): ToolImplementation {
  return {
    definition: {
      name: 'write_file', version: '1.0.0',
      description: 'Write UTF-8 content to a file inside the workspace root.',
      capabilities: ['filesystem_write'], permission: WORKSPACE_WRITE,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['path', 'content'],
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 4096 },
          content: { type: 'string', maxLength: MAX_DEFAULT_OUTPUT },
          createDirectories: { type: 'boolean' }
        }
      },
      limits: { maxBytes: MAX_DEFAULT_OUTPUT }
    },
    execute(args, context) {
      // Path guard runs before any write; the guard also blocks sensitive paths.
      const target = resolveWorkspacePath(context.pathGuard, String(args.path));
      const content = String(args.content ?? '');
      if (content.length > (context.maxOutputBytes || MAX_DEFAULT_OUTPUT)) {
        throw new Error(`write content exceeds limit: ${content.length} bytes`);
      }
      if (args.createDirectories === true) mkdirSync(dirname(target.absolutePath), { recursive: true });
      writeFileSync(target.absolutePath, content, 'utf8');
      const relativePath = relative(context.workspaceRoot, target.absolutePath).split(sep).join('/');
      return JSON.stringify({ path: relativePath, bytes: Buffer.byteLength(content, 'utf8') });
    }
  };
}

// Terminal execution: structured argv only (no shell string), explicit timeout,
// bounded output, per-command authorization and secret redaction (spec 10 §6, §9).
function terminalExecTool(): ToolImplementation {
  return {
    definition: {
      name: 'terminal.exec', version: '1.0.0',
      description: 'Execute a structured command (argv form) inside the workspace root.',
      capabilities: ['process_execute'], permission: PROCESS_EXEC,
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['argv'],
        properties: {
          argv: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 4096 } },
          cwd: { type: 'string', maxLength: 4096 }
        }
      },
      limits: { maxBytes: MAX_DEFAULT_OUTPUT, timeoutMs: 30_000 }
    },
    execute(args, context) {
      const argv = (args.argv as string[]).map(String);
      // Structured argv means the first element is the program, never a shell.
      const decision = context.authorizeCommand?.(argv) ?? { allowed: false, reason: 'no command authorizer configured' };
      if (!decision.allowed) throw new Error(`command denied: ${decision.reason}`);
      const cwd = args.cwd ? resolveWorkspacePath(context.pathGuard, String(args.cwd)).absolutePath : context.workspaceRoot;
      const timeout = context.commandTimeoutMs ?? 30_000;
      // All process execution is funneled through the sandbox (spec 15 §7). If no
      // sandbox is configured, execution is refused: there is no ambient fallback.
      if (!context.runCommand) throw new Error('command denied: no process sandbox configured');
      const result = context.runCommand(argv, cwd, timeout);
      // The exit code is part of the observation, not just the text: verification
      // decides PASS/FAIL from it, and a model that cannot see it cannot tell a
      // successful command from a failing one (spec 10 §9, 11 §3).
      const combined = `${result.stdout}${result.stderr}`;
      const redacted = redactSecrets(truncate(combined, context.maxOutputBytes || MAX_DEFAULT_OUTPUT).text);
      return JSON.stringify({ exitCode: result.exitCode, timedOut: result.timedOut, output: redacted.text });
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
      const args = gitArgs[name];
      // Destructive Git is denied by baseline policy; read operations pass through
      // (spec 15 §9). Classification happens before execution, never after.
      const decision = context.authorizeGit?.(args);
      if (decision && !decision.allowed) throw new Error(`git operation denied: ${decision.reason}`);
      return context.gitRunner(args);
    }
  };
}

export function builtinTools(): ToolImplementation[] {
  return [
    readFileTool(), listDirectoryTool(), searchFilesTool(),
    writeFileTool(), terminalExecTool(),
    gitTool('git.status'), gitTool('git.diff'), gitTool('git.log'), gitTool('git.branch')
  ];
}
