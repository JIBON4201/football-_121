import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('matches API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('lists matches with pagination', async () => {
    const res = await request(app).get('/api/v1/matches');
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.headers['cache-control']).toContain('public');
  });

  it('supports phase filters', async () => {
    const upcoming = await request(app).get('/api/v1/matches?phase=upcoming');
    expect(upcoming.body.data).toHaveLength(1);
    expect(upcoming.body.data[0].slug).toBe('fc-example-vs-real-sample');

    const finished = await request(app).get('/api/v1/matches?phase=finished');
    expect(finished.body.data).toHaveLength(1);
    expect(finished.body.data[0].slug).toBe('real-sample-vs-fc-example');
  });

  it('supports exact status and date filters', async () => {
    const res = await request(app).get('/api/v1/matches?status=finished&from=2019-01-01&to=2021-01-01');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects invalid status and dates', async () => {
    const badStatus = await request(app).get('/api/v1/matches?status=playing');
    expect(badStatus.status).toBe(400);
    const badDate = await request(app).get('/api/v1/matches?from=not-a-date');
    expect(badDate.status).toBe(400);
  });

  it('filters by team on either side of the fixture', async () => {
    const res = await request(app).get('/api/v1/matches?team=fc-example');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('returns empty list for unknown team filter', async () => {
    const res = await request(app).get('/api/v1/matches?team=no-such-team');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns match detail and 404s cleanly', async () => {
    const found = await request(app).get('/api/v1/matches/fc-example-vs-real-sample');
    expect(found.status).toBe(200);
    expect(found.body.data.slug).toBe('fc-example-vs-real-sample');

    const missing = await request(app).get('/api/v1/matches/no-such-match');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('resolves card fields in the same response with include=card', async () => {
    const plain = await request(app).get('/api/v1/matches');
    expect(plain.body.data[0].homeTeam).toBeUndefined();
    expect(plain.body.data[0].events).toBeUndefined();

    const card = await request(app).get('/api/v1/matches?include=card');
    expect(card.status).toBe(200);
    expect(card.body.pagination.total).toBe(2);
    for (const row of card.body.data) {
      expect(row.homeTeam.slug).toMatch(/fc-example|real-sample/);
      expect(row.awayTeam.slug).toBeDefined();
      expect(row.competition.slug).toBe('premier-league');
      expect(Array.isArray(row.events)).toBe(true);
      // A card never carries the heavyweight datasets.
      expect(row.lineups).toBeUndefined();
      expect(row.teamStatistics).toBeUndefined();
      expect(row.playerStatistics).toBeUndefined();
    }
  });

  it('serves card fields on the feeds too and rejects an unknown include', async () => {
    const live = await request(app).get('/api/v1/matches/live?include=card');
    expect(live.status).toBe(200);
    expect(Array.isArray(live.body.data)).toBe(true);

    const bad = await request(app).get('/api/v1/matches?include=everything');
    expect(bad.status).toBe(400);
  });

  it('keeps only the card event types and caps them per match', async () => {
    const { fake } = installTestEnv();
    // 10 candidate events on one match: 9 card types plus a substitution, which
    // a card never renders. `e1` already sits at minute 23 in the seed store.
    const types = ['goal', 'yellow_card', 'red_card', 'own_goal', 'penalty_goal', 'substitution', 'goal', 'yellow_card', 'substitution'];
    types.forEach((type, index) => {
      fake.store.match_events.push({
        id: `feed-${index}`,
        match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        type,
        minute: index + 1,
      });
    });

    const card = await request(app).get('/api/v1/matches?include=card');
    expect(card.status).toBe(200);
    const row = card.body.data.find((r: { slug: string }) => r.slug === 'fc-example-vs-real-sample');
    expect(row.events).toHaveLength(6);
    expect(row.events.map((e: { type: string }) => e.type)).not.toContain('substitution');
    // Chronological: the earliest card events win, and `e1` (minute 23) is pushed out.
    expect(row.events.map((e: { minute: number }) => e.minute)).toEqual([1, 2, 3, 4, 5, 7]);
  });
});
