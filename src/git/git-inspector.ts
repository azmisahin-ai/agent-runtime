import { execFileSync, spawnSync } from 'node:child_process';
import type { GitState } from '../domain/types.js';

// Read-only Git inspection using structured argv (spec 10 §6, 12 §7).
// Never uses a shell string, so there is no injection surface.
export class GitInspector {
  constructor(private readonly workspaceRoot: string) {}

  run(args: string[]): string {
    const result = spawnSync('git', args, { cwd: this.workspaceRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} exited ${result.status}: ${(result.stderr ?? '').trim()}`);
    return (result.stdout ?? '').trim();
  }

  state(): GitState {
    try {
      const head = this.run(['rev-parse', 'HEAD']);
      const branch = this.run(['branch', '--show-current']);
      const status = this.run(['status', '--porcelain']);
      return { head: head || null, branch: branch || null, dirty: status.length > 0 };
    } catch {
      return { head: null, branch: null, dirty: false };
    }
  }

  isRepository(): boolean {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.workspaceRoot, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
