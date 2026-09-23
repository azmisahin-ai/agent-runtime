import type { PermissionLevel, ToolCapability } from '../domain/types.js';

export interface PolicyRequestContext {
  toolName: string;
  capabilities: ToolCapability[];
  permission: PermissionLevel;
}

export interface ResolvedPolicy {
  allowed: boolean;
  permission: PermissionLevel;
  reason: string;
}

export interface PolicyOptions {
  // Baseline is DENY (spec 15 §3). Capabilities must be explicitly granted.
  grantedCapabilities?: ToolCapability[];
  allowProcessExecution?: boolean;
  allowNetworkAccess?: boolean;
  allowedCommands?: string[];
}

const PERMISSION_ORDER: PermissionLevel[] = ['READ_ONLY', 'WORKSPACE_WRITE', 'PROCESS_EXECUTION', 'NETWORK_ACCESS', 'ADMIN'];

// Most restrictive applicable rule wins (spec 15 §3). Repository/model output can
// never widen this decision.
export class PolicyEngine {
  private readonly granted: Set<ToolCapability>;
  private readonly allowProcess: boolean;
  private readonly allowNetwork: boolean;
  private readonly allowedCommands: Set<string>;

  constructor(options: PolicyOptions = {}) {
    this.granted = new Set(options.grantedCapabilities ?? ['read_only', 'filesystem_read', 'git_access']);
    this.allowProcess = options.allowProcessExecution ?? false;
    this.allowNetwork = options.allowNetworkAccess ?? false;
    this.allowedCommands = new Set(options.allowedCommands ?? []);
  }

  evaluate(context: PolicyRequestContext): ResolvedPolicy {
    for (const capability of context.capabilities) {
      if (capability === 'network_access' && !this.allowNetwork) {
        return { allowed: false, permission: context.permission, reason: 'network_access is denied by baseline policy' };
      }
      if (capability === 'process_execute' && !this.allowProcess) {
        return { allowed: false, permission: context.permission, reason: 'process_execute is denied by baseline policy' };
      }
      if (!this.granted.has(capability)) {
        return { allowed: false, permission: context.permission, reason: `capability not granted: ${capability}` };
      }
    }
    if (context.permission === 'PROCESS_EXECUTION' && !this.allowProcess) {
      return { allowed: false, permission: context.permission, reason: 'PROCESS_EXECUTION permission denied by baseline policy' };
    }
    return { allowed: true, permission: context.permission, reason: 'granted by policy' };
  }

  // Structured argv (spec 10 §6): the executable must be explicitly allowlisted.
  authorizeCommand(argv: string[]): ResolvedPolicy {
    if (!this.allowProcess) {
      return { allowed: false, permission: 'PROCESS_EXECUTION', reason: 'process execution disabled by baseline policy' };
    }
    const executable = argv[0];
    if (!executable || !this.allowedCommands.has(executable)) {
      return { allowed: false, permission: 'PROCESS_EXECUTION', reason: `command not allowlisted: ${executable ?? '<empty>'}` };
    }
    return { allowed: true, permission: 'PROCESS_EXECUTION', reason: 'command allowlisted' };
  }

  static strongest(left: PermissionLevel, right: PermissionLevel): PermissionLevel {
    return PERMISSION_ORDER.indexOf(left) >= PERMISSION_ORDER.indexOf(right) ? left : right;
  }
}
