import { ApiClientError } from '@/lib/api-client';

/** User-facing error mapping. Never leaks internal details or secrets. */
export function getUserMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'CANCELLED') return 'Request was cancelled.';
    if (error.isTimeout) return 'The request timed out. Please try again.';
    if (error.isNetworkError) return 'Network unavailable. Check your connection and retry.';
    switch (error.status) {
      case 400:
        return 'Invalid request. Please check the input and try again.';
      case 401:
        return 'Please sign in to continue.';
      case 403:
        return 'You do not have access to this content.';
      case 404:
        return 'The requested content could not be found.';
      case 409:
        return 'This action conflicts with existing data.';
      case 413:
        return 'The upload is too large.';
      case 415:
      case 422:
        return 'The file could not be processed. Please try another file.';
      case 429:
        return 'Too many requests. Please slow down and retry.';
      default:
        if (error.status >= 500) return 'The service is temporarily unavailable. Please try again later.';
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.isNetworkError || error.isTimeout);
}

/** True when the caller hit a rate limit and should back off rather than retry. */
export function isRateLimitError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 429;
}

/** Error kind buckets for empty/error state components. */
export type ErrorKind = 'not-found' | 'network' | 'forbidden' | 'server' | 'unknown';

export function toErrorKind(error: unknown): ErrorKind {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return 'not-found';
    if (error.isNetworkError || error.isTimeout) return 'network';
    if (error.status === 403) return 'forbidden';
    if (error.status >= 500 || error.status === 0) return 'server';
    return 'unknown';
  }
  return 'unknown';
}
