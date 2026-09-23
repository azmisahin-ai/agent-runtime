export type TaskState =
  | 'CREATED' | 'QUEUED' | 'RUNNING' | 'WAITING_TOOL' | 'WAITING_USER'
  | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'PAUSED' | 'CANCELLED';

export type AttemptOutcome = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';
export type VerificationStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type EventSource = 'USER' | 'MODEL' | 'RUNTIME' | 'TOOL' | 'BACKEND' | 'SYSTEM';
export type PermissionLevel = 'READ_ONLY' | 'WORKSPACE_WRITE' | 'PROCESS_EXECUTION' | 'NETWORK_ACCESS' | 'ADMIN';
export type ToolCapability = 'read_only' | 'filesystem_read' | 'filesystem_write' | 'process_execute' | 'network_access' | 'git_access';
export type ToolRunStatus =
  | 'REQUESTED' | 'VALIDATING' | 'VALIDATED' | 'AUTHORIZED' | 'RUNNING'
  | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'DENIED' | 'CANCELLED' | 'UNKNOWN';
export type FailureCategory =
  | 'MODEL_FAILURE' | 'BACKEND_FAILURE' | 'CONTEXT_FAILURE' | 'MEMORY_FAILURE' | 'TOOL_FAILURE'
  | 'VERIFICATION_FAILURE' | 'TIMEOUT' | 'PERMISSION_FAILURE' | 'REPOSITORY_FAILURE'
  | 'PERSISTENCE_FAILURE' | 'UNKNOWN_FAILURE';

export interface Project {
  projectId: string;
  name: string;
  rootPath: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  taskId: string;
  projectId: string;
  title: string;
  description: string;
  state: TaskState;
  currentAttemptId: string | null;
  currentCheckpointId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attempt {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  backendId: string;
  model: string;
  startedAt: string;
  endedAt: string | null;
  outcome: AttemptOutcome | null;
  verification: VerificationStatus | null;
}

export interface RuntimeEvent {
  eventId: string;
  projectId: string | null;
  taskId: string | null;
  attemptId: string | null;
  sequenceNumber: number;
  type: string;
  timestamp: string;
  source: EventSource;
  payload: Record<string, unknown>;
}

export interface GitState {
  head: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface Checkpoint {
  checkpointId: string;
  taskId: string;
  attemptId: string | null;
  state: TaskState;
  currentGoal: string;
  currentStep: string;
  repositoryRevision: string | null;
  gitState: GitState;
  memoryRefs: string[];
  contextSnapshotId: string | null;
  pendingAction: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConfigSnapshot {
  configSnapshotId: string;
  taskId: string;
  attemptId: string;
  schemaVersion: number;
  profile: string;
  effectiveConfig: Record<string, unknown>;
  effectivePolicy: Record<string, unknown>;
  backendId: string;
  model: string;
  policyVersion: number;
  configHash: string;
  createdAt: string;
}

export interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  capabilities: ToolCapability[];
  permission: PermissionLevel;
  inputSchema: Record<string, unknown>;
  limits?: { maxBytes?: number; timeoutMs?: number };
}

export interface ToolRequest {
  requestId: string;
  taskId: string;
  attemptId: string;
  tool: string;
  version: string;
  arguments: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResult {
  toolRunId: string;
  status: ToolRunStatus;
  output: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ToolRun {
  toolRunId: string;
  taskId: string;
  attemptId: string;
  requestId: string;
  toolName: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  status: ToolRunStatus;
  permission: PermissionLevel;
  output: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export type ContextSectionType =
  | 'SYSTEM' | 'TASK' | 'STATE' | 'MEMORY' | 'REPOSITORY' | 'FILE' | 'SYMBOL'
  | 'GIT' | 'TOOL' | 'OBSERVATION' | 'TEST' | 'ERROR' | 'INSTRUCTION';

export interface ContextSection {
  id: string;
  type: ContextSectionType;
  content: string;
  source: string;
  priority: 0 | 1 | 2 | 3 | 4;
  tokenCost: number;
  relevance: number;
  timestamp: string;
  provenance: string;
}

export interface ContextPack {
  contextId: string;
  taskId: string;
  attemptId: string;
  createdAt: string;
  modelContextLimit: number;
  reservedOutputTokens: number;
  systemTokens: number;
  toolSchemaTokens: number;
  retrievalBudget: number;
  sections: ContextSection[];
}

export interface ContextSnapshot {
  contextSnapshotId: string;
  taskId: string;
  attemptId: string;
  model: string;
  tokenCount: number;
  contextHash: string;
  sections: ContextSection[];
  retrievalQuery: string;
  createdAt: string;
}

export interface VerificationCheck {
  name: string;
  kind: 'TEST' | 'BUILD' | 'LINT' | 'TYPECHECK' | 'INVARIANT' | 'REPOSITORY' | 'CUSTOM';
  status: VerificationStatus;
  evidence: string;
}

export interface VerificationResult {
  verificationId: string;
  taskId: string;
  attemptId: string;
  status: VerificationStatus;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
}

export interface Evaluation {
  evaluationId: string;
  taskId: string;
  attemptId: string;
  backendId: string;
  provider: string;
  model: string;
  repositoryRevision: string | null;
  runtimeConfig: Record<string, unknown>;
  outcome: AttemptOutcome;
  verification: VerificationStatus;
  failureCategory: FailureCategory | null;
  evidence: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
}

// --- Memory (spec 03) ---

export type MemoryType = 'WORKING' | 'EPISODIC' | 'SEMANTIC' | 'PROJECT' | 'PROCEDURAL' | 'FAILURE';
export type MemoryScope = 'GLOBAL' | 'PROJECT' | 'TASK' | 'ATTEMPT' | 'SESSION';
export type MemorySource = 'USER' | 'MODEL' | 'TOOL' | 'REPOSITORY' | 'GIT' | 'TEST' | 'SYSTEM' | 'DERIVED';
export type MemoryConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type MemoryStatus = 'ACTIVE' | 'SUPERSEDED' | 'EXPIRED' | 'UNCERTAIN' | 'CONFLICTING' | 'ARCHIVED';
export type MemoryRelationType = 'supports' | 'contradicts' | 'supersedes' | 'derived_from' | 'related_to';

export interface MemoryRecord {
  memoryId: string;
  projectId: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  confidence: MemoryConfidence;
  status: MemoryStatus;
  validFrom: string;
  validUntil: string | null;
  supersedes: string | null;
  supersededBy: string | null;
  relatedTaskId: string | null;
  relatedAttemptId: string | null;
  relatedFiles: string[];
  relatedSymbols: string[];
}

export interface MemoryEvidence {
  memoryEvidenceId: string;
  memoryId: string;
  source: MemorySource;
  reference: string;
  contentHash: string;
  revision: string | null;
  createdAt: string;
}

export interface MemoryRelation {
  memoryRelationId: string;
  fromMemoryId: string;
  toMemoryId: string;
  relation: MemoryRelationType;
  createdAt: string;
}

export interface MemoryCandidate {
  projectId: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: MemorySource;
  confidence: MemoryConfidence;
  relatedTaskId?: string | null;
  relatedAttemptId?: string | null;
  relatedFiles?: string[];
  relatedSymbols?: string[];
  evidence?: { reference: string; contentHash: string; revision?: string | null }[];
  supersedes?: string | null;
}

// --- Repository intelligence (spec 12) ---

export type IndexState = 'FRESH' | 'STALE' | 'BUILDING' | 'FAILED' | 'UNKNOWN';

export interface RepositoryFileRecord {
  fileId: string;
  projectId: string;
  path: string;
  language: string | null;
  size: number;
  contentHash: string;
  revision: string | null;
  indexedAt: string;
}

export interface RepositorySymbolRecord {
  symbolId: string;
  projectId: string;
  fileId: string;
  kind: string;
  qualifiedName: string;
  location: string;
  signature: string | null;
  contentHash: string;
  indexedAt: string;
}

export interface RepositoryIndexStateRecord {
  projectId: string;
  state: IndexState;
  revision: string | null;
  indexedAt: string | null;
  fileCount: number;
  symbolCount: number;
  updatedAt: string;
}
