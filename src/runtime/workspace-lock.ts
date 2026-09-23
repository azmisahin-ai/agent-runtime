import { openSync, closeSync, writeSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Exclusive workspace lock for multi-writer safety (roadmap M4). The runtime owns
// continuity, so at most one attempt may write a workspace at a time. A stale lock
// (dead PID) is reclaimed; a live holder is never preempted.
export class WorkspaceLock {
  private held = false;
  private readonly lockPath: string;

  constructor(workspaceRoot: string) {
    this.lockPath = join(workspaceRoot, '.runtime', 'workspace.lock');
  }

  acquire(): { acquired: boolean; holderPid: number | null } {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    try {
      const fd = openSync(this.lockPath, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      closeSync(fd);
      this.held = true;
      return { acquired: true, holderPid: process.pid };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holderPid = this.readHolderPid();
      // Reclaim only when the recorded process is provably gone.
      if (holderPid !== null && !isAlive(holderPid)) {
        try { unlinkSync(this.lockPath); } catch { return { acquired: false, holderPid }; }
        return this.acquire();
      }
      return { acquired: false, holderPid };
    }
  }

  release(): void {
    if (!this.held) return;
    try { unlinkSync(this.lockPath); } catch { /* already gone */ }
    this.held = false;
  }

  get isHeld(): boolean { return this.held; }

  private readHolderPid(): number | null {
    try {
      const parsed = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { pid?: number };
      return typeof parsed.pid === 'number' ? parsed.pid : null;
    } catch {
      return null;
    }
  }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
