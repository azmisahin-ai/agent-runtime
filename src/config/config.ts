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
  tools: { maxOutputBytes: number };
  grantedCapabilities: ToolCapability[];
  allowProcessExecution: boolean;
  allowNetworkAccess: boolean;
  allowedCommands: string[];
  profile: string;
  policyVersion: number;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

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
    tools: { maxOutputBytes: Number(env.AGENT_RUNTIME_MAX_OUTPUT_BYTES ?? '262144') },
    grantedCapabilities: ['read_only', 'filesystem_read', 'git_access'],
    allowProcessExecution: allowProcess,
    allowNetworkAccess: allowNetwork,
    allowedCommands: (env.AGENT_RUNTIME_ALLOWED_COMMANDS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    profile: env.AGENT_RUNTIME_PROFILE ?? 'local-dev',
    policyVersion: 1
  };
}
