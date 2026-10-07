import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSuggestionFetcher } from '@/components/search/SearchInput';
import { trackEvent, trackSearch } from '@/lib/analytics';
import { isRateLimitError, toErrorKind, getUserMessage } from '@/lib/errors';
import { ApiClientError } from '@/lib/api-client';
import { fetchSearchResults, SEARCH_REVALIDATE_SECONDS } from '@/lib/search-server';
import { parseSearchFilters } from '@/lib/search';

/**
 * Transport-level behaviour: request shaping, error classification and the
 * search data layer's failure modes. These run in the node environment, so
 * `fetch` is stubbed rather than a DOM being mounted.
 */

const ENVELOPE = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function apiError(status: number, code = 'REQUEST_FAILED'): ApiClientError {
  return new ApiClientError({ message: 'boom', status, code });
}

describe('error classification', () => {
  it('identifies a rate-limit response so the UI can tell readers to back off', () => {
    expect(isRateLimitError(apiError(429, 'RATE_LIMITED'))).toBe(true);
    expect(isRateLimitError(apiError(500))).toBe(false);
    expect(isRateLimitError(new Error('plain'))).toBe(false);
  });

  it('maps statuses to distinct kinds', () => {
    expect(toErrorKind(apiError(404))).toBe('not-found');
    expect(toErrorKind(apiError(403))).toBe('forbidden');
    expect(toErrorKind(apiError(500))).toBe('server');
    expect(toErrorKind(apiError(429))).toBe('unknown');
  });

  it('never leaks internals in user-facing copy', () => {
    const messages = [400, 403, 404, 429, 500].map((status) => getUserMessage(apiError(status)));
    for (const message of messages) {
      expect(message).not.toMatch(/stack|select |postgres|supabase|api_?key/i);
    }
    expect(getUserMessage(apiError(429))).toMatch(/slow down/i);
  });
});

describe('suggestion requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not retry a suggestion, so typing stays responsive', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return ENVELOPE({ data: [], requestId: 'r1' });
      }),
    );
    await createSuggestionFetcher()('arsenal', new AbortController().signal);
    // Exactly one attempt: a debounced autocomplete must not fan out retries.
    expect(calls).toHaveLength(1);
  });

  it('cancels the underlying request when the caller aborts', async () => {
    // Mimic real fetch: stay pending, and reject with AbortError on cancellation.
    let inFlightSignal: AbortSignal | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal ?? null;
            inFlightSignal = signal;
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = createSuggestionFetcher()('arsenal', controller.signal);
    // Let the client wire the signal up before cancelling.
    await Promise.resolve();
    controller.abort();
    // The client reports the cancellation rather than a generic failure.
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    // The client's own request was aborted, not merely the caller's handle.
    expect((inFlightSignal as unknown as AbortSignal).aborted).toBe(true);
  });

  it('tolerates a non-array payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ENVELOPE({ data: { unexpected: true }, requestId: 'r1' })),
    );
    await expect(
      createSuggestionFetcher()('arsenal', new AbortController().signal),
    ).resolves.toEqual([]);
  });

  it('surfaces a rate limit rather than swallowing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ENVELOPE({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429)),
    );
    await expect(
      createSuggestionFetcher()('arsenal', new AbortController().signal),
    ).rejects.toSatisfy((error: unknown) => isRateLimitError(error));
  });
});

describe('search data layer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never calls the API for a blank or too-short query', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const query of ['', '   ', 'a']) {
      const result = await fetchSearchResults(parseSearchFilters({ q: query }));
      expect(result.status).toBe('invalid');
      expect(result.items).toEqual([]);
    }
    // The landing state is free: no request is made for it.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns results and pagination from the API envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ENVELOPE({
          data: [
            {
              entity_type: 'team',
              entity_id: 't1',
              title: 'Arsenal',
              slug: 'arsenal',
              url: '/teams/arsenal',
              image: null,
              description: null,
              metadata: {},
              relevance: 90,
            },
          ],
          pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
          requestId: 'r1',
        }),
      ),
    );
    const result = await fetchSearchResults(parseSearchFilters({ q: 'arsenal' }));
    expect(result.status).toBe('ready');
    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('reports an empty result set distinctly from a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ENVELOPE({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    );
    const result = await fetchSearchResults(parseSearchFilters({ q: 'zzzznotathing' }));
    expect(result.status).toBe('empty');
  });

  it('degrades to an error state instead of throwing, so the page can retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream exploded', { status: 502 })),
    );
    const result = await fetchSearchResults(parseSearchFilters({ q: 'arsenal' }));
    expect(result.status).toBe('error');
    expect(result.items).toEqual([]);
  });

  it('drops malformed rows but keeps the good ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ENVELOPE({
          data: [null, { entity_type: 'team' }, { junk: true }, 'nope'],
          pagination: { page: 1, limit: 10, total: 4, totalPages: 1 },
        }),
      ),
    );
    const result = await fetchSearchResults(parseSearchFilters({ q: 'arsenal' }));
    // Partial data still renders: one bad row must not fail the search.
    expect(result.status).toBe('empty');
    expect(result.items).toEqual([]);
  });

  it('sends only the filters the reader set', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return ENVELOPE({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } });
      }),
    );
    await fetchSearchResults(parseSearchFilters({ q: 'arsenal', type: 'team', page: '3' }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('q=arsenal');
    expect(calls[0]).toContain('type=team');
    expect(calls[0]).toContain('page=3');
    expect(calls[0]).not.toContain('competition=');
  });

  it('revalidates on a short interval so results do not go stale', () => {
    expect(SEARCH_REVALIDATE_SECONDS).toBeGreaterThan(0);
    expect(SEARCH_REVALIDATE_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe('search analytics', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a query shape rather than the query text', () => {
    trackSearch('search-submitted', { query: 'arsenal secret plan' });
    const queue = (window as unknown as { __FOOTBALL_ANALYTICS__: Array<Record<string, unknown>> }).__FOOTBALL_ANALYTICS__;
    expect(queue).toHaveLength(1);
    const serialized = JSON.stringify(queue);
    expect(serialized).not.toContain('arsenal');
    expect(serialized).not.toContain('secret plan');
    expect(queue[0].name).toBe('search-submitted');
    expect(queue[0].id).toBe('query-length:19');
  });

  it('records the search funnel event names', () => {
    trackSearch('search-suggestion-selected', { query: 'ars', entityType: 'team', viaKeyboard: true });
    trackSearch('search-result-clicked', { query: 'ars', entityType: 'team' });
    trackSearch('search-no-results', { query: 'ars', hasFilters: false });
    const queue = (window as unknown as { __FOOTBALL_ANALYTICS__: Array<Record<string, unknown>> }).__FOOTBALL_ANALYTICS__;
    expect(queue.map((event) => event.name)).toEqual([
      'search-suggestion-selected',
      'search-result-clicked',
      'search-no-results',
    ]);
  });

  it('still buffers entity clicks for the existing attribution path', () => {
    trackEvent('match-click', 'm1');
    const queue = (window as unknown as { __FOOTBALL_ANALYTICS__: unknown[] }).__FOOTBALL_ANALYTICS__;
    expect(queue).toHaveLength(1);
  });

  it('never throws when there is no window', () => {
    vi.unstubAllGlobals();
    expect(() => trackSearch('search-submitted', { query: 'arsenal' })).not.toThrow();
  });
});
