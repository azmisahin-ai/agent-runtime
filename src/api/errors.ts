import type { FailureCategory, VerificationStatus } from '../domain/types.js';

// API error contract (spec 09 §7). Codes map to HTTP status via HTTP_STATUS.
export type ApiErrorCode =
  | 'INVALID_REQUEST' | 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT'
  | 'TASK_INVALID_STATE' | 'TASK_ALREADY_RUNNING' | 'TASK_NOT_RESUMABLE'
  | 'BACKEND_UNAVAILABLE' | 'BACKEND_CAPABILITY_UNSUPPORTED'
  | 'TOOL_DENIED' | 'TOOL_INVALID_REQUEST' | 'TOOL_TIMEOUT'
  | 'VERIFICATION_FAILED' | 'VERIFICATION_UNKNOWN'
  | 'PERSISTENCE_ERROR' | 'MIGRATION_ERROR'
  | 'PERMISSION_DENIED' | 'INTERNAL_ERROR';

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TASK_INVALID_STATE: 409,
  TASK_ALREADY_RUNNING: 409,
  TASK_NOT_RESUMABLE: 409,
  BACKEND_UNAVAILABLE: 503,
  BACKEND_CAPABILITY_UNSUPPORTED: 422,
  TOOL_DENIED: 403,
  TOOL_INVALID_REQUEST: 400,
  TOOL_TIMEOUT: 504,
  VERIFICATION_FAILED: 422,
  VERIFICATION_UNKNOWN: 422,
  PERSISTENCE_ERROR: 500,
  MIGRATION_ERROR: 500,
  PERMISSION_DENIED: 403,
  INTERNAL_ERROR: 500
};

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
    request_id: string;
  };
}

// Errors surfaced to clients. Internal details never leak to the response body.
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number { return HTTP_STATUS[this.code]; }

  toBody(requestId: string): ApiErrorBody {
    return { error: { code: this.code, message: this.message, retryable: this.retryable, details: this.details, request_id: requestId } };
  }
}

export function notFound(entity: string, id: string): ApiError {
  return new ApiError('NOT_FOUND', `${entity} not found`, false, { id });
}

// Map a domain failure category to an API error. Security-relevant failures are
// never treated as ordinary transient errors (spec 15 §14).
export function fromFailureCategory(category: FailureCategory | null, message: string): ApiError {
  switch (category) {
    case 'PERMISSION_FAILURE': return new ApiError('PERMISSION_DENIED', message, false);
    case 'BACKEND_FAILURE': return new ApiError('BACKEND_UNAVAILABLE', message, true);
    case 'PERSISTENCE_FAILURE': return new ApiError('PERSISTENCE_ERROR', message, false);
    case 'TOOL_FAILURE': return new ApiError('TOOL_DENIED', message, false);
    case 'TIMEOUT': return new ApiError('TOOL_TIMEOUT', message, true);
    default: return new ApiError('INTERNAL_ERROR', message, false);
  }
}

export function verificationError(status: VerificationStatus, message: string): ApiError {
  return status === 'UNKNOWN'
    ? new ApiError('VERIFICATION_UNKNOWN', message, false)
    : new ApiError('VERIFICATION_FAILED', message, false);
}
