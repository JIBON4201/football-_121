import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { getUserMessage, isNetworkError, isNotFoundError, toErrorKind } from '@/lib/errors';

const error = (status: number, code = 'X', flags: { isNetworkError?: boolean; isTimeout?: boolean } = {}) =>
  new ApiClientError({ message: 'm', status, code, ...flags });

describe('frontend error handling', () => {
  it('maps statuses to friendly messages without internals', () => {
    expect(getUserMessage(error(404))).toContain('could not be found');
    expect(getUserMessage(error(0, 'NETWORK_ERROR', { isNetworkError: true }))).toContain('Network');
    expect(getUserMessage(new Error('db password=hunter2'))).not.toContain('hunter2');
    expect(getUserMessage(error(500))).toContain('temporarily unavailable');
  });

  it('classifies error kinds for state components', () => {
    expect(isNotFoundError(error(404))).toBe(true);
    expect(isNotFoundError(error(500))).toBe(false);
    expect(isNetworkError(new ApiClientError({ message: 'x', status: 0, code: 'TIMEOUT', isTimeout: true }))).toBe(true);
    expect(toErrorKind(error(403))).toBe('forbidden');
    expect(toErrorKind(error(503))).toBe('server');
    expect(toErrorKind(new Error('?'))).toBe('unknown');
  });
});
