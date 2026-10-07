import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { generateMetadata as competitionsMetadataFn } from '@/app/(site)/competitions/page';
import { generateMetadata as competitionMetadata } from '@/app/(site)/competitions/[slug]/page';
import {
  COMPETITION_CANONICAL,
  COMPETITION_VIEWS,
  competitionHref,
  fetchCompetitionDetail,
  fetchCompetitionList,
  fetchCompetitionMatches,
  fetchCompetitionNews,
  fetchStandings,
  orderSeasons,
  parseCompetitionSelection,
  parseCompetitionView,
  parseSeasonId,
  resolveSeason,
  toCompetitionDetails,
  viewLabel,
  type CompetitionRecord,
  type Season,
  type StandingRow,
  type StandingTeam,
} from '@/lib/competitions';
import { CompetitionCard, CompetitionHeader, CompetitionNav, SeasonSelector, competitionTypeLabel } from '@/components/competitions/CompetitionHeader';
import { CompetitionNews, CompetitionOverview, CompetitionTeams } from '@/components/competitions/CompetitionSections';
import { StandingsTable, STANDING_COLUMNS } from '@/components/competitions/StandingsTable';
import { StandingsView } from '@/components/competitions/StandingsView';
import type { Article } from '@/types/api';

const competition: CompetitionRecord = {
  id: 'comp-1',
  name: 'Premier League',
  short_name: 'EPL',
  slug: 'premier-league',
  logo_url: 'https://cdn.test/epl.png',
  type: 'league',
  gender: 'men',
  is_active: true,
  country: null,
};

const country = { id: 'c-1', name: 'England', slug: 'england', code: 'ENG', flag_url: null };

const season = (overrides: Partial<Season> = {}): Season => ({
  id: 'season-current',
  competition_id: 'comp-1',
  name: '2026/27',
  start_date: '2026-08-01',
  end_date: '2027-05-31',
  is_current: true,
  ...overrides,
});

const team = (overrides: Partial<StandingTeam> = {}): StandingTeam => ({
  id: 'team-1',
  name: 'FC Example',
  short_name: 'FCE',
  slug: 'fc-example',
  logo_url: 'https://cdn.test/fce.png',
  ...overrides,
});

const row = (overrides: Partial<StandingRow> = {}): StandingRow => ({
  team_id: 'team-1',
  position: 1,
  played: 10,
  won: 7,
  drawn: 2,
  lost: 1,
  goals_for: 20,
  goals_against: 7,
  goal_difference: 13,
  points: 23,
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'article-1',
  title: 'Title win',
  slug: 'title-win',
  excerpt: null,
  article_type: 'match_report',
  published_at: '2026-09-01T10:00:00.000Z',
  is_featured: false,
  is_breaking: false,
  view_count: 3,
  ...overrides,
});

function mockApi(
  respond: (pathname: string, url: URL) => { status: number; body: unknown } | null,
  seen?: Array<{ url: string; init?: unknown }>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      seen?.push({ url, init });
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\/api\/v1/, '') || '/';
      const hit = respond(pathname, parsed);
      if (!hit) {
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'Not found' } }) };
      }
      return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, json: async () => hit.body };
    }) as unknown as typeof fetch,
  );
}

const envelope = (data: unknown, pagination?: unknown) => ({ data, pagination, requestId: 'test' });

const standingsBody = (overrides: Record<string, unknown> = {}) => ({
  competition: { id: 'comp-1', name: 'Premier League', slug: 'premier-league', type: 'league' },
  season: season(),
  teams: [team(), team({ id: 'team-2', name: 'Real Sample', slug: 'real-sample' })],
  standings: { rows: [row()], matches_considered: 10, matches_skipped: 0, rules_id: 'league.standard', format: 'league' },
  state: 'ready',
  total_matches: 12,
  rules_id: 'league.standard',
  format: 'league',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('competition filters and views', () => {
  it('accepts only known views and falls back to the overview', () => {
    for (const view of COMPETITION_VIEWS) {
      expect(parseCompetitionView(view)).toBe(view);
    }
    expect(parseCompetitionView('nope')).toBe('overview');
    expect(parseCompetitionView(undefined)).toBe('overview');
    expect(parseCompetitionView(['standings'])).toBe('standings');
    expect(viewLabel('standings')).toBe('Standings');
  });

  it('accepts a season uuid only and rejects anything else', () => {
    expect(parseSeasonId('44444444-4444-4444-8444-444444444444')).toBe('44444444-4444-4444-8444-444444444444');
    expect(parseSeasonId('44444444-4444-4444-8444-4444444444AA')).toBe('44444444-4444-4444-8444-4444444444aa');
    for (const bad of ['not-a-uuid', '../../etc', '123', '', undefined]) {
      expect(parseSeasonId(bad), String(bad)).toBeNull();
    }
  });

  it('parses a full selection and drops invalid filters', () => {
    const selection = parseCompetitionSelection({
      view: 'matches',
      season: '44444444-4444-4444-8444-444444444444',
      page: '3',
      status: 'finished',
      team: 'fc-example',
      from: '2026-08-01',
      to: '2026-09-01',
    });
    expect(selection).toEqual({
      view: 'matches',
      seasonId: '44444444-4444-4444-8444-444444444444',
      page: 3,
      status: 'finished',
      team: 'fc-example',
      from: '2026-08-01',
      to: '2026-09-01',
    });

    const bad = parseCompetitionSelection({ team: 'bad slug/../etc', from: 'yesterday', to: '01/02/2026', page: '-1' });
    expect(bad.team).toBeNull();
    expect(bad.from).toBeNull();
    expect(bad.to).toBeNull();
    expect(bad.page).toBe(1);
  });

  it('keeps every season and view on one canonical competition path', () => {
    // The season and view live in the query string only, so a season can never
    // fork the entity into a competing canonical URL.
    expect(competitionHref('premier-league', {})).toBe('/competitions/premier-league');
    expect(competitionHref('premier-league', { view: 'overview' })).toBe('/competitions/premier-league');
    expect(competitionHref('premier-league', { view: 'standings', seasonId: 'season-1' })).toBe(
      '/competitions/premier-league?view=standings&season=season-1',
    );
    expect(competitionHref('premier-league', { view: 'matches', seasonId: 's', page: 2 })).toContain('page=2');
  });

  it('orders seasons with the current one first', () => {
    const ordered = orderSeasons([
      season({ id: 'old', name: '2019/20', start_date: '2019-08-01', is_current: false }),
      season({ id: 'new', name: '2030/31', start_date: '2030-08-01', is_current: false }),
      season({ id: 'cur', name: '2026/27' }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(['cur', 'new', 'old']);
  });

  it('resolves an explicit season and otherwise the current one', () => {
    const seasons = [season({ id: 'cur' }), season({ id: 'old', is_current: false })];
    expect(resolveSeason(seasons, 'old')?.id).toBe('old');
    expect(resolveSeason(seasons, null)?.id).toBe('cur');
    expect(resolveSeason(seasons, 'missing')).toBeNull();
    expect(resolveSeason([], null)).toBeNull();
  });

  it('labels a competition type readably and tolerates an unknown one', () => {
    expect(competitionTypeLabel('league')).toBe('League');
    expect(competitionTypeLabel('CUP')).toBe('Cup');
    expect(competitionTypeLabel('group_stage')).toBe('Group stage');
    expect(competitionTypeLabel('something_new')).toBe('something_new');
    expect(competitionTypeLabel(null)).toBeNull();
  });
});

describe('competition response validation', () => {
  it('requires a name and slug before a competition is usable', () => {
    expect(toCompetitionDetails(null)).toBeNull();
    expect(toCompetitionDetails({ competition: { name: 'No slug' } })).toBeNull();
    expect(toCompetitionDetails({ competition: { name: 'X', slug: 'x' } })).not.toBeNull();
  });

  it('drops malformed seasons, teams and articles', () => {
    const details = toCompetitionDetails({
      competition: { id: 'c', name: 'X', slug: 'x' },
      country: { id: 'c1', name: 'England' },
      seasons: [{ id: 's1', name: '2026' }, { name: 'no id' }, null],
      teams: [team(), { name: 'no slug' }, null],
      articles: [article(), { title: 'no slug' }, null],
      upcomingMatches: [],
      recentMatches: [],
    });
    expect(details).not.toBeNull();
    expect(details?.seasons).toHaveLength(1);
    expect(details?.teams).toHaveLength(1);
    expect(details?.articles).toHaveLength(1);
    expect(details?.country?.name).toBe('England');
  });
});

describe('competition listing data layer', () => {
  it('requests only active competitions and returns pagination', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) =>
        pathname === '/competitions'
          ? { status: 200, body: envelope([competition], { page: 1, limit: 24, total: 1, totalPages: 1 }) }
          : null,
      seen,
    );
    const result = await fetchCompetitionList();
    expect(result.status).toBe('ready');
    expect(result.rows[0].slug).toBe('premier-league');
    const url = new URL(seen[0].url);
    expect(url.searchParams.get('active')).toBe('true');
  });

  it('separates empty from a transport failure', async () => {
    mockApi((pathname) =>
      pathname === '/competitions'
        ? { status: 200, body: envelope([], { page: 1, limit: 24, total: 0, totalPages: 0 }) }
        : null,
    );
    await expect(fetchCompetitionList()).resolves.toMatchObject({ status: 'empty' });

    mockApi(() => null);
    const failed = await fetchCompetitionList();
    expect(failed.status).toBe('error');
    expect(failed.rows).toEqual([]);
  });
});

describe('competition detail data layer', () => {
  it('returns the competition, its seasons, teams and coverage', async () => {
    mockApi((pathname) =>
      pathname === '/competitions/premier-league/details'
        ? {
            status: 200,
            body: envelope({
              competition: { ...competition, country_id: 'c-1' },
              country,
              seasons: [season()],
              teams: [team()],
              upcomingMatches: [],
              recentMatches: [],
              articles: [article()],
            }),
          }
        : null,
    );
    const result = await fetchCompetitionDetail('premier-league');
    expect(result.status).toBe('ready');
    expect(result.seasons).toHaveLength(1);
    expect(result.teams).toHaveLength(1);
    expect(result.articles).toHaveLength(1);
    expect(result.country?.name).toBe('England');
  });

  it('404s an invalid slug without fetching and maps 404 to not-found', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'gone' } }) };
      }) as unknown as typeof fetch,
    );
    await expect(fetchCompetitionDetail('bad slug/../etc')).resolves.toMatchObject({ status: 'not-found' });
    expect(seen).toHaveLength(0);

    await expect(fetchCompetitionDetail('premier-league')).resolves.toMatchObject({ status: 'not-found' });
  });

  it('reports a transport failure as an error, not a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { code: 'UPSTREAM_ERROR', message: 'boom' } }),
      })) as unknown as typeof fetch,
    );
    await expect(fetchCompetitionDetail('premier-league')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('standings data layer', () => {
  it('requests the backend calculation and indexes teams by id', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi((pathname) => (pathname === '/competitions/premier-league/standings' ? { status: 200, body: envelope(standingsBody()) } : null), seen);
    const result = await fetchStandings('premier-league', null);
    expect(result.status).toBe('ready');
    expect(result.payload?.state).toBe('ready');
    expect(result.payload?.standings.rows).toHaveLength(1);
    expect(result.teamsById.get('team-1')?.slug).toBe('fc-example');
    expect(new URL(seen[0].url).searchParams.get('season')).toBeNull();
  });

  it('scopes the request to the selected season', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/competitions/premier-league/standings') return null;
      seen.push(url.search);
      return { status: 200, body: envelope(standingsBody()) };
    });
    await fetchStandings('premier-league', '44444444-4444-4444-8444-444444444444');
    expect(seen[0]).toContain('season=44444444-4444-4444-8444-444444444444');
  });

  it('reports an unavailable table distinctly from an empty competition', async () => {
    mockApi(() => null);
    const unavailable = await fetchStandings('premier-league', null);
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.payload).toBeNull();

    mockApi((pathname) =>
      pathname === '/competitions/premier-league/standings'
        ? { status: 200, body: envelope(standingsBody({ state: 'empty', standings: { rows: [], matches_considered: 0, matches_skipped: 0, rules_id: 'league.standard', format: 'league' } })) }
        : null,
    );
    const empty = await fetchStandings('premier-league', null);
    expect(empty.status).toBe('ready');
    expect(empty.payload?.state).toBe('empty');
  });

  it('preserves a not-applicable state for a knockout competition', async () => {
    mockApi((pathname) =>
      pathname === '/competitions/fa-cup/standings'
        ? { status: 200, body: envelope(standingsBody({ state: 'not_applicable', format: 'knockout', rules_id: 'knockout.standard' })) }
        : null,
    );
    const result = await fetchStandings('fa-cup', null);
    expect(result.payload?.state).toBe('not_applicable');
    expect(result.payload?.format).toBe('knockout');
  });
});

describe('competition matches and news', () => {
  it('scopes matches to the competition, season and filters', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/matches') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([{ id: 'm1', slug: 'a-vs-b' }], { page: 1, limit: 12, total: 1, totalPages: 1 }) };
    });
    const selection = parseCompetitionSelection({
      view: 'matches',
      season: '44444444-4444-4444-8444-444444444444',
      status: 'finished',
      team: 'fc-example',
    });
    const result = await fetchCompetitionMatches('premier-league', selection);
    expect(result.status).toBe('ready');
    expect(seen[0]).toContain('competition=premier-league');
    expect(seen[0]).toContain('season=44444444-4444-4444-8444-444444444444');
    expect(seen[0]).toContain('status=finished');
    expect(seen[0]).toContain('team=fc-example');
  });

  it('requests news through the canonical competition relation', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/news') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([article()], { page: 1, limit: 6, total: 1, totalPages: 1 }) };
    });
    const result = await fetchCompetitionNews('premier-league');
    expect(result.status).toBe('ready');
    expect(seen[0]).toContain('competition=premier-league');
  });

  it('degrades each section independently on failure', async () => {
    mockApi(() => null);
    await expect(fetchCompetitionMatches('premier-league', parseCompetitionSelection({}))).resolves.toMatchObject({ status: 'error' });
    await expect(fetchCompetitionNews('premier-league')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('competition listing components', () => {
  it('links each competition canonically and shows only known metadata', () => {
    const html = renderToString(createElement(CompetitionCard, { competition }));
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('Premier League');
    expect(html).toContain('EPL');
    expect(html).toContain('League');
    expect(html).toContain('https://cdn.test/epl.png');
    expect(html).not.toContain('comp-1');
  });

  it('omits an unknown region and type rather than guessing', () => {
    const html = renderToString(
      createElement(CompetitionCard, { competition: { ...competition, type: null, short_name: null } }),
    );
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).not.toContain('>League<');
  });
});

describe('competition header and season selector', () => {
  it('states the competition identity, type, region and current season', () => {
    const html = renderToString(
      createElement(CompetitionHeader, { competition, country, season: season() }),
    );
    expect(html).toContain('id="competition-heading"');
    expect(html).toContain('Premier League');
    expect(html).toContain('England');
    expect(html).toContain('League');
    expect(html).toContain('2026/27');
    expect(html).toContain('Current season');
    expect(html).toContain('2026-08-01');
    // The public contract has no description field, so none is invented.
    expect(html).not.toContain('description');
  });

  it('says so plainly when no season is recorded', () => {
    const html = renderToString(createElement(CompetitionHeader, { competition, country: null, season: null }));
    expect(html).toContain('No season has been recorded');
    expect(html).not.toContain('Current season');
  });

  it('offers every season in a labelled form that keeps the view', () => {
    const seasons = [season(), season({ id: 'old', name: '2019/20', is_current: false })];
    const html = renderToString(
      createElement(SeasonSelector, { slug: 'premier-league', seasons, selected: season(), view: 'matches' }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/competitions/premier-league"');
    expect(html).toContain('<label for="competition-season">Season</label>');
    // The option value is the season id, never the display name.
    expect(html).toContain('value="old"');
    expect(html).toContain('2019/20');
    expect(html).toContain('(current)');
    expect(html).toContain('name="view"');
    expect(renderToString(createElement(SeasonSelector, { slug: 'premier-league', seasons: [], selected: null, view: 'overview' }))).toBe('');
  });

  it('navigates sections while preserving the selected season', () => {
    const html = renderToString(
      createElement(CompetitionNav, {
        slug: 'premier-league',
        view: 'standings',
        seasonId: 'season-1',
        views: COMPETITION_VIEWS,
      }),
    );
    expect(html).toContain('aria-label="Competition sections"');
    expect(html).toContain('aria-current="page"');
    for (const label of ['Overview', 'Matches', 'Standings', 'Teams', 'News']) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('season=season-1');
  });
});

describe('standings table', () => {
  const teamsById = new Map([['team-1', team()]]);

  it('renders an accessible table with a scrollable region', () => {
    const html = renderToString(
      createElement(StandingsTable, { rows: [row()], teamsById, caption: '2026/27 standings' }),
    );
    expect(html).toContain('<table');
    expect(html).toContain('<caption>2026/27 standings</caption>');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="2026/27 standings"');
    expect(html).toContain('href="/teams/fc-example"');
    // Every documented column is present.
    for (const column of ['Played', 'Won', 'Drawn', 'Lost', 'Goals for', 'Goals against', 'Goal difference', 'Points']) {
      expect(html, column).toContain(column);
    }
  });

  it('gives a screen-reader summary of the row figures', () => {
    const html = renderToString(
      createElement(StandingsTable, { rows: [row()], teamsById, caption: 'Table' }),
    );
    expect(html).toContain('Position 1, FC Example, Played 10, Won 7');
  });

  it('labels an unresolvable team instead of printing an id', () => {
    const html = renderToString(
      createElement(StandingsTable, { rows: [row({ team_id: 'team-unknown' })], teamsById, caption: 'Table' }),
    );
    expect(html).toContain('Team details unavailable');
    expect(html).not.toContain('team-unknown');
  });

  it('accepts a custom column set so it stays format-agnostic', () => {
    const html = renderToString(
      createElement(StandingsTable, {
        rows: [row()],
        teamsById,
        caption: 'Group A',
        columns: [{ key: 'points', header: 'Pts', description: 'Points', render: (r: StandingRow) => String(r.points) }],
      }),
    );
    expect(html).toContain('Group A');
    expect(html).toContain('>23<');
    expect(html).not.toContain('>7<');
  });

  it('renders nothing when there are no rows', () => {
    expect(renderToString(createElement(StandingsTable, { rows: [], teamsById, caption: 'Table' }))).toBe('');
    expect(STANDING_COLUMNS).toHaveLength(8);
  });
});

describe('standings view states', () => {
  const teamsById = new Map([['team-1', team()]]);
  const payload = (state: string, rows: StandingRow[] = [row()]) => ({
    status: 'ready' as const,
    payload: {
      competition: { id: 'comp-1', name: 'Premier League', slug: 'premier-league', type: 'league' },
      season: season(),
      teams: [team()],
      standings: { rows, matches_considered: 10, matches_skipped: 0, rules_id: 'league.standard', format: 'league' },
      state: state as 'ready' | 'empty' | 'incomplete' | 'not_applicable',
      total_matches: 12,
      rules_id: 'league.standard',
      format: 'league',
    },
    teamsById,
  });

  it('renders a ready table and states the historical season', () => {
    const ready = renderToString(createElement(StandingsView, { result: payload('ready'), season: season(), isCurrentSeason: true }));
    expect(ready).toContain('2026/27 standings');
    expect(ready).toContain('current season');
    expect(ready).toContain('Based on 10 completed matches');
    expect(ready).toContain('href="/teams/fc-example"');

    const historical = renderToString(
      createElement(StandingsView, {
        result: payload('ready'),
        season: season({ id: 'old', name: '2019/20', is_current: false }),
        isCurrentSeason: false,
      }),
    );
    expect(historical).toContain('2019/20 standings');
    expect(historical).toContain('historical season');
  });

  it('distinguishes no data from an unavailable table', () => {
    const empty = renderToString(createElement(StandingsView, { result: payload('empty', []), season: season(), isCurrentSeason: true }));
    expect(empty).toContain('No standings yet');
    expect(empty).toContain('No finished matches have been recorded');
    expect(empty).not.toContain('temporarily unavailable');

    const unavailable = renderToString(
      createElement(StandingsView, { result: { status: 'unavailable', payload: null, teamsById: new Map() }, season: null, isCurrentSeason: true }),
    );
    expect(unavailable).toContain('temporarily unavailable');
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).not.toContain('No standings yet');
  });

  it('flags an incomplete table and reports how many results are missing', () => {
    const incomplete = {
      ...payload('incomplete'),
      payload: {
        ...payload('incomplete').payload,
        standings: { rows: [row()], matches_considered: 9, matches_skipped: 2, rules_id: 'league.standard', format: 'league' },
      },
    };
    const html = renderToString(createElement(StandingsView, { result: incomplete, season: season(), isCurrentSeason: true }));
    expect(html).toContain('Standings are incomplete');
    expect(html).toContain('Treat it as provisional');
    expect(html).toContain('2 could not be included');
    // The table is still shown so the partial data is usable.
    expect(html).toContain('href="/teams/fc-example"');
  });

  it('explains a knockout competition instead of showing an empty table', () => {
    const knockout = {
      ...payload('not_applicable', []),
      payload: { ...payload('not_applicable', []).payload, format: 'knockout' as const },
    };
    const html = renderToString(createElement(StandingsView, { result: knockout, season: null, isCurrentSeason: true }));
    expect(html).toContain('No league table');
    expect(html).toContain('knockout');
    expect(html).not.toContain('<table');
  });
});

describe('competition sections', () => {
  it('links participating teams to canonical team pages', () => {
    const html = renderToString(createElement(CompetitionTeams, { teams: [team(), team({ id: 't2', name: 'Real Sample', slug: 'real-sample' })] }));
    expect(html).toContain('Participating teams');
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/teams/real-sample"');
    // React separates adjacent text nodes with comment markers.
    expect(html.replace(/<!-- -->/g, ' ').replace(/\s+/g, ' ')).toContain('2 teams');
    expect(renderToString(createElement(CompetitionTeams, { teams: [] }))).toBe('');
  });

  it('separates empty competition news from unavailable news', () => {
    const empty = renderToString(createElement(CompetitionNews, { articles: [], status: 'empty' }));
    expect(empty).toContain('No published stories are linked');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(CompetitionNews, { articles: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');

    const ready = renderToString(createElement(CompetitionNews, { articles: [article()], status: 'ready' }));
    expect(ready).toContain('href="/news/title-win"');
  });

  it('assembles an overview from its independent sections', () => {
    const html = renderToString(
      createElement(CompetitionOverview, {
        competition,
        country,
        season: season(),
        teams: [team()],
        standingsHref: competitionHref('premier-league', { view: 'standings' }),
        recentMatches: <p>recent</p>,
        upcomingMatches: <p>upcoming</p>,
        news: <p>news</p>,
      }),
    );
    expect(html).toContain('At a glance');
    expect(html).toContain('Premier League');
    expect(html).toContain('England');
    expect(html).toContain('2026/27');
    expect(html).toContain('Season standings');
    expect(html).toContain('href="/competitions"');
    expect(html).toContain('Recent results');
    expect(html).toContain('Upcoming fixtures');
    expect(html).toContain('Participating teams');
  });
});

describe('competition metadata and styles', () => {
  it('canonicalizes paged listings to the bare competition index', async () => {
    const competitionsMetadata = await competitionsMetadataFn({ searchParams: {} });
    expect(competitionsMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}${COMPETITION_CANONICAL}`);
    expect(competitionsMetadata.robots).toBe('index,follow');
  });

  it('builds competition metadata from the resolved record', async () => {
    mockApi((pathname) =>
      pathname === '/competitions'
        ? {
            status: 200,
            body: envelope([
              { id: 'comp-1', name: 'Premier League', short_name: 'EPL', slug: 'premier-league', logo_url: null, type: 'league' },
            ]),
          }
        : null,
    );
    const meta = await competitionMetadata({ params: { slug: 'premier-league' } });
    expect(meta.alternates?.canonical).toBe(`${siteConfig.siteUrl}/competitions/premier-league`);
    expect(String(meta.title)).toContain('Premier League');
    expect(meta.robots).toBe('index,follow');
  });

  it('noindexes an unknown competition and an invalid slug', async () => {
    mockApi(() => null);
    await expect(competitionMetadata({ params: { slug: 'nope' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
    await expect(
      competitionMetadata({ params: { slug: 'bad slug' } }),
    ).resolves.toMatchObject({ robots: 'noindex,nofollow' });
  });

  it('ships the competition and standings styles the components rely on', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of [
      '.competition-card',
      '.competition-header',
      '.competition-nav',
      '.season-selector',
      '.competition-teams__list',
      '.standings-table',
      '.standings-table__scroll',
      '.standings-table__team-col',
      '.competitions-grid',
    ]) {
      expect(css, selector).toContain(selector);
    }
    // Mobile: the table scrolls horizontally without forcing page-wide scroll.
    expect(css).toContain('.standings-table__scroll');
    expect(css).toMatch(/overflow-x: auto/);
    expect(css).not.toContain('overflow-x: scroll');
  });
});
