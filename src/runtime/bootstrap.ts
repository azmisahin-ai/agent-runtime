import { Database } from '../persistence/database.js';
import { ProjectRepository } from '../persistence/project-repository.js';
import { TaskRepository } from '../persistence/task-repository.js';
import { CheckpointRepository } from '../persistence/checkpoint-repository.js';
import { ConfigSnapshotRepository } from '../persistence/config-snapshot-repository.js';
import { ContextSnapshotRepository } from '../persistence/context-snapshot-repository.js';
import { ToolRunRepository } from '../persistence/tool-run-repository.js';
import { SessionRepository } from '../persistence/session-repository.js';
import { VerificationRepository, EvaluationRepository } from '../persistence/verification-repository.js';
import { EventStore } from '../events/event-store.js';
import { TaskService } from '../application/task-service.js';
import { loadConfig, type RuntimeConfig } from '../config/config.js';
import { PolicyEngine } from '../tools/policy.js';
import { ToolEngine } from '../tools/tool-engine.js';
import { builtinTools } from '../tools/builtin-tools.js';
import { ContextEngine } from '../context/context-engine.js';
import { VerificationEngine } from '../verification/verification-engine.js';
import { EvaluationRecorder } from '../evaluation/evaluation-recorder.js';
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
  contextEngine: ContextEngine;
  toolEngine: ToolEngine;
  verificationEngine: VerificationEngine;
  evaluationRecorder: EvaluationRecorder;
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
  const events = new EventStore(db);
  const taskService = new TaskService(db, tasks, events);

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
    gitRunner: git.isRepository() ? (args) => git.run(args) : undefined
  });
  for (const tool of builtinTools()) toolEngine.register(tool);

  const contextEngine = new ContextEngine(config.context);
  const verificationEngine = new VerificationEngine(db, verifications, events);
  const evaluationRecorder = new EvaluationRecorder(db, evaluations, events);

  const backend = new OllamaBackend({
    baseUrl: config.backend.baseUrl,
    model: config.backend.model,
    requestTimeoutMs: config.backend.requestTimeoutMs
  });

  const orchestrator = new RuntimeOrchestrator({
    db, config, tasks, checkpoints, contextSnapshots, configSnapshots, toolRuns, sessions,
    events, contextEngine, toolEngine, verificationEngine, evaluationRecorder
  }, backend);

  return {
    config, db, projects, tasks, events, taskService, checkpoints, configSnapshots,
    contextSnapshots, toolRuns, sessions, verifications, evaluations,
    contextEngine, toolEngine, verificationEngine, evaluationRecorder, orchestrator, backend
  };
}
