import type {
  Attempt, Checkpoint, Project, RuntimeEvent, Task, ToolRun, VerificationResult
} from '../domain/types.js';

// API DTOs are separate from domain entities (spec 09 §1). They are the stable
// wire shape; domain records may change internally without breaking clients.

export interface ProjectDto {
  project_id: string;
  name: string;
  root_path: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TaskDto {
  task_id: string;
  project_id: string;
  title: string;
  description: string;
  state: string;
  current_attempt_id: string | null;
  current_checkpoint_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttemptDto {
  attempt_id: string;
  task_id: string;
  attempt_number: number;
  backend_id: string;
  model: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  verification: string | null;
}

export interface EventDto {
  event_id: string;
  sequence_number: number;
  type: string;
  timestamp: string;
  source: string;
  task_id: string | null;
  attempt_id: string | null;
  payload: Record<string, unknown>;
}

export interface CheckpointDto {
  checkpoint_id: string;
  task_id: string;
  attempt_id: string | null;
  state: string;
  current_goal: string;
  current_step: string;
  repository_revision: string | null;
  git_state: { head: string | null; branch: string | null; dirty: boolean };
  created_at: string;
}

export interface ToolRunDto {
  tool_run_id: string;
  tool_name: string;
  status: string;
  permission: string;
  output: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface VerificationDto {
  verification_id: string;
  attempt_id: string;
  status: string;
  checks: { name: string; kind: string; status: string; evidence: string }[];
  started_at: string;
  ended_at: string;
}

export function toProjectDto(project: Project): ProjectDto {
  return {
    project_id: project.projectId, name: project.name, root_path: project.rootPath,
    status: project.status, created_at: project.createdAt, updated_at: project.updatedAt
  };
}

export function toTaskDto(task: Task): TaskDto {
  return {
    task_id: task.taskId, project_id: task.projectId, title: task.title, description: task.description,
    state: task.state, current_attempt_id: task.currentAttemptId, current_checkpoint_id: task.currentCheckpointId,
    created_at: task.createdAt, updated_at: task.updatedAt
  };
}

export function toAttemptDto(attempt: Attempt): AttemptDto {
  return {
    attempt_id: attempt.attemptId, task_id: attempt.taskId, attempt_number: attempt.attemptNumber,
    backend_id: attempt.backendId, model: attempt.model, started_at: attempt.startedAt,
    ended_at: attempt.endedAt, outcome: attempt.outcome, verification: attempt.verification
  };
}

export function toEventDto(event: RuntimeEvent): EventDto {
  return {
    event_id: event.eventId, sequence_number: event.sequenceNumber, type: event.type,
    timestamp: event.timestamp, source: event.source, task_id: event.taskId,
    attempt_id: event.attemptId, payload: event.payload
  };
}

export function toCheckpointDto(checkpoint: Checkpoint): CheckpointDto {
  return {
    checkpoint_id: checkpoint.checkpointId, task_id: checkpoint.taskId, attempt_id: checkpoint.attemptId,
    state: checkpoint.state, current_goal: checkpoint.currentGoal, current_step: checkpoint.currentStep,
    repository_revision: checkpoint.repositoryRevision, git_state: checkpoint.gitState, created_at: checkpoint.createdAt
  };
}

export function toToolRunDto(run: ToolRun): ToolRunDto {
  return {
    tool_run_id: run.toolRunId, tool_name: run.toolName, status: run.status, permission: run.permission,
    output: run.output, error: run.error, started_at: run.startedAt, ended_at: run.endedAt
  };
}

export function toVerificationDto(verification: VerificationResult): VerificationDto {
  return {
    verification_id: verification.verificationId, attempt_id: verification.attemptId,
    status: verification.status, checks: verification.checks.map(check => ({
      name: check.name, kind: check.kind, status: check.status, evidence: check.evidence
    })),
    started_at: verification.startedAt, ended_at: verification.endedAt
  };
}
