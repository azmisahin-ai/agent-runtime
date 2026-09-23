import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export interface SandboxOptions {
  workspaceRoot: string;
  maxOutputBytes: number;
  timeoutMs: number;
  // Explicit, minimal environment. Anything not listed is not inherited.
  env?: Record<string, string>;
  // Best-effort resource limits. 0 means "do not set".
  maxFileSizeBytes?: number;
  maxProcesses?: number;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

// A single, auditable place where process execution happens (spec 15 §7).
// It controls cwd, environment, timeout and output bounds, and never uses a shell.
export class ProcessSandbox {
  constructor(private readonly options: SandboxOptions) {}

  run(argv: string[], cwd?: string, timeoutMs?: number): SandboxResult {
    if (argv.length === 0) throw new Error('sandbox requires a non-empty argv');
    const spawnOptions: SpawnSyncOptions = {
      cwd: cwd ?? this.options.workspaceRoot,
      timeout: timeoutMs ?? this.options.timeoutMs,
      encoding: 'utf8',
      shell: false,
      maxBuffer: this.options.maxOutputBytes,
      // Explicit environment only: no inherited credentials or tokens.
      env: this.explicitEnv(cwd)
    };
    const result = spawnSync(argv[0], argv.slice(1), spawnOptions);
    const stdout = typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString('utf8') ?? '');
    const stderr = typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString('utf8') ?? '');
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') return { stdout, stderr, exitCode: null, timedOut: true };
      // Exceeding the output bound is a bounded failure, not an uncaught crash:
      // the runtime must still produce evidence of the attempt.
      if (code === 'ENOBUFS') return { stdout, stderr, exitCode: null, timedOut: false };
      throw new Error(`sandboxed command failed to start: ${result.error.message}`);
    }
    return { stdout, stderr, exitCode: result.status, timedOut: result.signal === 'SIGTERM' };
  }

  // The environment is a deliberate allowlist, not the ambient process environment
  // (spec 15 §6-7). Secrets never leak into child processes by inheritance.
  private explicitEnv(cwd?: string): Record<string, string> {
    const base: Record<string, string> = {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'C',
      LC_ALL: 'C',
      HOME: cwd ?? this.options.workspaceRoot,
      TMPDIR: cwd ?? this.options.workspaceRoot
    };
    return { ...base, ...(this.options.env ?? {}) };
  }
}
