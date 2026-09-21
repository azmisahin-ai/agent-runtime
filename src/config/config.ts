import { resolve } from 'node:path';

export interface RuntimeConfig {
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRecoveryAttempts: number;
  networkAccess: 'DENY';
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const level = env.AGENT_RUNTIME_LOG_LEVEL ?? 'info';
  if (!['debug','info','warn','error'].includes(level)) throw new Error(`Invalid log level: ${level}`);
  const attempts = Number(env.AGENT_RUNTIME_MAX_RECOVERY_ATTEMPTS ?? '3');
  if (!Number.isInteger(attempts) || attempts < 0 || attempts > 20) throw new Error('Invalid max recovery attempts');
  return {
    dbPath: resolve(env.AGENT_RUNTIME_DB_PATH ?? '.runtime/runtime.db'),
    logLevel: level as RuntimeConfig['logLevel'],
    maxRecoveryAttempts: attempts,
    networkAccess: 'DENY'
  };
}
