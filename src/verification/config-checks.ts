import type { VerificationCheck } from '../domain/types.js';
import type { VerificationCheckSpec } from '../config/config.js';
import type { CheckRunContext, VerifyInput } from './verification-engine.js';
import type { ToolEngine } from '../tools/tool-engine.js';
import { GitInspector } from '../git/git-inspector.js';

export interface ConfigCheckDeps {
  toolEngine: ToolEngine;
  workspaceRoot: string;
}

interface TerminalObservation {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

// `terminal.exec` returns a JSON observation so the exit code survives alongside the
// text. Anything else is an observation this runner cannot interpret, and an
// uninterpretable check is UNKNOWN, never PASS (spec 11 §1-3).
function parseObservation(raw: string | null): TerminalObservation | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalObservation>;
    if (typeof parsed.output !== 'string') return null;
    return {
      exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
      timedOut: parsed.timedOut === true,
      output: parsed.output
    };
  } catch {
    return null;
  }
}

function bounded(text: string, limit = 500): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...[truncated]`;
}

// A REPOSITORY check establishes its verdict from repository state rather than a
// command (spec 11 §2-3). It passes when the workspace carries a change relative to
// its committed baseline; an unchanged tree cannot demonstrate a change was made.
function runRepositoryCheck(deps: ConfigCheckDeps, context: CheckRunContext): { status: 'PASS' | 'FAIL' | 'UNKNOWN'; evidence: string } {
  const git = new GitInspector(deps.workspaceRoot);
  if (!git.isRepository()) return { status: 'UNKNOWN', evidence: 'workspace is not a git repository; repository state cannot be inspected' };
  try {
    const diff = git.run(['diff', '--name-only']);
    const changed = diff.split('\n').map(line => line.trim()).filter(Boolean);
    return changed.length > 0
      ? { status: 'PASS', evidence: `repository carries a change: ${bounded(changed.join(', '))}` }
      : { status: 'FAIL', evidence: 'repository is unchanged from its committed baseline' };
  } catch (error) {
    return { status: 'UNKNOWN', evidence: `repository state could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Every configured check runs through the Tool Engine, so its execution is
// validated, policy-checked and persisted as canonical evidence exactly like a
// model-requested tool (spec 10 §1, 11 §3). Verification never bypasses policy with
// a direct shell path.
function runCommandCheck(spec: VerificationCheckSpec, deps: ConfigCheckDeps, context: CheckRunContext): { status: 'PASS' | 'FAIL' | 'UNKNOWN'; evidence: string } {
  const result = deps.toolEngine.execute({
    requestId: `check_${spec.name}`,
    taskId: context.taskId,
    attemptId: context.attemptId,
    tool: 'terminal.exec',
    version: '1.0.0',
    arguments: { argv: spec.argv, ...(spec.cwd ? { cwd: spec.cwd } : {}) },
    timestamp: new Date().toISOString()
  });

  // A denied or failed tool run proves nothing about the task; it is UNKNOWN with
  // the reason, so an unauthorized check can never read as a passing one.
  if (result.status !== 'SUCCEEDED') {
    return { status: 'UNKNOWN', evidence: `check command did not run (${result.status}): ${bounded(result.error ?? 'no error reported')}` };
  }
  const observation = parseObservation(result.output);
  if (observation === null) return { status: 'UNKNOWN', evidence: `check command produced an unreadable observation: ${bounded(result.output ?? '')}` };
  if (observation.timedOut) return { status: 'UNKNOWN', evidence: `check command timed out: ${bounded(observation.output)}` };
  if (observation.exitCode === null) return { status: 'UNKNOWN', evidence: `check command did not report an exit code: ${bounded(observation.output)}` };
  return observation.exitCode === 0
    ? { status: 'PASS', evidence: `exit code 0: ${bounded(observation.output)}` }
    : { status: 'FAIL', evidence: `exit code ${observation.exitCode}: ${bounded(observation.output)}` };
}

// Turns the operator's declared checks into the runtime-owned check list for an
// attempt. These come from configuration, never from a client request (spec 11 §2,
// 15 §10).
export function checksFromConfig(specs: VerificationCheckSpec[], deps: ConfigCheckDeps): VerifyInput['checks'] {
  return specs.map(spec => ({
    name: spec.name,
    kind: spec.kind as VerificationCheck['kind'],
    run: (_agentClaim: string, context: CheckRunContext) => spec.kind === 'REPOSITORY'
      ? runRepositoryCheck(deps, context)
      : runCommandCheck(spec, deps, context)
  }));
}
