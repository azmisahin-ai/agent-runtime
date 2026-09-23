export type OperationClass = 'READ_ONLY' | 'WORKSPACE_WRITE' | 'DESTRUCTIVE' | 'UNKNOWN';

export interface OperationDecision {
  operationClass: OperationClass;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface DestructiveOperationPolicyOptions {
  // Destructive operations are denied unless an operator explicitly allows them.
  allowDestructive?: boolean;
  // Commands that are inherently destructive regardless of arguments.
  extraDestructiveCommands?: string[];
}

// Git subcommands that permanently alter history, the worktree or the remote
// (spec 15 §9). These are denied by default; read operations are safer baseline
// capabilities. Naming an operation as destructive here is deliberate and explicit.
const DESTRUCTIVE_GIT_SUBCOMMANDS = new Set([
  'push', 'reset', 'rebase', 'filter-branch', 'filter-repo', 'clean',
  'checkout-index', 'update-ref', 'gc', 'prune', 'reflog', 'stash'
]);

// Git subcommands that mutate but are recoverable locally. They still widen
// permission beyond read-only and are treated as workspace writes.
const WRITE_GIT_SUBCOMMANDS = new Set([
  'add', 'commit', 'merge', 'cherry-pick', 'revert', 'rm', 'mv', 'restore', 'tag', 'branch',
  'checkout', 'switch', 'apply', 'am', 'init', 'clone'
]);

const READ_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files', 'ls-tree',
  'cat-file', 'blame', 'describe', 'shortlog', 'grep', 'config', 'remote', 'tag', 'name-rev', 'symbolic-ref', 'for-each-ref'
]);

// Processes that are destructive by nature and are never authorized implicitly.
const DESTRUCTIVE_COMMANDS = new Set(['rm', 'rmdir', 'shred', 'mkfs', 'dd', 'truncate', 'chmod', 'chown', 'kill', 'pkill', 'killall']);

// A policy for classifying and gating operations (spec 15 §9, §15). It never
// widens policy and never treats repository content as authority.
export class DestructiveOperationPolicy {
  private readonly allowDestructive: boolean;
  private readonly extraDestructive: Set<string>;

  constructor(options: DestructiveOperationPolicyOptions = {}) {
    this.allowDestructive = options.allowDestructive ?? false;
    this.extraDestructive = new Set(options.extraDestructiveCommands ?? []);
  }

  classifyGit(args: string[]): OperationClass {
    const subcommand = args.find(token => !token.startsWith('-')) ?? '';
    // `branch` is read-only with no argument and a write with one.
    if (subcommand === 'branch') return args.filter(token => !token.startsWith('-')).length > 1 ? 'WORKSPACE_WRITE' : 'READ_ONLY';
    if (DESTRUCTIVE_GIT_SUBCOMMANDS.has(subcommand)) return 'DESTRUCTIVE';
    if (WRITE_GIT_SUBCOMMANDS.has(subcommand)) return 'WORKSPACE_WRITE';
    if (READ_GIT_SUBCOMMANDS.has(subcommand)) return 'READ_ONLY';
    return 'UNKNOWN';
  }

  classifyCommand(argv: string[]): OperationClass {
    const executable = (argv[0] ?? '').split('/').pop() ?? '';
    if (this.extraDestructive.has(executable) || DESTRUCTIVE_COMMANDS.has(executable)) return 'DESTRUCTIVE';
    return 'UNKNOWN';
  }

  // A decision is derived from the operation itself, not from who requested it.
  authorizeGit(args: string[]): OperationDecision {
    const operationClass = this.classifyGit(args);
    return this.decide(operationClass, `git ${args.join(' ')}`);
  }

  authorizeCommand(argv: string[]): OperationDecision {
    const operationClass = this.classifyCommand(argv);
    return this.decide(operationClass, `command ${argv[0] ?? '<empty>'}`);
  }

  private decide(operationClass: OperationClass, label: string): OperationDecision {
    if (operationClass === 'DESTRUCTIVE' && !this.allowDestructive) {
      return { operationClass, allowed: false, requiresApproval: true, reason: `${label} is destructive and denied by baseline policy` };
    }
    if (operationClass === 'UNKNOWN') {
      return { operationClass, allowed: false, requiresApproval: false, reason: `${label} is not a recognized safe operation` };
    }
    if (operationClass === 'DESTRUCTIVE') {
      return { operationClass, allowed: true, requiresApproval: true, reason: `${label} allowed only by explicit operator policy` };
    }
    return { operationClass, allowed: true, requiresApproval: false, reason: `${label} permitted as ${operationClass}` };
  }
}
