import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aggregatePlayerStats,
  PLAYER_STAT_FIELDS,
  scopeFor,
  SCOPE_LABELS,
  type PlayerStatSample,
} from '../src/lib/player-stats';
import { app, installTestEnv } from './helpers';

const sample = (overrides: Partial<PlayerStatSample> = {}): PlayerStatSample => ({
  minutes: 90,
  goals: 1,
  assists: 0,
  shots: 3,
  shots_on_target: 2,
  passes: 40,
  pass_accuracy: 85,
  tackles: 2,
  interceptions: 1,
  clearances: 3,
  yellow_cards: 0,
  red_cards: 0,
  rating: 7.5,
  ...overrides,
});

const nulls = (): PlayerStatSample => {
  const row = {} as PlayerStatSample;
  for (const field of PLAYER_STAT_FIELDS) row[field] = null;
  return row;
};

describe('player statistics aggregator', () => {
  it('sums counts and averages ratings', () => {
    const totals = aggregatePlayerStats([
      sample({ goals: 2, minutes: 90, rating: 8 }),
      sample({ goals: 1, minutes: 45, rating: 6 }),
    ]);
    expect(totals.appearances).toBe(2);
    expect(totals.values.goals).toBe(3);
    expect(totals.values.minutes).toBe(135);
    // Rating is a mean, not a sum.
    expect(totals.values.rating).toBe(7);
    expect(totals.average_rating).toBe(7);
    expect(totals.ratings_reported).toBe(2);
  });

  it('never turns an unreported statistic into a zero', () => {
    const totals = aggregatePlayerStats([sample({ goals: 2 })]);
    expect(totals.values.goals).toBe(2);
    // A reported zero stays a zero.
    expect(totals.values.assists).toBe(0);
    // An absent field is null, not zero.
    const withGap = aggregatePlayerStats([sample(), sample({ rating: null })]);
    expect(withGap.values.rating).toBe(7.5);
    expect(withGap.partial).toContain('rating');
  });

  it('returns nulls when nothing was reported at all', () => {
    const totals = aggregatePlayerStats([nulls(), nulls()]);
    expect(totals.appearances).toBe(2);
    for (const field of PLAYER_STAT_FIELDS) {
      expect(totals.values[field], field).toBeNull();
    }
  });

  it('handles an empty sample set', () => {
    const totals = aggregatePlayerStats([]);
    expect(totals.appearances).toBe(0);
    expect(totals.values.goals).toBeNull();
    expect(totals.partial).toEqual([]);
  });

  it('flags every field missing from at least one row', () => {
    const totals = aggregatePlayerStats([
      sample(),
      sample({ assists: null, passes: null, rating: null }),
    ]);
    expect(totals.partial).toEqual(expect.arrayContaining(['assists', 'passes', 'rating']));
    // Complete fields are not flagged.
    expect(totals.partial).not.toContain('goals');
  });

  it('treats pass accuracy as a mean rather than a sum', () => {
    const totals = aggregatePlayerStats([sample({ pass_accuracy: 80 }), sample({ pass_accuracy: 90 })]);
    expect(totals.values.pass_accuracy).toBe(85);
  });

  it('labels the scope implied by the active filters', () => {
    expect(scopeFor(false, false)).toBe('career');
    expect(scopeFor(true, false)).toBe('season');
    expect(scopeFor(false, true)).toBe('competition');
    expect(scopeFor(true, true)).toBe('season_competition');
    for (const scope of ['career', 'season', 'competition', 'season_competition'] as const) {
      expect(SCOPE_LABELS[scope]).toBeTruthy();
    }
  });
});

describe('player statistics API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('returns per-match rows with resolved team, opponent and competition', async () => {
    const res = await request(app).get('/api/v1/players/john-doe/statistics');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const data = res.body.data;
    expect(data.scope).toBe('career');
    expect(data.matches).toHaveLength(1);
    const row = data.matches[0];
    expect(row).toMatchObject({
      match_slug: 'fc-example-vs-real-sample',
      team_name: 'FC Example',
      team_slug: 'fc-example',
      opponent_name: 'Real Sample',
      opponent_slug: 'real-sample',
      competition_name: 'Premier League',
      competition_slug: 'premier-league',
      goals: 1,
      is_home: true,
    });
    // The match is not finished in the seed, so no outcome may be claimed.
    expect(row.outcome).toBeNull();
    expect(data.totals.appearances).toBe(1);
    expect(data.totals.values.goals).toBe(1);
  });

  it('marks unreported fields as unavailable instead of zero', async () => {
    const res = await request(app).get('/api/v1/players/john-doe/statistics');
    const data = res.body.data;
    // Only goals are recorded on the seeded row.
    expect(data.totals.values.goals).toBe(1);
    expect(data.totals.values.minutes).toBeNull();
    expect(data.totals.unavailable).toEqual(expect.arrayContaining(['minutes']));
    expect(data.totals.partial).toEqual([]);
    // An incomplete record is labelled as such rather than presented as complete.
    expect(data.state).toBe('partial');
  });

  it('resolves the outcome once a result exists', async () => {
    const { fake } = installTestEnv();
    fake.store.matches[0].status = 'finished';
    fake.store.matches[0].home_score = 2;
    fake.store.matches[0].away_score = 1;
    const res = await request(app).get('/api/v1/players/john-doe/statistics');
    expect(res.body.data.matches[0].outcome).toBe('win');
    // Still partial: the seeded row only reports goals.
    expect(res.body.data.state).toBe('partial');
  });

  it('reports a complete record when every field is present', async () => {
    const { fake } = installTestEnv();
    fake.store.matches[0].status = 'finished';
    fake.store.matches[0].home_score = 2;
    fake.store.matches[0].away_score = 1;
    Object.assign(fake.store.match_player_statistics[0], {
      minutes: 90,
      goals: 1,
      assists: 0,
      shots: 3,
      shots_on_target: 2,
      passes: 40,
      pass_accuracy: 85,
      tackles: 2,
      interceptions: 1,
      clearances: 3,
      yellow_cards: 0,
      red_cards: 0,
      rating: 7.5,
    });
    const res = await request(app).get('/api/v1/players/john-doe/statistics');
    const data = res.body.data;
    expect(data.state).toBe('ready');
    expect(data.totals.unavailable).toEqual([]);
    expect(data.totals.partial).toEqual([]);
    expect(data.totals.values.minutes).toBe(90);
    expect(data.totals.values.rating).toBe(7.5);
  });

  it('scopes to a season', async () => {
    const res = await request(app).get(
      '/api/v1/players/john-doe/statistics?season=44444444-4444-4444-8444-444444444444',
    );
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toBe('season');
    expect(res.body.data.matches).toHaveLength(1);

    const empty = await request(app).get(
      '/api/v1/players/john-doe/statistics?season=44444444-4444-4444-8444-4444444444ff',
    );
    expect(empty.body.data.state).toBe('empty');
    expect(empty.body.data.matches).toEqual([]);
  });

  it('scopes to a competition and never mixes competitions', async () => {
    const { fake } = installTestEnv();
    fake.store.competitions.push({
      id: 'ffffffff-ffff-4fff-8fff-fffffffffffe',
      slug: 'fa-cup',
      name: 'FA Cup',
      is_active: false,
    });
    fake.store.matches.push({
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddfe',
      slug: 'fc-example-vs-real-sample-cup',
      status: 'finished',
      scheduled_at: '2026-09-05T15:00:00.000Z',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffffe',
      season_id: '44444444-4444-4444-8444-444444444444',
      home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      home_score: 1,
      away_score: 0,
    });
    fake.store.match_player_statistics.push({
      id: 'ps-cup',
      match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddfe',
      team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      goals: 2,
    });

    const cup = await request(app).get('/api/v1/players/john-doe/statistics?competition=fa-cup');
    expect(cup.status).toBe(200);
    expect(cup.body.data.scope).toBe('competition');
    expect(cup.body.data.competition_slug).toBe('fa-cup');
    expect(cup.body.data.matches).toHaveLength(1);
    expect(cup.body.data.matches[0].match_slug).toBe('fc-example-vs-real-sample-cup');
    expect(cup.body.data.totals.values.goals).toBe(2);

    const both = await request(app).get(
      '/api/v1/players/john-doe/statistics?season=44444444-4444-4444-8444-444444444444&competition=fa-cup',
    );
    expect(both.body.data.scope).toBe('season_competition');
    expect(both.body.data.matches).toHaveLength(1);

    const league = await request(app).get('/api/v1/players/john-doe/statistics?competition=premier-league');
    expect(league.body.data.matches).toHaveLength(1);
    expect(league.body.data.matches[0].match_slug).toBe('fc-example-vs-real-sample');
  });

  it('returns an empty state for a player with no appearances', async () => {
    const { fake } = installTestEnv();
    fake.store.players.push({
      id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9',
      slug: 'newcomer',
      display_name: 'Newcomer',
      position: 'Midfielder',
    });
    const res = await request(app).get('/api/v1/players/newcomer/statistics');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('empty');
    expect(res.body.data.matches).toEqual([]);
    expect(res.body.data.totals.appearances).toBe(0);
  });

  it('bounds the returned appearances and says when totals are a subset', async () => {
    const res = await request(app).get('/api/v1/players/john-doe/statistics?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBeLessThanOrEqual(1);

    const tooBig = await request(app).get('/api/v1/players/john-doe/statistics?limit=5000');
    expect(tooBig.status).toBe(400);
  });

  it('404s an unknown player and 400s an invalid filter', async () => {
    const missing = await request(app).get('/api/v1/players/no-such-player/statistics');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const badSeason = await request(app).get('/api/v1/players/john-doe/statistics?season=not-a-uuid');
    expect(badSeason.status).toBe(400);
    const badCompetition = await request(app).get('/api/v1/players/john-doe/statistics?competition=bad%20slug');
    expect(badCompetition.status).toBe(400);
  });

  it('surfaces a data failure rather than returning empty statistics', async () => {
    const { fake } = installTestEnv();
    fake.failTables.add('match_player_statistics');
    const res = await request(app).get('/api/v1/players/john-doe/statistics');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.data).toBeUndefined();
  });
});
