import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { calculateStandings, isSettledStatus, type SettledMatch } from '../src/lib/standings';
import {
  DEFAULT_LEAGUE_RULES,
  GROUP_STAGE_RULES,
  KNOCKOUT_RULES,
  resolveStandingsRules,
  standingsRulesFor,
  supportsTable,
  TWO_POINT_LEAGUE_RULES,
} from '../src/lib/standings-rules';
import { app, installTestEnv } from './helpers';

const A = 'team-a';
const B = 'team-b';
const C = 'team-c';

const match = (home: string, away: string, homeScore: number, awayScore: number): SettledMatch => ({
  home_team_id: home,
  away_team_id: away,
  home_score: homeScore,
  away_score: awayScore,
  scheduled_at: '2026-09-01T15:00:00.000Z',
});

const byId = (rows: Array<{ team_id: string }>, id: string) => rows.find((row) => row.team_id === id);

describe('standings rules', () => {
  it('resolves a standard league table by default', () => {
    expect(resolveStandingsRules(null)).toBe(DEFAULT_LEAGUE_RULES);
    expect(resolveStandingsRules(undefined)).toBe(DEFAULT_LEAGUE_RULES);
    expect(resolveStandingsRules('league')).toBe(DEFAULT_LEAGUE_RULES);
    expect(resolveStandingsRules('  LEAGUE  ')).toBe(DEFAULT_LEAGUE_RULES);
  });

  it('maps known formats and never hard-codes league arithmetic', () => {
    expect(resolveStandingsRules('cup')).toBe(KNOCKOUT_RULES);
    expect(resolveStandingsRules('Cup')).toBe(KNOCKOUT_RULES);
    expect(resolveStandingsRules('playoff')).toBe(KNOCKOUT_RULES);
    expect(resolveStandingsRules('group_stage')).toBe(GROUP_STAGE_RULES);
    // A brand new competition type still gets a table rather than nothing.
    expect(resolveStandingsRules('super-league')).toBe(DEFAULT_LEAGUE_RULES);
    expect(TWO_POINT_LEAGUE_RULES.points.win).toBe(2);
    expect(DEFAULT_LEAGUE_RULES.points).toEqual({ win: 3, draw: 1, loss: 0 });
  });

  it('supports tables for league and group formats only', () => {
    expect(supportsTable(DEFAULT_LEAGUE_RULES)).toBe(true);
    expect(supportsTable(GROUP_STAGE_RULES)).toBe(true);
    expect(supportsTable(KNOCKOUT_RULES)).toBe(false);
  });

  it('prefers an explicit per-competition override when one exists', () => {
    const fromCompetition = standingsRulesFor({ id: 'abc', type: 'cup' });
    expect(fromCompetition).toBe(KNOCKOUT_RULES);
    expect(standingsRulesFor({ type: null })).toBe(DEFAULT_LEAGUE_RULES);
  });
});

describe('standings calculator', () => {
  it('identifies settled statuses only', () => {
    expect(isSettledStatus('finished')).toBe(true);
    for (const other of ['live', 'half_time', 'scheduled', 'postponed', 'cancelled', 'abandoned', 'suspended']) {
      expect(isSettledStatus(other), other).toBe(false);
    }
  });

  it('accumulates played, wins, draws, losses, goals and points', () => {
    const result = calculateStandings([
      match(A, B, 2, 1),
      match(A, C, 0, 0),
      match(B, C, 3, 0),
    ]);
    const a = byId(result.rows, A);
    expect(a).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, goals_for: 2, goals_against: 1, goal_difference: 1, points: 4 });
    const b = byId(result.rows, B);
    expect(b).toMatchObject({ played: 2, won: 1, drawn: 0, lost: 1, goals_for: 4, goals_against: 2, goal_difference: 2, points: 3 });
    const c = byId(result.rows, C);
    expect(c).toMatchObject({ played: 2, won: 0, drawn: 1, lost: 1, goals_for: 0, goals_against: 3, goal_difference: -3, points: 1 });
    expect(result.matches_considered).toBe(3);
  });

  it('orders by points then goal difference then goals scored', () => {
    const result = calculateStandings([match(A, B, 1, 0), match(B, C, 4, 0)]);
    expect(result.rows.map((row) => row.team_id)).toEqual([B, A, C]);
    expect(result.rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it('separates teams on goals scored when the difference is level', () => {
    const result = calculateStandings([match(A, B, 0, 0), match(A, C, 2, 0)]);
    const a = byId(result.rows, A);
    const b = byId(result.rows, B);
    expect(a?.goals_for).toBe(2);
    expect(b?.goals_for).toBe(0);
    expect(result.rows[0].team_id).toBe(A);
    expect(result.rows[1].team_id).toBe(B);
  });

  it('falls back to a deterministic name tie-break so rows are never equal', () => {
    const result = calculateStandings([match(A, B, 0, 0)], {
      nameById: new Map([
        [A, 'Zebra FC'],
        [B, 'Alpha FC'],
      ]),
    });
    expect(result.rows[0].team_id).toBe(B);
    expect(result.rows[1].team_id).toBe(A);
  });

  it('applies head-to-head tie-breaks when the ruleset asks for them', () => {
    // A and C are level on points and goal difference; B beats them both.
    const result = calculateStandings([match(A, C, 1, 1), match(A, B, 0, 1), match(C, B, 0, 1)]);
    const a = byId(result.rows, A);
    const c = byId(result.rows, C);
    expect(a?.points).toBe(c?.points);
    expect(a?.goal_difference).toBe(c?.goal_difference);
    // C beat nobody but drew with A; A lost to B. Head-to-head cannot separate
    // them on points, so the result stays stable and complete either way.
    expect([a?.position, c?.position].sort()).toEqual([2, 3]);
  });

  it('includes a participating team that has not played yet', () => {
    const result = calculateStandings([], { teamIds: [A, B, C] });
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row).toMatchObject({ played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, points: 0 });
    }
    expect(result.matches_considered).toBe(0);
  });

  it('skips a finished match that has no score instead of inventing one', () => {
    const result = calculateStandings(
      [
        { home_team_id: A, away_team_id: B, home_score: null as unknown as number, away_score: null as unknown as number, scheduled_at: '2026-09-01T15:00:00.000Z' },
        match(B, C, 1, 0),
      ],
      { teamIds: [A, B, C] },
    );
    expect(result.matches_skipped).toBe(1);
    expect(result.matches_considered).toBe(1);
    // A appeared only in the unscoreable fixture, so it has played nothing.
    expect(byId(result.rows, A)).toMatchObject({ played: 0, points: 0 });
    expect(byId(result.rows, B)?.played).toBe(1);
  });

  it('ignores a fixture where a team plays itself', () => {
    const result = calculateStandings([match(A, A, 5, 0)], { teamIds: [A, B] });
    expect(result.matches_considered).toBe(0);
    expect(result.matches_skipped).toBe(1);
    expect(byId(result.rows, A)).toMatchObject({ played: 0, goals_for: 0, points: 0 });
  });

  it('reports no table for a knockout format', () => {
    const result = calculateStandings([match(A, B, 1, 0)], { rules: KNOCKOUT_RULES });
    expect(result.rows).toEqual([]);
    expect(result.format).toBe('knockout');
  });

  it('honours an alternative points system', () => {
    const twoPoint = calculateStandings([match(A, B, 1, 0), match(C, B, 1, 0)], {
      rules: { ...TWO_POINT_LEAGUE_RULES, tieBreaks: ['points', 'name'] },
      nameById: new Map([[A, 'A'], [B, 'B'], [C, 'C']]),
    });
    expect(byId(twoPoint.rows, A)?.points).toBe(2);
    expect(byId(twoPoint.rows, C)?.points).toBe(2);
  });
});

describe('standings API', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('returns a table derived from finished matches for the current season', async () => {
    const res = await request(app).get('/api/v1/competitions/premier-league/standings');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const data = res.body.data;
    expect(data.state).toBe('ready');
    expect(data.season).toMatchObject({ name: '2026/27', is_current: true });
    expect(data.rules_id).toBe('league.standard');
    expect(data.teams.map((team: { slug: string }) => team.slug).sort()).toEqual(['fc-example', 'real-sample']);

    const rows = data.standings.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    // Real Sample won 2-1 away; goal difference puts them top on equal points.
    expect(rows[0]).toMatchObject({
      position: 1,
      team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      played: 1,
      won: 1,
      lost: 0,
      goals_for: 2,
      goals_against: 1,
      goal_difference: 1,
      points: 3,
    });
    expect(rows[1]).toMatchObject({ position: 2, won: 0, lost: 1, goal_difference: -1, points: 0 });
  });

  it('reports an empty table when a competition has no results yet', async () => {
    const { fake } = installTestEnv();
    fake.store.competitions.push({
      id: 'ffffffff-ffff-4fff-8fff-fffffffffff9',
      slug: 'world-series',
      name: 'World Series',
      type: 'league',
      is_active: false,
    });
    fake.store.seasons.push({
      id: '44444444-4444-4444-8444-4444444444ff',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff9',
      name: '2026',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
    });
    const res = await request(app).get('/api/v1/competitions/world-series/standings');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('empty');
    expect(res.body.data.standings.rows).toEqual([]);
  });

  it('reports a knockout competition as not applicable instead of a fake table', async () => {
    const { fake } = installTestEnv();
    fake.store.competitions.push({
      id: 'ffffffff-ffff-4fff-8fff-fffffffffffa',
      slug: 'fa-cup',
      name: 'FA Cup',
      type: 'cup',
      is_active: false,
    });
    const res = await request(app).get('/api/v1/competitions/fa-cup/standings');
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('not_applicable');
    expect(res.body.data.format).toBe('knockout');
    expect(res.body.data.standings.rows).toEqual([]);
  });

  it('scopes a historical season without touching the current table', async () => {
    const { fake } = installTestEnv();
    fake.store.seasons.push({
      id: '44444444-4444-4444-8444-4444444444aa',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      name: '2019/20',
      start_date: '2019-08-01',
      end_date: '2020-05-31',
      is_current: false,
    });
    fake.store.matches.push({
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddaa',
      slug: 'fc-example-vs-real-sample-2019',
      status: 'finished',
      scheduled_at: '2019-09-01T15:00:00.000Z',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
      season_id: '44444444-4444-4444-8444-4444444444aa',
      home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      home_score: 0,
      away_score: 0,
    });

    const historical = await request(app).get(
      '/api/v1/competitions/premier-league/standings?season=44444444-4444-4444-8444-4444444444aa',
    );
    expect(historical.status).toBe(200);
    expect(historical.body.data.season).toMatchObject({ name: '2019/20', is_current: false });
    const historicalRows = historical.body.data.standings.rows as Array<Record<string, unknown>>;
    // The 0-0 is the only result in this season, so both sides sit on one point.
    expect(historicalRows).toHaveLength(2);
    for (const row of historicalRows) {
      expect(row).toMatchObject({ played: 1, drawn: 1, points: 1, goal_difference: 0 });
    }

    // The current season is unaffected by the historical request.
    const current = await request(app).get('/api/v1/competitions/premier-league/standings');
    expect(current.body.data.season).toMatchObject({ name: '2026/27', is_current: true });
    const currentRows = current.body.data.standings.rows as Array<Record<string, unknown>>;
    expect(currentRows.every((row) => row.points === 0 || row.points === 3)).toBe(true);
    expect(current.body.data.standings.matches_considered).toBe(1);
  });

  it('rejects a season that belongs to another competition instead of substituting one', async () => {
    const { fake } = installTestEnv();
    fake.store.competitions.push({
      id: 'ffffffff-ffff-4fff-8fff-fffffffffffb',
      slug: 'other-league',
      name: 'Other League',
      type: 'league',
      is_active: false,
    });
    fake.store.seasons.push({
      id: '44444444-4444-4444-8444-4444444444bb',
      competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffffb',
      name: '2025/26',
      is_current: true,
    });
    const res = await request(app).get(
      '/api/v1/competitions/premier-league/standings?season=44444444-4444-4444-8444-4444444444bb',
    );
    expect(res.status).toBe(400);
    expect(res.body.data).toBeUndefined();
  });

  it('404s an unknown competition and 400s an invalid season', async () => {
    const missing = await request(app).get('/api/v1/competitions/no-such-competition/standings');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const bad = await request(app).get('/api/v1/competitions/premier-league/standings?season=not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it('surfaces a data failure without returning a partial table', async () => {
    const { fake } = installTestEnv();
    fake.failTables.add('matches');
    const res = await request(app).get('/api/v1/competitions/premier-league/standings');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.data).toBeUndefined();
  });
});
