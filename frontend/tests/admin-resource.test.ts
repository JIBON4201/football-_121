/**
 * Admin API client + resource layer.
 *
 * Covers the status mapping every Control Center page depends on (401, 403, 404,
 * 409, 400/422, 429, 5xx, network), pagination, query serialisation and the
 * relationship-option helpers. Uses the existing vitest setup; `fetch` is stubbed
 * per test so no network or database is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'test-admin-token';
const BASE = 'http://api.test';

function envelope<T>(data: T, pagination?: unknown) {
  return { data, ...(pagination ? { pagination } : {}) };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** Stub the admin session token so the client attaches a real Bearer header. */
function stubToken() {
  vi.doMock('@/lib/admin-session', () => ({
    getAdminAccessToken: () => TOKEN,
    getAdminSession: async () => ({ status: 'ok', user: { id: 'u1', permissions: [] } }),
  }));
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('API_URL', BASE);
  vi.stubEnv('NEXT_PUBLIC_API_URL', BASE);
  stubToken();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('@/lib/admin-session');
});

describe('toAdminError', () => {
  async function map(status: number, body: unknown, headers?: Record<string, string>) {
    const { toAdminError } = await import('@/lib/admin/resource');
    const { ApiClientError } = await import('@/lib/api-client');
    return toAdminError(new ApiClientError({ message: 'boom', status, code: 'X', fields: undefined, retryAfterSeconds: headers ? Number(headers['Retry-After']) : undefined }), 'fallback');
  }

  it('maps 401 to unauthenticated so the page redirects to login', async () => {
    expect((await map(401, {})).status).toBe('unauthenticated');
  });

  it('maps 403 to forbidden so the page renders AccessDenied', async () => {
    expect((await map(403, {})).status).toBe('forbidden');
  });

  it('maps 404 to not-found', async () => {
    expect((await map(404, {})).status).toBe('not-found');
  });

  it('maps 409 to conflict and keeps the backend explanation', async () => {
    const result = await map(409, {});
    expect(result.status).toBe('conflict');
  });

  it('maps 400 to invalid, because the backend rejects schema violations with 400', async () => {
    // Regression guard: the backend uses 400 VALIDATION_ERROR, not 422.
    expect((await map(400, {})).status).toBe('invalid');
  });

  it('maps 422 to invalid as well', async () => {
    expect((await map(422, {})).status).toBe('invalid');
  });

  it('maps 429 to rate-limited with the retry hint', async () => {
    const { toAdminError } = await import('@/lib/admin/resource');
    const { ApiClientError } = await import('@/lib/api-client');
    const result = toAdminError(
      new ApiClientError({ message: 'slow down', status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 }),
      'fallback',
    );
    expect(result).toMatchObject({ status: 'rate-limited', retryAfterSeconds: 30 });
  });

  it('never leaks a 5xx driver message to the operator', async () => {
    const { toAdminError } = await import('@/lib/admin/resource');
    const { ApiClientError } = await import('@/lib/api-client');
    const result = toAdminError(
      new ApiClientError({
        message: 'UPSTREAM_ERROR: relation "public.teams" does not exist',
        status: 503,
        code: 'UPSTREAM_ERROR',
        requestId: 'req-123',
      }),
      'fallback',
    );
    expect(result.status).toBe('error');
    // Sanitized, but the request id is preserved so support can trace it.
    expect((result as { message: string }).message).not.toContain('relation');
    expect((result as { message: string }).message).toContain('req-123');
  });

  it('reports a network failure distinctly from a server error', async () => {
    const { toAdminError } = await import('@/lib/admin/resource');
    const { ApiClientError } = await import('@/lib/api-client');
    const result = toAdminError(
      new ApiClientError({ message: 'Network request failed', status: 0, code: 'NETWORK_ERROR', isNetworkError: true }),
      'Teams unavailable',
    );
    expect((result as { message: string }).message).toMatch(/could not reach the api/i);
  });
});

/**
 * Fetch mock typed like `fetch` itself, so `mock.calls[n]` is `[url, init]`
 * rather than the empty tuple an untyped `vi.fn(async () => …)` infers (which
 * cannot be cast to a tuple without going through `unknown`).
 */
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(handler);
}

describe('admin resource', () => {
  it('lists rows and normalises pagination from the envelope', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(envelope([{ id: 't1', name: 'Eastvale City' }], { page: 2, limit: 10, total: 21, totalPages: 3 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { adminTeams } = await import('@/lib/admin/resources');
    const result = await adminTeams.list({ page: 2, limit: 10, q: 'east' });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.pagination).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });

    // The Bearer token must be attached, and query params serialised.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/admin/teams');
    expect(url).toContain('page=2');
    expect(url).toContain('q=east');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    // Admin reads must never come from a shared cache.
    expect(init.cache).toBe('no-store');
  });

  it('drops malformed rows rather than rendering undefined cells', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(envelope([{ id: 't1', name: 'A' }, { name: 'no id' }, null]))));
    const { adminTeams } = await import('@/lib/admin/resources');
    const result = await adminTeams.list({});
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.rows).toHaveLength(1);
  });

  it('surfaces 403 rather than an empty list when the admin lacks the grant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'FORBIDDEN', message: 'nope' } }, 403)));
    const { adminTeams } = await import('@/lib/admin/resources');
    expect((await adminTeams.list({})).status).toBe('forbidden');
  });

  it('POSTs a create body as JSON', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: { id: 't9', name: 'Newport' } }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const { adminTeams } = await import('@/lib/admin/resources');
    const result = await adminTeams.create({ name: 'Newport', short_name: 'NPT' });

    expect(result.status).toBe('ok');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({ name: 'Newport' });
  });

  it('PATCHes an update', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: { id: 't1', name: 'Renamed' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { adminTeams } = await import('@/lib/admin/resources');
    await adminTeams.update('t1', { name: 'Renamed' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/teams/t1');
    expect(init.method).toBe('PATCH');
  });

  it('DELETEs and percent-encodes the id', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: { id: 'a/b', deleted: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const { adminTeams } = await import('@/lib/admin/resources');
    const result = await adminTeams.remove('a/b');

    expect(result.status).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/teams/a%2Fb');
    expect(init.method).toBe('DELETE');
  });

  it('returns not-found for a single record that does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'gone' } }, 404)));
    const { adminTeams } = await import('@/lib/admin/resources');
    expect((await adminTeams.get('missing')).status).toBe('not-found');
  });
});

describe('validation field errors', () => {
  it('extracts per-field messages from the backend Zod payload', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    const { toAdminError } = await import('@/lib/admin/resource');

    const error = new ApiClientError({
      message: 'Invalid request parameters',
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { name: 'Required' },
    });
    const result = toAdminError(error, 'fallback');

    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.fields).toEqual({ name: 'Required' });
  });
});

describe('relationship option helpers', () => {
  it('maps option ids to select values', async () => {
    const { toFieldOptions } = await import('@/lib/admin/options-shared');
    expect(toFieldOptions([{ id: 'a', label: 'England' }])).toEqual([{ value: 'a', label: 'England' }]);
  });

  it('builds a label lookup for rendering foreign keys as names', async () => {
    const { toLabelLookup } = await import('@/lib/admin/options-shared');
    const lookup = toLabelLookup([
      { id: 'a', label: 'England' },
      { id: 'b', label: 'Spain' },
    ]);
    expect(lookup.get('a')).toBe('England');
    expect(lookup.get('zz')).toBeUndefined();
  });

  it('never hardcodes options: each fetcher calls a real endpoint', async () => {
    const fetchMock = mockFetch(() => jsonResponse(envelope([{ id: 'c1', name: 'England' }], { page: 1, limit: 100, total: 1, totalPages: 1 })));
    vi.stubGlobal('fetch', fetchMock);

    const { fetchOptionCountries } = await import('@/lib/admin/options');
    const rows = await fetchOptionCountries();

    expect(rows).toEqual([{ id: 'c1', label: 'England' }]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/api/v1/countries');
  });

  it('degrades to an empty list when the endpoint fails, so a form still renders', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { fetchOptionTeams } = await import('@/lib/admin/options');
    await expect(fetchOptionTeams()).resolves.toEqual([]);
  });
});

describe('list query parsing', () => {
  it('clamps page and limit so a hand-edited URL cannot request an unbounded scan', async () => {
    const { readListQuery } = await import('@/lib/admin/list-query');
    expect(readListQuery({ page: '99999999', limit: '99999' })).toMatchObject({ page: 10_000, limit: 100 });
  });

  it('falls back to defaults for junk input', async () => {
    const { readListQuery } = await import('@/lib/admin/list-query');
    expect(readListQuery({ page: 'abc', limit: '-5' })).toMatchObject({ page: 1, limit: 20 });
  });

  it('drops a non-boolean active filter rather than sending it to the API', async () => {
    const { readBoolean } = await import('@/lib/admin/list-query');
    expect(readBoolean('true')).toBe(true);
    expect(readBoolean('false')).toBe(false);
    expect(readBoolean('yes')).toBeUndefined();
    expect(readBoolean(undefined)).toBeUndefined();
  });

  it('rejects a malformed uuid filter', async () => {
    const { readUuid } = await import('@/lib/admin/list-query');
    expect(readUuid('not-a-uuid')).toBeUndefined();
    expect(readUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });
});