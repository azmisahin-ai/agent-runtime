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

  // Changed files since a revision (or the working tree) as ranking inputs. Git
  // signals are candidates, never automatic relevance (spec 12 §7).
  changedFiles(against: string | null = null): string[] {
    try {
      const args = against ? ['diff', '--name-only', `${against}..HEAD`] : ['diff', '--name-only', 'HEAD'];
      const output = this.run(args);
      return output.split('\n').map(line => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  recentCommits(limit = 20): { hash: string; subject: string; author: string; date: string }[] {
    try {
      const output = this.run(['log', `-${Math.max(1, Math.min(limit, 200))}`, '--pretty=format:%H%x1f%s%x1f%an%x1f%aI']);
      return output.split('\n').filter(Boolean).map(line => {
        const [hash, subject, author, date] = line.split('\x1f');
        return { hash, subject, author, date };
      });
    } catch {
      return [];
    }
  }

  diff(against: string | null = null, maxBytes = 200_000): string {
    try {
      const args = against ? ['diff', `${against}..HEAD`] : ['diff', 'HEAD'];
      return this.run(args).slice(0, maxBytes);
    } catch {
      return '';
    }
  }
}
