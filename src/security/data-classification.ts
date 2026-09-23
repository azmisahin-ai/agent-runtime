import { containsSecret } from './secret-redaction.js';

// Data classification (spec 15 §12). Every datum the runtime handles carries a
// label that decides whether it may be persisted, placed in context, logged or
// written as an evaluation artifact. Labels are ordered by increasing sensitivity
// so a stricter classification can never be downgraded silently.
export const DATA_CLASSIFICATIONS = ['PUBLIC', 'PROJECT', 'SENSITIVE', 'SECRET'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

const RANK: Record<DataClassification, number> = { PUBLIC: 0, PROJECT: 1, SENSITIVE: 2, SECRET: 3 };

// The single egress policy table. A channel either permits a classification or
// refuses it. SECRET is refused by every channel; SENSITIVE is local-only.
export interface EgressPolicy {
  persist: boolean;
  context: boolean;
  log: boolean;
  artifact: boolean;
}

const CHANNEL_POLICY: Record<DataClassification, EgressPolicy> = {
  // PUBLIC content may flow anywhere.
  PUBLIC: { persist: true, context: true, log: true, artifact: true },
  // PROJECT content is ordinary working data: diagnostics may carry it, but not
  // the SENSITIVE/SECRET surfaces.
  PROJECT: { persist: true, context: true, log: true, artifact: true },
  // SENSITIVE content is needed to do the work, so it may be placed in the
  // current attempt's model context, but it is not hoarded: it is never written
  // to durable memory, logs or artifacts.
  SENSITIVE: { persist: false, context: true, log: false, artifact: false },
  // SECRET content is a boundary: it is never persisted, never placed in context,
  // never logged and never written to an artifact.
  SECRET: { persist: false, context: false, log: false, artifact: false }
};

export function rankOf(classification: DataClassification): number {
  return RANK[classification];
}

// The most restrictive label wins when data of several classifications is merged
// (spec 15 §3: most restrictive policy wins).
export function mostRestrictive(...values: DataClassification[]): DataClassification {
  if (values.length === 0) return 'PUBLIC';
  return values.reduce((worst, value) => (RANK[value] > RANK[worst] ? value : worst), values[0]);
}

export function policyFor(classification: DataClassification): EgressPolicy {
  return { ...CHANNEL_POLICY[classification] };
}

// A classification is an assertion about content, not about trust in the caller.
// It is derived from the content itself so that a SECRET cannot be mislabelled as
// PUBLIC: any detectable secret forces SECRET, and sensitive-path/pattern matches
// force SENSITIVE. Only genuinely content-free assertions stay PUBLIC.
const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|[^A-Za-z0-9_])\.env(\.|$)/i,
  /(^|[^A-Za-z0-9_])\.ssh([/\\]|$)/i,
  /(^|[^A-Za-z0-9_])(credentials|secrets?)(\.|$)/i,
  /\bpassword\s*[:=]/i,
  /\b(private|secret)[_-]?key\b/i,
  /\bAuthorization:\s*Bearer\b/i
];

export function classifyData(input: { content?: string; path?: string | null; declared?: DataClassification | null }): DataClassification {
  const content = input.content ?? '';
  const path = input.path ?? '';

  // Content-derived evidence always outranks a declared label. A secret is SECRET
  // even if the caller declared PUBLIC.
  if (containsSecret(content) || containsSecret(path)) return 'SECRET';
  if (SENSITIVE_PATTERNS.some(pattern => pattern.test(path) || pattern.test(content))) return 'SENSITIVE';

  if (input.declared) return input.declared;
  // Untagged content is treated as project data, not public: the safe default is
  // to withhold it from diagnostic logs until something classifies it.
  return 'PROJECT';
}

export interface EgressDecision {
  classification: DataClassification;
  allowed: boolean;
  channel: keyof EgressPolicy;
  reason: string;
}

export function canEgress(channel: keyof EgressPolicy, classification: DataClassification): EgressDecision {
  const allowed = CHANNEL_POLICY[classification][channel];
  const reason = allowed
    ? `${classification} data is permitted in ${channel}`
    : `${classification} data must not enter ${channel}`;
  return { classification, allowed, channel, reason };
}

// Reusable guard. Throws rather than silently downgrading or dropping the datum,
// so a caller cannot believe it logged something it did not.
export function assertEgress(channel: keyof EgressPolicy, classification: DataClassification): void {
  const decision = canEgress(channel, classification);
  if (!decision.allowed) throw new Error(decision.reason);
}
