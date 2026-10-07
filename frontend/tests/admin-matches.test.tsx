import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminMatches, normalizeMatchesListResult } from '@/lib/admin/matches';
import { matchesQueryToSearch, parseMatchesQuery } from '@/lib/admin/match-query';

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

// Next 14's bundled React provides the action/form-status hooks; the vitest
// React 18.3.1 does not. Stub them so client form components can render.
// They live in two different modules: useActionState is imported from 'react',
// useFormStatus/useFormState from 'react-dom'.
vi.mock('react', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useActionState: (action: unknown, initialState: unknown) => [initialState, () => undefined, false],
  };
});

vi.mock('react-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useActionState: (action: unknown, initialState: unknown) => [initialState, () => undefined, false],
    useFormStatus: () => ({ pending: false }),
    useFormState: (action: unknown, initialState: unknown) => [initialState, () => undefined, false],
  };
});

import MatchesPage from '@/app/control-center/(protected)/matches/page';
import MatchDetailPage from '@/app/control-center/(protected)/matches/[id]/page';
import {
  createMatchAction,
  createEventAction,
  deleteMatchAction,
  deleteEventAction,
  updateEventAction,
  updateMatchAction,
} from '@/app/control-center/matches/actions';

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
const VID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const ROW = {
  id: 'm1',
  slug: 'home-vs-away',
  competition_id: CID,
  season_id: SID,
  venue_id: VID,
  home_team_id: FD,
  away_team_id: TD,
  scheduled_at: '2026-10-04T15:00:00.000Z',
  status: 'scheduled',
  home_score: null,
  away_score: null,
  home_score_ht: null,
  away_score_ht: null,
  home_score_et: null,
  away_score_et: null,
  home_score_pen: null,
  away_score_pen: null,
  round: null,
  matchday: null,
  referee_name: null,
  attendance: null,
  created_at: '2026-09-30',
  updated_at: '2026-09-30',
};

function listEnvelope(rows: unknown[] = [ROW]) {
  return json(200, { data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 }, requestId: 'r1' });
}

const DETAIL = {
  ...ROW,
  homeTeam: { id: FD, name: 'Home FC', slug: 'home-fc' },
  awayTeam: { id: TD, name: 'Away FC', slug: 'away-fc' },
  competition: { id: CID, name: 'Premier League', slug: 'premier-league' },
  season: { id: SID, name: '2026/27', competition_id: CID },
  venue: { id: VID, name: 'Stadium', slug: 'stadium' },
  dependents: { match_events: 0, match_lineups: 0, match_team_statistics: 0, match_player_statistics: 0, article_matches: 0 },
};

const EVENT = {
  id: 'e1',
  match_id: 'm1',
  team_id: FD,
  player_id: PD,
  assist_player_id: null,
  type: 'goal',
  minute: 23,
  extra_minute: null,
  description: 'Header from a corner',
  created_at: '2026-10-04T15:23:00.000Z',
  updated_at: '2026-10-04T15:23:00.000Z',
};

function detailRoutes(permissions: string[], withEvents = true) {
  const routes: Record<string, () => Response> = {
    '/admin/me': () => meEnvelope(permissions),
    '/admin/matches/m1': () => json(200, { data: DETAIL }),
    '/api/v1/teams': () => json(200, { data: [] }),
    '/api/v1/players': () => json(200, { data: [] }),
  };
  if (withEvents) routes['/admin/matches/m1/events'] = () => json(200, { data: [EVENT], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } });
  return routes;
}

describe('parseMatchesQuery / matchesQueryToSearch', () => {
  it('defaults and clamps', () => {
    expect(parseMatchesQuery({})).toMatchObject({ page: 1, limit: 20 });
    expect(parseMatchesQuery({ page: '-2', limit: '999', sort: 'sideways', from: 'nope' })).toMatchObject({ page: 1, limit: 100, sort: undefined, from: undefined });
  });

  it('round-trips set values only', () => {
    const q = parseMatchesQuery({ page: '2', status: 'live', competitionId: CID, from: '2026-01-01', sort: 'asc' });
    expect(matchesQueryToSearch(q).toString()).toBe('page=2&limit=20&status=live&competitionId=ffffffff-ffff-4fff-8fff-ffffffffffff&from=2026-01-01&sort=asc');
  });
});

describe('normalizeMatchesListResult', () => {
  it('maps rows and drops malformed ones', () => {
    const r = normalizeMatchesListResult({ data: [{}, ROW], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.rows).toHaveLength(1);
  });
});

describe('fetchAdminMatches', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('maps 401/403/error', async () => {
    stubFetchByUrl({ '/admin/matches': () => json(401, {}) });
    await expect(fetchAdminMatches({ page: 1, limit: 20 })).resolves.toEqual({ status: 'unauthenticated' });
    stubFetchByUrl({ '/admin/matches': () => json(403, {}) });
    await expect(fetchAdminMatches({ page: 1, limit: 20 })).resolves.toEqual({ status: 'forbidden' });
    stubFetchByUrl({ '/admin/matches': () => { throw new Error('down'); } });
    await expect(fetchAdminMatches({ page: 1, limit: 20 })).resolves.toMatchObject({ status: 'error' });
  });
});

describe('MatchesPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function fullRoutes(permissions: string[], rows: unknown[] = [ROW]) {
    return {
      '/admin/me': () => meEnvelope(permissions),
      '/admin/matches': () => listEnvelope(rows),
      '/api/v1/competitions': () => json(200, { data: [] }),
      '/admin/seasons': () => json(200, { data: [] }),
      '/api/v1/teams': () => json(200, { data: [] }),
    };
  }

  it('renders rows with status and score', async () => {
    stubFetchByUrl(fullRoutes(['matches.read', 'matches.create', 'matches.update', 'matches.delete']));
    const html = renderToString(await MatchesPage({ searchParams: {} }));
    expect(html).toContain('scheduled');
    expect(html).toContain('New match');
  });

  it('hides actions when permissions are missing', async () => {
    stubFetchByUrl(fullRoutes(['matches.read']));
    const html = renderToString(await MatchesPage({ searchParams: {} }));
    expect(html).not.toContain('New match');
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Edit');
  });

  it('renders empty state', async () => {
    stubFetchByUrl(fullRoutes(['matches.read'], []));
    const html = renderToString(await MatchesPage({ searchParams: {} }));
    expect(html).toContain('No matches found');
  });

  it('renders access denied when forbidden', async () => {
    stubFetchByUrl({ '/admin/me': () => json(403, {}), '/admin/matches': () => listEnvelope() });
    const html = renderToString(await MatchesPage({ searchParams: {} }));
    expect(html).toContain('Access denied');
  });

  it('renders error state when the API fails', async () => {
    stubFetchByUrl({
      '/admin/me': () => meEnvelope(['matches.read']),
      '/admin/matches': () => { throw new Error('down'); },
      '/api/v1/competitions': () => json(200, { data: [] }),
      '/admin/seasons': () => json(200, { data: [] }),
      '/api/v1/teams': () => json(200, { data: [] }),
    });
    const html = renderToString(await MatchesPage({ searchParams: {} }));
    expect(html).toContain('Matches unavailable');
  });
});

describe('MatchDetailPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  it('renders resolved names, score and events for managers', async () => {
    stubFetchByUrl(detailRoutes(['matches.read', 'match_events.manage']));
    const html = renderToString(await MatchDetailPage({ params: { id: 'm1' } }));
    expect(html).toContain('Home FC');
    expect(html).toContain('Away FC');
    expect(html).toContain('Premier League');
    expect(html).toContain('goal');
    expect(html).toContain('Add event');
  });

  it('shows the no-permission note without match_events.manage', async () => {
    stubFetchByUrl(detailRoutes(['matches.read'], false));
    const html = renderToString(await MatchDetailPage({ params: { id: 'm1' } }));
    expect(html).toContain('Home FC');
    expect(html).not.toContain('Add event');
    expect(html).toContain('match_events.manage');
  });

  it('renders access denied when forbidden', async () => {
    stubFetchByUrl({ '/admin/me': () => json(403, {}), '/admin/matches/m1': () => json(200, { data: DETAIL }) });
    const html = renderToString(await MatchDetailPage({ params: { id: 'm1' } }));
    expect(html).toContain('Access denied');
  });
});

describe('match server actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function validMatchForm() {
    const fd = new FormData();
    fd.set('competition_id', CID);
    fd.set('home_team_id', FD);
    fd.set('away_team_id', TD);
    fd.set('scheduled_at', '2026-10-04T15:00');
    return fd;
  }

  it('create rejects an empty submission without calling the API', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.create']) });
    const result = await createMatchAction({}, new FormData());
    expect(result.error).toContain('fix the highlighted fields');
    expect(result.fields?.competition_id).toBeDefined();
    expect(result.fields?.home_team_id).toBeDefined();
  });

  it('create rejects home == away', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.create']) });
    const fd = validMatchForm();
    fd.set('away_team_id', FD);
    const result = await createMatchAction({}, fd);
    expect(result.fields?.away_team_id).toBeDefined();
  });

  it('create posts the payload and redirects', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['matches.create']),
      '/admin/matches': () => json(201, { data: { ...ROW, id: 'new-1' } }),
    });
    await expect(createMatchAction({}, validMatchForm())).rejects.toThrow('NEXT_REDIRECT');
    const postCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/matches') && !String(input).includes('/admin/me'));
    expect(postCall).toBeTruthy();
    const [, init] = postCall as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('"competition_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"');
  });

  it('create is blocked without matches.create', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.read']) });
    const result = await createMatchAction({}, validMatchForm());
    expect(result.error).toContain('permission');
  });

  it('update rejects invalid input and patches when valid', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.update']) });
    expect((await updateMatchAction('m1', {}, new FormData())).error).toContain('fix the highlighted fields');

    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['matches.update']),
      '/admin/matches/m1': () => json(200, { data: ROW }),
    });
    const result = await updateMatchAction('m1', {}, validMatchForm());
    expect(result.success).toBe('Changes saved.');
    const patchCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/matches/m1'));
    expect((patchCall![1] as RequestInit).method).toBe('PATCH');
  });

  it('delete fails closed and respects permissions', async () => {
    cookieValue = undefined;
    expect((await deleteMatchAction('m1')).error).toContain('session');

    cookieValue = 'token-123';
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.read']) });
    expect((await deleteMatchAction('m1')).error).toContain('permission');

    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['matches.delete']),
      '/admin/matches/m1': () => json(200, { data: { id: 'm1', deleted: true } }),
    });
    expect((await deleteMatchAction('m1')).success).toBe('Match deleted.');
    const del = fn.mock.calls.find(([input]) => String(input).includes('/admin/matches/m1'));
    expect((del![1] as RequestInit).method).toBe('DELETE');
  });
});

describe('match event actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    cookieValue = 'token-123';
  });

  function validEventForm() {
    const fd = new FormData();
    fd.set('type', 'goal');
    fd.set('minute', '23');
    fd.set('team_id', FD);
    fd.set('player_id', PD);
    return fd;
  }

  it('create rejects invalid input without calling the API', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['match_events.manage']) });
    const result = await createEventAction('m1', {}, new FormData());
    expect(result.error).toContain('fix the highlighted fields');
    expect(result.fields?.type).toBeDefined();
  });

  it('create posts and is blocked without the manage permission', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['match_events.manage']),
      '/admin/matches/m1/events': () => json(201, { data: EVENT }),
    });
    const result = await createEventAction('m1', {}, validEventForm());
    expect(result.success).toBe('Event added.');
    const postCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/matches/m1/events'));
    expect((postCall![1] as RequestInit).method).toBe('POST');

    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.read']) });
    expect((await createEventAction('m1', {}, validEventForm())).error).toContain('permission');
  });

  it('update patches and delete removes', async () => {
    const fn = stubFetchByUrl({
      '/admin/me': () => meEnvelope(['match_events.manage']),
      '/admin/matches/m1/events/e1': () => json(200, { data: EVENT }),
    });
    const upd = await updateEventAction('m1', 'e1', {}, validEventForm());
    expect(upd.success).toBe('Event updated.');
    const patchCall = fn.mock.calls.find(([input]) => String(input).includes('/admin/matches/m1/events/e1'));
    expect((patchCall![1] as RequestInit).method).toBe('PATCH');

    const del = await deleteEventAction('m1', 'e1');
    expect(del.success).toBe('Event deleted.');
    const delCall = fn.mock.calls.filter(([input]) => String(input).includes('/admin/matches/m1/events/e1'));
    expect((delCall[delCall.length - 1]![1] as RequestInit).method).toBe('DELETE');
  });

  it('event actions are blocked without match_events.manage', async () => {
    stubFetchByUrl({ '/admin/me': () => meEnvelope(['matches.read']) });
    expect((await updateEventAction('m1', 'e1', {}, validEventForm())).error).toContain('permission');
    expect((await deleteEventAction('m1', 'e1')).error).toContain('permission');
  });
});

describe('responsive/chrome contracts', () => {
  it('keeps the filter grid breakpoints', () => {
    const css = readFileSync(new URL('../src/styles/admin.css', import.meta.url), 'utf-8');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('.cc-filters');
    expect(css).toContain('.cc-event-manager');
  });

  it('no public chrome in matches pages', () => {
    const page = readFileSync(new URL('../src/app/control-center/(protected)/matches/page.tsx', import.meta.url), 'utf-8');
    for (const chrome of ['SiteHeader', 'SiteFooter', 'MobileBottomNav']) expect(page).not.toContain(chrome);
  });
});
