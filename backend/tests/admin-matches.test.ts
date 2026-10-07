import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/matches';

const M1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const M2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const COMP = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const SEASON = '44444444-4444-4444-8444-444444444444';
const TEAM_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PLAYER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const GRANTS = ['matches.read', 'matches.create', 'matches.update', 'matches.delete', 'match_events.manage'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `70000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  setTestRoles(['admin']);
}

describe('step 7: admin matches + match events', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('list + pagination + total', async () => {
    const res = await request(app).get(`${BASE}?limit=1`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2 });
  });

  it('filters: status/competition/season/team/dates/sort', async () => {
    const get = (qs: string) => request(app).get(`${BASE}?${qs}`).set(AUTHED);
    expect((await get('status=scheduled')).body.pagination.total).toBe(1);
    expect((await get(`competitionId=${COMP}`)).body.pagination.total).toBe(2);
    expect((await get(`seasonId=${SEASON}`)).body.pagination.total).toBe(2);
    expect((await get(`teamId=${TEAM_A}`)).body.pagination.total).toBe(2);
    expect((await get('from=2029-01-01&to=2031-01-01')).body.pagination.total).toBe(1);
    expect((await get('sort=asc')).status).toBe(200);
    expect((await get('status=bogus')).status).toBe(400);
  });

  it('single match with dependents + relations', async () => {
    const res = await request(app).get(`${BASE}/${M1}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: M1 });
    expect(res.body.data.dependents.match_events).toBeGreaterThanOrEqual(1);
    expect(res.body.data).toHaveProperty('homeTeam');
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('create (201, slug generated, audited)', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      competition_id: COMP,
      season_id: SEASON,
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      scheduled_at: '2031-05-01T15:00:00.000Z',
      round: 'Final',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'scheduled' });
    expect(typeof res.body.data.slug).toBe('string');
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'matches.create'),
    ).toBe(true);
  });

  it('validation failures -> 400, nothing written', async () => {
    const before = (fake.store.matches as unknown[]).length;
    const base = { competition_id: COMP, home_team_id: TEAM_A, away_team_id: TEAM_B, scheduled_at: '2031-05-01T15:00:00.000Z' };
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, home_team_id: TEAM_A, away_team_id: TEAM_A })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, competition_id: '00000000-0000-4000-8000-000000000999' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, status: 'bogus' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, home_score: -1 })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, scheduled_at: 'not-a-date' })).status).toBe(400);
    expect((fake.store.matches as unknown[]).length).toBe(before);
  });

  it('invalid competition/season relationship -> 400', async () => {
    fake.store.competitions.push({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', slug: 'other-league', name: 'Other', is_active: true });
    fake.store.seasons.push({ id: '55555555-5555-4555-8555-555555555555', competition_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', name: '2026/27' });
    const res = await request(app).post(BASE).set(AUTHED).send({
      competition_id: COMP,
      season_id: '55555555-5555-4555-8555-555555555555',
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      scheduled_at: '2031-05-01T15:00:00.000Z',
    });
    expect(res.status).toBe(400);
  });

  it('update scores + audit; unknown -> 404', async () => {
    const res = await request(app).patch(`${BASE}/${M2}`).set(AUTHED).send({ home_score: 3, away_score: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ home_score: 3, away_score: 2 });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'matches.update'),
    ).toBe(true);
    expect((await request(app).patch(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED).send({ home_score: 1 })).status).toBe(404);
    expect((await request(app).patch(`${BASE}/${M2}`).set(AUTHED).send({ home_team_id: TEAM_A, away_team_id: TEAM_A })).status).toBe(400);
  });

  it('match events CRUD + validation', async () => {
    const list = await request(app).get(`${BASE}/${M1}/events`).set(AUTHED);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBeGreaterThanOrEqual(1);

    const created = await request(app).post(`${BASE}/${M1}/events`).set(AUTHED).send({
      team_id: TEAM_A,
      player_id: PLAYER,
      type: 'goal',
      minute: 45,
    });
    expect(created.status).toBe(201);
    const eventId = created.body.data.id as string;

    // Team outside the fixture.
    fake.store.teams.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', slug: 'third-fc', name: 'Third FC', is_active: true });
    expect(
      (await request(app).post(`${BASE}/${M1}/events`).set(AUTHED).send({ team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', type: 'goal', minute: 10 })).status,
    ).toBe(400);
    // Substitution without a player; assist on a card.
    expect((await request(app).post(`${BASE}/${M1}/events`).set(AUTHED).send({ type: 'substitution', minute: 60 })).status).toBe(400);
    expect(
      (await request(app).post(`${BASE}/${M1}/events`).set(AUTHED).send({ type: 'yellow_card', player_id: PLAYER, assist_player_id: PLAYER, minute: 61 })).status,
    ).toBe(400);

    const patched = await request(app).patch(`${BASE}/${M1}/events/${eventId}`).set(AUTHED).send({ minute: 46 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.minute).toBe(46);

    // Cross-match access is 404, never leaks.
    expect((await request(app).patch(`${BASE}/${M2}/events/${eventId}`).set(AUTHED).send({ minute: 47 })).status).toBe(404);

    const removed = await request(app).delete(`${BASE}/${M1}/events/${eventId}`).set(AUTHED);
    expect(removed.status).toBe(200);
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'match_events.delete'),
    ).toBe(true);
  });

  it('permission checks per operation', async () => {
    seedAdmin(fake, ['matches.read']);
    expect(
      (await request(app).post(BASE).set(AUTHED).send({ competition_id: COMP, home_team_id: TEAM_A, away_team_id: TEAM_B, scheduled_at: '2031-05-01T15:00:00.000Z' })).status,
    ).toBe(403);
    expect((await request(app).patch(`${BASE}/${M2}`).set(AUTHED).send({ round: 'x' })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${M2}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).post(`${BASE}/${M1}/events`).set(AUTHED).send({ type: 'goal' })).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('delete safety: dependents -> 409 with cancel path; bare match deletes', async () => {
    const blocked = await request(app).delete(`${BASE}/${M1}`).set(AUTHED);
    expect(blocked.status).toBe(409);

    const cancelled = await request(app).patch(`${BASE}/${M1}`).set(AUTHED).send({ status: 'cancelled' });
    expect(cancelled.status).toBe(200);

    const created = await request(app).post(BASE).set(AUTHED).send({
      competition_id: COMP,
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      scheduled_at: '2032-01-01T15:00:00.000Z',
    });
    const id = created.body.data.id as string;
    const del = await request(app).delete(`${BASE}/${id}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'matches.delete'),
    ).toBe(true);
    expect((await request(app).delete(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });
});
