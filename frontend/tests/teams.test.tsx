import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteConfig } from '@/config/site';
import { generateMetadata as teamsMetadataFn } from '@/app/(site)/teams/page';
import { generateMetadata as teamMetadata } from '@/app/(site)/teams/[slug]/page';
import {
  buildTeamCompetitions,
  fetchTeamDetail,
  fetchTeamList,
  fetchTeamMatches,
  fetchTeamNews,
  fetchTeamStatistics,
  groupSquad,
  parseMatchWindow,
  parseTeamSelection,
  parseTeamView,
  squadGroupFor,
  teamHref,
  toTeamDetails,
  toTeamStatistics,
  TEAMS_CANONICAL,
  unresolvedSquad,
  TEAM_VIEWS,
  type SquadPlayer,
  type TeamFormResult,
  type TeamRecord,
} from '@/lib/teams';
import type { CompetitionRecord, Season } from '@/lib/competitions';
import { TeamCard, TeamHeader, TeamNav } from '@/components/teams/TeamHeader';
import { SquadList } from '@/components/teams/SquadList';
import { TeamForm, TeamStatistics } from '@/components/teams/TeamForm';
import { SquadPreview, TeamCompetitions, TeamMatches, TeamNews } from '@/components/teams/TeamSections';

const team: TeamRecord = {
  id: 'team-1',
  name: 'FC Example',
  short_name: 'FCE',
  slug: 'fc-example',
  logo_url: 'https://cdn.test/fce.png',
  founded_year: 1905,
  venue_id: 'venue-1',
  website_url: 'https://fcexample.test',
  is_active: true,
  country_id: 'country-1',
  country: null,
};

const country = { id: 'country-1', name: 'England', slug: 'england', code: 'ENG', flag_url: null };

const season = (overrides: Partial<Season> = {}): Season => ({
  id: 'season-1',
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

const player = (overrides: Partial<{ id: string; display_name: string; slug: string; position: string | null }> = {}) => ({
  id: 'player-1',
  display_name: 'Jane Doe',
  slug: 'jane-doe',
  photo_url: null,
  position: 'Forward',
  ...overrides,
});

const squadRow = (overrides: Partial<SquadPlayer> = {}): SquadPlayer => ({
  player: player(),
  shirt_number: 9,
  captain: false,
  is_current: true,
  season_id: 'season-1',
  ...overrides,
});

const formResult = (overrides: Partial<TeamFormResult> = {}): TeamFormResult => ({
  outcome: 'win',
  goals_for: 2,
  goals_against: 1,
  opponent_id: 'team-2',
  scheduled_at: '2026-09-01T15:00:00.000Z',
  ...overrides,
});

const statisticsBody = (overrides: Record<string, unknown> = {}) => ({
  team: { id: 'team-1', name: 'FC Example', slug: 'fc-example' },
  season_id: null,
  totals: { played: 10, won: 6, drawn: 2, lost: 2, goals_for: 18, goals_against: 7, goal_difference: 11, clean_sheets: 4 },
  form: [formResult()],
  matches_considered: 10,
  matches_skipped: 0,
  state: 'ready',
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

/**
 * React separates adjacent text nodes with comment markers and escapes `&` in
 * attribute values, so assertions compare against normalised markup.
 */
const text = (html: string): string => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const detailsBody = (overrides: Record<string, unknown> = {}) => ({
  team: { ...team, country },
  country,
  venue: { id: 'venue-1', name: 'Example Arena', city: 'London', capacity: 30000 },
  competitions: [competition()],
  seasons: [season()],
  upcomingMatches: [],
  recentMatches: [],
  articles: [],
  squad: [{ player: player(), shirt_number: 9, is_current: true, season_id: 'season-1' }],
  participation: [{ competition_id: 'comp-1', season_id: 'season-1' }],
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('team views, filters and canonical links', () => {
  it('accepts only known views and falls back to the overview', () => {
    for (const view of TEAM_VIEWS) {
      expect(parseTeamView(view)).toBe(view);
    }
    expect(parseTeamView('nope')).toBe('overview');
    expect(parseTeamView(undefined)).toBe('overview');
  });

  it('accepts a known match window only', () => {
    expect(parseMatchWindow('upcoming')).toBe('upcoming');
    expect(parseMatchWindow('results')).toBe('results');
    expect(parseMatchWindow('all')).toBe('all');
    expect(parseMatchWindow('anything-else')).toBe('all');
  });

  it('parses a selection and drops invalid filters', () => {
    const selection = parseTeamSelection({
      view: 'matches',
      season: '44444444-4444-4444-8444-444444444444',
      page: '2',
      window: 'results',
      competition: 'premier-league',
      from: '2026-08-01',
      to: '2026-09-01',
    });
    expect(selection).toEqual({
      view: 'matches',
      seasonId: '44444444-4444-4444-8444-444444444444',
      page: 2,
      window: 'results',
      competition: 'premier-league',
      from: '2026-08-01',
      to: '2026-09-01',
    });

    const bad = parseTeamSelection({ competition: 'bad slug/../etc', from: 'soon', season: 'nope', page: '0' });
    expect(bad.competition).toBeNull();
    expect(bad.from).toBeNull();
    expect(bad.seasonId).toBeNull();
    expect(bad.page).toBe(1);
  });

  it('keeps every view on one canonical team path', () => {
    expect(teamHref('fc-example', {})).toBe('/teams/fc-example');
    expect(teamHref('fc-example', { view: 'overview' })).toBe('/teams/fc-example');
    expect(teamHref('fc-example', { view: 'squad', seasonId: 'season-1' })).toBe('/teams/fc-example?view=squad&season=season-1');
    expect(teamHref('fc-example', { view: 'matches', window: 'results', page: 3 })).toContain('page=3');
  });
});

describe('squad grouping', () => {
  it('maps recorded positions into the standard units', () => {
    expect(squadGroupFor('Goalkeeper')).toBe('goalkeepers');
    expect(squadGroupFor('GK')).toBe('goalkeepers');
    expect(squadGroupFor('Centre-Back')).toBe('defenders');
    expect(squadGroupFor('Left Back')).toBe('defenders');
    expect(squadGroupFor('Central Midfielder')).toBe('midfielders');
    expect(squadGroupFor('Attacking Midfielder')).toBe('midfielders');
    expect(squadGroupFor('Striker')).toBe('forwards');
  });

  it('never invents a position', () => {
    expect(squadGroupFor(null)).toBe('unknown');
    expect(squadGroupFor(undefined)).toBe('unknown');
    expect(squadGroupFor('')).toBe('unknown');
    expect(squadGroupFor('   ')).toBe('unknown');
    expect(squadGroupFor('Sommelier')).toBe('unknown');
  });

  it('groups players and orders them by shirt number', () => {
    const groups = groupSquad([
      squadRow({ player: player({ id: 'p1', display_name: 'Keeper', slug: 'keeper', position: 'Goalkeeper' }), shirt_number: 1 }),
      squadRow({ player: player({ id: 'p2', display_name: 'Striker Two', slug: 'striker-two', position: 'Striker' }), shirt_number: 19 }),
      squadRow({ player: player({ id: 'p3', display_name: 'Striker One', slug: 'striker-one', position: 'Forward' }), shirt_number: 9 }),
      squadRow({ player: player({ id: 'p4', display_name: 'Back', slug: 'back', position: 'Defender' }), shirt_number: 4 }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['goalkeepers', 'defenders', 'forwards']);
    const forwards = groups.find((group) => group.key === 'forwards');
    expect(forwards?.players.map((row) => row.shirt_number)).toEqual([9, 19]);
  });

  it('puts unknown positions in their own group and omits empty ones', () => {
    const groups = groupSquad([
      squadRow({ player: player({ position: 'Mystery' }) }),
      squadRow({ player: player({ id: 'p2', display_name: 'Keeper', slug: 'keeper', position: 'Goalkeeper' }) }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['goalkeepers', 'unknown']);
  });

  it('counts players without a resolvable profile', () => {
    expect(unresolvedSquad([squadRow(), squadRow({ player: null })])).toBe(1);
    // A player-less entry is never rendered as a group member.
    expect(groupSquad([squadRow({ player: null })])).toEqual([]);
  });
});

describe('team competitions from participation links', () => {
  it('maps seasons onto the competitions the team plays in', () => {
    const entries = buildTeamCompetitions(
      [competition(), competition({ id: 'comp-2', name: 'FA Cup', slug: 'fa-cup' })],
      [season(), season({ id: 'season-2', competition_id: 'comp-2', name: '2026/27', is_current: false })],
      [
        { competition_id: 'comp-1', season_id: 'season-1' },
        { competition_id: 'comp-2', season_id: 'season-2' },
      ],
    );
    expect(entries).toHaveLength(2);
    const league = entries.find((entry) => entry.competition.slug === 'premier-league');
    expect(league?.seasons.map((item) => item.name)).toEqual(['2026/27']);
  });

  it('returns no seasons for a competition with no participation link', () => {
    const entries = buildTeamCompetitions([competition()], [season()], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].seasons).toEqual([]);
  });
});

describe('team response validation', () => {
  it('requires a name and slug', () => {
    expect(toTeamDetails(null)).toBeNull();
    expect(toTeamDetails({ team: { name: 'No slug' } })).toBeNull();
    expect(toTeamDetails(detailsBody())).not.toBeNull();
  });

  it('reads captain status only when the API supplies it', () => {
    const plain = toTeamDetails(detailsBody());
    expect(plain?.squad[0].captain).toBe(false);
    const withCaptain = toTeamDetails(
      detailsBody({ squad: [{ player: player(), shirt_number: 10, is_current: true, captain: true, season_id: 'season-1' }] }),
    );
    expect(withCaptain?.squad[0].captain).toBe(true);
  });

  it('rejects a statistics payload without totals', () => {
    expect(toTeamStatistics(null)).toBeNull();
    expect(toTeamStatistics({ team: { slug: 'x' } })).toBeNull();
    expect(toTeamStatistics(statisticsBody())).not.toBeNull();
  });

  it('drops malformed form entries', () => {
    const payload = toTeamStatistics(
      statisticsBody({ form: [formResult(), { outcome: 'guess', goals_for: 1, goals_against: 0, scheduled_at: 'x' }, null] }),
    );
    expect(payload?.form).toHaveLength(1);
  });
});

describe('team listing data layer', () => {
  it('sends the search term to the backend and stays paginated', async () => {
    const seen: Array<{ url: string; init?: unknown }> = [];
    mockApi(
      (pathname) =>
        pathname === '/teams' ? { status: 200, body: envelope([team], { page: 1, limit: 24, total: 1, totalPages: 1 }) } : null,
      seen,
    );
    const result = await fetchTeamList({ query: '  example  ' });
    expect(result.status).toBe('ready');
    expect(result.query).toBe('example');
    const url = new URL(seen[0].url);
    expect(url.searchParams.get('q')).toBe('example');
    expect(url.searchParams.get('active')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('24');
  });

  it('omits the query when the field is empty', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/teams') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([], { page: 1, limit: 24, total: 0, totalPages: 0 }) };
    });
    await fetchTeamList({ query: '   ' });
    expect(seen[0]).not.toContain('q=');
  });

  it('separates empty from a transport failure', async () => {
    mockApi((pathname) =>
      pathname === '/teams' ? { status: 200, body: envelope([], { page: 1, limit: 24, total: 0, totalPages: 0 }) } : null,
    );
    await expect(fetchTeamList({})).resolves.toMatchObject({ status: 'empty' });

    mockApi(() => null);
    await expect(fetchTeamList({})).resolves.toMatchObject({ status: 'error', rows: [] });
  });
});

describe('team detail data layer', () => {
  it('returns the profile, squad, competitions and participation', async () => {
    mockApi((pathname) =>
      pathname === '/teams/fc-example/details' ? { status: 200, body: envelope(detailsBody()) } : null,
    );
    const result = await fetchTeamDetail('fc-example');
    expect(result.status).toBe('ready');
    expect(result.team?.name).toBe('FC Example');
    expect(result.country?.name).toBe('England');
    expect(result.venue?.name).toBe('Example Arena');
    expect(result.squad).toHaveLength(1);
    expect(result.participation).toHaveLength(1);
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
    await expect(fetchTeamDetail('bad slug/../etc')).resolves.toMatchObject({ status: 'not-found' });
    expect(seen).toHaveLength(0);
    await expect(fetchTeamDetail('fc-example')).resolves.toMatchObject({ status: 'not-found' });
  });

  it('reports a transport failure as an error, not a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 'UPSTREAM_ERROR', message: 'x' } }) })) as unknown as typeof fetch,
    );
    await expect(fetchTeamDetail('fc-example')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('team statistics data layer', () => {
  it('reads the server calculation', async () => {
    mockApi((pathname) => (pathname === '/teams/fc-example/statistics' ? { status: 200, body: envelope(statisticsBody()) } : null));
    const result = await fetchTeamStatistics('fc-example', null);
    expect(result.status).toBe('ready');
    expect(result.payload?.totals.played).toBe(10);
    expect(result.payload?.form).toHaveLength(1);
  });

  it('scopes to a season', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/teams/fc-example/statistics') return null;
      seen.push(url.search);
      return { status: 200, body: envelope(statisticsBody()) };
    });
    await fetchTeamStatistics('fc-example', '44444444-4444-4444-8444-444444444444');
    expect(seen[0]).toContain('season=44444444-4444-4444-8444-444444444444');
  });

  it('distinguishes unavailable from empty', async () => {
    mockApi(() => null);
    const unavailable = await fetchTeamStatistics('fc-example', null);
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.payload).toBeNull();

    mockApi((pathname) =>
      pathname === '/teams/fc-example/statistics'
        ? { status: 200, body: envelope(statisticsBody({ state: 'empty', totals: { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, clean_sheets: 0 }, form: [] })) }
        : null,
    );
    const empty = await fetchTeamStatistics('fc-example', null);
    expect(empty.status).toBe('ready');
    expect(empty.payload?.state).toBe('empty');
  });
});

describe('team matches and news', () => {
  it('scopes matches to the team and requested window', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/matches') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([], { page: 1, limit: 12, total: 0, totalPages: 0 }) };
    });
    await fetchTeamMatches('fc-example', parseTeamSelection({ view: 'matches', window: 'results' }));
    expect(seen[0]).toContain('team=fc-example');
    expect(seen[0]).toContain('phase=finished');
    expect(seen[0]).toContain('sort=desc');

    await fetchTeamMatches('fc-example', parseTeamSelection({ window: 'upcoming' }));
    expect(seen[1]).toContain('phase=upcoming');
    expect(seen[1]).toContain('sort=asc');
  });

  it('requests team news through the canonical relation', async () => {
    const seen: string[] = [];
    mockApi((pathname, url) => {
      if (pathname !== '/news') return null;
      seen.push(url.search);
      return { status: 200, body: envelope([]) };
    });
    await fetchTeamNews('fc-example');
    expect(seen[0]).toContain('team=fc-example');
  });

  it('degrades each section independently', async () => {
    mockApi(() => null);
    await expect(fetchTeamMatches('fc-example', parseTeamSelection({}))).resolves.toMatchObject({ status: 'error' });
    await expect(fetchTeamNews('fc-example')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('team listing and profile components', () => {
  it('links a team canonically and shows known metadata only', () => {
    const html = renderToString(createElement(TeamCard, { team }));
    expect(html).toContain('href="/teams/fc-example"');
    expect(html).toContain('FC Example');
    expect(html).toContain('FCE');
    expect(text(html)).toContain('Founded 1905');
    expect(html).not.toContain('team-1');
  });

  it('shows identity, venue and a safe external website link', () => {
    const html = renderToString(
      createElement(TeamHeader, {
        team,
        country,
        venue: { id: 'venue-1', name: 'Example Arena', city: 'London', capacity: 30000 },
      }),
    );
    expect(html).toContain('id="team-heading"');
    expect(html).toContain('England');
    expect(html).toContain('Example Arena');
    expect(html).toContain('30,000');
    expect(html).toContain('href="https://fcexample.test/"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(text(html)).toContain('Founded 1905');
  });

  it('rejects a hostile website url and says so plainly', () => {
    for (const hostile of ['javascript:alert(1)', 'data:text/html,x', 'not a url']) {
      const html = renderToString(
        createElement(TeamHeader, { team: { ...team, website_url: hostile }, country: null, venue: null }),
      );
      expect(html, hostile).not.toContain('javascript:');
      expect(html, hostile).toContain('Not available');
    }
  });

  it('omits an unknown venue and region rather than guessing', () => {
    const html = renderToString(
      createElement(TeamHeader, { team: { ...team, website_url: null, founded_year: null }, country: null, venue: null }),
    );
    expect(html).toContain('Not available');
    expect(html).not.toContain('Founded');
  });

  it('navigates sections while preserving the season', () => {
    const html = renderToString(createElement(TeamNav, { slug: 'fc-example', view: 'squad', seasonId: 'season-1' }));
    expect(html).toContain('aria-label="Team sections"');
    expect(html).toContain('aria-current="page"');
    for (const label of ['Overview', 'Matches', 'Squad', 'Competitions', 'News']) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('season=season-1');
  });
});

describe('squad component', () => {
  it('links every player to a canonical profile', () => {
    const html = renderToString(
      createElement(SquadList, {
        squad: [
          squadRow({ player: player({ position: 'Goalkeeper', display_name: 'Gary Keeper', slug: 'gary-keeper' }), shirt_number: 1 }),
          squadRow({ player: player({ position: 'Striker', display_name: 'Striker One', slug: 'striker-one' }), shirt_number: 9 }),
        ],
        status: 'ready',
      }),
    );
    expect(html).toContain('Goalkeepers');
    expect(html).toContain('Forwards');
    expect(html).toContain('href="/players/gary-keeper"');
    expect(html).toContain('href="/players/striker-one"');
    expect(text(html)).toContain('2 players');
    expect(text(html)).toContain('Shirt number 9');
  });

  it('never renders a squad group for an unresolved player', () => {
    const html = renderToString(createElement(SquadList, { squad: [squadRow({ player: null })], status: 'ready' }));
    expect(html).toContain('No current squad has been registered');
    expect(html).not.toContain('player_id');
  });

  it('separates an empty squad from an unavailable one', () => {
    const empty = renderToString(createElement(SquadList, { squad: [], status: 'empty' }));
    expect(empty).toContain('No current squad has been registered');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(SquadList, { squad: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');
    expect(failed).toContain('role="alert"');
  });

  it('previews named players and links to the full squad', () => {
    const html = renderToString(
      createElement(SquadPreview, { squad: [squadRow(), squadRow({ player: null })], slug: 'fc-example' }),
    );
    expect(html).toContain('href="/players/jane-doe"');
    expect(html).toContain('href="/teams/fc-example?view=squad"');
    expect(html).not.toContain('player_id');
  });
});

describe('team form and statistics', () => {
  const opponents = new Map([['team-2', { name: 'Real Sample', slug: 'real-sample' }]]);

  it('shows form without relying on colour alone', () => {
    const html = renderToString(
      createElement(TeamForm, {
        form: [formResult({ outcome: 'win' }), formResult({ outcome: 'draw' }), formResult({ outcome: 'loss' })],
        opponents,
      }),
    );
    expect(html).toContain('Recent form');
    // Every outcome carries a written label, not just a colour.
    expect(html).toContain('>Win<');
    expect(html).toContain('>Draw<');
    expect(html).toContain('>Loss<');
    expect(html).toContain('data-outcome="win"');
    expect(html).toContain('href="/teams/real-sample"');
    expect(html).toContain('2–1');
  });

  it('says an opponent is unidentified rather than guessing a link', () => {
    const html = renderToString(createElement(TeamForm, { form: [formResult({ opponent_id: 'unknown' })], opponents }));
    expect(html).toContain('Opponent not identified');
    expect(html).not.toContain('href="/teams/unknown"');
  });

  it('renders nothing when there is no completed form', () => {
    expect(renderToString(createElement(TeamForm, { form: [], opponents }))).toBe('');
  });

  it('shows aggregate statistics and never fabricates missing data', () => {
    const html = renderToString(
      createElement(TeamStatistics, { result: { status: 'ready', payload: toTeamStatistics(statisticsBody()) } }),
    );
    expect(html).toContain('>18<'); // goals scored
    expect(html).toContain('>7<'); // goals conceded
    expect(html).toContain('Matches played');
    expect(html).toContain('Clean sheets');
    expect(text(html)).toContain('Based on 10 completed matches.');
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('flags a provisional record when results are missing', () => {
    const html = renderToString(
      createElement(TeamStatistics, {
        result: { status: 'ready', payload: toTeamStatistics(statisticsBody({ state: 'incomplete', matches_skipped: 2 })) },
      }),
    );
    expect(html).toContain('provisional');
    expect(text(html)).toContain('2 completed matches that are missing a result');
  });

  it('distinguishes unavailable statistics from an empty record', () => {
    const unavailable = renderToString(
      createElement(TeamStatistics, { result: { status: 'unavailable', payload: null } }),
    );
    expect(unavailable).toContain('temporarily unavailable');
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).not.toContain('Based on 0 completed');

    const empty = renderToString(
      createElement(TeamStatistics, {
        result: {
          status: 'ready',
          payload: toTeamStatistics(
            statisticsBody({
              state: 'empty',
              form: [],
              totals: { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, clean_sheets: 0 },
            }),
          ),
        },
      }),
    );
    expect(empty).toContain('No completed matches have been recorded');
    expect(empty).not.toContain('temporarily unavailable');
  });
});

describe('team matches, competitions and news sections', () => {
  it('offers a match window filter on the canonical path', () => {
    const html = renderToString(
      createElement(TeamMatches, {
        slug: 'fc-example',
        selection: parseTeamSelection({ view: 'matches' }),
        items: [],
        status: 'empty',
      }),
    );
    expect(html).toContain('aria-label="Match window"');
    expect(text(html)).toContain('href="/teams/fc-example?view=matches&window=upcoming"');
    expect(text(html)).toContain('href="/teams/fc-example?view=matches&window=results"');
    expect(html).toContain('No matches are available');
  });

  it('links competitions and their seasons canonically', () => {
    const html = renderToString(
      createElement(TeamCompetitions, {
        entries: buildTeamCompetitions([competition()], [season()], [{ competition_id: 'comp-1', season_id: 'season-1' }]),
        status: 'ready',
      }),
    );
    expect(html).toContain('href="/competitions/premier-league"');
    expect(html).toContain('2026/27');
    expect(html).toContain('current');
  });

  it('states when a team competes in nothing', () => {
    const html = renderToString(createElement(TeamCompetitions, { entries: [], status: 'empty' }));
    expect(html).toContain('not currently recorded as competing');
  });

  it('separates empty team news from unavailable news', () => {
    const empty = renderToString(createElement(TeamNews, { articles: [], status: 'empty' }));
    expect(empty).toContain('No published stories are linked');
    expect(empty).not.toContain('temporarily unavailable');

    const failed = renderToString(createElement(TeamNews, { articles: [], status: 'error' }));
    expect(failed).toContain('temporarily unavailable');
  });
});

describe('team metadata and styles', () => {
  it('canonicalizes the team index', async () => {
    const teamsMetadata = await teamsMetadataFn({ searchParams: {} });
    expect(teamsMetadata.alternates?.canonical).toBe(`${siteConfig.siteUrl}${TEAMS_CANONICAL}`);
    expect(teamsMetadata.robots).toBe('index,follow');
  });

  it('builds team metadata from the resolved profile', async () => {
    mockApi((pathname) =>
      pathname === '/teams'
        ? {
            status: 200,
            body: envelope([{ id: 't-1', name: 'FC Example', short_name: 'FCE', slug: 'fc-example', logo_url: null }]),
          }
        : null,
    );
    const meta = await teamMetadata({ params: { slug: 'fc-example' } });
    expect(meta.alternates?.canonical).toBe(`${siteConfig.siteUrl}/teams/fc-example`);
    expect(String(meta.title)).toContain('FC Example');
    expect(meta.robots).toBe('index,follow');
  });

  it('noindexes an unknown team and an invalid slug', async () => {
    mockApi(() => null);
    await expect(teamMetadata({ params: { slug: 'nope' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
    await expect(teamMetadata({ params: { slug: 'bad slug' } })).resolves.toMatchObject({
      robots: 'noindex,nofollow',
    });
  });

  it('ships the team styles the components rely on', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'globals.css'), 'utf8');
    for (const selector of [
      '.team-card',
      '.team-header',
      '.team-nav',
      '.teams-search',
      '.teams-grid',
      '.squad__players',
      '.squad__player',
      '.team-form__list',
      '.team-form__badge',
      '.team-statistics__grid',
      '.team-matches__windows',
      '.team-competitions__list',
      '.team-squad-preview__list',
    ]) {
      expect(css, selector).toContain(selector);
    }
    // Form outcomes must be distinguishable without colour.
    expect(css).toContain('[data-outcome="win"]');
    expect(css).toContain('[data-outcome="loss"]');
    // Squad stays a responsive grid rather than a wide scroll region.
    expect(css).toContain('.squad__players');
    expect(css).not.toContain('overflow-x: scroll');
  });
});
