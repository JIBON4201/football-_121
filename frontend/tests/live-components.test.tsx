import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveMatchCard } from '@/components/live/LiveMatchCard';
import { LiveMatchBanner } from '@/components/live/LiveMatchBanner';
import { mergeLiveRows } from '@/lib/live-feed';
import type { MatchListItem } from '@/lib/matches';
import type { Competition, Match, Team } from '@/types/api';

const KICKOFF = '2024-05-01T15:00:00.000Z';
const AT_67_MINUTES = Date.parse('2024-05-01T16:07:00.000Z');

function team(id: string, name: string, slug: string): Team {
  return { id, name, short_name: null, slug, logo_url: null };
}

function competition(id: string, name: string, slug: string): Competition {
  return { id, name, short_name: null, slug, logo_url: null };
}

function matchRow(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    slug: 'arsenal-v-chelsea',
    status: 'live',
    scheduled_at: KICKOFF,
    home_score: 2,
    away_score: 1,
    home_team_id: 't1',
    away_team_id: 't2',
    competition_id: 'c1',
    ...overrides,
  };
}

function listItem(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    match: matchRow(),
    homeTeam: team('t1', 'Arsenal', 'arsenal'),
    awayTeam: team('t2', 'Chelsea', 'chelsea'),
    competition: competition('c1', 'Premier League', 'premier-league'),
    venue: null,
    ...overrides,
  };
}

describe('LiveMatchCard', () => {
  it('shows the real status, the backend score and canonical links', () => {
    const html = renderToString(
      createElement(LiveMatchCard, { item: listItem(), serverNowMs: AT_67_MINUTES }),
    );
    expect(html).toContain('LIVE');
    expect(html).toContain('2 - 1');
    expect(html).toContain('href="/matches/arsenal-v-chelsea"');
    expect(html).toContain('href="/teams/arsenal"');
    expect(html).toContain('href="/teams/chelsea"');
    expect(html).toContain('href="/competitions/premier-league"');
  });

  it('states that the minute is approximate rather than authoritative', () => {
    const html = renderToString(
      createElement(LiveMatchCard, { item: listItem(), serverNowMs: AT_67_MINUTES }),
    );
    // The rendered minute may have its apostrophe HTML-escaped.
    expect(html).toMatch(/67(&#x27;|'|’)/);
    expect(html).toContain('approximately 67 minutes elapsed');
  });

  it('never shows a running clock during half time or a shootout', () => {
    for (const status of ['half_time', 'penalty_shootout', 'suspended']) {
      const html = renderToString(
        createElement(LiveMatchCard, {
          item: listItem({ match: matchRow({ status }) }),
          serverNowMs: AT_67_MINUTES,
        }),
      );
      // No elapsed minute may leak into a state with no running clock.
      expect(html).not.toMatch(/67(&#x27;|'|’)/);
      expect(html).not.toContain('minutes elapsed');
      // The state is still communicated.
      expect(html).toContain(status === 'half_time' ? 'HT' : status === 'suspended' ? 'SUSPENDED' : 'PEN');
    }
  });

  it('never mutates the score and hides it until both values are known', () => {
    const unknown = renderToString(
      createElement(LiveMatchCard, {
        item: listItem({ match: matchRow({ home_score: null, away_score: null }) }),
        serverNowMs: AT_67_MINUTES,
      }),
    );
    expect(unknown).not.toContain('2 - 1');
    expect(unknown).toContain('Score not available yet');
  });

  it('marks a suspended match as halted, not as running', () => {
    const html = renderToString(
      createElement(LiveMatchCard, {
        item: listItem({ match: matchRow({ status: 'suspended' }) }),
        serverNowMs: AT_67_MINUTES,
      }),
    );
    expect(html).toContain('data-status="suspended"');
    expect(html).toContain('Suspended');
  });
});

describe('LiveMatchBanner', () => {
  it('renders the state label and the approximation note while in play', () => {
    const html = renderToString(
      createElement(LiveMatchBanner, { status: 'live', scheduledAt: KICKOFF, serverTime: new Date(AT_67_MINUTES).toISOString() }),
    );
    expect(html).toContain('live-banner');
    expect(html).toContain('Live');
    expect(html).toContain('approximate');
  });

  it('renders nothing at all for a match that is not in progress', () => {
    for (const status of ['scheduled', 'finished', 'postponed', 'cancelled', 'abandoned']) {
      const html = renderToString(
        createElement(LiveMatchBanner, { status, scheduledAt: KICKOFF, serverTime: new Date(AT_67_MINUTES).toISOString() }),
      );
      expect(html).toBe('');
    }
  });

  it('shows a suspended state without a clock', () => {
    const html = renderToString(
      createElement(LiveMatchBanner, { status: 'suspended', scheduledAt: KICKOFF, serverTime: new Date(AT_67_MINUTES).toISOString() }),
    );
    expect(html).toContain('SUSPENDED');
    expect(html).toContain('Scores and events update automatically.');
  });
});

describe('mergeLiveRows', () => {
  it('takes the score and status from the poll, never from the snapshot', () => {
    const snapshot = [listItem()];
    const { items } = mergeLiveRows(snapshot, [
      { item: listItem({ match: matchRow({ home_score: 3, away_score: 3, status: 'half_time' }) }), serverTime: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].match.home_score).toBe(3);
    expect(items[0].match.status).toBe('half_time');
  });

  it('drops a match the backend no longer reports as in progress', () => {
    const { items } = mergeLiveRows([listItem()], [
      { item: listItem({ match: matchRow({ status: 'finished' }) }), serverTime: null },
    ]);
    expect(items).toEqual([]);
  });

  it('keeps a suspended match in the feed', () => {
    const { items } = mergeLiveRows([listItem()], [
      { item: listItem({ match: matchRow({ status: 'suspended' }) }), serverTime: null },
    ]);
    expect(items).toHaveLength(1);
  });

  it('adds a new live match directly from its enriched poll row', () => {
    const { items } = mergeLiveRows([], [
      { item: listItem({ match: matchRow({ slug: 'liverpool-v-city', id: 'm9' }) }), serverTime: null },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].match.slug).toBe('liverpool-v-city');
  });

  it('surfaces the server time anchor and sorts in-play matches first', () => {
    const { items, serverTime } = mergeLiveRows(
      [
        listItem({ match: matchRow({ id: 'm2', slug: 'a-v-b', status: 'half_time' }) }),
        listItem({ match: matchRow({ id: 'm1', slug: 'arsenal-v-chelsea', status: 'live' }) }),
      ],
      [
        { item: listItem({ match: matchRow({ id: 'm2', slug: 'a-v-b', status: 'half_time' }) }), serverTime: '2024-05-01T16:07:00.000Z' },
        { item: listItem({ match: matchRow({ id: 'm1', slug: 'arsenal-v-chelsea', status: 'live' }) }), serverTime: '2024-05-01T16:07:00.000Z' },
      ],
    );
    expect(serverTime).toBe('2024-05-01T16:07:00.000Z');
    expect(items.map((item) => item.match.id)).toEqual(['m1', 'm2']);
  });

  it('returns an empty feed rather than throwing on no rows', () => {
    expect(mergeLiveRows([], [])).toEqual({ items: [], serverTime: null });
  });
});
