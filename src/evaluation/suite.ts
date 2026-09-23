// Initial evaluation suite: 20 tasks across four categories (spec 06 §6).
// Each task records expected behavior, verification intent, constraints and
// isolation requirements. These are metadata definitions; execution is driven by
// the runtime's VerificationRunner so results stay independent of the definition.

export type EvaluationCategory = 'REPOSITORY_ANALYSIS' | 'BUG_FIX' | 'TEST_FIX' | 'FEATURE';

export interface EvaluationTaskDefinition {
  taskPackId: string;
  category: EvaluationCategory;
  title: string;
  description: string;
  expectedBehavior: string;
  verificationIntent: string;
  constraints: string[];
  repositoryRevision: string | null;
  isolation: { workspace: 'EPHEMERAL_COPY'; network: 'DENY'; allowProcessExecution: boolean };
}

export interface EvaluationSuite {
  suiteId: string;
  version: string;
  tasks: EvaluationTaskDefinition[];
}

const isolation = (allowProcessExecution: boolean) => ({ workspace: 'EPHEMERAL_COPY' as const, network: 'DENY' as const, allowProcessExecution });

function taskPack(packId: string, category: EvaluationCategory, title: string, description: string, expectedBehavior: string, verificationIntent: string, constraints: string[] = []): EvaluationTaskDefinition {
  return { taskPackId: packId, category, title, description, expectedBehavior, verificationIntent, constraints, repositoryRevision: null, isolation: isolation(true) };
}

export const INITIAL_SUITE: EvaluationSuite = {
  suiteId: 'initial-v0.1',
  version: '1.0.0',
  tasks: [
    // 5 repository analysis
    taskPack('repo-analyze-modules', 'REPOSITORY_ANALYSIS', 'Map module boundaries', 'Identify the top-level modules and their dependencies.', 'A structured summary of modules and edges.', 'REPOSITORY_SNAPSHOT_MATCHES', ['read-only', 'no workspace mutation']),
    taskPack('repo-analyze-entrypoints', 'REPOSITORY_ANALYSIS', 'Locate entry points', 'Find executable entry points and how they bootstrap.', 'Entry points listed with file references.', 'FILES_CITED_EXIST', ['read-only']),
    taskPack('repo-analyze-tests', 'REPOSITORY_ANALYSIS', 'Inventory tests', 'List test suites and what they cover.', 'Test inventory with target mapping.', 'INVENTORY_NONEMPTY', ['read-only']),
    taskPack('repo-analyze-config', 'REPOSITORY_ANALYSIS', 'Explain configuration surface', 'Describe environment-driven configuration knobs.', 'Configuration keys and defaults documented.', 'CONFIG_KEYS_MATCH_SOURCE', ['read-only']),
    taskPack('repo-analyze-hotspots', 'REPOSITORY_ANALYSIS', 'Find change hotspots', 'Identify files with the highest change frequency.', 'Ranked hotspots from git history.', 'GIT_HISTORY_CONSISTENT', ['read-only']),
    // 5 bug fixes
    taskPack('bug-fix-off-by-one', 'BUG_FIX', 'Fix boundary off-by-one', 'Reproduce and fix an off-by-one in a range helper.', 'The failing assertion passes and no behavior regresses.', 'TARGETED_TEST_PASSES', ['no policy change']),
    taskPack('bug-fix-null-deref', 'BUG_FIX', 'Fix null dereference', 'Handle a missing optional value without crashing.', 'The crash path returns a typed error instead.', 'REGRESSION_TEST_PASSES', ['no policy change']),
    taskPack('bug-fix-retry-leak', 'BUG_FIX', 'Fix retry resource leak', 'Close resources on every retry path.', 'No leaked handles after retries.', 'RESOURCE_CHECK_PASSES', []),
    taskPack('bug-fix-state-race', 'BUG_FIX', 'Fix state transition race', 'Prevent an invalid terminal transition.', 'Terminal states cannot return to RUNNING.', 'STATE_MACHINE_TEST_PASSES', ['no policy change']),
    taskPack('bug-fix-parser', 'BUG_FIX', 'Fix parser misparse', 'Correct handling of a nested delimiter.', 'Parser returns the correct tree.', 'PARSER_TEST_PASSES', []),
    // 5 test fixes
    taskPack('test-fix-flaky', 'TEST_FIX', 'De-flake timing test', 'Remove a time-dependent assertion without weakening coverage.', 'The test passes deterministically.', 'TEST_PASSES_N_TIMES', ['coverage not reduced']),
    taskPack('test-fix-broken-import', 'TEST_FIX', 'Repair broken import', 'Restore a test that fails to resolve a module.', 'The suite collects and runs.', 'SUITE_COLLECTS', []),
    taskPack('test-fix-assertion', 'TEST_FIX', 'Correct a wrong assertion', 'Fix an assertion that encodes the bug, not the behavior.', 'Assertion matches intended behavior.', 'TEST_PASSES', ['no test deletion']),
    taskPack('test-fix-fixture', 'TEST_FIX', 'Repair a shared fixture', 'Fix fixture setup that leaks state between tests.', 'Tests are order-independent.', 'TEST_PASSES_IN_ISOLATION', []),
    taskPack('test-fix-mock', 'TEST_FIX', 'Remove an over-broad stub', 'Replace a stub that hides a real path with a real dependency.', 'The real code path executes and passes.', 'REAL_PATH_COVERED', ['no new mocks']),
    // 5 feature tasks
    taskPack('feature-endpoint', 'FEATURE', 'Add a read endpoint', 'Add a read-only endpoint with input validation.', 'Endpoint validates input and returns the DTO.', 'ENDPOINT_TEST_PASSES', ['read-only']),
    taskPack('feature-config-flag', 'FEATURE', 'Add a config flag', 'Add an opt-in flag with a safe default.', 'The flag defaults to the restrictive value.', 'CONFIG_DEFAULT_TEST_PASSES', []),
    taskPack('feature-metric', 'FEATURE', 'Add a metric', 'Record a counter for a failure path.', 'The metric increments on the failure path.', 'METRIC_TEST_PASSES', []),
    taskPack('feature-cli-subcommand', 'FEATURE', 'Add a subcommand', 'Add a subcommand with argument validation.', 'Invalid arguments are rejected.', 'CLI_TEST_PASSES', []),
    taskPack('feature-doc', 'FEATURE', 'Document a workflow', 'Document the recovery workflow accurately.', 'Documentation matches implemented behavior.', 'DOC_REFERENCES_RESOLVE', ['no code behavior change'])
  ]
};

export function suiteByCategory(suite: EvaluationSuite, category: EvaluationCategory): EvaluationTaskDefinition[] {
  return suite.tasks.filter(task => task.category === category);
}

export function categoryCounts(suite: EvaluationSuite): Record<string, number> {
  return suite.tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.category] = (counts[task.category] ?? 0) + 1;
    return counts;
  }, {});
}
