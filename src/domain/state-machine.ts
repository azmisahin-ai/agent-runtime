import type { TaskState } from './types.js';

const transitions: Record<TaskState, readonly TaskState[]> = {
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'PAUSED', 'CANCELLED'],
  RUNNING: ['WAITING_TOOL', 'WAITING_USER', 'VERIFYING', 'PAUSED', 'FAILED', 'CANCELLED'],
  WAITING_TOOL: ['RUNNING', 'FAILED', 'PAUSED', 'CANCELLED'],
  WAITING_USER: ['RUNNING', 'PAUSED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED', 'PAUSED'],
  COMPLETED: [],
  FAILED: [],
  PAUSED: ['RUNNING', 'CANCELLED'],
  CANCELLED: [],
};

export class InvalidTaskTransitionError extends Error {
  constructor(public readonly from: TaskState, public readonly to: TaskState) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskTransitionError';
  }
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to);
}

export function transitionTask(from: TaskState, to: TaskState): TaskState {
  if (!canTransition(from, to)) throw new InvalidTaskTransitionError(from, to);
  return to;
}
