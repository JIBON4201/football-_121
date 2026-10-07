import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveMatchCard, ResultMatchCard } from '@/components/touchline/match-cards';
import { EmptyState, ErrorState } from '@/components/touchline/empty-state';
import {
  MATCH_CENTRE_REVALIDATE,
  loadMatchFeed,
  toFootballMatch,
  toMatchEventSummaries,
  toMatchStatus,
} from '@/lib/touchline/homepage-api';
import { getLivePageData, getMatchCentreData } from '@/lib/touchline/site-data';
import type { Competition, Match, MatchDetails, MatchEvent, Team } from '@/types/api';

const HOME_ID = 'team-home';
const AWAY_ID = 'team-away';

function team(overrides: Partial<Team> = {}): Team {
  return { id: HOME_ID, name: 'Northbridge United', short_name: 'NBU', slug: 'northbridge', logo_url: 'https://cdn.test/nbu.png', ...overrides };
}

function awayTeam(): Team {
  return { id: AWAY_ID, name: 'Eastvale City', short_name: 'EVC', slug: 'eastvale', logo_url: null };
}

function competition(): Competition {
  return { id: 'comp-1', name: 'Premier League', short_name: 'EPL', slug: 'premier-league', logo_url: null };
}

function matchRow(overrides: Partial<Match> = {}): Match {
  return {
    id: 'match-1',
    slug: 'northbridge-v-eastvale-2026-09-12',
    status: 'finished',
    scheduled_at: '2026-09-12T15:00:00.000Z',
    home_score: 2,
    away_score: 1,
    home_team_id: HOME_ID,
    away_team_id: AWAY_ID,
    competition_id: 'comp-1',
    ...overrides,
  };
}

function event(overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: 'event-1',
    team_id: HOME_ID,
    player_id: 'player-1',
    assist_player_id: null,
    type: 'goal',
    minute: 23,
    extra_minute: null,
    description: null,
    ...overrides,
  };
}

function details(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    match: matchRow(),
    competition: competition(),
    homeTeam: team(),
    awayTeam: awayTeam(),
    events: [],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const listBody = (rows: unknown[]) => ({ data: rows, pagination: { page: 1, limit: 50, total: rows.length, totalPages: 1 }, requestId: 'test' });

/** Answers only the match endpoints; every other path 404s so over-fetching is visible. */
function mockMatchApi(
  respond: (pathname: string) => { status: number; body: unknown } | null,
  seen?: string[],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname.replace(/^\/api\/v1/, '') || '/';
      seen?.push(pathname);
      const hit = respond(pathname);
      if (!hit) return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'no route' }, requestId: 'r' });
      return jsonResponse(hit.status, hit.body);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('match adapter', () => {
  it('links every match to its own canonical report, not the listing page', () => {
    const mapped = toFootballMatch(details());
    expect(mapped?.href).toBe('/matches/northbridge-v-eastvale-2026-09-12');
    expect(mapped?.href).not.toBe('/matches');
  });

  it('carries the real status, score, kick-off and competition', () => {
    const mapped = toFootballMatch(details());
    expect(mapped).toMatchObject({
      id: 'northbridge-v-eastvale-2026-09-12',
      status: 'finished',
      homeScore: 2,
      awayScore: 1,
      kickoffAt: '2026-09-12T15:00:00.000Z',
    });
    expect(mapped?.competition.name).toBe('Premier League');
    expect(mapped?.homeTeam.name).toBe('Northbridge United');
    expect(mapped?.awayTeam.name).toBe('Eastvale City');
    // A missing logo stays missing; the crest falls back to an abbreviation.
    expect(mapped?.awayTeam.logoUrl).toBeUndefined();
  });

  it('drops a match that cannot name both clubs, rather than rendering placeholders', () => {
    expect(toFootballMatch(details({ awayTeam: null }))).toBeNull();
    expect(toFootballMatch(details({ homeTeam: null }))).toBeNull();
  });

  it('never invents a status the API did not report', () => {
    expect(toMatchStatus('live')).toBe('live');
    expect(toMatchStatus('half_time')).toBe('live');
    expect(toMatchStatus('scheduled')).toBe('scheduled');
    expect(toMatchStatus('finished')).toBe('finished');
    // Dead or unknown states are dropped instead of relabelled.
    for (const status of ['postponed', 'cancelled', 'abandoned', 'nonsense']) {
      expect(toMatchStatus(status), status).toBeNull();
      expect(toFootballMatch(details({ match: matchRow({ status }) })), status).toBeNull();
    }
  });

  it('reports an in-play state honestly instead of claiming LIVE', () => {
    const running = toFootballMatch(details({ match: matchRow({ status: 'live' }), events: [event({ minute: 67 })] }));
    expect(running?.minute).toBe("67'");
    // The minute itself is the label; "LIVE" would be less precise.
    expect(running?.statusLabel).toBeUndefined();

    expect(toFootballMatch(details({ match: matchRow({ status: 'live' }) }))?.statusLabel).toBe('LIVE');
    expect(toFootballMatch(details({ match: matchRow({ status: 'half_time' }) }))?.statusLabel).toBe('HT');
    expect(toFootballMatch(details({ match: matchRow({ status: 'suspended' }) }))?.statusLabel).toBe('Suspended');

    const shootout = toFootballMatch(
      details({ match: matchRow({ status: 'penalty_shootout' }), events: [event({ minute: 120, extra_minute: 3 })] }),
    );
    expect(shootout?.statusLabel).toBe("PENS 120+3'");
  });

  it('keeps goals and cards with their side, and drops the rest', () => {
    const summaries = toMatchEventSummaries(
      details({
        events: [
          event({ id: 'e1', type: 'goal', team_id: HOME_ID, minute: 23 }),
          event({ id: 'e2', type: 'yellow_card', team_id: AWAY_ID, minute: 55 }),
          event({ id: 'e3', type: 'substitution', team_id: HOME_ID, minute: 60 }),
          event({ id: 'e4', type: 'var', team_id: AWAY_ID, minute: 61 }),
          event({ id: 'e5', type: 'own_goal', team_id: AWAY_ID, minute: 78 }),
        ],
      }),
    );
    expect(summaries).toEqual([
      { type: 'goal', minute: "23'", side: 'home' },
      { type: 'yellow_card', minute: "55'", side: 'away' },
      { type: 'own_goal', minute: "78'", side: 'away' },
    ]);
  });

  it('bounds how many events a single match card claims', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      event({ id: `e${index}`, minute: index + 1, type: 'goal' }),
    );
    expect(toMatchEventSummaries(details({ events: many })).length).toBeLessThanOrEqual(6);
  });

  it('tolerates a match with no events at all', () => {
    expect(toMatchEventSummaries(details())).toEqual([]);
    expect(toFootballMatch(details())?.events).toBeUndefined();
  });
});

describe('match feed loading', () => {
  it('separates a failed feed from a genuinely empty one', async () => {
    mockMatchApi((pathname) => {
      if (pathname === '/matches/live') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'down' } } };
      if (pathname === '/matches/upcoming') return { status: 200, body: listBody([]) };
      return null;
    });
    const failed = await loadMatchFeed('live', { limit: 10, revalidateSeconds: 30, tag: 'matches:live' });
    expect(failed.failed).toBe(true);
    expect(failed.matches).toEqual([]);

    const empty = await loadMatchFeed('upcoming', { limit: 10, revalidateSeconds: 60, tag: 'matches:upcoming' });
    // An empty feed is a real answer, not an outage, and must not raise an error.
    expect(empty.failed).toBe(false);
    expect(empty.matches).toEqual([]);
  });

  it('enriches rows through the details endpoint and keeps the rest on failure', async () => {
    mockMatchApi((pathname) => {
      if (pathname === '/matches/finished') return { status: 200, body: listBody([matchRow(), matchRow({ id: 'm2', slug: 'broken-v-nobody' })]) };
      if (pathname === '/matches/northbridge-v-eastvale-2026-09-12/details') return { status: 200, body: { data: details({ events: [event()] }), requestId: 'r' } };
      if (pathname === '/matches/broken-v-nobody/details') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'gone' } } };
      return null;
    });
    const feed = await loadMatchFeed('finished', { limit: 10, revalidateSeconds: 300, tag: 'matches:results' });
    expect(feed.failed).toBe(false);
    // One unresolvable match must not take down the feed.
    expect(feed.matches).toHaveLength(1);
    expect(feed.matches[0].events).toEqual([{ type: 'goal', minute: "23'", side: 'home' }]);
  });

  it('caches live scores faster than settled results', () => {
    expect(MATCH_CENTRE_REVALIDATE.live).toBeLessThan(MATCH_CENTRE_REVALIDATE.upcoming);
    expect(MATCH_CENTRE_REVALIDATE.upcoming).toBeLessThan(MATCH_CENTRE_REVALIDATE.finished);
  });
});

describe('match centre page data', () => {
  it('live asks only for the two match feeds it renders', async () => {
    const seen: string[] = [];
    mockMatchApi((pathname) => {
      if (pathname === '/matches/live') return { status: 200, body: listBody([matchRow({ status: 'live' })]) };
      if (pathname === '/matches/upcoming') return { status: 200, body: listBody([matchRow({ status: 'scheduled', slug: 'upcoming-v-x' })]) };
      if (pathname.endsWith('/details')) return { status: 200, body: { data: details({ match: matchRow() }), requestId: 'r' } };
      return null;
    }, seen);
    const data = await getLivePageData();
    expect(data.live).toHaveLength(1);
    expect(data.upcoming).toHaveLength(1);
    expect(data.liveFailed).toBe(false);

    // The newsroom, transfers and directories are not match-centre data.
    for (const unwanted of ['/news', '/news/latest', '/news/breaking', '/transfers', '/teams', '/players', '/competitions', '/matches/finished']) {
      expect(seen, unwanted).not.toContain(unwanted);
    }
  });

  it('matches reads fixtures, live and results as three separate feeds', async () => {
    const seen: string[] = [];
    mockMatchApi((pathname) => {
      if (pathname === '/matches/live') return { status: 200, body: listBody([]) };
      if (pathname === '/matches/upcoming') return { status: 200, body: listBody([matchRow({ status: 'scheduled' })]) };
      if (pathname === '/matches/finished') return { status: 200, body: listBody([matchRow()]) };
      if (pathname.endsWith('/details')) return { status: 200, body: { data: details(), requestId: 'r' } };
      return null;
    }, seen);
    const data = await getMatchCentreData();
    expect(seen).toContain('/matches/live');
    expect(seen).toContain('/matches/upcoming');
    expect(seen).toContain('/matches/finished');
    expect(data.upcoming).toHaveLength(1);
    expect(data.results).toHaveLength(1);
    // No live match is in play, which is an empty feed rather than a failure.
    expect(data.live).toEqual([]);
    expect(data.liveFailed).toBe(false);
    expect(data.resultsFailed).toBe(false);
  });

  it('flags only the feed that failed', async () => {
    mockMatchApi((pathname) => {
      if (pathname === '/matches/finished') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'down' } } };
      if (pathname === '/matches/live' || pathname === '/matches/upcoming') return { status: 200, body: listBody([]) };
      return null;
    });
    const data = await getMatchCentreData();
    expect(data.resultsFailed).toBe(true);
    expect(data.liveFailed).toBe(false);
    expect(data.upcomingFailed).toBe(false);
  });
});

describe('match cards', () => {
  const keyEvents = [
    event({ id: 'e1', type: 'goal', team_id: HOME_ID, minute: 23 }),
    event({ id: 'e2', type: 'yellow_card', team_id: AWAY_ID, minute: 55 }),
  ];
  const inPlay = toFootballMatch(details({ match: matchRow({ status: 'live' }), events: keyEvents }))!;
  const settled = toFootballMatch(details({ events: keyEvents }))!;

  it('shows status, competition, both clubs, crests and the real score', () => {
    const html = renderToString(createElement(LiveMatchCard, { match: inPlay }));
    expect(html).toContain('Premier League');
    expect(html).toContain('Northbridge United');
    expect(html).toContain('Eastvale City');
    expect(html).toContain('https://cdn.test/nbu.png');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('<strong>1</strong>');
    // No crest exists for the away side in the API payload, so the abbreviation
    // fallback is used rather than a broken image.
    expect(html).not.toContain('<img src=""');
  });

  it('links to the match report and never to the listing page', () => {
    const html = renderToString(createElement(LiveMatchCard, { match: inPlay }));
    expect(html).toContain('href="/matches/northbridge-v-eastvale-2026-09-12"');
  });

  it('shows the minute once known and the honest label otherwise', () => {
    expect(renderToString(createElement(LiveMatchCard, { match: inPlay }))).toContain("55&#x27;");
    const halfTime = toFootballMatch(details({ match: matchRow({ status: 'half_time' }) }))!;
    expect(renderToString(createElement(LiveMatchCard, { match: halfTime }))).toContain('HT');
  });

  it('lists key events on the result card', () => {
    const html = renderToString(createElement(ResultMatchCard, { match: settled }));
    expect(html).toContain('class="meta-line"');
    expect(html).toContain('Key events:');
    expect(html).toContain("23&#x27; NBU");
    expect(html).toContain("55&#x27; EVC Y");
    expect(html).toContain('meta-separator');
  });

  it('omits the events row when the API recorded nothing', () => {
    const html = renderToString(createElement(ResultMatchCard, { match: toFootballMatch(details())! }));
    expect(html).not.toContain('meta-line');
    expect(html).not.toContain('Key events');
  });
});

describe('feed states', () => {
  it('announces an outage as an error and an empty feed as a status', () => {
    const failed = renderToString(createElement(ErrorState, { title: 'Live scores unavailable', description: 'Try again shortly.' }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Live scores unavailable');

    const empty = renderToString(createElement(EmptyState, { title: 'No matches live', description: 'Check back at kick-off.' }));
    expect(empty).toContain('role="status"');
    expect(empty).not.toContain('role="alert"');
  });

  it('shares one visual language between the two states', () => {
    const failed = renderToString(createElement(ErrorState, { title: 'T', description: 'D' }));
    const empty = renderToString(createElement(EmptyState, { title: 'T', description: 'D' }));
    // Same panel class, so an outage never looks like a redesign.
    expect(failed.replace('role="alert"', '')).toBe(empty.replace('role="status"', ''));
  });
});