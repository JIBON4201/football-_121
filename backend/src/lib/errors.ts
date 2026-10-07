export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Authentication required'): ApiError =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Insufficient permissions'): ApiError =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (resource = 'Resource'): ApiError =>
  new ApiError(404, 'NOT_FOUND', `${resource} not found`);

export const conflict = (message: string): ApiError =>
  new ApiError(409, 'CONFLICT', message);

/** Request body exceeded the configured limit. */
export const payloadTooLarge = (message = 'Request body too large'): ApiError =>
  new ApiError(413, 'PAYLOAD_TOO_LARGE', message);

export const rateLimited = (message = 'Too many requests'): ApiError =>
  new ApiError(429, 'RATE_LIMITED', message);

export const notImplemented = (message = 'Not implemented'): ApiError =>
  new ApiError(501, 'NOT_IMPLEMENTED', message);

/** Upstream (database/provider) failure. Never attach driver details. */
export const upstream = (message = 'Upstream service unavailable'): ApiError =>
  new ApiError(503, 'UPSTREAM_ERROR', message);

/**
 * Service boundary guard: ApiError passes through unchanged, anything else
 * (driver errors, type errors) becomes a sanitized 503. Raw PostgreSQL
 * errors must never reach the API response layer.
 */
export function toServiceError(error: unknown, message = 'Service unavailable'): ApiError {
  if (error instanceof ApiError) return error;
  return upstream(message);
}
