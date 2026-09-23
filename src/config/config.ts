import { resolve } from 'node:path';
import type { ToolCapability } from '../domain/types.js';

export interface RuntimeConfig {
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRecoveryAttempts: number;
  networkAccess: 'DENY' | 'ALLOW';
  workspaceRoot: string;
  backend: { baseUrl: string; model: string; requestTimeoutMs: number };
  context: { modelContextLimit: number; reservedOutputTokens: number; toolSchemaTokens: number; safetyMarginTokens: number };
  tools: { maxOutputBytes: number; commandTimeoutMs: number };
  grantedCapabilities: ToolCapability[];
  allowProcessExecution: boolean;
  allowNetworkAccess: boolean;
  allowedCommands: string[];
  profile: string;
  policyVersion: number;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const VALID_CAPABILITIES: ToolCapability[] = ['read_only', 'filesystem_read', 'filesystem_write', 'process_execute', 'network_access', 'git_access'];

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
    tools: { maxOutputBytes: Number(env.AGENT_RUNTIME_MAX_OUTPUT_BYTES ?? '262144'), commandTimeoutMs: Number(env.AGENT_RUNTIME_COMMAND_TIMEOUT_MS ?? '30000') },
    grantedCapabilities: parseCapabilities(env),
    allowProcessExecution: allowProcess,
    allowNetworkAccess: allowNetwork,
    allowedCommands: (env.AGENT_RUNTIME_ALLOWED_COMMANDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    profile: env.AGENT_RUNTIME_PROFILE ?? 'local-dev',
    policyVersion: 1
  };
}
