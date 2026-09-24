import { resolve } from 'node:path';
import type { ToolCapability, VerificationCheck } from '../domain/types.js';

// An operator-declared verification check (spec 11 §2). The runtime, not the
// client, decides what proves success, so these come from configuration only:
// no API request may supply an executable check (spec 11 §2, 15 §10).
export interface VerificationCheckSpec {
  name: string;
  kind: VerificationCheck['kind'];
  // Structured argv, run through the Tool Engine. Absent for a REPOSITORY check,
  // which derives its verdict from repository evidence instead of a command.
  argv?: string[];
  cwd?: string;
}

export interface RuntimeConfig {
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRecoveryAttempts: number;
  networkAccess: 'DENY' | 'ALLOW';
  workspaceRoot: string;
  backend: { baseUrl: string; model: string; requestTimeoutMs: number };
  context: { modelContextLimit: number; reservedOutputTokens: number; toolSchemaTokens: number; safetyMarginTokens: number };
  tools: { maxOutputBytes: number; commandTimeoutMs: number; maxToolIterations: number };
  // Backend selection (spec 05 §7): 'ollama' is the default model server; 'cli'
  // launches a subordinate external CLI agent through the sandbox.
  backendKind: 'ollama' | 'cli';
  cli: { command: string | null; args: string[] };
  grantedCapabilities: ToolCapability[];
  allowProcessExecution: boolean;
  allowNetworkAccess: boolean;
  allowDestructiveOperations: boolean;
  allowedCommands: string[];
  verification: { checks: VerificationCheckSpec[] };
  profile: string;
  policyVersion: number;
  api: { port: number; host: string; token: string | null; queueDrainIntervalMs: number };
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const VALID_CAPABILITIES: ToolCapability[] = ['read_only', 'filesystem_read', 'filesystem_write', 'process_execute', 'network_access', 'git_access'];
const VALID_CHECK_KINDS: VerificationCheck['kind'][] = ['TEST', 'BUILD', 'LINT', 'TYPECHECK', 'INVARIANT', 'REPOSITORY', 'CUSTOM'];

// Verification checks are operator-declared, so an unusable declaration is a hard
// startup error rather than a check that silently never runs (spec 11 §2). A check
// with no way to run would otherwise be a green light that verifies nothing.
function parseVerificationChecks(env: Record<string, string | undefined>): VerificationCheckSpec[] {
  const raw = env.AGENT_RUNTIME_VERIFICATION_CHECKS;
  if (!raw || raw.trim().length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`AGENT_RUNTIME_VERIFICATION_CHECKS must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('AGENT_RUNTIME_VERIFICATION_CHECKS must be a JSON array of checks');

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`verification check #${index} must be an object`);
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== 'string' || name.length === 0) throw new Error(`verification check #${index} requires a non-empty name`);
    const kind = record.kind;
    if (typeof kind !== 'string' || !VALID_CHECK_KINDS.includes(kind as VerificationCheck['kind'])) {
      throw new Error(`verification check ${name} has an invalid kind: ${String(kind)}`);
    }
    const argv = record.argv;
    if (argv !== undefined) {
      if (!Array.isArray(argv) || argv.length === 0 || argv.some(token => typeof token !== 'string' || token.length === 0)) {
        throw new Error(`verification check ${name} has an invalid argv: expected a non-empty array of strings`);
      }
    }
    // A REPOSITORY check reads repository evidence; every other kind must declare how
    // it runs, or it could never produce a verdict.
    if (kind !== 'REPOSITORY' && argv === undefined) {
      throw new Error(`verification check ${name} of kind ${kind} requires an argv`);
    }
    const cwd = record.cwd;
    if (cwd !== undefined && typeof cwd !== 'string') throw new Error(`verification check ${name} has an invalid cwd`);
    return { name, kind: kind as VerificationCheck['kind'], argv: argv as string[] | undefined, cwd: cwd as string | undefined };
  });
}

// Baseline grants. filesystem_write/process_execute/network_access are NOT
// granted here: they must be explicitly requested and are gated further by the
// dedicated flags below (spec 15 §3, §8).
const BASELINE_CAPABILITIES: ToolCapability[] = ['read_only', 'filesystem_read', 'git_access'];

function parseCapabilities(env: Record<string, string | undefined>): ToolCapability[] {
  const raw = env.AGENT_RUNTIME_GRANTED_CAPABILITIES;
  const requested = raw ? raw.split(',').map(token => token.trim()).filter(Boolean) as ToolCapability[] : [];
  for (const capability of requested) {
    if (!VALID_CAPABILITIES.includes(capability)) throw new Error(`Unknown capability: ${capability}`);
    // process_execute and network_access still require their dedicated flags.
    if (capability === 'process_execute' && env.AGENT_RUNTIME_ALLOW_PROCESS !== 'true') {
      throw new Error('process_execute requires AGENT_RUNTIME_ALLOW_PROCESS=true');
    }
    if (capability === 'network_access' && env.AGENT_RUNTIME_ALLOW_NETWORK !== 'true') {
      throw new Error('network_access requires AGENT_RUNTIME_ALLOW_NETWORK=true');
    }
  }
  const granted = new Set<ToolCapability>([...BASELINE_CAPABILITIES, ...requested]);
  // The dedicated flags are the explicit widening decision; honoring them here
  // keeps the capability set and the policy flags consistent (spec 15 §3, §8).
  if (env.AGENT_RUNTIME_ALLOW_PROCESS === 'true') granted.add('process_execute');
  if (env.AGENT_RUNTIME_ALLOW_NETWORK === 'true') granted.add('network_access');
  return [...granted];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const level = env.AGENT_RUNTIME_LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(level)) throw new Error(`Invalid log level: ${level}`);
  const attempts = Number(env.AGENT_RUNTIME_MAX_RECOVERY_ATTEMPTS ?? '3');
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 20) throw new Error('Invalid max recovery attempts');
  // The tool loop is bounded: an agent that never emits FINAL must not spin forever
  // (spec 14 §3 step 11). An operator can raise the bound but not remove it.
  const toolIterations = Number(env.AGENT_RUNTIME_MAX_TOOL_ITERATIONS ?? '10');
  if (!Number.isInteger(toolIterations) || toolIterations < 1 || toolIterations > 100) throw new Error('Invalid max tool iterations');
  const allowNetwork = env.AGENT_RUNTIME_ALLOW_NETWORK === 'true';
  const allowProcess = env.AGENT_RUNTIME_ALLOW_PROCESS === 'true';
  return {
    dbPath: resolve(env.AGENT_RUNTIME_DB_PATH ?? '.runtime/runtime.db'),
    logLevel: level as RuntimeConfig['logLevel'],
    maxRecoveryAttempts: attempts,
    // Network is DENY by default and cannot be widened by repository content (spec 15 §8).
    networkAccess: allowNetwork ? 'ALLOW' : 'DENY',
    workspaceRoot: resolve(env.AGENT_RUNTIME_WORKSPACE ?? process.cwd()),
    backend: {
      baseUrl: env.AGENT_RUNTIME_OLLAMA_URL ?? 'http://127.0.0.1:11434',
      model: env.AGENT_RUNTIME_MODEL ?? 'qwen2.5-coder:7b',
      requestTimeoutMs: Number(env.AGENT_RUNTIME_REQUEST_TIMEOUT_MS ?? '120000')
    },
    context: {
      modelContextLimit: Number(env.AGENT_RUNTIME_CONTEXT_LIMIT ?? '8192'),
      reservedOutputTokens: Number(env.AGENT_RUNTIME_RESERVED_OUTPUT ?? '1024'),
      toolSchemaTokens: Number(env.AGENT_RUNTIME_TOOL_SCHEMA_TOKENS ?? '0'),
      safetyMarginTokens: Number(env.AGENT_RUNTIME_CONTEXT_SAFETY ?? '1024')
    },
    tools: { maxOutputBytes: Number(env.AGENT_RUNTIME_MAX_OUTPUT_BYTES ?? '262144'), commandTimeoutMs: Number(env.AGENT_RUNTIME_COMMAND_TIMEOUT_MS ?? '30000'), maxToolIterations: toolIterations },
    backendKind: (env.AGENT_RUNTIME_BACKEND ?? 'ollama') === 'cli' ? 'cli' : 'ollama',
    cli: {
      // A CLI agent is an explicit operator choice; there is no default binary.
      command: env.AGENT_RUNTIME_CLI_COMMAND && env.AGENT_RUNTIME_CLI_COMMAND.length > 0 ? env.AGENT_RUNTIME_CLI_COMMAND : null,
      args: (env.AGENT_RUNTIME_CLI_ARGS ?? '').split(' ').map(s => s.trim()).filter(Boolean)
    },
    grantedCapabilities: parseCapabilities(env),
    allowProcessExecution: allowProcess,
    allowNetworkAccess: allowNetwork,
    // Destructive operations are denied by default and require an explicit
    // operator opt-in (spec 15 §9).
    allowDestructiveOperations: env.AGENT_RUNTIME_ALLOW_DESTRUCTIVE === 'true',
    allowedCommands: (env.AGENT_RUNTIME_ALLOWED_COMMANDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    verification: { checks: parseVerificationChecks(env) },
    profile: env.AGENT_RUNTIME_PROFILE ?? 'local-dev',
    policyVersion: 1,
    api: {
      port: Number(env.AGENT_RUNTIME_API_PORT ?? '8787'),
      host: env.AGENT_RUNTIME_API_HOST ?? '127.0.0.1',
      // No default token: mutations stay disabled until an operator provides one.
      token: env.AGENT_RUNTIME_API_TOKEN && env.AGENT_RUNTIME_API_TOKEN.length > 0 ? env.AGENT_RUNTIME_API_TOKEN : null,
      // The queue drainer is off unless the operator enables it; a runtime that
      // silently started executing queued work would be a surprising side effect.
      queueDrainIntervalMs: Number(env.AGENT_RUNTIME_QUEUE_DRAIN_MS ?? '0')
    }
  };
}
