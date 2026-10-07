import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/players';

const P1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const TEAM_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TEAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const COUNTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const SEASON = '44444444-4444-4444-8444-444444444444';

const GRANTS = ['players.read', 'players.create', 'players.update', 'players.delete'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  setTestRoles(['admin']);
}

describe('step 9: admin players CRUD', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('list + pagination + total', async () => {
    const res = await request(app).get(`${BASE}?limit=1`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 1 });
  });

  it('search + team/nationality/position/status filters + sort', async () => {
    const get = (qs: string) => request(app).get(`${BASE}?${qs}`).set(AUTHED);
    expect((await get('q=john')).body.pagination.total).toBe(1);
    expect((await get(`teamId=${TEAM_B}`)).body.pagination.total).toBe(1);
    expect((await get(`teamId=${TEAM_A}`)).body.pagination.total).toBe(0);
    expect((await get(`nationalityId=${COUNTRY}`)).body.pagination.total).toBe(1);
    expect((await get('position=Forward')).body.pagination.total).toBe(1);
    expect((await get('sort=display_name&order=desc')).status).toBe(200);
  });

  it('single player with current team + transfers + dependents', async () => {
    const res = await request(app).get(`${BASE}/${P1}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: P1, display_name: 'John Doe' });
    expect(res.body.data.currentTeam).toMatchObject({ id: TEAM_B });
    expect(res.body.data.transfers.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.dependents.transfers).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('create (201, slug generated, audited)', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      display_name: 'Jane Roe',
      first_name: 'Jane',
      position: 'Midfielder',
      preferred_foot: 'left',
      height_cm: 170,
      date_of_birth: '2000-01-15',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ display_name: 'Jane Roe' });
    expect(typeof res.body.data.slug).toBe('string');
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'players.create'),
    ).toBe(true);
  });

  it('create with team assignment writes history (append-only)', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      display_name: 'Team Player',
      team_id: TEAM_A,
      season_id: SEASON,
      shirt_number: 10,
    });
    expect(res.status).toBe(201);
    const history = fake.store.player_team_history as Array<Record<string, unknown>>;
    expect(history.some((h) => h.player_id === res.body.data.id && h.team_id === TEAM_A && h.is_current === true)).toBe(true);
  });

  it('duplicate slug auto-resolved, never 409', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({ display_name: 'Copy Cat', slug: 'john-doe' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).not.toBe('john-doe');
  });

  it('validation failure -> 400, nothing written', async () => {
    const before = (fake.store.players as unknown[]).length;
    expect((await request(app).post(BASE).set(AUTHED).send({})).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'x'.repeat(151) })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', slug: 'bad slug!' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', nationality_id: '00000000-0000-4000-8000-000000000999' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', preferred_foot: 'middle' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', height_cm: 50 })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', date_of_birth: '15-01-2000' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'Bad', team_id: '00000000-0000-4000-8000-000000000999' })).status).toBe(400);
    expect((fake.store.players as unknown[]).length).toBe(before);
  });

  it('update + team reassignment preserves history + audit', async () => {
    const res = await request(app).patch(`${BASE}/${P1}`).set(AUTHED).send({ position: 'Defender' });
    expect(res.status).toBe(200);
    expect(res.body.data.position).toBe('Defender');

    const historyBefore = (fake.store.player_team_history as unknown[]).length;
    const reassigned = await request(app).patch(`${BASE}/${P1}`).set(AUTHED).send({ team_id: TEAM_A });
    expect(reassigned.status).toBe(200);
    // Append-only: a new row, never a rewrite.
    expect((fake.store.player_team_history as unknown[]).length).toBe(historyBefore + 1);
    const detail = await request(app).get(`${BASE}/${P1}`).set(AUTHED);
    expect(detail.body.data.currentTeam).toMatchObject({ id: TEAM_A });

    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'players.update'),
    ).toBe(true);
    expect((await request(app).patch(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED).send({ position: 'X' })).status).toBe(404);
  });

  it('permission checks per operation', async () => {
    seedAdmin(fake, ['players.read']);
    expect((await request(app).post(BASE).set(AUTHED).send({ display_name: 'No Grant' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${P1}`).set(AUTHED).send({ position: 'X' })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${P1}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('delete safety: referenced player -> 409; bare player deletes', async () => {
    expect((await request(app).delete(`${BASE}/${P1}`).set(AUTHED)).status).toBe(409);

    const created = await request(app).post(BASE).set(AUTHED).send({ display_name: 'Ephemeral Player' });
    const id = created.body.data.id as string;
    const del = await request(app).delete(`${BASE}/${id}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'players.delete'),
    ).toBe(true);
    expect((await request(app).delete(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });
});
