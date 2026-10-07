import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAdminDashboard, normalizeDashboard } from '@/lib/admin/dashboard';

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === 'cc_at' ? { value: 'token-123' } : undefined),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

import DashboardPage from '@/app/control-center/(protected)/dashboard/page';

function envelope(data: unknown) {
  return { data, requestId: 'req-1' };
}

const FULL_PERMISSIONS = [
  'dashboard.read',
  'matches.create',
  'teams.create',
  'players.create',
  'competitions.create',
  'seasons.manage',
  'venues.manage',
  'articles.create',
];

function sessionEnvelope(permissions: string[] = FULL_PERMISSIONS) {
  return {
    data: { id: 'user-1', email: 'admin@example.com', roles: ['admin'], permissions },
    requestId: 'req-session',
  };
}

/** Route-aware fetch stub: the page asks /admin/me (session) then /admin/dashboard. */
function stubDashboardFetch(dashboardBody: unknown, sessionBody: unknown = sessionEnvelope()) {
  return vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.includes('/admin/me')) return jsonResponse(200, sessionBody);
    return jsonResponse(200, envelope(dashboardBody));
  });
}

function validPayload() {
  return {
    articles: { total: 12, published: 9, draft: 2, archived: 1, breaking: 3, review: 1, scheduled: 2, scheduledOverdue: 1 },
    transfers: { total: 7, rumour: 2 },
    matches: { upcoming: 5, live: 2, finished: 40, today: 3, total: 47, attention: 1 },
    teams: { total: 20 },
    players: { total: 500 },
    competitions: { total: 4 },
    seasons: { total: 4 },
    venues: { total: 12 },
    adminUsers: { total: 6, active: 5, disabled: 1 },
    sync: {
      queued: 1, running: 0, failed: 1, completed: 9,
      lastSuccessAt: '2026-10-03T10:00:00.000Z',
      lastFailureAt: '2026-10-03T09:00:00.000Z',
      lastFailureMessage: 'upstream timeout',
      sources: [{ id: 'ds1', name: 'Seed', provider: 'seed', isActive: true }],
      recentErrors: [{ id: 'e1', syncJobId: 'j1', entityType: 'matches', errorCode: 'TIMEOUT', message: 'upstream timeout', createdAt: '2026-10-03T09:00:00.000Z' }],
      byDomain: [
        { domain: 'matches', status: 'failed', at: '2026-10-03T09:00:00.000Z' },
        { domain: 'teams', status: 'never', at: null },
      ],
    },
    freshness: { matchesAt: '2026-10-03T10:00:00.000Z', articlesAt: null, transfersAt: null },
    activeWindow: { id: 'w1', name: 'Summer 2026', season_id: 's1', start_date: '2026-06-01', end_date: '2026-09-01' },
    liveMatches: [
      {
        id: 'm1',
        slug: 'a-v-b',
        home_team_id: 'h1h1h1h1h1',
        away_team_id: 'a1a1a1a1a1',
        scheduled_at: '2026-10-04T12:00:00.000Z',
        status: 'live',
        home_score: 1,
        away_score: 0,
        competition: { id: 'c1', name: 'Premier League', slug: 'premier-league' },
        homeTeam: { id: 'h1h1h1h1h1', name: 'Eastvale City', slug: 'eastvale-city' },
        awayTeam: { id: 'a1a1a1a1a1', name: 'Northbridge United', slug: 'northbridge-united' },
        latestMinute: 67,
        updated_at: '2026-10-04T13:00:00.000Z',
      },
    ],
    upcomingMatches: [],
    recentMatches: [],
    recentArticles: [
      {
        id: 'ar1',
        title: 'Big win for the visitors',
        slug: 'big-win',
        status: 'published',
        article_type: 'news',
        published_at: '2026-10-01',
        created_at: '2026-09-30',
      },
    ],
    recentTransfers: [
      {
        id: 't1',
        player_id: 'p1p1p1p1p1',
        from_team_id: 'f1f1f1f1f1',
        to_team_id: 't2t2t2t2t2',
        status: 'confirmed',
        effective_date: '2026-10-01',
        created_at: '2026-09-28',
      },
    ],
    recentActivity: [
      {
        id: 'al1',
        user_id: 'u1u1u1u1u1',
        action: 'create',
        entity_type: 'article',
        entity_id: 'ar1ar1ar1',
        created_at: '2026-10-03T10:00:00.000Z',
      },
    ],
  };
}

function emptyPayload() {
  return {
    articles: { total: 0, published: 0, draft: 0, archived: 0, breaking: 0, review: 0, scheduled: 0, scheduledOverdue: 0 },
    transfers: { total: 0, rumour: 0 },
    matches: { upcoming: 0, live: 0, finished: 0, today: 0, total: 0, attention: 0 },
    teams: { total: 0 },
    players: { total: 0 },
    competitions: { total: 0 },
    seasons: { total: 0 },
    venues: { total: 0 },
    adminUsers: { total: 0, active: 0, disabled: 0 },
    sync: { queued: 0, running: 0, failed: 0, completed: 0, lastSuccessAt: null, lastFailureAt: null, lastFailureMessage: null, sources: [], recentErrors: [], byDomain: [] },
    freshness: { matchesAt: null, articlesAt: null, transfersAt: null },
    activeWindow: null,
    liveMatches: [],
    upcomingMatches: [],
    recentMatches: [],
    recentArticles: [],
    recentTransfers: [],
    recentActivity: [],
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('normalizeDashboard', () => {
  it('maps a valid payload one-for-one', () => {
    const d = normalizeDashboard(validPayload());
    expect(d).not.toBeNull();
    expect(d?.articles.total).toBe(12);
    expect(d?.matches.live).toBe(2);
    expect(d?.adminUsers).toEqual({ total: 6, active: 5, disabled: 1 });
    expect(d?.activeWindow?.name).toBe('Summer 2026');
    expect(d?.liveMatches[0]?.slug).toBe('a-v-b');
    expect(d?.recentActivity[0]?.action).toBe('create');
  });

  it('rejects non-object payloads instead of fabricating a dashboard', () => {
    expect(normalizeDashboard(null)).toBeNull();
    expect(normalizeDashboard([])).toBeNull();
    expect(normalizeDashboard('nope')).toBeNull();
    expect(normalizeDashboard(42)).toBeNull();
  });

  it('degrades malformed rows to neutral values, never invented numbers', () => {
    const d = normalizeDashboard({ articles: { total: 'lots' }, matches: null, liveMatches: [{}] });
    expect(d?.articles.total).toBe(0);
    expect(d?.matches.live).toBe(0);
    expect(d?.liveMatches).toEqual([]);
    expect(d?.activeWindow).toBeNull();
  });

  it('maps extended aggregates one-for-one and degrades missing sync honestly', () => {
    const d = normalizeDashboard(validPayload());
    expect(d?.matches.total).toBe(47);
    expect(d?.matches.attention).toBe(1);
    expect(d?.articles.review).toBe(1);
    expect(d?.articles.scheduledOverdue).toBe(1);
    expect(d?.transfers.rumour).toBe(2);
    expect(d?.sync?.failed).toBe(1);
    expect(d?.sync?.byDomain).toHaveLength(2);
    expect(d?.freshness?.matchesAt).toBe('2026-10-03T10:00:00.000Z');
    expect(d?.liveMatches[0]?.homeTeam?.name).toBe('Eastvale City');
    expect(d?.liveMatches[0]?.latestMinute).toBe(67);
    expect(d?.recentMatches).toEqual([]);

    const legacy = normalizeDashboard(emptyPayload());
    expect(legacy?.sync?.failed).toBe(0);
    expect(legacy?.sync?.byDomain).toEqual([]);
    const missing = normalizeDashboard({ articles: { total: 1 } });
    expect(missing?.sync?.sources).toEqual([]);
    expect(missing?.freshness?.matchesAt).toBeNull();
  });
});

describe('fetchAdminDashboard', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok with normalized data on a valid envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, envelope(validPayload()))));
    const result = await fetchAdminDashboard();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.articles.total).toBe(12);
    }
  });

  it('sends the admin session token and asks for no store', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, envelope(validPayload())));
    vi.stubGlobal('fetch', fetchMock);
    await fetchAdminDashboard();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
    expect(init.cache).toBe('no-store');
  });

  it('maps a 401 to unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { code: 'UNAUTHORIZED' } })));
    await expect(fetchAdminDashboard()).resolves.toEqual({ status: 'unauthenticated' });
  });

  it('maps a 403 to forbidden, distinct from signed-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: { code: 'FORBIDDEN' } })));
    await expect(fetchAdminDashboard()).resolves.toEqual({ status: 'forbidden' });
  });

  it('turns a 5xx/network failure into a retryable error state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
    await expect(fetchAdminDashboard()).resolves.toMatchObject({ status: 'error' });
  });

  it('rejects a malformed body as an error, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, envelope(42))));
    await expect(fetchAdminDashboard()).resolves.toMatchObject({ status: 'error' });
  });
});

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the real payload: totals, panels and the active window', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Dashboard');
    expect(html).toContain('Articles');
    expect(html).toContain('>12<');
    expect(html).toContain('Live matches');
    expect(html).toContain('Upcoming matches');
    expect(html).toContain('Recent articles');
    expect(html).toContain('Recent transfers');
    expect(html).toContain('Recent admin activity');
    expect(html).toContain('Summer 2026');
    expect(html).toContain('Big win for the visitors');
    expect(html).toContain('create');
    expect(html).toContain('No upcoming matches');
  });

  it('renders a dashboard-level empty state when nothing exists yet', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(emptyPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('No data yet');
  });

  it('shows Access denied when the admin lacks dashboard.read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/admin/me')) return jsonResponse(200, sessionEnvelope());
      return jsonResponse(403, { error: { code: 'FORBIDDEN' } });
    }));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Access denied');
  });

  it('shows the error state with a retry control on API failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('/admin/me')) return jsonResponse(200, sessionEnvelope());
      throw new Error('down');
    }));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Dashboard unavailable');
    expect(html).toContain('Refresh');
  });

  it('does not leak a dashboard body when forbidden or failing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(403, { error: {} })));
    const forbidden = renderToString(await DashboardPage());
    expect(forbidden).not.toContain('Total articles');
    expect(forbidden).not.toContain('Recent admin activity');
  });

  it('links KPI cards to their management pages', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    for (const href of ['/control-center/matches', '/control-center/teams', '/control-center/players', '/control-center/competitions', '/control-center/articles', '/control-center/transfers', '/control-center/seasons', '/control-center/venues', '/control-center/users']) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('renders the live monitor with names, score, minute and a view link', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Eastvale City');
    expect(html).toContain('Northbridge United');
    expect(html).toContain('Premier League');
    expect(html).toContain('67');
    expect(html).toContain('View match');
    expect(html).toContain('/control-center/matches/m1');
  });

  it('derives attention alerts from real numbers only', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Attention required');
    expect(html).toContain('1 sync job');
    expect(html).toContain('failed');
    expect(html).toContain('past its publish time');
    expect(html).toContain('upstream timeout');
  });

  it('reports an all-clear when no real problems exist', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(emptyPayload()));
    // Empty payload renders the dashboard-level empty state instead.
    const empty = renderToString(await DashboardPage());
    expect(empty).toContain('No data yet');
    const clean = validPayload();
    clean.sync = { ...clean.sync, queued: 0, running: 0, failed: 0 };
    clean.articles.scheduledOverdue = 0;
    clean.matches.attention = 0;
    clean.articles.review = 0;
    clean.transfers.rumour = 0;
    vi.stubGlobal('fetch', stubDashboardFetch(clean));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('No issues detected');
  });

  it('renders system health with providers, domains and freshness', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('System health');
    expect(html).toContain('operational');
    expect(html).toContain('Seed');
    expect(html).toContain('Sync status by domain');
    expect(html).toContain('Never synced');
    expect(html).toContain('Recent sync errors');
    expect(html).toContain('TIMEOUT');
    expect(html).toContain('Freshness');
  });

  it('marks sync execution honestly when no run endpoint exists', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload()));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('no run-sync endpoint exists');
    expect(html).not.toContain('Run sync');
  });

  it('gates quick actions on the real session permissions', async () => {
    vi.stubGlobal('fetch', stubDashboardFetch(validPayload(), sessionEnvelope(['dashboard.read', 'teams.create'])));
    const html = renderToString(await DashboardPage());
    expect(html).toContain('Quick actions');
    expect(html).toContain('/control-center/teams/new');
    expect(html).not.toContain('/control-center/matches/new');
    expect(html).not.toContain('/control-center/articles/new');
  });
});

describe('dashboard layout contract', () => {
  it('keeps the panel responsive at 768/1024/1440 with an overflow-safe grid', () => {
    const css = readFileSync(new URL('../src/styles/admin.css', import.meta.url), 'utf-8');
    expect(css).toContain('@media (min-width: 768px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (min-width: 1440px)');
    expect(css).toContain('minmax(0, 1fr)');
    expect(css).toContain('.cc-table-wrap');
    expect(css).toContain('overflow-x: auto');
  });

  it('renders no public site chrome inside the dashboard page source', () => {
    const source = readFileSync(
      new URL('../src/app/control-center/(protected)/dashboard/page.tsx', import.meta.url),
      'utf-8',
    );
    for (const chrome of ['SiteHeader', 'SiteFooter', 'MobileBottomNav']) {
      expect(source).not.toContain(chrome);
    }
  });
});
