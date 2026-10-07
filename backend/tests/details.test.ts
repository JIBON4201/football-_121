import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

describe('detail aggregations', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('match details aggregate canonical relations in bounded queries', async () => {
    const before = fake.queries.length;
    const res = await request(app).get('/api/v1/matches/fc-example-vs-real-sample/details');
    expect(res.status).toBe(200);
    const details = res.body.data;
    expect(details.competition.slug).toBe('premier-league');
    expect(details.venue.slug).toBe('arena');
    expect(details.homeTeam.slug).toBe('fc-example');
    expect(details.awayTeam.slug).toBe('real-sample');
    expect(details.events).toHaveLength(1);
    expect(details.lineups).toHaveLength(1);
    expect(details.lineups[0].players).toHaveLength(1);
    expect(details.lineups[0].players[0].player.slug).toBe('john-doe');
    expect(details.teamStatistics).toHaveLength(1);
    expect(details.playerStatistics).toHaveLength(1);
    // Fixed cost regardless of related-row volume (no N+1).
    expect(fake.queries.length - before).toBeLessThanOrEqual(12);
  });

  it('match details 404 for unknown slug', async () => {
    const res = await request(app).get('/api/v1/matches/no-such-match/details');
    expect(res.status).toBe(404);
  });

  it('team details include competitions, matches, articles and squad', async () => {
    const before = fake.queries.length;
    const res = await request(app).get('/api/v1/teams/real-sample/details');
    expect(res.status).toBe(200);
    const details = res.body.data;
    expect(details.competitions).toHaveLength(1);
    expect(details.seasons).toHaveLength(1);
    expect(details.upcomingMatches.map((m: { slug: string }) => m.slug)).toContain(
      'fc-example-vs-real-sample',
    );
    expect(details.recentMatches.map((m: { slug: string }) => m.slug)).toContain(
      'real-sample-vs-fc-example',
    );
    expect(details.squad).toHaveLength(1);
    expect(details.squad[0].player.slug).toBe('john-doe');
    // Country and venue resolve in the same parallel round, so the total stays
    // constant — no per-row queries for squad or fixtures.
    expect(details.country.slug).toBe('england');
    expect(fake.queries.length - before).toBeLessThanOrEqual(12);
  });

  it('team articles reference published content only', async () => {
    const res = await request(app).get('/api/v1/teams/fc-example/details');
    expect(res.status).toBe(200);
    expect(res.body.data.articles.map((a: { slug: string }) => a.slug)).toEqual(['big-win']);
  });

  it('player details include history, transfers, articles and stats', async () => {
    const before = fake.queries.length;
    const res = await request(app).get('/api/v1/players/john-doe/details');
    expect(res.status).toBe(200);
    const details = res.body.data;
    expect(details.nationality.slug).toBe('england');
    expect(details.history).toHaveLength(1);
    expect(details.history[0].team.slug).toBe('real-sample');
    expect(details.history[0].season.name).toBe('2026/27');
    expect(details.transfers).toHaveLength(1);
    expect(details.transfers[0].status).toBe('completed');
    expect(details.recentStatistics).toHaveLength(1);
    expect(details.recentStatistics[0].match.slug).toBe('fc-example-vs-real-sample');
    // Competitions are reached through the season on the history row, never
    // inferred from an appearance.
    expect(details.competitions.map((c: { slug: string }) => c.slug)).toEqual(['premier-league']);
    // Query count stays constant: one more batched lookup, no per-row queries.
    expect(fake.queries.length - before).toBeLessThanOrEqual(12);
  });

  it('competition details are standings-ready', async () => {
    const before = fake.queries.length;
    const res = await request(app).get('/api/v1/competitions/premier-league/details');
    expect(res.status).toBe(200);
    const details = res.body.data;
    expect(details.seasons).toHaveLength(1);
    expect(details.teams).toHaveLength(2);
    expect(details.upcomingMatches).toHaveLength(1);
    expect(details.recentMatches).toHaveLength(1);
    expect(fake.queries.length - before).toBeLessThanOrEqual(8);
  });

  it('detail 404s stay clean across resources', async () => {
    for (const path of [
      '/api/v1/teams/nope/details',
      '/api/v1/players/nope/details',
      '/api/v1/competitions/nope/details',
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});
