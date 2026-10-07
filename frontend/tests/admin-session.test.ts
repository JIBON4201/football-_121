import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieValue = { current: 'token-123' as string | undefined };

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === 'cc_at' && cookieValue.current ? { value: cookieValue.current } : undefined),
  }),
}));

import { ADMIN_ACCESS_COOKIE, adminApiFetch, getAdminSession } from '@/lib/admin-session';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify({ data: body }), { status, headers: { 'content-type': 'application/json' } });

describe('admin session resolution', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    cookieValue.current = 'token-123';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes httpOnly cookie names only', () => {
    expect(ADMIN_ACCESS_COOKIE).toBe('cc_at');
  });

  it('is unauthenticated without a session cookie and never calls the API', async () => {
    cookieValue.current = undefined;
    await expect(getAdminSession()).resolves.toEqual({ status: 'unauthenticated' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a backend 401 to unauthenticated', async () => {
    fetchMock.mockResolvedValue(json(401, null));
    await expect(getAdminSession()).resolves.toEqual({ status: 'unauthenticated' });
  });

  it('maps a backend 403 to forbidden, keeping it distinct from signed out', async () => {
    fetchMock.mockResolvedValue(json(403, null));
    await expect(getAdminSession()).resolves.toEqual({ status: 'forbidden' });
  });

  it('maps a backend 200 to an ok session with roles and permissions', async () => {
    fetchMock.mockResolvedValue(
      json(200, { id: 'user-1', email: 'admin@example.com', roles: ['admin'], permissions: ['dashboard.read'] }),
    );
    await expect(getAdminSession()).resolves.toEqual({
      status: 'ok',
      user: { id: 'user-1', email: 'admin@example.com', roles: ['admin'], permissions: ['dashboard.read'] },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/admin/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
    expect(init?.cache).toBe('no-store');
  });

  it('fails closed when the API is unreachable or returns a malformed body', async () => {
    // Network failure, malformed payload and 5xx are API failures, not bad
    // sessions: they must surface as `error` (keep the cookie, show retry)
    // rather than `unauthenticated` (redirect to login, discard session).
    // See `getAdminSession` docblock: "Deliberately distinct from
    // `unauthenticated`".
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getAdminSession()).resolves.toEqual({
      status: 'error',
      message: 'Could not reach the Admin API. Check that the backend is running, then retry.',
    });

    fetchMock.mockResolvedValue(json(200, { nope: true }));
    await expect(getAdminSession()).resolves.toEqual({
      status: 'error',
      message: 'The Admin API returned an unexpected session payload.',
    });

    fetchMock.mockResolvedValue(json(500, null));
    await expect(getAdminSession()).resolves.toEqual({
      status: 'error',
      message: 'The Admin API returned 500. Your session is still valid — retry, or sign in again if it persists.',
    });
  });

  it('resolves to a retryable error instead of hanging when the backend stalls', async () => {
    // AbortSignal.timeout() surfaces as an aborted request: the session check
    // must fail closed to `error` (retryable) rather than pending forever in
    // the dashboard loading skeleton.
    const stalled = new Error('The operation was aborted due to timeout');
    stalled.name = 'TimeoutError';
    fetchMock.mockRejectedValue(stalled);
    await expect(getAdminSession()).resolves.toEqual({
      status: 'error',
      message: 'Could not reach the Admin API. Check that the backend is running, then retry.',
    });
  });

  it('bounds the identity check so suspense always resolves', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'u1', email: null, roles: [], permissions: [] }));
    await getAdminSession();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never treats a forbidden session as signed in', async () => {
    fetchMock.mockResolvedValue(json(403, null));
    const session = await getAdminSession();
    expect(session.status === 'ok' && session.user.id).toBeFalsy();
  });

  it('sends the session token on Admin API calls and never caches them', async () => {
    fetchMock.mockResolvedValue(json(200, []));
    await adminApiFetch('/api/v1/admin/articles', { method: 'GET' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/admin/articles');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
    expect(init?.cache).toBe('no-store');
  });
});