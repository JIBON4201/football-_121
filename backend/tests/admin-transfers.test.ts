import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/transfers';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '33333333-3333-4333-8333-333333333333';
const PLAYER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const TEAM_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const SEASON = '44444444-4444-4444-8444-444444444444';
const SEASON_OTHER = '22222222-2222-4222-8222-222222222222';
const WINDOW = '77777777-7777-4777-8777-777777777777';

const GRANTS = ['transfers.read', 'transfers.create', 'transfers.update', 'transfers.delete'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `80000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  fake.store.seasons.push({ id: SEASON_OTHER, competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', name: '2025/26' });
  fake.store.transfer_windows = [
    { id: WINDOW, name: 'Summer 2026', season_id: SEASON, start_date: '2026-07-01', end_date: '2026-08-31' },
  ];
  setTestRoles(['admin']);
}

describe('step 6: admin transfers CRUD', () => {
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

  it('filters: status/player/teams/season/dates/sort', async () => {
    const get = (qs: string) => request(app).get(`${BASE}?${qs}`).set(AUTHED);

    expect((await get('status=completed')).body.pagination.total).toBe(1);
    expect((await get('status=rumour')).body.pagination.total).toBe(1);
    expect((await get(`playerId=${PLAYER}`)).body.pagination.total).toBe(2);
    expect((await get(`fromTeamId=${TEAM_A}`)).body.pagination.total).toBe(1);
    expect((await get(`toTeamId=${TEAM_B}`)).body.pagination.total).toBe(1);
    expect((await get(`seasonId=${SEASON_OTHER}`)).body.pagination.total).toBe(2);
    expect((await get('effectiveFrom=2026-01-01&effectiveTo=2026-12-31')).body.pagination.total).toBe(1);
    expect((await get('sort=asc&sortField=effective_date')).status).toBe(200);
    expect((await get('status=bogus')).status).toBe(400);
  });

  it('window filter', async () => {
    (fake.store.transfers as Array<Record<string, unknown>>).find((t) => t.id === T1)!.window_id = WINDOW;
    const res = await request(app).get(`${BASE}?windowId=${WINDOW}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
  });

  it('single transfer with relations', async () => {
    const res = await request(app).get(`${BASE}/${T1}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: T1, status: 'completed' });
    expect(res.body.data).toHaveProperty('player');
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('create (201, audited)', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      player_id: PLAYER,
      season_id: SEASON,
      transfer_type: 'permanent',
      from_team_id: TEAM_A,
      to_team_id: TEAM_B,
      status: 'announced',
      fee: 10.5,
      currency: 'EUR',
      announcement_date: '2026-07-01T10:00:00.000Z',
      effective_date: '2026-08-01T10:00:00.000Z',
      window_id: WINDOW,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'announced', fee: 10.5, currency: 'EUR' });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'transfers.create'),
    ).toBe(true);
  });

  it('validation failure -> 400, nothing written', async () => {
    const before = (fake.store.transfers as unknown[]).length;
    const base = { player_id: PLAYER, season_id: SEASON, transfer_type: 'permanent' };
    expect((await request(app).post(BASE).set(AUTHED).send({ season_id: SEASON, transfer_type: 'permanent' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, fee: -5 })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, currency: 'euro' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, from_team_id: TEAM_A, to_team_id: TEAM_A })).status).toBe(400);
    expect(
      (await request(app).post(BASE).set(AUTHED).send({ ...base, announcement_date: '2026-08-01T10:00:00.000Z', effective_date: '2026-07-01T10:00:00.000Z' })).status,
    ).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, status: 'bogus' })).status).toBe(400);
    expect((fake.store.transfers as unknown[]).length).toBe(before);
  });

  it('invalid foreign keys -> 400', async () => {
    const base = { player_id: PLAYER, season_id: SEASON, transfer_type: 'permanent' };
    const missing = '00000000-0000-4000-8000-000000000999';
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, player_id: missing })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, from_team_id: missing })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, season_id: missing })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ ...base, window_id: missing })).status).toBe(400);
    // Window belongs to SEASON, not SEASON_OTHER.
    expect(
      (await request(app).post(BASE).set(AUTHED).send({ ...base, season_id: SEASON_OTHER, window_id: WINDOW })).status,
    ).toBe(400);
  });

  it('update + audit trail', async () => {
    const res = await request(app).patch(`${BASE}/${T2}`).set(AUTHED).send({ status: 'announced', fee: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'announced', fee: 7 });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'transfers.update'),
    ).toBe(true);
    expect((await request(app).patch(`${BASE}/${T2}`).set(AUTHED).send({ status: 'bogus' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED).send({ status: 'announced' })).status).toBe(404);
  });

  it('permission enforcement per operation', async () => {
    seedAdmin(fake, ['transfers.read']);
    const base = { player_id: PLAYER, season_id: SEASON, transfer_type: 'permanent' };
    expect((await request(app).post(BASE).set(AUTHED).send(base)).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${T2}`).set(AUTHED).send({ fee: 1 })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${T2}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('delete + audit; unknown -> 404', async () => {
    const del = await request(app).delete(`${BASE}/${T2}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true });
    expect((fake.store.transfers as Array<Record<string, unknown>>).some((t) => t.id === T2)).toBe(false);
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'transfers.delete'),
    ).toBe(true);
    expect((await request(app).delete(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });
});
