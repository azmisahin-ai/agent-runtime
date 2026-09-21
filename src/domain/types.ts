export type TaskState =
  | 'CREATED' | 'QUEUED' | 'RUNNING' | 'WAITING_TOOL' | 'WAITING_USER'
  | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'PAUSED' | 'CANCELLED';

export type AttemptOutcome = 'SUCCESS' | 'FAILURE' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';
export type VerificationStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type EventSource = 'USER' | 'MODEL' | 'RUNTIME' | 'TOOL' | 'BACKEND' | 'SYSTEM';

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
