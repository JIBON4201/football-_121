import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, createApiClient } from '@/lib/api-client';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('typed API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns typed envelopes on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: { ok: true }, requestId: 'r1' })));
    const client = createApiClient({ baseUrl: 'http://api.test' });
    const result = await client.get<{ ok: boolean }>('/health');
    expect(result.data).toEqual({ ok: true });
    expect(result.requestId).toBe('r1');
  });

  it('normalizes backend error envelopes without leaking internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Nope' }, requestId: 'r2' })),
    );
    const client = createApiClient({ baseUrl: 'http://api.test' });
    const error = await client.get('/news/x').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(404);
    expect((error as ApiClientError).code).toBe('NOT_FOUND');
  });

  it('retries safe GET requests but never POST', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { error: { code: 'UPSTREAM_ERROR', message: 'down' }, requestId: 'r' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createApiClient({ baseUrl: 'http://api.test' });
    await client.get('/news').catch(() => undefined);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    fetchMock.mockClear();
    await client.post('/articles', {}).catch(() => undefined);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('times out slow requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
      throw new Error('unreachable');
    }));
    const client = createApiClient({ baseUrl: 'http://api.test' });
    const error = await client.get('/news', { timeoutMs: 20 }).catch((error: unknown) => error);
    expect((error as ApiClientError).isTimeout).toBe(true);
  });

  it('honours caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: 1, requestId: 'r' })));
    const client = createApiClient({ baseUrl: 'http://api.test' });
    const controller = new AbortController();
    controller.abort();
    const error = await client.get('/news', { signal: controller.signal }).catch((error: unknown) => error);
    expect((error as ApiClientError).code).toBe('CANCELLED');
  });

  it('sends bearer tokens when provided', async () => {
    let captured: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
        captured = init?.headers ?? {};
        return jsonResponse(200, { data: 1, requestId: 'r' });
      }),
    );
    const client = createApiClient({ baseUrl: 'http://api.test' });
    await client.get('/me', { authToken: 'token-123' });
    expect(captured.Authorization).toBe('Bearer token-123');
  });

  it('rejects malformed envelopes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { unexpected: true })));
    const client = createApiClient({ baseUrl: 'http://api.test' });
    const error = await client.get('/news').catch((error: unknown) => error);
    expect((error as ApiClientError).code).toBe('BAD_RESPONSE');
  });
});
