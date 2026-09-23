import { Database } from '../persistence/database.js';
import { ProjectRepository } from '../persistence/project-repository.js';
import { TaskRepository } from '../persistence/task-repository.js';
import { CheckpointRepository } from '../persistence/checkpoint-repository.js';
import { ConfigSnapshotRepository } from '../persistence/config-snapshot-repository.js';
import { ContextSnapshotRepository } from '../persistence/context-snapshot-repository.js';
import { ToolRunRepository } from '../persistence/tool-run-repository.js';
import { SessionRepository } from '../persistence/session-repository.js';
import { VerificationRepository, EvaluationRepository } from '../persistence/verification-repository.js';
import { MemoryRepository } from '../persistence/memory-repository.js';
import { RepositoryIndexRepository } from '../persistence/repository-index-repository.js';
import { EventStore } from '../events/event-store.js';
import { TaskService } from '../application/task-service.js';
import { loadConfig, type RuntimeConfig } from '../config/config.js';
import { PolicyEngine } from '../tools/policy.js';
import { ToolEngine } from '../tools/tool-engine.js';
import { builtinTools } from '../tools/builtin-tools.js';
import { ContextEngine } from '../context/context-engine.js';
import { Compactor } from '../context/compactor.js';
import { VerificationEngine } from '../verification/verification-engine.js';
import { EvaluationRecorder } from '../evaluation/evaluation-recorder.js';
import { MemoryEngine } from '../memory/memory-engine.js';
import { RepositoryScanner } from '../repository/repository-scanner.js';
import { StructuredLogger, MetricsRegistry } from '../observability/logger.js';
import { GitInspector } from '../git/git-inspector.js';
import { OllamaBackend } from '../backends/ollama-backend.js';
import { RuntimeOrchestrator } from './orchestrator.js';
import { repoPath } from './paths.js';

export interface Runtime {
  config: RuntimeConfig;
  db: Database;
  projects: ProjectRepository;
  tasks: TaskRepository;
  events: EventStore;
  taskService: TaskService;
  checkpoints: CheckpointRepository;
  configSnapshots: ConfigSnapshotRepository;
  contextSnapshots: ContextSnapshotRepository;
  toolRuns: ToolRunRepository;
  sessions: SessionRepository;
  verifications: VerificationRepository;
  evaluations: EvaluationRepository;
  memories: MemoryRepository;
  repositoryIndex: RepositoryIndexRepository;
  contextEngine: ContextEngine;
  compactor: Compactor;
  toolEngine: ToolEngine;
  verificationEngine: VerificationEngine;
  evaluationRecorder: EvaluationRecorder;
  memoryEngine: MemoryEngine;
  repositoryScanner: RepositoryScanner;
  logger: StructuredLogger;
  metrics: MetricsRegistry;
  orchestrator: RuntimeOrchestrator;
  backend: OllamaBackend;
}

export function bootstrap(env: Record<string, string | undefined> = process.env): Runtime {
  const config = loadConfig(env);
  const db = new Database(config.dbPath);
  db.migrate(repoPath('migrations'));

  const projects = new ProjectRepository(db);
  const tasks = new TaskRepository(db);
  const checkpoints = new CheckpointRepository(db);
  const configSnapshots = new ConfigSnapshotRepository(db);
  const contextSnapshots = new ContextSnapshotRepository(db);
  const toolRuns = new ToolRunRepository(db);
  const sessions = new SessionRepository(db);
  const verifications = new VerificationRepository(db);
  const evaluations = new EvaluationRepository(db);
  const memories = new MemoryRepository(db);
  const repositoryIndex = new RepositoryIndexRepository(db);
  const events = new EventStore(db);
  const taskService = new TaskService(db, tasks, events);
  const logger = new StructuredLogger(config.logLevel);
  const metrics = new MetricsRegistry();

  const git = new GitInspector(config.workspaceRoot);
  const policy = new PolicyEngine({
    grantedCapabilities: config.grantedCapabilities,
    allowProcessExecution: config.allowProcessExecution,
    allowNetworkAccess: config.allowNetworkAccess,
    allowedCommands: config.allowedCommands
  });
  const toolEngine = new ToolEngine(db, toolRuns, events, {
    workspaceRoot: config.workspaceRoot,
    pathGuard: { workspaceRoot: config.workspaceRoot },
    policy,
    maxOutputBytes: config.tools.maxOutputBytes,
    gitRunner: git.isRepository() ? (args) => git.run(args) : undefined,
    authorizeCommand: (argv) => policy.authorizeCommand(argv),
    commandTimeoutMs: config.tools.commandTimeoutMs
  });
  for (const tool of builtinTools()) toolEngine.register(tool);

  const contextEngine = new ContextEngine(config.context);
  const memoryEngine = new MemoryEngine({ db, repository: memories, events });
  const compactor = new Compactor({ memoryEngine });
  const verificationEngine = new VerificationEngine(db, verifications, events);
  const evaluationRecorder = new EvaluationRecorder(db, evaluations, events);
  const repositoryScanner = new RepositoryScanner(repositoryIndex);

  const backend = new OllamaBackend({
    baseUrl: config.backend.baseUrl,
    model: config.backend.model,
    requestTimeoutMs: config.backend.requestTimeoutMs
  });

  const orchestrator = new RuntimeOrchestrator({
    db, config, tasks, checkpoints, contextSnapshots, configSnapshots, toolRuns, sessions,
    events, contextEngine, toolEngine, verificationEngine, evaluationRecorder,
    memoryEngine, logger, metrics
  }, backend);

  return {
    config, db, projects, tasks, events, taskService, checkpoints, configSnapshots,
    contextSnapshots, toolRuns, sessions, verifications, evaluations, memories, repositoryIndex,
    contextEngine, compactor, toolEngine, verificationEngine, evaluationRecorder, memoryEngine,
    repositoryScanner, logger, metrics, orchestrator, backend
  };
}
