import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  asCompletedMatch,
  isSettledStatus,
  recentForm,
  resultsForTeam,
  summariseResults,
  teamResultFor,
  type CompletedMatch,
} from '../src/lib/team-stats';
import { app, installTestEnv } from './helpers';

const TEAM = 'team-a';
const RIVAL = 'team-b';

const match = (home: string, away: string, homeScore: number, awayScore: number, at = '2026-09-01T15:00:00.000Z'): CompletedMatch => ({
  home_team_id: home,
  away_team_id: away,
  home_score: homeScore,
  away_score: awayScore,
  scheduled_at: at,
});

describe('team statistics calculator', () => {
  it('counts only completed matches', () => {
    expect(isSettledStatus('finished')).toBe(true);
    for (const other of ['live', 'half_time', 'scheduled', 'postponed', 'abandoned', 'suspended']) {
      expect(isSettledStatus(other), other).toBe(false);
    }
  });

  it('rejects a finished match with no score rather than assuming nil', () => {
    expect(asCompletedMatch({ status: 'finished', home_team_id: 'a', away_team_id: 'b', home_score: null, away_score: null, scheduled_at: 'x' })).toBeNull();
    expect(asCompletedMatch({ status: 'finished', home_team_id: 'a', away_team_id: 'b', home_score: 1, scheduled_at: 'x' })).toBeNull();
    expect(asCompletedMatch({ status: 'scheduled', home_team_id: 'a', away_team_id: 'b', home_score: 1, away_score: 0, scheduled_at: 'x' })).toBeNull();
    expect(asCompletedMatch({ status: 'finished', home_team_id: 'a', away_team_id: 'a', home_score: 1, away_score: 0, scheduled_at: 'x' })).toBeNull();
    expect(
      asCompletedMatch({ status: 'finished', home_team_id: 'a', away_team_id: 'b', home_score: '2', away_score: '1', scheduled_at: 'x' }),
    ).toEqual({ home_team_id: 'a', away_team_id: 'b', home_score: 2, away_score: 1, scheduled_at: 'x' });
  });

  it('reads a result from the team perspective on either side', () => {
    expect(teamResultFor(match(TEAM, RIVAL, 2, 1), TEAM)).toMatchObject({ outcome: 'win', goals_for: 2, goals_against: 1, opponent_id: RIVAL });
    expect(teamResultFor(match(RIVAL, TEAM, 2, 1), TEAM)).toMatchObject({ outcome: 'loss', goals_for: 1, goals_against: 2, opponent_id: RIVAL });
    expect(teamResultFor(match(TEAM, RIVAL, 1, 1), TEAM)).toMatchObject({ outcome: 'draw' });
    expect(teamResultFor(match('other', 'team-c', 1, 0), TEAM)).toBeNull();
  });

  it('summarises played, wins, draws, losses, goals and clean sheets', () => {
    const totals = summariseResults([
      { outcome: 'win', goals_for: 3, goals_against: 0, scheduled_at: '1' },
      { outcome: 'win', goals_for: 2, goals_against: 1, scheduled_at: '2' },
      { outcome: 'draw', goals_for: 1, goals_against: 1, scheduled_at: '3' },
      { outcome: 'loss', goals_for: 0, goals_against: 2, scheduled_at: '4' },
    ]);
    expect(totals).toEqual({
      played: 4,
      won: 2,
      drawn: 1,
      lost: 1,
      goals_for: 6,
      goals_against: 4,
      goal_difference: 2,
      // 3-0 only: the 2-1 and 0-2 are not clean sheets.
      clean_sheets: 1,
    });
  });

  it('counts a 0-0 as a clean sheet', () => {
    const totals = summariseResults([{ outcome: 'draw', goals_for: 0, goals_against: 0, scheduled_at: '1' }]);
    expect(totals.clean_sheets).toBe(1);
  });

  it('orders results oldest first and returns form newest first', () => {
    const results = resultsForTeam(
      [
        match(TEAM, RIVAL, 1, 0, '2026-09-03T00:00:00.000Z'),
        match(TEAM, RIVAL, 0, 1, '2026-09-01T00:00:00.000Z'),
        match(RIVAL, 'other', 5, 0, '2026-09-02T00:00:00.000Z'),
      ],
      TEAM,
    );
    expect(results).toHaveLength(2);
    expect(results[0].scheduled_at).toBe('2026-09-01T00:00:00.000Z');
    const form = recentForm(results, 5);
    // Newest first: the 3 September win precedes the 1 September defeat.
    expect(form.map((entry) => entry.outcome)).toEqual(['win', 'loss']);
    expect(form).toHaveLength(2);
    expect(recentForm(results, 1)).toHaveLength(1);
    expect(recentForm(results, 0)).toEqual([]);
  });

  it('excludes a match the team was not involved in from both totals and form', () => {
    const results = resultsForTeam([match('x', 'y', 9, 9)], TEAM);
    expect(results).toEqual([]);
    expect(summariseResults(results).played).toBe(0);
  });
});

describe('team statistics API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('derives totals and form from completed matches', async () => {
    const res = await request(app).get('/api/v1/teams/real-sample/statistics');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const data = res.body.data;
    // The seeded finished fixture is Real Sample 2-1 FC Example at home.
    expect(data.state).toBe('ready');
    expect(data.totals).toMatchObject({ played: 1, won: 1, drawn: 0, lost: 0, goals_for: 2, goals_against: 1, goal_difference: 1 });
    expect(data.form).toHaveLength(1);
    expect(data.form[0]).toMatchObject({ outcome: 'win', goals_for: 2, goals_against: 1 });
    expect(data.team).toMatchObject({ slug: 'real-sample' });
  });

  it('reflects the same fixture from the other side', async () => {
    const res = await request(app).get('/api/v1/teams/fc-example/statistics');
    expect(res.body.data.totals).toMatchObject({ played: 1, won: 0, drawn: 0, lost: 1, goals_for: 1, goals_against: 2, goal_difference: -1 });
    expect(res.body.data.form[0]).toMatchObject({ outcome: 'loss' });
  });

  it('reports an empty state before any results', async () => {
    const { fake } = installTestEnv();
    fake.store.teams.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', slug: 'new-town', name: 'New Town', is_active: true });
    const res = await request(app).get('/api/v1/teams/new-town/statistics');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('empty');
    expect(res.body.data.totals.played).toBe(0);
    expect(res.body.data.form).toEqual([]);
  });

  it('flags an incomplete table when a finished match has no score', async () => {
    const { fake } = installTestEnv();
    fake.store.matches.push({
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddab',
      slug: 'fc-example-vs-real-sample-scoreless',
      status: 'finished',
      scheduled_at: '2019-09-01T15:00:00.000Z',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      season_id: '44444444-4444-4444-8444-444444444444',
      home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    });
    const res = await request(app).get('/api/v1/teams/fc-example/statistics');
    expect(res.body.data.state).toBe('incomplete');
    expect(res.body.data.matches_skipped).toBe(1);
    // The scorable result is still reported.
    expect(res.body.data.totals.played).toBe(1);
  });

  it('scopes to a season without mixing in another competition', async () => {
    const { fake } = installTestEnv();
    fake.store.seasons.push({
      id: '44444444-4444-4444-8444-4444444444c1',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      name: '2019/20',
      start_date: '2019-08-01',
      is_current: false,
    });
    fake.store.matches.push({
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddac',
      slug: 'fc-example-vs-real-sample-2019',
      status: 'finished',
      scheduled_at: '2019-09-01T15:00:00.000Z',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      season_id: '44444444-4444-4444-8444-4444444444c1',
      home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      home_score: 0,
      away_score: 0,
    });

    const historical = await request(app).get(
      '/api/v1/teams/fc-example/statistics?season=44444444-4444-4444-8444-4444444444c1',
    );
    expect(historical.status).toBe(200);
    expect(historical.body.data.totals).toMatchObject({ played: 1, drawn: 1, won: 0, lost: 0 });
    expect(historical.body.data.season_id).toBe('44444444-4444-4444-8444-4444444444c1');

    // Without a season, both fixtures count.
    const all = await request(app).get('/api/v1/teams/fc-example/statistics');
    expect(all.body.data.totals.played).toBe(2);
  });

  it('honours the form window and clamps it', async () => {
    const res = await request(app).get('/api/v1/teams/real-sample/statistics?form=3');
    expect(res.status).toBe(200);
    expect(res.body.data.form.length).toBeLessThanOrEqual(3);
    const tooBig = await request(app).get('/api/v1/teams/real-sample/statistics?form=999');
    expect(tooBig.status).toBe(400);
  });

  it('404s an unknown team and 400s an invalid season', async () => {
    const missing = await request(app).get('/api/v1/teams/no-such-team/statistics');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const bad = await request(app).get('/api/v1/teams/real-sample/statistics?season=not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it('surfaces a data failure rather than returning fabricated totals', async () => {
    const { fake } = installTestEnv();
    fake.failTables.add('matches');
    const res = await request(app).get('/api/v1/teams/real-sample/statistics');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.data).toBeUndefined();
  });
});
