import type { ToolCapability } from '../domain/types.js';

// External-agent trust boundary (spec 05 §8, 15 §11).
//
// ACP/CLI/native agents may bring their own tools and capabilities. The runtime
// must document whether each tool is runtime-owned or externally-owned, and an
// external capability may never silently expand runtime policy. This module is the
// single place that decides that boundary; it does not ship a transport, so no
// external agent can reach execution without an operator registering it here and
// building an adapter on top of `AgentBackend`.

// Capabilities the runtime itself mediates. An external agent that claims one of
// these does not thereby obtain it: the runtime tool engine still gates the call.
export const RUNTIME_OWNED_CAPABILITIES: ToolCapability[] = [
  'read_only', 'filesystem_read', 'filesystem_write', 'process_execute', 'network_access', 'git_access'
];

export type ToolOwnership = 'RUNTIME' | 'EXTERNAL';

export interface ExternalAgentTool {
  name: string;
  ownership: ToolOwnership;
  capabilities: ToolCapability[];
}

export interface ExternalAgentProfile {
  agentId: string;
  kind: 'ACP' | 'CLI' | 'NATIVE';
  // What the external agent claims it can do. Treated as an untrusted declaration.
  declaredCapabilities: ToolCapability[];
  tools: ExternalAgentTool[];
}

export interface CapabilityDecision {
  capability: ToolCapability;
  allowed: boolean;
  reason: string;
  // True when the external agent declared the capability but the runtime did not
  // grant it. Such a request is denied, never widened (spec 15 §11).
  declaredButNotGranted: boolean;
}

export interface ExternalAgentBoundary {
  agentId: string;
  kind: ExternalAgentProfile['kind'];
  effectiveCapabilities: ToolCapability[];
  denied: CapabilityDecision[];
  tools: Array<ExternalAgentTool & { callable: boolean; reason: string }>;
}

export interface ResolveBoundaryInput {
  profile: ExternalAgentProfile;
  // The operator's runtime-granted capabilities. This is the ceiling.
  runtimeGranted: ToolCapability[];
}

// Effective capability is the intersection of what the runtime grants and what the
// external agent declares. Nothing the external agent declares can raise the
// ceiling; anything it declares beyond the grant is surfaced as a denial so the
// decision is auditable rather than silent.
export function resolveExternalBoundary(input: ResolveBoundaryInput): ExternalAgentBoundary {
  const granted = new Set(input.runtimeGranted);
  const declared = new Set(input.profile.declaredCapabilities);

  const effective: ToolCapability[] = [];
  const denied: CapabilityDecision[] = [];
  for (const capability of RUNTIME_OWNED_CAPABILITIES) {
    const isGranted = granted.has(capability);
    const isDeclared = declared.has(capability);
    if (isGranted && isDeclared) {
      effective.push(capability);
      continue;
    }
    if (isDeclared && !isGranted) {
      denied.push({
        capability, allowed: false, declaredButNotGranted: true,
        reason: `external agent declares ${capability} but the runtime grants it to no one`
      });
    }
  }

  // An externally-owned tool is callable only when every capability it needs is
  // inside the effective set; otherwise the runtime would be executing external
  // authority (spec 15 §11).
  const tools = input.profile.tools.map(tool => {
    const missing = tool.capabilities.filter(c => !effective.includes(c));
    if (missing.length > 0) {
      return { ...tool, callable: false, reason: `${tool.ownership}-owned tool ${tool.name} requires capabilities outside the grant: ${missing.join(', ')}` };
    }
    return { ...tool, callable: true, reason: `${tool.ownership}-owned tool within the effective grant` };
  });

  return {
    agentId: input.profile.agentId,
    kind: input.profile.kind,
    effectiveCapabilities: effective,
    denied,
    tools
  };
}

// External session ids are mapped to Task/Attempt ids for correlation, but they are
// never runtime authority (spec 05 §8). A backend that cannot resume is replaced by
// a new backend session while durable Task continuity is preserved.
export interface ExternalSessionMapping {
  externalSessionId: string;
  taskId: string;
  attemptId: string;
  resumeSupported: boolean;
}

export class ExternalSessionRegistry {
  private readonly byExternal = new Map<string, ExternalSessionMapping>();
  private readonly byAttempt = new Map<string, ExternalSessionMapping>();

  map(mapping: ExternalSessionMapping): void {
    this.byExternal.set(mapping.externalSessionId, mapping);
    this.byAttempt.set(mapping.attemptId, mapping);
  }

  // Resolution is correlation only; callers must not treat the external session as
  // proof that an Attempt succeeded.
  resolve(externalSessionId: string): ExternalSessionMapping | null {
    return this.byExternal.get(externalSessionId) ?? null;
  }

  forAttempt(attemptId: string): ExternalSessionMapping | null {
    return this.byAttempt.get(attemptId) ?? null;
  }

  // When an external session cannot resume, the runtime keeps the Attempt and
  // signals that a fresh backend session must be started instead (spec 05 §8).
  resumeOrReplace(attemptId: string): { resumable: boolean; reason: string } {
    const mapping = this.byAttempt.get(attemptId);
    if (!mapping) return { resumable: false, reason: 'no external session is mapped to this attempt' };
    if (!mapping.resumeSupported) return { resumable: false, reason: 'external backend cannot resume; start a new backend session with the same durable attempt' };
    return { resumable: true, reason: 'external session can resume within the same attempt' };
  }
}

// Documentation helper: the ownership table an operator can inspect to know which
// tools are mediated by the runtime and which belong to an external agent.
export function ownershipTable(profile: ExternalAgentProfile): Record<string, ToolOwnership> {
  const table: Record<string, ToolOwnership> = {};
  for (const tool of profile.tools) table[tool.name] = tool.ownership;
  return table;
}
