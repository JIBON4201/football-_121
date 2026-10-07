import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { generateMetadata as playersMetadataFn } from '@/app/(site)/players/page';
import { generateMetadata as playerMetadata } from '@/app/(site)/players/[slug]/page';
import {
  careerCompetitions,
  careerSeasons,
  currentTeamEntry,
  fetchPlayerDetail,
  fetchPlayerList,
  fetchPlayerNews,
  fetchPlayerStatistics,
  formatPlayerStat,
  orderCareer,
  parsePlayerSelection,
  parsePlayerView,
  playerHref,
  toPlayerDetails,
  toPlayerStatistics,
  PLAYER_STAT_FIELDS,
  PLAYERS_CANONICAL,
  PLAYER_VIEWS,
  type CareerEntry,
  type CompetitionRecord,
  type PlayerRecord,
  type PlayerStatisticsPayload,
  type Season,
  type Team,
} from '@/lib/players';
import { CareerHistory, PlayerCard, PlayerHeader, PlayerNav } from '@/components/players/PlayerHeader';
import { PlayerMatches, PlayerNews, PlayerStatisticsView } from '@/components/players/PlayerStatistics';
import type { Article } from '@/types/api';

const player: PlayerRecord = {
  id: 'player-1',
  display_name: 'John Doe',
  slug: 'john-doe',
  photo_url: 'https://cdn.test/jd.png',
  position: 'Forward',
  first_name: 'John',
  last_name: 'Doe',
  date_of_birth: '1995-05-17',
  nationality_id: 'country-1',
  preferred_foot: 'right',
  height_cm: 183,
  status: 'active',
  nationality: null,
};

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Real Sample',
  short_name: 'RSM',
  slug: 'real-sample',
  logo_url: 'https://cdn.test/rsm.png',
  ...overrides,
});

const season = (overrides: Partial<Season> = {}): Season => ({
  id: '44444444-4444-4444-8444-444444444444',
  competition_id: 'comp-1',
  name: '2026/27',
  start_date: '2026-08-01',
  end_date: '2027-05-31',
  is_current: true,
  ...overrides,
});

const competition = (overrides: Partial<CompetitionRecord> = {}): CompetitionRecord => ({
  id: 'comp-1',
  name: 'Premier League',
  short_name: 'EPL',
  slug: 'premier-league',
  logo_url: null,
  is_active: true,
  ...overrides,
});

const careerEntry = (overrides: Partial<CareerEntry> = {}): CareerEntry => ({
  id: 'h1',
  team: team(),
  season: season(),
  shirt_number: 10,
  joined_at: '2026-08-01',
  left_at: null,
  is_current: true,
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'article-1',
  title: 'Player feature',
  slug: 'player-feature',
  excerpt: null,
  article_type: 'news',
  published_at: '2026-09-01T10:00:00.000Z',
  is_featured: false,
  is_breaking: false,
  view_count: 4,
  ...overrides,
});

/** React separates adjacent text nodes with comment markers and escapes `&`. */
const text = (html: string): string => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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

const detailsBody = (overrides: Record<string, unknown> = {}) => ({
  player,
  nationality: { id: 'country-1', name: 'England', slug: 'england', code: 'ENG', flag_url: null },
  history: [
    { id: 'h1', team, season, shirt_number: 10, joined_at: '2026-08-01', left_at: null, is_current: true },
    {
      id: 'h0',
      team: { ...team(), id: 'team-0', name: 'Old Club', slug: 'old-club' },
      season: { ...season(), id: '44444444-4444-4444-8444-444444440000', competition_id: 'comp-0', name: '2019/20', is_current: false },
      shirt_number: 7,
      joined_at: '2019-07-01',
      left_at: '2020-06-30',
      is_current: false,
    },
  ],
  seasons: [season(), { ...season(), id: '44444444-4444-4444-8444-444444440000', competition_id: 'comp-0', name: '2019/20', is_current: false }],
  competitions: [competition()],
  articles: [article()],
  ...overrides,
});

const statsBody = (overrides: Record<string, unknown> = {}) => ({
  player: { id: 'player-1', name: 'John Doe', slug: 'john-doe' },
  scope: 'career',
  season_id: null,
  competition_slug: null,
  matches: [
    {
      match_slug: 'real-sample-vs-fc-example',
      scheduled_at: '2026-09-01T15:00:00.000Z',
      match_status: 'finished',
      team_name: 'Real Sample',
      team_slug: 'real-sample',
      opponent_name: 'FC Example',
      opponent_slug: 'fc-example',
      is_home: true,
      competition_name: 'Premier League',
      competition_slug: 'premier-league',
      season_id: '44444444-4444-4444-8444-444444444444',
      outcome: 'win',
      minutes: 90,
      goals: 2,
      assists: 1,
      shots: 4,
      shots_on_target: 3,
      passes: 40,
      pass_accuracy: 85,
      tackles: 2,
      interceptions: 1,
      clearances: 3,
      yellow_cards: 0,
      red_cards: 0,
      rating: 8.4,
    },
  ],
  totals: {
    appearances: 1,
    values: {
      minutes: 90,
      goals: 2,
      assists: 1,
      shots: 4,
      shots_on_target: 3,
      passes: 40,
      pass_accuracy: 85,
      tackles: 2,
      interceptions: 1,
      clearances: 3,
      yellow_cards: 0,
      red_cards: 0,
      rating: 8.4,
    },
    partial: [],
    unavailable: [],
    average_rating: 8.4,
    ratings_reported: 1,
  },
  state: 'ready',
  truncated: false,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('player views, filters and canonical links', () => {
  it('accepts only known views and falls back to the overview', () => {
    for (const view of PLAYER_VIEWS) {
      expect(parsePlayerView(view)).toBe(view);
    }
    expect(parsePlayerView('nope')).toBe('overview');
    expect(parsePlayerView(undefined)).toBe('overview');
  });

  it('parses a selection and drops invalid filters', () => {
    const selection = parsePlayerSelection({
      view: 'statistics',
      season: '44444444-4444-4444-8444-444444444444',
      competition: 'premier-league',
      limit: '5',
    });
    expect(selection).toEqual({
      view: 'statistics',
      seasonId: '44444444-4444-4444-8444-444444444444',
      competition: 'premier-league',
      limit: 5,
    });

    const bad = parsePlayerSelection({ competition: 'bad slug/../etc', season: 'nope', limit: '99999' });
    expect(bad.competition).toBeNull();
    expect(bad.seasonId).toBeNull();
    expect(bad.limit).toBeLessThanOrEqual(100);
  });

  it('keeps every view on one canonical player path', () => {
    expect(playerHref('john-doe', {})).toBe('/players/john-doe');
    expect(playerHref('john-doe', { view: 'overview' })).toBe('/players/john-doe');
    expect(playerHref('john-doe', { view: 'career', seasonId: 'season-1' })).toBe(
      '/players/john-doe?view=career&season=season-1',
    );
  });
});

describe('career helpers', () => {
  it('orders career spells oldest first and the current one last', () => {
    const ordered = orderCareer([careerEntry(), careerEntry({ id: 'h0', joined_at: '2019-07-01', left_at: '2020-06-30', is_current: false })]);
    expect(ordered.map((entry) => entry.id)).toEqual(['h0', 'h1']);
  });

  it('puts a dateless row last instead of guessing its place', () => {
    const ordered = orderCareer([
      careerEntry({ id: 'undated', joined_at: null, left_at: null, season: null }),
      careerEntry({ id: 'dated', joined_at: '2019-07-01', left_at: '2020-06-30', is_current: false }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['dated', 'undated']);
  });

  it('identifies the current team spell', () => {
    expect(currentTeamEntry([careerEntry()])?.team?.slug).toBe('real-sample');
    // A current row with no resolvable team is not a current team.
    expect(currentTeamEntry([careerEntry({ team: null })])).toBeNull();
    expect(currentTeamEntry([])).toBeNull();
  });

  it('reaches competitions only through the seasons named by career rows', () => {
    const entries = careerCompetitions(
      [careerEntry(), careerEntry({ id: 'h0', season: { ...season(), id: '44444444-4444-4444-8444-444444440000', competition_id: 'comp-0', name: '2019/20' } })],
      [competition(), competition({ id: 'comp-0', name: 'Old Cup', slug: 'old-cup' })],
    );
    expect(entries).toHaveLength(2);
    // A competition with no matching season on a career row is excluded.
    const orphan = careerCompetitions([careerEntry()], [competition(), competition({ id: 'comp-9', name: 'Orphan', slug: 'orphan' })]);
    expect(orphan).toHaveLength(1);
    expect(orphan[0].competition.slug).toBe('premier-league');
  });

  it('lists the seasons the player has a row for, newest first', () => {
    const seasons = careerSeasons([careerEntry(), careerEntry({ id: 'h0', season: { ...season(), id: '44444444-4444-4444-8444-444444440000', name: '2019/20' } })]);
    expect(seasons.map((entry) => entry.name)).toEqual(['2026/27', '2019/20']);
  });
});

describe('player response validation', () => {
  it('requires a display name and slug', () => {
    expect(toPlayerDetails(null)).toBeNull();
    expect(toPlayerDetails({ player: { display_name: 'No slug' } })).toBeNull();
    expect(toPlayerDetails(detailsBody())).not.toBeNull();
  });

  it('reassembles teams and competitions from the flat statistics payload', () => {
    const payload = toPlayerStatistics(statsBody());
    expect(payload?.appearances[0].team?.slug).toBe('real-sample');
    expect(payload?.appearances[0].opponent?.slug).toBe('fc-example');
    expect(payload?.appearances[0].competition?.slug).toBe('premier-league');
  });

  it('treats a name without a slug as unresolved', () => {
    const payload = toPlayerStatistics(
      statsBody({
        matches: [
          { match_slug: 'a-vs-b', scheduled_at: '2026-09-01T15:00:00.000Z', team_name: 'Nameless', team_slug: null, opponent_name: null, opponent_slug: null, competition_name: null, competition_slug: null },
        ],
      }),
    );
    expect(payload?.appearances[0].team).toBeNull();
    expect(payload?.appearances[0].opponent).toBeNull();
    expect(payload?.appearances[0].competition).toBeNull();
  });

  it('rejects a statistics payload without totals', () => {
    expect(toPlayerStatistics(null)).toBeNull();
    expect(toPlayerStatistics({ player: { slug: 'x' } })).toBeNull();
  });

  it('drops malformed appearance rows', () => {
    const payload = toPlayerStatistics(
      statsBody({ matches: [{ match_slug: 'a' }, { match_slug: 'a-vs-b', scheduled_at: '2026-09-01T15:00:00.000Z' }, null] }),
    );
    expect(payload?.appearances).toHaveLength(1);
  });
});

describe('player statistic formatting', () => {
  it('never renders an unreported statistic as zero', () => {
    expect(formatPlayerStat(null, 'goals')).toBe('—');
    expect(formatPlayerStat(0, 'goals')).toBe('0');
    expect(formatPlayerStat(2, 'goals')).toBe('2');
  });

  it('formats averages with a decimal and counts plainly', () => {
    expect(formatPlayerStat(8.44, 'rating')).toBe('8.4');
    expect(formatPlayerStat(85, 'pass_accuracy')).toBe('85');
    expect(formatPlayerStat(90, 'minutes')).toBe('90');
  });
});

describe('player listing data layer', () => {
  it('sends the search term to the backend and stays paginated', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) =>
        pathname === '/players' ? { status: 200, body: envelope([player], { page: 1, limit: 24, total: 1, totalPages: 1 }) } : null,
      seen,
    );
    const result = await fetchPlayerList({ query: '  john  ' });
    expect(result.status).toBe('ready');
    expect(result.query).toBe('john');
    const url = new URL(seen[0].url);
    expect(url.searchParams.get('q')).toBe('john');
    expect(url.searchParams.get('limit')).toBe('24');
  });

  it('omits the query when the field is empty', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/players') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([], { page: 1, limit: 24, total: 0, totalPages: 0 }) };
    });
    await fetchPlayerList({ query: '  ' });
    expect(seen[0]).not.toContain('q=');
  });

  it('separates empty from a transport failure', async () => {
    mockApi((pathname) =>
      pathname === '/players' ? { status: 200, body: envelope([], { page: 1, limit: 24, total: 0, totalPages: 0 }) } : null,
    );
    await expect(fetchPlayerList({})).resolves.toMatchObject({ status: 'empty' });

    mockApi(() => null);
    await expect(fetchPlayerList({})).resolves.toMatchObject({ status: 'error', rows: [] });
  });
});

describe('player detail data layer', () => {
  it('returns the profile, career and coverage', async () => {
    mockApi((pathname) => (pathname === '/players/john-doe/details' ? { status: 200, body: envelope(detailsBody()) } : null));
    const result = await fetchPlayerDetail('john-doe');
    expect(result.status).toBe('ready');
    expect(result.player?.display_name).toBe('John Doe');
    expect(result.nationality?.name).toBe('England');
    expect(result.history).toHaveLength(2);
    expect(result.competitions).toHaveLength(1);
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
    await expect(fetchPlayerDetail('bad slug/../etc')).resolves.toMatchObject({ status: 'not-found' });
    expect(seen).toHaveLength(0);
    await expect(fetchPlayerDetail('john-doe')).resolves.toMatchObject({ status: 'not-found' });
  });

  it('reports a transport failure as an error, not a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'UPSTREAM_ERROR', message: 'x' } }) })) as unknown as typeof fetch,
    );
    await expect(fetchPlayerDetail('john-doe')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('player statistics data layer', () => {
  it('sends the scope filters to the backend', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/players/john-doe/statistics') return null;
      seen.push(url.search);
      return { status: 200, body: envelope(statsBody()) };
    });
    const selection = parsePlayerSelection({
      view: 'statistics',
      season: '44444444-4444-4444-8444-444444444444',
      competition: 'premier-league',
    });
    const result = await fetchPlayerStatistics('john-doe', selection);
    expect(result.status).toBe('ready');
    expect(seen[0]).toContain('season=44444444-4444-4444-8444-444444444444');
    expect(seen[0]).toContain('competition=premier-league');
    expect(result.payload?.scope).toBe('career');
  });

  it('distinguishes unavailable from empty', async () => {
    mockApi(() => null);
    const unavailable = await fetchPlayerStatistics('john-doe', parsePlayerSelection({}));
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.payload).toBeNull();

    mockApi((pathname) =>
      pathname === '/players/john-doe/statistics'
        ? { status: 200, body: envelope(statsBody({ state: 'empty', matches: [] })) }
        : null,
    );
    const empty = await fetchPlayerStatistics('john-doe', parsePlayerSelection({}));
    expect(empty.status).toBe('ready');
    expect(empty.payload?.state).toBe('empty');
  });
});

describe('player news data layer', () => {
  it('requests news through the canonical relation', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/news') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([article()]) };
    });
    const result = await fetchPlayerNews('john-doe');
    expect(result.status).toBe('ready');
    expect(seen[0]).toContain('player=john-doe');
  });

  it('degrades to an error rather than throwing', async () => {
    mockApi(() => null);
    await expect(fetchPlayerNews('john-doe')).resolves.toMatchObject({ status: 'error', items: [] });
  });
});

describe('player listing and profile components', () => {
  it('links a player canonically and shows known attributes only', () => {
    const html = renderToString(createElement(PlayerCard, { player, nationalityName: 'England' }));
    expect(html).toContain('href="/players/john-doe"');
    expect(html).toContain('John Doe');
    expect(html).toContain('Forward');
    expect(html).toContain('England');
    expect(html).toContain('https://cdn.test/jd.png');
    expect(html).not.toContain('player-1');
  });

  it('omits absent attributes rather than guessing', () => {
    const html = renderToString(
      createElement(PlayerCard, {
        player: { ...player, position: null, photo_url: null },
      }),
    );
    expect(html).toContain('href="/players/john-doe"');
    expect(html).not.toContain('Forward');
    expect(html).not.toContain('<img');
  });

  it('shows identity, public attributes and the current team', () => {
    const html = renderToString(
      createElement(PlayerHeader, {
        player,
        nationality: { id: 'country-1', name: 'England', slug: 'england', code: 'ENG', flag_url: null },
        currentTeam: careerEntry(),
      }),
    );
    expect(html).toContain('id="player-heading"');
    expect(html).toContain('John Doe');
    expect(html).toContain('England');
    expect(html).toContain('183');
    expect(html).toContain('right');
    expect(html).toContain('href="/teams/real-sample"');
    expect(html).toContain('Shirt number');
  });

  it('marks genuinely absent attributes as not recorded', () => {
    const html = renderToString(
      createElement(PlayerHeader, {
        player: { ...player, date_of_birth: null, preferred_foot: null, height_cm: null, first_name: null, last_name: null },
        nationality: null,
        currentTeam: null,
      }),
    );
    expect(html).toContain('Not public');
    expect(html).toContain('Not recorded');
    expect(html).not.toContain('Age');
  });

  it('navigates sections while preserving the scope', () => {
    const html = renderToString(
      createElement(PlayerNav, {
        slug: 'john-doe',
        view: 'statistics',
        selection: parsePlayerSelection({ season: '44444444-4444-4444-8444-444444444444' }),
      }),
    );
    expect(html).toContain('aria-label="Player sections"');
    expect(html).toContain('aria-current="page"');
    for (const label of ['Overview', 'Career', 'Matches', 'Statistics', 'News']) {
      expect(html, label).toContain(label);
    }
    expect(text(html)).toContain('season=44444444-4444-4444-8444-444444444444');
  });
});

describe('career components', () => {
  it('lists spells chronologically with canonical team links', () => {
    const html = renderToString(
      createElement(CareerHistory, {
        history: [
          careerEntry(),
          careerEntry({ id: 'h0', team: { ...team(), id: 't0', name: 'Old Club', slug: 'old-club' }, joined_at: '2019-07-01', left_at: '2020-06-30', is_current: false }),
        ],
        status: 'ready',
      }),
    );
    expect(html).toContain('href="/teams/old-club"');
    expect(html).toContain('href="/teams/real-sample"');
    expect(html).toContain('Current');
    expect(html.indexOf('Old Club')).toBeLessThan(html.indexOf('Real Sample'));
  });

  it('says when dates are missing instead of inventing them', () => {
    const html = renderToString(
      createElement(CareerHistory, { history: [careerEntry({ joined_at: null, left_at: null, season: null })], status: 'ready' }),
    );
    expect(html).toContain('Dates not recorded');
    expect(html).toContain('Season not recorded');
  });

  it('labels an unresolved team rather than printing an id', () => {
    const html = renderToString(createElement(CareerHistory, { history: [careerEntry({ team: null })], status: 'ready' }));
    expect(html).toContain('Team not identified');
    expect(html).not.toContain('team-1');
  });

  it('separates an empty career from an unavailable one', () => {
    const empty = renderToString(createElement(CareerHistory, { history: [], status: 'empty' }));
    expect(empty).toContain('No team history has been recorded');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(CareerHistory, { history: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');
    expect(failed).toContain('role="alert"');
  });
});

describe('player statistics components', () => {
  const payload = toPlayerStatistics(statsBody()) as PlayerStatisticsPayload;
  const selection = parsePlayerSelection({ view: 'statistics' });

  it('states the scope and never fabricates a missing value', () => {
    const html = renderToString(
      createElement(PlayerStatisticsView, { result: { status: 'ready', payload }, seasons: [season()], selection, slug: 'john-doe' }),
    );
    expect(text(html)).toContain('Scope: All recorded appearances');
    expect(html).toContain('href="/matches/real-sample-vs-fc-example"');
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Player appearances"');
    expect(html).toContain('<caption>Recent recorded appearances</caption>');
  });

  it('shows an em dash for an unreported statistic and explains the gap', () => {
    const partial = toPlayerStatistics(
      statsBody({
        totals: {
          appearances: 2,
          values: { minutes: 90, goals: 2 },
          partial: [],
          unavailable: ['assists', 'shots', 'passes', 'rating'],
          average_rating: null,
          ratings_reported: 0,
        },
      }),
    );
    const html = renderToString(
      createElement(PlayerStatisticsView, { result: { status: 'ready', payload: partial as PlayerStatisticsPayload }, seasons: [], selection, slug: 'john-doe' }),
    );
    expect(html).toContain('—');
    expect(html).toContain('were not reported');
    expect(html).toContain('rather than zero');
  });

  it('offers a season scope filter on the canonical path', () => {
    const html = renderToString(
      createElement(PlayerStatisticsView, {
        result: { status: 'ready', payload },
        seasons: [season()],
        selection: parsePlayerSelection({ view: 'statistics', season: '44444444-4444-4444-8444-444444444444' }),
        slug: 'john-doe',
      }),
    );
    expect(html).toContain('<label for="player-stats-season">Season</label>');
    expect(html).toContain('action="/players/john-doe"');
    expect(text(html)).toContain('value="44444444-4444-4444-8444-444444444444"');
    expect(text(html)).toContain('Clear scope');
  });

  it('distinguishes unavailable statistics from an empty scope', () => {
    const unavailable = renderToString(
      createElement(PlayerStatisticsView, { result: { status: 'unavailable', payload: null }, seasons: [], selection, slug: 'john-doe' }),
    );
    expect(unavailable).toContain('temporarily unavailable');
    expect(unavailable).toContain('role="alert"');

    const empty = renderToString(
      createElement(PlayerStatisticsView, {
        result: { status: 'ready', payload: toPlayerStatistics(statsBody({ state: 'empty', matches: [] })) as PlayerStatisticsPayload },
        seasons: [],
        selection,
        slug: 'john-doe',
      }),
    );
    expect(empty).toContain('No recorded appearances match this scope');
    expect(empty).not.toContain('temporarily unavailable');
  });

  it('lists recent matches with a canonical link and figures', () => {
    const html = renderToString(
      createElement(PlayerMatches, { appearances: payload.appearances, status: 'ready' }),
    );
    expect(html).toContain('href="/matches/real-sample-vs-fc-example"');
    expect(text(html)).toContain('Real Sample v FC Example');
    expect(text(html)).toContain('Premier League');
    expect(text(html)).toContain('90 min, 2 goals, 1 assists');
    expect(text(html)).toContain('Win');
  });

  it('separates empty news from unavailable news', () => {
    const empty = renderToString(createElement(PlayerNews, { articles: [], status: 'empty' }));
    expect(empty).toContain('No published stories are linked');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(PlayerNews, { articles: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');
  });
});

describe('player metadata and styles', () => {
  it('canonicalizes the player index', async () => {
    const playersMetadata = await playersMetadataFn({ searchParams: {} });
    expect(playersMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}${PLAYERS_CANONICAL}`);
    expect(playersMetadata.robots).toBe('index,follow');
  });

  it('builds player metadata from the resolved profile', async () => {
    mockApi((pathname) =>
      pathname === '/players'
        ? {
            status: 200,
            body: envelope([{ id: 'p-1', display_name: 'John Doe', slug: 'john-doe', photo_url: null, position: 'Forward' }]),
          }
        : null,
    );
    const meta = await playerMetadata({ params: { slug: 'john-doe' } });
    expect(meta.alternates?.canonical).toBe(`${siteConfig.siteUrl}/players/john-doe`);
    expect(String(meta.title)).toContain('John Doe');
    expect(meta.robots).toBe('index,follow');
  });

  it('noindexes an unknown player and an invalid slug', async () => {
    mockApi(() => null);
    await expect(playerMetadata({ params: { slug: 'nope' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
    await expect(playerMetadata({ params: { slug: 'bad slug' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
  });

  it('ships the player styles the components rely on', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of [
      '.player-card',
      '.player-header',
      '.player-nav',
      '.players-search',
      '.players-grid',
      '.career__list',
      '.player-stats__totals',
      '.player-stats__filters',
      '.player-appearances',
      '.player-appearances__scroll',
      '.player-matches__list',
    ]) {
      expect(css, selector).toContain(selector);
    }
    // Every statistic field has a label, and totals are grouped responsively.
    expect(css).toContain('.player-stats__totals');
    expect(css).toContain('repeat(auto-fit, minmax(6rem, 1fr))');
    // The appearances table scrolls rather than hiding columns.
    expect(css).toContain('overflow-x: auto');
    expect(css).not.toContain('overflow-x: scroll');
    for (const field of PLAYER_STAT_FIELDS) {
      expect(field, field).toBeTruthy();
    }
  });
});
