import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { MatchCard } from '@/components/matches/MatchCard';
import { MatchDateNav, MatchFilterForm } from '@/components/matches/MatchFilters';
import { MatchDetailView } from '@/components/matches/MatchDetailView';
import { MatchHeader } from '@/components/matches/MatchHeader';
import { MatchEvents } from '@/components/matches/MatchEvents';
import { MatchLineups } from '@/components/matches/MatchLineups';
import { MatchStats } from '@/components/matches/MatchStats';
import { metadata as matchesMetadata } from '@/app/(site)/matches/page';
import {
  compareTeamStats,
  dateKeyLabel,
  enrichPlayerStats,
  eventLabel,
  eventsBySide,
  fetchMatchDetail,
  fetchMatchList,
  fetchRelatedMatchNews,
  formatEventMinute,
  formatStatValue,
  groupMatchesByDate,
  isFinishedStatus,
  isLiveStatus,
  isUpcomingStatus,
  isVoidStatus,
  lineupsBySide,
  MATCH_PAGE_SIZE,
  MATCH_REVALIDATE,
  matchDateKey,
  parseMatchFilters,
  resolveSide,
  shiftDateKey,
  toMatchDetails,
  toQueryString,
  type MatchDetails,
  type MatchListItem,
} from '@/lib/matches';
import type { Article, Competition, Match, Player, Team } from '@/types/api';

const homeTeam: Team = {
  id: 'team-home',
  name: 'FC Example',
  short_name: 'FCE',
  slug: 'fc-example',
  logo_url: 'https://cdn.test/fce.png',
};

const awayTeam: Team = {
  id: 'team-away',
  name: 'Real Sample',
  short_name: 'RSM',
  slug: 'real-sample',
  logo_url: 'https://cdn.test/rsm.png',
};

const competition: Competition = {
  id: 'comp-1',
  name: 'Premier League',
  short_name: 'EPL',
  slug: 'premier-league',
  logo_url: null,
};

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 'match-1',
  slug: 'fc-example-vs-real-sample',
  status: 'scheduled',
  scheduled_at: '2030-02-01T15:00:00.000Z',
  home_score: null,
  away_score: null,
  home_team_id: homeTeam.id,
  away_team_id: awayTeam.id,
  competition_id: competition.id,
  ...overrides,
});

const listItem = (overrides: Partial<MatchListItem> = {}): MatchListItem => ({
  match: match(),
  homeTeam,
  awayTeam,
  competition,
  venue: { id: 'venue-1', name: 'Example Arena', city: 'Dhaka', capacity: 30000 },
  ...overrides,
});

const player: Player = {
  id: 'player-1',
  display_name: 'Jane Doe',
  slug: 'jane-doe',
  photo_url: null,
  position: 'Forward',
};

const details = (overrides: Partial<MatchDetails> = {}): MatchDetails => ({
  match: match({ status: 'finished', home_score: 2, away_score: 1 }),
  homeTeam,
  awayTeam,
  competition,
  season: { id: 's1', name: '2030/31', competition_id: competition.id, start_date: null, end_date: null, is_current: true },
  venue: { id: 'venue-1', name: 'Example Arena', city: 'Dhaka', capacity: 30000 },
  events: [],
  lineups: [],
  teamStatistics: [],
  playerStatistics: [],
  ...overrides,
});

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'article-1',
  title: 'Match report',
  slug: 'match-report',
  excerpt: null,
  article_type: 'match_report',
  published_at: '2030-02-02T10:00:00.000Z',
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

const detailsBody = (overrides: Record<string, unknown> = {}) => ({
  match: match(),
  competition,
  season: null,
  venue: { id: 'venue-1', name: 'Example Arena', city: 'Dhaka', capacity: 30000 },
  homeTeam,
  awayTeam,
  events: [],
  lineups: [],
  teamStatistics: [],
  playerStatistics: [],
  ...overrides,
});

/** A list row as served with `include=card`. */
const cardRow = (overrides: Partial<Match> = {}, extra: Record<string, unknown> = {}) => ({
  ...match(overrides),
  homeTeam,
  awayTeam,
  competition,
  venue: { id: 'venue-1', name: 'Example Arena', city: 'Dhaka', capacity: 30000 },
  events: [],
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('match filters', () => {
  it('keeps known values and drops anything unrecognised', () => {
    const filters = parseMatchFilters({
      phase: 'live',
      competition: 'premier-league',
      team: 'fc-example',
      from: '2030-02-01',
      to: '2030-02-07',
      sort: 'asc',
      page: '3',
      limit: '999',
      status: 'half_time',
      bogus: 'x',
    });
    expect(filters.phase).toBe('live');
    // phase wins server-side, so status is not sent alongside it
    expect(filters.status).toBeNull();
    expect(filters.competition).toBe('premier-league');
    expect(filters.from).toBe('2030-02-01');
    expect(filters.sort).toBe('asc');
    expect(filters.page).toBe(3);
    expect(filters.limit).toBeLessThanOrEqual(24);
  });

  it('rejects invalid phases, slugs and dates rather than passing them through', () => {
    const filters = parseMatchFilters({
      phase: 'not-a-phase',
      status: 'not-a-status',
      competition: 'bad slug/../etc',
      from: '01-02-2030',
      to: 'tomorrow',
      sort: 'sideways',
      page: '-4',
      limit: '0',
    });
    expect(filters.phase).toBeNull();
    expect(filters.status).toBeNull();
    expect(filters.competition).toBeNull();
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
    expect(filters.sort).toBeNull();
    expect(filters.page).toBe(1);
    expect(filters.limit).toBe(MATCH_PAGE_SIZE);
  });

  it('keeps a status when no phase is set', () => {
    expect(parseMatchFilters({ status: 'postponed' }).status).toBe('postponed');
  });

  it('serializes filters to a stable query string', () => {
    expect(toQueryString(parseMatchFilters({}))).toBe('');
    const query = toQueryString(parseMatchFilters({ phase: 'finished', team: 'fc-example', page: '2' }));
    expect(query).toBe('?phase=finished&team=fc-example&page=2');
  });
});

describe('match date grouping', () => {
  it('groups by calendar day and labels each group', () => {
    const items = [
      listItem({ match: match({ id: 'a', slug: 'a', scheduled_at: '2030-02-01T11:00:00.000Z' }) }),
      listItem({ match: match({ id: 'b', slug: 'b', scheduled_at: '2030-02-01T18:00:00.000Z' }) }),
      listItem({ match: match({ id: 'c', slug: 'c', scheduled_at: '2030-02-02T15:00:00.000Z' }) }),
    ];
    const groups = groupMatchesByDate(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].dateKey).toBe('2030-02-01');
    expect(groups[1].dateKey).toBe('2030-02-02');
    expect(groups[0].label).toBe(dateKeyLabel('2030-02-01'));
  });

  it('derives and shifts date keys, rejecting unusable input', () => {
    expect(matchDateKey('2030-02-01T15:00:00.000Z')).toBe('2030-02-01');
    expect(matchDateKey(null)).toBeNull();
    expect(matchDateKey('not-a-date')).toBeNull();
    expect(shiftDateKey('2030-02-01', 1)).toBe('2030-02-02');
    expect(shiftDateKey('2030-02-01', -1)).toBe('2030-01-31');
    expect(shiftDateKey('rubbish', 1)).toBeNull();
  });

  it('labels an undated fixture without inventing a date', () => {
    const groups = groupMatchesByDate([listItem({ match: match({ scheduled_at: 'nonsense' }) })]);
    expect(groups[0].dateKey).toBe('unknown');
    expect(groups[0].label).toBe('Date to be confirmed');
  });
});

describe('match status classification', () => {
  it('separates live, upcoming, finished and void states', () => {
    expect(isLiveStatus('half_time')).toBe(true);
    expect(isLiveStatus('finished')).toBe(false);
    expect(isUpcomingStatus('scheduled')).toBe(true);
    expect(isUpcomingStatus('live')).toBe(false);
    expect(isFinishedStatus('finished')).toBe(true);
    for (const voided of ['postponed', 'cancelled', 'abandoned', 'suspended']) {
      expect(isVoidStatus(voided)).toBe(true);
    }
    expect(isVoidStatus('live')).toBe(false);
  });
});

describe('match response validation', () => {
  it('requires both teams before a fixture is usable', () => {
    expect(toMatchDetails(null)).toBeNull();
    expect(toMatchDetails({ match: match(), homeTeam, awayTeam: null })).toBeNull();
    expect(toMatchDetails({ match: match(), homeTeam: null, awayTeam })).toBeNull();
    expect(toMatchDetails({ match: { id: 'x' }, homeTeam, awayTeam })).toBeNull();
    expect(toMatchDetails(detailsBody())).not.toBeNull();
  });

  it('coerces missing optional fields instead of failing', () => {
    const parsed = toMatchDetails({ match: match(), homeTeam, awayTeam, venue: { id: 'v' } });
    expect(parsed).not.toBeNull();
    expect(parsed?.venue).toBeNull();
    expect(parsed?.competition).toBeNull();
    expect(parsed?.events).toEqual([]);
  });
});

describe('match listing data layer', () => {
  it('requests the card shape and enriches rows with real teams', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) => {
        if (pathname === '/matches') return { status: 200, body: envelope([cardRow()], { page: 1, limit: 12, total: 1, totalPages: 1 }) };
        return null;
      },
      seen,
    );
    const filters = parseMatchFilters({ phase: 'upcoming', competition: 'premier-league', team: 'fc-example' });
    const result = await fetchMatchList(filters);
    expect(result.status).toBe('ready');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].homeTeam.slug).toBe('fc-example');
    expect(result.rows[0].venue?.city).toBe('Dhaka');

    const listCall = new URL(seen[0].url);
    expect(listCall.pathname).toBe('/api/v1/matches');
    expect(listCall.searchParams.get('phase')).toBe('upcoming');
    expect(listCall.searchParams.get('competition')).toBe('premier-league');
    expect(listCall.searchParams.get('team')).toBe('fc-example');
    expect(listCall.searchParams.get('include')).toBe('card');
    expect((seen[0].init as { next?: { revalidate?: number } }).next?.revalidate).toBe(MATCH_REVALIDATE.scheduled);
  });

  it('uses a shorter window for live fixtures', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) => {
        if (pathname === '/matches') return { status: 200, body: envelope([], { page: 1, limit: 12, total: 0, totalPages: 0 }) };
        return null;
      },
      seen,
    );
    await fetchMatchList(parseMatchFilters({ phase: 'live' }));
    expect((seen[0].init as { next?: { revalidate?: number } }).next?.revalidate).toBe(MATCH_REVALIDATE.live);
  });

  it('drops fixtures whose teams cannot be resolved instead of inventing names', async () => {
    mockApi((pathname) => {
      if (pathname === '/matches') return { status: 200, body: envelope([match()], { page: 1, limit: 12, total: 1, totalPages: 1 }) };
      return null;
    });
    const result = await fetchMatchList(parseMatchFilters({}));
    expect(result.status).toBe('error');
    expect(result.rows).toHaveLength(0);
  });

  it('reports empty distinctly from a failure', async () => {
    mockApi((pathname) =>
      pathname === '/matches'
        ? { status: 200, body: envelope([], { page: 1, limit: 12, total: 0, totalPages: 0 }) }
        : null,
    );
    const result = await fetchMatchList(parseMatchFilters({}));
    expect(result.status).toBe('empty');
    expect(result.pagination.totalPages).toBe(0);
  });

  it('isolates a listing failure without throwing', async () => {
    mockApi(() => null);
    const result = await fetchMatchList(parseMatchFilters({}));
    expect(result.status).toBe('error');
    expect(result.rows).toEqual([]);
  });

  it('never requests per-match details for a full page', async () => {
    const many = Array.from({ length: 24 }, (_, index) =>
      cardRow({ id: `m${index}`, slug: `match-${index}` }),
    );
    const calls: string[] = [];
    mockApi((pathname) => (pathname === '/matches' ? { status: 200, body: envelope(many, { page: 1, limit: 24, total: many.length, totalPages: 1 }) } : null));
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(new URL(url).pathname);
        return originalFetch(url, init);
      }) as unknown as typeof fetch,
    );
    const result = await fetchMatchList(parseMatchFilters({ limit: '24' }));
    expect(calls.filter((path) => path.endsWith('/details'))).toHaveLength(0);
    expect(result.rows).toHaveLength(24);
  });
});

describe('match detail data layer', () => {
  it('resolves the aggregate payload and a state-aware cache window', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) => {
        if (pathname === '/matches/fc-example-vs-real-sample') {
          return { status: 200, body: envelope({ ...match(), status: 'live' }) };
        }
        if (pathname === '/matches/fc-example-vs-real-sample/details') {
          return { status: 200, body: envelope(detailsBody({ match: match({ status: 'live' }) })) };
        }
        return null;
      },
      seen,
    );
    const result = await fetchMatchDetail('fc-example-vs-real-sample');
    expect(result.status).toBe('ready');
    expect(result.details?.homeTeam.slug).toBe('fc-example');
    const detailsCall = seen.find((call) => call.url.endsWith('/details'));
    expect((detailsCall?.init as { next?: { revalidate?: number } }).next?.revalidate).toBe(MATCH_REVALIDATE.live);
  });

  it('maps a missing fixture to not-found and 404s invalid slugs without fetching', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: 'gone' } }) };
      }) as unknown as typeof fetch,
    );
    const missing = await fetchMatchDetail('fc-example-vs-real-sample');
    expect(missing.status).toBe('not-found');
    expect(missing.details).toBeNull();

    seen.length = 0;
    const invalid = await fetchMatchDetail('bad slug/../etc');
    expect(invalid.status).toBe('not-found');
    expect(seen).toHaveLength(0);
  });

  it('surfaces a transport failure as an error, not a 404', async () => {
    mockApi((pathname) => (pathname.endsWith('/details') ? { status: 500, body: { error: { code: 'X', message: 'boom' } } } : null));
    const result = await fetchMatchDetail('fc-example-vs-real-sample');
    expect(result.status).toBe('error');
  });
});

describe('related match coverage', () => {
  it('asks the backend for coverage linked to the fixture', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname === '/news') {
        seen.push(url.search);
        return { status: 200, body: envelope([article()]) };
      }
      return null;
    });
    const related = await fetchRelatedMatchNews('fc-example-vs-real-sample');
    expect(related).toHaveLength(1);
    expect(seen[0]).toContain('match=fc-example-vs-real-sample');
  });

  it('returns nothing rather than throwing when coverage is unavailable', async () => {
    mockApi(() => null);
    await expect(fetchRelatedMatchNews('fc-example-vs-real-sample')).resolves.toEqual([]);
    await expect(fetchRelatedMatchNews('bad slug')).resolves.toEqual([]);
  });
});

describe('match detail presentation helpers', () => {
  it('resolves a raw team id to a side and leaves unknown ids unresolved', () => {
    expect(resolveSide(homeTeam.id, homeTeam.id, awayTeam.id)).toBe('home');
    expect(resolveSide(awayTeam.id, homeTeam.id, awayTeam.id)).toBe('away');
    expect(resolveSide('team-nope', homeTeam.id, awayTeam.id)).toBeNull();
    expect(resolveSide(null, homeTeam.id, awayTeam.id)).toBeNull();
  });

  it('formats event minutes and labels unknown event types readably', () => {
    expect(formatEventMinute(45, null)).toBe("45'");
    expect(formatEventMinute(45, 2)).toBe("45+2'");
    expect(formatEventMinute(null, 2)).toBe('');
    expect(eventLabel('penalty_goal')).toBe('Penalty goal');
    expect(eventLabel('mystery_event')).toBe('mystery event');
  });

  it('never turns a missing statistic into a zero', () => {
    expect(formatStatValue(null, '%')).toBe('—');
    expect(formatStatValue(0, '')).toBe('0');
    expect(formatStatValue(55, '%')).toBe('55%');
  });

  it('pairs team statistics with the correct side and shares percentages', () => {
    const comparison = compareTeamStats(
      details({
        teamStatistics: [
          { id: 'ts-h', match_id: 'match-1', team_id: homeTeam.id, possession: 60, shots: 10, shots_on_target: 4, corners: 5, fouls: 8, offsides: 1, yellow_cards: 2, red_cards: 0, passes: 400, pass_accuracy: 85 },
          { id: 'ts-a', match_id: 'match-1', team_id: awayTeam.id, possession: 40, shots: 6, shots_on_target: 2, corners: 2, fouls: 12, offsides: 3, yellow_cards: 1, red_cards: 0, passes: 300, pass_accuracy: 75 },
        ],
      }),
    );
    const possession = comparison.find((row) => row.label === 'Possession');
    expect(possession?.home).toBe(60);
    expect(possession?.away).toBe(40);
    expect(possession?.homeShare).toBe(60);
    expect(possession?.awayShare).toBe(40);
    // counting stats are never turned into a bogus share
    const shots = comparison.find((row) => row.label === 'Shots');
    expect(shots?.homeShare).toBeNull();
    expect(compareTeamStats(details())).toEqual([]);
  });

  it('names player statistics from the lineup and flags the rest as unknown', () => {
    const enrichedStats = enrichPlayerStats(
      details({
        lineups: [
          {
            id: 'l1',
            match_id: 'match-1',
            team_id: homeTeam.id,
            formation: '4-3-3',
            coach_name: 'Coach Home',
            players: [
              { id: 'lp1', lineup_id: 'l1', player_id: player.id, position: 'FW', shirt_number: 9, captain: false, substitute: false, starter: true, minutes_played: 90, player },
            ],
          },
        ],
        playerStatistics: [
          { id: 'ps1', match_id: 'match-1', team_id: homeTeam.id, player_id: player.id, minutes: 90, goals: 2, assists: 1, shots: 4, shots_on_target: 3, passes: 30, pass_accuracy: 90, tackles: 1, interceptions: 0, clearances: 0, yellow_cards: 0, red_cards: 0, rating: 8.1 },
          { id: 'ps2', match_id: 'match-1', team_id: awayTeam.id, player_id: 'player-unknown', minutes: 60, goals: null, assists: null, shots: null, shots_on_target: null, passes: null, pass_accuracy: null, tackles: null, interceptions: null, clearances: null, yellow_cards: null, red_cards: null, rating: null },
        ],
      }),
    );
    expect(enrichedStats[0].player?.slug).toBe('jane-doe');
    expect(enrichedStats[0].side).toBe('home');
    expect(enrichedStats[1].player).toBeNull();
    expect(enrichedStats[1].side).toBe('away');
  });

  it('orders lineups home first and events by minute', () => {
    const lineups = lineupsBySide(
      details({
        lineups: [
          { id: 'l-away', match_id: 'match-1', team_id: awayTeam.id, formation: null, coach_name: null, players: [] },
          { id: 'l-home', match_id: 'match-1', team_id: homeTeam.id, formation: null, coach_name: null, players: [] },
        ],
      }),
    );
    expect(lineups.map((entry) => entry.side)).toEqual(['home', 'away']);

    const timeline = eventsBySide(
      details({
        events: [
          { id: 'e2', match_id: 'match-1', team_id: awayTeam.id, player_id: null, assist_player_id: null, type: 'goal', minute: 78, extra_minute: null, description: null },
          { id: 'e1', match_id: 'match-1', team_id: homeTeam.id, player_id: null, assist_player_id: null, type: 'yellow_card', minute: 12, extra_minute: null, description: null },
        ],
      }),
    );
    expect(timeline.map((entry) => entry.event.id)).toEqual(['e1', 'e2']);
    expect(timeline[0].side).toBe('home');
  });
});

describe('match card', () => {
  it('links every entity by canonical slug and shows the score only when known', () => {
    const scheduled = renderToString(createElement(MatchCard, { item: listItem() }));
    expect(scheduled).toContain('href="/teams/fc-example"');
    expect(scheduled).toContain('href="/teams/real-sample"');
    expect(scheduled).toContain('href="/competitions/premier-league"');
    expect(scheduled).toContain('href="/matches/fc-example-vs-real-sample"');
    expect(scheduled).toContain('Example Arena');
    expect(scheduled).toContain('score not available');
    expect(scheduled).not.toContain(homeTeam.id);

    const finished = renderToString(
      createElement(MatchCard, {
        item: listItem({ match: match({ status: 'finished', home_score: 3, away_score: 0 }) }),
      }),
    );
    expect(finished).toContain('3 - 0');
    expect(finished).toContain('full time');
  });

  it('omits the venue when it is unknown instead of guessing', () => {
    const html = renderToString(createElement(MatchCard, { item: listItem({ venue: null }) }));
    expect(html).not.toContain('Example Arena');
  });
});

describe('match header', () => {
  it('shows known facts and marks absent ones as unavailable', () => {
    const html = renderToString(createElement(MatchHeader, { details: details() }));
    expect(html).toContain('id="match-heading"');
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('2030/31');
    expect(html).toContain('Full time');
    expect(html).toContain('30,000');

    const sparse = renderToString(
      createElement(MatchHeader, {
        details: details({
          venue: null,
          season: null,
          match: match({ status: 'postponed', referee_name: null, attendance: null }),
        }),
      }),
    );
    expect(sparse).toContain('Not available');
    expect(sparse).toContain('postponed');
    expect(sparse).not.toContain('2030/31');
  });

  it('never renders a score before it is known', () => {
    const html = renderToString(
      createElement(MatchHeader, { details: details({ match: match({ status: 'scheduled', home_score: null, away_score: null }) }) }),
    );
    // a pre-kickoff fixture shows a neutral separator, never a scoreline
    expect(html).toContain('match-header__vs');
    expect(html).not.toContain('visually-hidden');
  });
});

describe('match events and lineups', () => {
  it('describes events by name and never exposes a player id', () => {
    const html = renderToString(
      createElement(MatchEvents, {
        details: details({
          events: [
            { id: 'e1', match_id: 'match-1', team_id: homeTeam.id, player_id: player.id, assist_player_id: null, type: 'goal', minute: 23, extra_minute: null, description: 'Header' },
            { id: 'e2', match_id: 'match-1', team_id: 'team-unknown', player_id: 'player-unknown', assist_player_id: null, type: 'mystery_event', minute: null, extra_minute: null, description: null },
          ],
          lineups: [
            { id: 'l1', match_id: 'match-1', team_id: homeTeam.id, formation: null, coach_name: null, players: [
              { id: 'lp1', lineup_id: 'l1', player_id: player.id, position: 'FW', shirt_number: 9, captain: false, substitute: false, starter: true, minutes_played: 90, player },
            ] },
          ],
        }),
      }),
    );
    expect(html).toContain('match-event__minute">23');
    expect(html).toContain('Goal');
    expect(html).toContain('href="/players/jane-doe"');
    expect(html).toContain('Header');
    expect(html).toContain('Team not identified');
    expect(html).toContain('mystery event');
    expect(html).not.toContain('player-unknown');
    expect(html).not.toContain('team-unknown');
  });

  it('states plainly when a timeline is empty', () => {
    const html = renderToString(createElement(MatchEvents, { details: details() }));
    expect(html).toContain('No match events');
  });

  it('renders lineups with resolved players and hides when absent', () => {
    const populated = renderToString(
      createElement(MatchLineups, {
        details: details({
          lineups: [
            { id: 'l1', match_id: 'match-1', team_id: homeTeam.id, formation: '4-3-3', coach_name: 'Coach Home', players: [
              { id: 'lp1', lineup_id: 'l1', player_id: player.id, position: 'Forward', shirt_number: 9, captain: true, substitute: false, starter: true, minutes_played: 90, player },
              { id: 'lp2', lineup_id: 'l1', player_id: 'player-unknown', position: null, shirt_number: null, captain: false, substitute: true, starter: false, minutes_played: null, player: null },
            ] },
          ],
        }),
      }),
    );
    expect(populated).toContain('Starting eleven');
    expect(populated).toContain('Substitutes');
    expect(populated).toContain('4-3-3');
    expect(populated).toContain('Coach Home');
    expect(populated).toContain('href="/players/jane-doe"');
    expect(populated).toContain('Player details unavailable');
    expect(populated).not.toContain('player-unknown');

    const empty = renderToString(createElement(MatchLineups, { details: details() }));
    expect(empty).toContain('No lineups');
  });
});

describe('match statistics', () => {
  it('shows an em dash for missing values and hides entirely when empty', () => {
    const partial = renderToString(
      createElement(MatchStats, {
        details: details({
          teamStatistics: [
            { id: 'ts-h', match_id: 'match-1', team_id: homeTeam.id, possession: 55, shots: null, shots_on_target: null, corners: null, fouls: null, offsides: null, yellow_cards: null, red_cards: null, passes: null, pass_accuracy: null },
          ],
        }),
      }),
    );
    expect(partial).toContain('55%');
    expect(partial).toContain('—');
    expect(partial).not.toContain('>0<');
    expect(partial).toContain('No player statistics');

    const none = renderToString(createElement(MatchStats, { details: details() }));
    expect(none).toContain('No team statistics');
  });

  it('lists player statistics with a canonical link for known players', () => {
    const html = renderToString(
      createElement(MatchStats, {
        details: details({
          lineups: [
            { id: 'l1', match_id: 'match-1', team_id: homeTeam.id, formation: null, coach_name: null, players: [
              { id: 'lp1', lineup_id: 'l1', player_id: player.id, position: 'FW', shirt_number: 9, captain: false, substitute: false, starter: true, minutes_played: 90, player },
            ] },
          ],
          playerStatistics: [
            { id: 'ps1', match_id: 'match-1', team_id: homeTeam.id, player_id: player.id, minutes: 90, goals: 2, assists: null, shots: 4, shots_on_target: 3, passes: 30, pass_accuracy: 90, tackles: 1, interceptions: 0, clearances: 0, yellow_cards: 1, red_cards: 0, rating: 8.1 },
          ],
        }),
      }),
    );
    expect(html).toContain('href="/players/jane-doe"');
    expect(html).toContain('Player statistics');
    expect(html).toContain('1Y / 0R');
  });
});

describe('match filter toolbar and date navigation', () => {
  it('renders a GET form that keeps the active filters selected', () => {
    const filters = parseMatchFilters({ phase: 'finished', competition: 'premier-league', team: 'fc-example', from: '2030-02-01', sort: 'asc' });
    const html = renderToString(
      createElement(MatchFilterForm, { filters, competitions: [competition], teams: [homeTeam, awayTeam], resultCount: 4 }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/matches"');
    expect(html).toContain('Premier League');
    expect(html).toContain('Real Sample');
    expect(html).toContain('value="finished" selected=""');
    expect(html).toContain('value="2030-02-01"');
    expect(html).toContain('Clear all filters');
  });

  it('steps through a selected day while keeping other filters', () => {
    const filters = parseMatchFilters({ phase: 'finished', team: 'fc-example', from: '2030-02-01', to: '2030-02-01' });
    const html = renderToString(createElement(MatchDateNav, { filters }));
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('phase=finished');
    expect(html).toContain('team=fc-example');
    expect(html).toContain('from=2030-01-31');
  });

  it('offers no date navigation when no day is selected', () => {
    expect(renderToString(createElement(MatchDateNav, { filters: parseMatchFilters({}) }))).toBe('');
  });
});

describe('match detail composition', () => {
  it('shows lineups and statistics for a settled match and related coverage', () => {
    const html = renderToString(
      createElement(MatchDetailView, {
        details: details({ lineups: [], teamStatistics: [], playerStatistics: [] }),
        relatedNews: [article()],
      }),
    );
    expect(html).toContain('Lineups');
    expect(html).toContain('Match events');
    expect(html).toContain('Statistics');
    expect(html).toContain('Related coverage');
    expect(html).toContain('href="/news/match-report"');
    expect(html).toContain('href="/matches"');
    // the route owns the page-level <article>; the view is only a wrapper div
    expect(html.startsWith('<div class="match-detail">')).toBe(true);
  });

  it('hides pre-kickoff sections, and shows live sections while in play', () => {
    const upcoming = renderToString(
      createElement(MatchDetailView, { details: details({ match: match({ status: 'scheduled' }) }), relatedNews: [] }),
    );
    expect(upcoming).not.toContain('>Lineups<');
    expect(upcoming).not.toContain('>Statistics<');
    expect(upcoming).not.toContain('Related coverage');
    // A match that has not kicked off gets no live banner either.
    expect(upcoming).not.toContain('live-banner');

    const live = renderToString(
      createElement(MatchDetailView, { details: details({ match: match({ status: 'live' }) }), relatedNews: [] }),
    );
    expect(live).toContain('>Lineups<');
    // In-play statistics are now shown, and must be labelled provisional.
    expect(live).toContain('>Statistics<');
    expect(live).toContain('provisional');
    expect(live).toContain('live-banner');
  });

  it('shows the live banner only for a match that is actually in progress', () => {
    for (const status of ['scheduled', 'pre_match', 'finished', 'postponed', 'cancelled', 'abandoned']) {
      const html = renderToString(
        createElement(MatchDetailView, { details: details({ match: match({ status }) }), relatedNews: [] }),
      );
      expect(html).not.toContain('live-banner');
    }

    for (const status of ['live', 'half_time', 'extra_time', 'penalty_shootout', 'suspended']) {
      const html = renderToString(
        createElement(MatchDetailView, { details: details({ match: match({ status }) }), relatedNews: [] }),
      );
      expect(html).toContain('live-banner');
    }
  });
});

describe('matches metadata and styles', () => {
  it('canonicalizes the bare listing', async () => {
    expect(matchesMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}/matches`);
    expect(matchesMetadata.robots).toBe('index,follow');
    expect(String(matchesMetadata.title)).toContain('Fixtures');
  });

  it('ships the match styles the components rely on', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of [
      '.match-card',
      '.match-day__list',
      '.match-filters',
      '.match-date-nav',
      '.match-phase-tabs',
      '.match-header__details-list',
      '.match-events__list',
      '.match-lineups',
      '.match-team-stats',
      '.match-player-stats',
      '.match-related',
      '.pagination',
    ]) {
      expect(css, selector).toContain(selector);
    }
    expect(css).not.toContain('overflow-x: scroll');
  });
});
