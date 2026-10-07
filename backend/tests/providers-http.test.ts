import { describe, expect, it, vi } from 'vitest';
import { ProviderHttpClient, ProviderHttpError } from '../src/providers/httpClient';

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

function clientFor(stub: FetchStub, extra: Record<string, unknown> = {}) {
  return new ProviderHttpClient({
    baseUrl: 'https://provider.example.com',
    apiKey: 'SECRET-KEY-123',
    timeoutMs: 1000,
    maxRetries: 2,
    baseDelayMs: 1,
    requestsPerMinute: 60000,
    maxResponseBytes: 1_000_000,
    fetchImpl: stub as typeof fetch,
    ...extra,
  });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('provider HTTP client', () => {
  it('returns parsed JSON on success and sends the key header', async () => {
    let seenHeaders: Record<string, string> = {};
    const client = clientFor(async (_url, init) => {
      seenHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return json({ ok: true });
    });
    const data = await client.request<{ ok: boolean }>('/ping');
    expect(data).toEqual({ ok: true });
    expect(seenHeaders['x-api-key']).toBe('SECRET-KEY-123');
  });

  it('does not retry permanent 4xx failures', async () => {
    let calls = 0;
    const client = clientFor(async () => {
      calls += 1;
      return json({ error: 'bad' }, 400);
    });
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'HTTP', retryable: false });
    expect(calls).toBe(1);
  });

  it('maps auth failures without retry', async () => {
    const client = clientFor(async () => json({}, 401));
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('retries transient 5xx then succeeds', async () => {
    let calls = 0;
    const client = clientFor(async () => {
      calls += 1;
      return calls === 1 ? json({}, 503) : json({ ok: true });
    });
    const data = await client.request<{ ok: boolean }>('/x');
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('times out hanging requests', async () => {
    const hanging: FetchStub = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    const client = clientFor(hanging, { timeoutMs: 30, maxRetries: 0 });
    await expect(client.request('/x')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const bad = clientFor(async () => new Response('not json', { status: 200 }));
    await expect(bad.request('/x')).rejects.toMatchObject({ code: 'INVALID_JSON' });

    const big = clientFor(async () => new Response('x'.repeat(100), { status: 200 }), {
      maxResponseBytes: 10,
    });
    await expect(big.request('/x')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('never logs secrets', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const client = clientFor(async () => json({ ok: true }));
      await client.request('/ping');
      const output = spy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(output).not.toContain('SECRET-KEY-123');
    } finally {
      spy.mockRestore();
    }
  });

  it('exposes retryable flags correctly', () => {
    expect(new ProviderHttpError('TIMEOUT', 'x').retryable).toBe(false);
  });
});
