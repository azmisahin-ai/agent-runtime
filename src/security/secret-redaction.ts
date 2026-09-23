// Secret redaction (spec 03 §4/§11, 15 §7, 17 §5).
// A conservative detector: high-precision patterns for credentials that must
// never enter memory, context, logs or telemetry. Redaction is irreversible.

const REDACTED = '[REDACTED]';

interface Pattern {
  name: string;
  regex: RegExp;
}

// High-precision patterns. Order matters: specific token shapes before generic
// key/value assignments so a token is redacted by its most specific rule.
const PATTERNS: Pattern[] = [
  { name: 'private_key_block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'github_token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: 'openai_key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'aws_access_key', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'slack_token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google_api_key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'basic_auth_url', regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/gi },
  // Generic secret assignment: KEY=value or "key": "value" for secret-named keys.
  { name: 'secret_assignment', regex: /(["']?)([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)\1(\s*[:=]\s*)(["']?)([^\s"',;}]{4,})\4/gi }
];

export interface RedactionReport {
  text: string;
  redacted: boolean;
  counts: Record<string, number>;
}

export function redactSecrets(input: string): RedactionReport {
  let text = input;
  const counts: Record<string, number> = {};
  for (const pattern of PATTERNS) {
    text = text.replace(pattern.regex, (...args) => {
      counts[pattern.name] = (counts[pattern.name] ?? 0) + 1;
      if (pattern.name === 'secret_assignment') {
        const quote = args[1] as string;
        const key = args[2] as string;
        const separator = args[3] as string;
        return `${quote}${key}${quote}${separator}${REDACTED}`;
      }
      if (pattern.name === 'basic_auth_url') {
        const match = args[0] as string;
        return match.replace(/\/\/[^/\s:@]+:[^/\s:@]+@/, `//${REDACTED}@`);
      }
      return REDACTED;
    });
  }
  return { text, redacted: Object.keys(counts).length > 0, counts };
}

// True when the text contains any detectable secret. Used by the memory
// persistence gate and telemetry sanitizers.
export function containsSecret(input: string): boolean {
  return redactSecrets(input).redacted;
}

export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value).text as unknown as T;
  if (Array.isArray(value)) return value.map(item => redactValue(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) output[key] = redactValue(child);
    return output as unknown as T;
  }
  return value;
}
