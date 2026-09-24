import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EvaluationTaskDefinition } from './suite.js';

export interface SuiteCheck {
  name: string;
  kind: 'TEST' | 'BUILD' | 'LINT' | 'TYPECHECK' | 'INVARIANT' | 'CUSTOM';
  run: (agentClaim: string) => { status: 'PASS' | 'FAIL' | 'UNKNOWN'; evidence: string };
}

// Maps each suite task pack to a check that actually exercises its declared
// `verificationIntent`, so a benchmark run scores the task's intent instead of a
// single mechanics invariant. Every check reads the agent's own response and the
// workspace it was given; a check that cannot decide returns UNKNOWN, which is
// never PASS (spec 11 §1-3). REPOSITORY diff checks are handled separately by the
// runner's baseline/observed evidence, so those packs assert claim-only here.
export function checksForSuiteTask(definition: EvaluationTaskDefinition, workspaceRoot: string): SuiteCheck[] {
  const read = (relative: string): string | null => {
    try { return readFileSync(resolve(workspaceRoot, relative), 'utf8'); } catch { return null; }
  };
  const claim = (agentClaim: string) => agentClaim ?? '';
  const check = (name: string, kind: SuiteCheck['kind'], run: SuiteCheck['run']): SuiteCheck => ({ name, kind, run });

  switch (definition.taskPackId) {
    // Repository analysis: the answer must actually name a repository artifact.
    case 'repo-analyze-modules':
      return [check('answer_names_module_file', 'INVARIANT', agent => {
        const text = claim(agent);
        if (text.length === 0) return { status: 'UNKNOWN', evidence: 'no agent answer to inspect' };
        return text.includes('math.js') || text.includes('parse.js') || /\.(js|ts)\b/.test(text)
          ? { status: 'PASS', evidence: 'module file cited in the answer' }
          : { status: 'FAIL', evidence: 'answer cited no module file' };
      })];
    case 'repo-analyze-entrypoints':
      return [check('answer_names_entrypoint', 'INVARIANT', agent => {
        const text = claim(agent);
        if (text.length === 0) return { status: 'UNKNOWN', evidence: 'no agent answer to inspect' };
        return text.includes('package.json') || text.includes('main') || text.includes('index')
          ? { status: 'PASS', evidence: 'entry point referenced in the answer' }
          : { status: 'FAIL', evidence: 'no entry point referenced' };
      })];
    case 'repo-analyze-tests':
      return [check('answer_mentions_tests', 'INVARIANT', agent => /test|spec/i.test(claim(agent))
        ? { status: 'PASS', evidence: 'test surface mentioned' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'no test surface mentioned' })];
    case 'repo-analyze-config':
      return [check('answer_names_config_key', 'INVARIANT', agent => {
        const text = claim(agent);
        if (text.length === 0) return { status: 'UNKNOWN', evidence: 'no agent answer to inspect' };
        return /AGENT_RUNTIME_[A-Z_]+|config|environment/i.test(text)
          ? { status: 'PASS', evidence: 'configuration surface described' }
          : { status: 'FAIL', evidence: 'no configuration surface described' };
      })];
    case 'repo-analyze-hotspots':
      return [check('answer_mentions_history', 'INVARIANT', agent => /git|histor|commit|change frequency|hotspot/i.test(claim(agent))
        ? { status: 'PASS', evidence: 'change-history source referenced' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'change-history source not referenced' })];

    // Bug fixes: the fix must exist in the file the task targets.
    case 'bug-fix-off-by-one':
      return [check('math_helper_bounds_correct', 'TEST', () => {
        const source = read('src/math.js');
        if (source === null) return { status: 'UNKNOWN', evidence: 'src/math.js not present to inspect' };
        const body = source.slice(source.indexOf('function add'), source.indexOf('module.exports'));
        // The seed returns a + b + 1; only an exact sum proves the off-by-one is gone.
        return /return\s+a\s*\+\s*b\s*;/.test(body)
          ? { status: 'PASS', evidence: 'add() returns exactly a + b' }
          : { status: 'FAIL', evidence: 'add() still returns an off-by-one result' };
      })];
    case 'bug-fix-null-deref':
      return [check('parse_handles_missing_input', 'TEST', () => {
        const source = read('src/parse.js');
        if (source === null) return { status: 'UNKNOWN', evidence: 'src/parse.js not present to inspect' };
        return /if\s*\(\s*text\s*==\s*null|text\s*\?\?|\?\?|typeof\s+text|==\s*null|===\s*null/.test(source)
          ? { status: 'PASS', evidence: 'parse() guards against a missing value' }
          : { status: 'FAIL', evidence: 'parse() dereferences its input without a guard' };
      })];
    case 'bug-fix-retry-leak':
      return [check('retry_closes_resources', 'TEST', () => {
        const source = read('src/retry.js');
        if (source === null) return { status: 'UNKNOWN', evidence: 'src/retry.js not present to inspect' };
        // The seed never releases anything on the retry path.
        return /finally|close\(|release\(/.test(source)
          ? { status: 'PASS', evidence: 'resource release path present on the retry loop' }
          : { status: 'FAIL', evidence: 'retry loop still leaks resources' };
      })];
    case 'bug-fix-state-race':
      return [check('terminal_state_guard_present', 'TEST', () => {
        const source = read('src/state.js');
        if (source === null) return { status: 'UNKNOWN', evidence: 'src/state.js not present to inspect' };
        // The seed returns any next state; only an explicit guard that consults a
        // terminal set before returning proves the race is closed.
        return /if\s*\([^)]*(TERMINAL|terminal|COMPLETED|FAILED)/.test(source)
          ? { status: 'PASS', evidence: 'terminal-state guard present' }
          : { status: 'FAIL', evidence: 'transition() still allows every next state' };
      })];
    case 'bug-fix-parser':
      return [check('parser_handles_nested_delimiter', 'TEST', () => {
        const source = read('src/parse.js');
        if (source === null) return { status: 'UNKNOWN', evidence: 'src/parse.js not present to inspect' };
        return /depth|nested|[^.]for\s*\(|[^.]while\s*\(/.test(source)
          ? { status: 'PASS', evidence: 'parse() walks the input rather than a bare split' }
          : { status: 'FAIL', evidence: 'parse() still splits without handling nesting' };
      })];

    // Test fixes: the claim must describe a fix and not a deletion.
    case 'test-fix-flaky':
    case 'test-fix-assertion':
    case 'test-fix-fixture':
    case 'test-fix-mock':
    case 'test-fix-broken-import':
      return [check('claim_describes_a_fix', 'INVARIANT', agent => {
        const text = claim(agent);
        if (text.length === 0) return { status: 'UNKNOWN', evidence: 'no agent answer to inspect' };
        if (/deleted the test|removed the test|skipped the test/i.test(text)) return { status: 'FAIL', evidence: 'fix removed coverage instead of repairing it' };
        return /fix|repair|assert|import|fixture|stub|deterministic/i.test(text)
          ? { status: 'PASS', evidence: 'answer describes a repair' }
          : { status: 'FAIL', evidence: 'answer does not describe a repair' };
      })];

    // Features: the claim must describe the added surface, with a safe default.
    case 'feature-endpoint':
      return [check('claim_adds_endpoint', 'INVARIANT', agent => /endpoint|route|GET|handler/i.test(claim(agent)) && claim(agent).length > 0
        ? { status: 'PASS', evidence: 'answer describes an endpoint' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'answer describes no endpoint' })];
    case 'feature-config-flag':
      return [check('claim_has_safe_default', 'INVARIANT', agent => {
        const text = claim(agent);
        if (text.length === 0) return { status: 'UNKNOWN', evidence: 'no agent answer to inspect' };
        return /default|off|false|disabled|restrictive/i.test(text)
          ? { status: 'PASS', evidence: 'answer states a restrictive default' }
          : { status: 'FAIL', evidence: 'answer states no safe default' };
      })];
    case 'feature-metric':
      return [check('claim_adds_metric', 'INVARIANT', agent => /metric|counter|increment/i.test(claim(agent)) && claim(agent).length > 0
        ? { status: 'PASS', evidence: 'answer describes a metric' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'answer describes no metric' })];
    case 'feature-cli-subcommand':
      return [check('claim_adds_subcommand', 'INVARIANT', agent => /subcommand|command|arg|flag/i.test(claim(agent)) && claim(agent).length > 0
        ? { status: 'PASS', evidence: 'answer describes a subcommand' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'answer describes no subcommand' })];
    case 'feature-doc':
      return [check('claim_documents_workflow', 'INVARIANT', agent => /recovery|resume|checkpoint|workflow/i.test(claim(agent)) && claim(agent).length > 0
        ? { status: 'PASS', evidence: 'answer documents the recovery workflow' }
        : claim(agent).length === 0 ? { status: 'UNKNOWN', evidence: 'no agent answer to inspect' } : { status: 'FAIL', evidence: 'answer documents no workflow' })];

    default:
      // An intent with no host implementation must not be silently scored as a
      // pass; it is UNKNOWN and the run is reported as unscored.
      return [check(`unimplemented_intent:${definition.verificationIntent}`, 'INVARIANT', () => ({
        status: 'UNKNOWN', evidence: `no host check implements verificationIntent ${definition.verificationIntent}`
      }))];
  }
}
