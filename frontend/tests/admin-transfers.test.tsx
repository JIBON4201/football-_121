import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminTransfers, normalizeTransfersListResult } from '@/lib/admin/transfers';
import { parseTransfersQuery, transfersQueryToSearch } from '@/lib/admin/transfer-query';

let cookieValue: string | undefined = 'token-123';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'cc_at' && cookieValue ? { value: cookieValue } : undefined) }),
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

import TransfersPage from '@/app/control-center/(protected)/transfers/page';
import { createTransferAction, deleteTransferAction, updateTransferAction } from '@/app/control-center/transfers/actions';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetchByUrl(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [key, handler] of Object.entries(routes)) {
      if (url.includes(key)) return handler(init);
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function meEnvelope(permissions: string[]) {
  return json(200, { data: { id: 'u1', email: 'admin@example.com', roles: ['admin'], permissions } });
}

const PD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const ROW = {
  id: 'tr1',
  player_id: PD,
  from_team_id: FD,
  to_team_id: TD,
  transfer_type: 'permanent',
  status: 'announced',
  fee: 5000000,
  currency: 'EUR',
  announcement_date: '2026-08-01T00:00:00.000Z',
  effective_date: '2026-08-15T00:00:00.000Z',
  season_id: SID,
  window_id: WID,
  created_at: '2026-08-01',
  updated_at: '2026-08-02',
};

function listEnvelope(rows: unknown[] = [ROW]) {
  return json(200, { data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 }, requestId: 'r1' });
}

describe('parseTransfersQuery / transfersQueryToSearch', () => {
  it('defaults and clamps', () => {
    expect(parseTransfersQuery({})).toMatchObject({ page: 1, limit: 20 });
    expect(parseTransfersQuery({ page: '-2', limit: '999', sort: 'sideways', sortField: 'title' })).toMatchObject({ page: 1, limit: 100, sort: undefined, sortField: undefined });
  });

  it('round-trips set values only', () => {
    const q = parseTransfersQuery({ page: '2', status: 'announced', sortField: 'announcement_date', sort: 'asc' });
    expect(transfersQueryToSearch(q).toString()).toBe('page=2&limit=20&status=announced&sort=asc&sortField=announcement_date');
  });
});

describe('normalizeTransfersListResult', () => {
  it('maps rows and drops malformed ones', () => {
    const r = normalizeTransfersListResult({ data: [{}, ROW], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.rows).toHaveLength(1);
  });
});

describe('fetchAdminTransfers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('maps 401/403/error', async () => {
    stubFetchByUrl({ '/admin/transfers': () => json(401, {}) });
    await expect(fetchAdminTransfers({ page: 1, limit: 20 })).resolves.toEqual({ status: 'unauthenticated' });
    stubFetchByUrl({ '/admin/transfers': () => json(403, {}) });
    await expect(fetchAdminTransfers({ page: 1, limit: 20 })).resolves.toEqual({ status: 'forbidden' });
    stubFetchByUrl({ '/admin/transfers': () => { throw new Error('down'); } });
    await expect(fetchAdminTransfers({ page: 1, limit: 20 })).resolves.toMatchObject({ status: 'error' });
  });
});

describe('TransfersPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function fullRoutes(permissions: string[], rows: unknown[] = [ROW]) {
    return {
      '/admin/me': () => meEnvelope(permissions),
      '/admin/transfers': () => listEnvelope(rows),
      '/players': () => json(200, { data: [] }),
      '/admin/seasons': () => json(200, { data: [] }),
      '/api/v1/teams': () => json(200, { data: [] }),
      '/transfers/windows': () => json(200, { data: [] }),
    };
  }

  it('renders rows with fee, status and type', async () => {
    stubFetchByUrl(fullRoutes(['transfers.read', 'transfers.create', 'transfers.update', 'transfers.delete']));
    const html = renderToString(await TransfersPage({ searchParams: {} }));
    expect(html).toContain('announced');
    expect(html).toContain('permanent');
    expect(html).toContain('5,000,000 EUR');
    expect(html).toContain('New transfer');
  });

  it('hides actions when permissions are missing', async () => {
    stubFetchByUrl(fullRoutes(['transfers.read']));
    const html = renderToString(await TransfersPage({ searchParams: {} }));
    expect(html).not.toContain('New transfer');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Edit');
  });

  it('renders empty state', async () => {
    stubFetchByUrl(fullRoutes(['transfers.read'], []));
    const html = renderToString(await TransfersPage({ searchParams: {} }));
    expect(html).toContain('No transfers found');
  });

  it('renders access denied when forbidden', async () => {
    stubFetchByUrl({ '/admin/me': () => json(403, {}), '/admin/transfers': () => listEnvelope() });
    const html = renderToString(await TransfersPage({ searchParams: {} }));
    expect(html).toContain('Access denied');
  });

  it('renders error state when the API fails', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['transfers.read']),
      '/admin/transfers': () => { throw new Error('down'); },
      '/players': () => json(200, { data: [] }),
      '/admin/seasons': () => json(200, { data: [] }),
      '/api/v1/teams': () => json(200, { data: [] }),
      '/transfers/windows': () => json(200, { data: [] }),
    });
    const html = renderToString(await TransfersPage({ searchParams: {} }));
    expect(html).toContain('Transfers unavailable');
  });
});

describe('transfer server actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function validFormData() {
    const fd = new FormData();
    fd.set('player_id', PD);
    fd.set('season_id', SID);
    fd.set('transfer_type', 'permanent');
    fd.set('from_team_id', FD);
    fd.set('to_team_id', TD);
    fd.set('fee', '1000000');
    fd.set('currency', 'EUR');
    return fd;
  }

  it('create rejects an empty submission without calling the API', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['transfers.create']) });
    const result = await createTransferAction({}, new FormData());
    expect(result.error).toContain('fix the highlighted fields');
    expect(result.fields?.player_id).toBeDefined();
    expect(result.fields?.season_id).toBeDefined();
  });

  it('create posts the payload and redirects', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['transfers.create']),
      '/admin/transfers': () => json(201, { data: { ...ROW, id: 'new-1' } }),
    });
    await expect(createTransferAction({}, validFormData())).rejects.toThrow('NEXT_REDIRECT');
    const postCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/transfers') && !String(input).includes('/admin/me'));
    expect(postCall).toBeTruthy();
    const [, init] = postCall as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('"transfer_type":"permanent"');
  });

  it('create is blocked without transfers.create', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['transfers.read']) });
    const result = await createTransferAction({}, validFormData());
    expect(result.error).toContain('permission');
  });

  it('create rejects from == to teams', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['transfers.create']) });
    const fd = validFormData();
    fd.set('to_team_id', FD);
    const result = await createTransferAction({}, fd);
    expect(result.fields?.to_team_id).toBeDefined();
  });

  it('update rejects invalid input and patches when valid', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['transfers.update']) });
    expect((await updateTransferAction('tr1', {}, new FormData())).error).toContain('fix the highlighted fields');

    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['transfers.update']),
      '/admin/transfers/tr1': () => json(200, { data: ROW }),
    });
    const result = await updateTransferAction('tr1', {}, validFormData());
    expect(result.success).toBe('Changes saved.');
    const patchCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/transfers/tr1'));
    expect((patchCall![1] as RequestInit).method).toBe('PATCH');
  });

  it('delete fails closed and respects permissions', async () => {
    cookieValue = undefined;
    expect((await deleteTransferAction('tr1')).error).toContain('session');

    cookieValue = 'token-123';
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['transfers.read']) });
    expect((await deleteTransferAction('tr1')).error).toContain('permission');

    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['transfers.delete']),
      '/admin/transfers/tr1': () => json(200, { data: { id: 'tr1', deleted: true } }),
    });
    expect((await deleteTransferAction('tr1')).success).toBe('Transfer deleted.');
    const del = fn.mock.calls.find(([input]) => String(input).includes('/admin/transfers/tr1'));
    expect((del![1] as RequestInit).method).toBe('DELETE');
  });
});

describe('responsive/chrome contracts', () => {
  it('keeps the filter grid breakpoints', () => {
    const css = readFileSync(new URL('../src/styles/admin.css', import.meta.url), 'utf-8');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('.cc-filters');
  });

  it('no public chrome in transfers pages', () => {
    const page = readFileSync(new URL('../src/app/control-center/(protected)/transfers/page.tsx', import.meta.url), 'utf-8');
    for (const chrome of ['SiteHeader', 'SiteFooter', 'MobileBottomNav']) expect(page).not.toContain(chrome);
  });
});
