import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/teams';

const T1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const COUNTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const COMP = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const SEASON = '44444444-4444-4444-8444-444444444444';

const GRANTS = ['teams.read', 'teams.create', 'teams.update', 'teams.delete'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `60000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  setTestRoles(['admin']);
}

describe('step 8: admin teams CRUD', () => {
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

  it('search + country/active/competition filters + sort', async () => {
    const get = (qs: string) => request(app).get(`${BASE}?${qs}`).set(AUTHED);
    expect((await get('q=example')).body.pagination.total).toBe(1);
    expect((await get('q=sample')).body.pagination.total).toBe(1);
    expect((await get(`countryId=${COUNTRY}`)).body.pagination.total).toBe(2);
    expect((await get('active=true')).body.pagination.total).toBe(2);
    expect((await get(`competitionId=${COMP}`)).body.pagination.total).toBe(2);
    expect((await get(`seasonId=${SEASON}`)).body.pagination.total).toBe(2);
    expect((await get('sort=name&order=desc')).status).toBe(200);
    expect((await get('active=maybe')).status).toBe(400);
  });

  it('single team with relations + dependents', async () => {
    const res = await request(app).get(`${BASE}/${T1}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: T1, slug: 'fc-example' });
    expect(res.body.data).toHaveProperty('country');
    expect(res.body.data.dependents.matches_home).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });

  it('create (201, slug generated, audited)', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      name: 'New United FC',
      short_name: 'NUFC',
      country_id: COUNTRY,
      founded_year: 1901,
      website_url: 'https://new-united.example.com',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'New United FC', is_active: true });
    expect(typeof res.body.data.slug).toBe('string');
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'teams.create'),
    ).toBe(true);
  });

  it('duplicate slug auto-resolved, never 409', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({ name: 'Copy FC', slug: 'fc-example' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).not.toBe('fc-example');
  });

  it('validation failure -> 400, nothing written', async () => {
    const before = (fake.store.teams as unknown[]).length;
    expect((await request(app).post(BASE).set(AUTHED).send({})).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'x'.repeat(151) })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'Bad FC', slug: 'bad slug!' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'Bad FC', country_id: '00000000-0000-4000-8000-000000000999' })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'Bad FC', founded_year: 1500 })).status).toBe(400);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'Bad FC', logo_url: 'not-a-url' })).status).toBe(400);
    expect((fake.store.teams as unknown[]).length).toBe(before);
  });

  it('update + deactivate (archive path) + audit', async () => {
    const res = await request(app).patch(`${BASE}/${T1}`).set(AUTHED).send({ short_name: 'FCE-X' });
    expect(res.status).toBe(200);
    expect(res.body.data.short_name).toBe('FCE-X');
    const archived = await request(app).patch(`${BASE}/${T1}`).set(AUTHED).send({ is_active: false });
    expect(archived.status).toBe(200);
    expect(archived.body.data.is_active).toBe(false);
    // Restore for other tests (isolated store, but be explicit).
    await request(app).patch(`${BASE}/${T1}`).set(AUTHED).send({ is_active: true });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'teams.update'),
    ).toBe(true);
    expect((await request(app).patch(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED).send({ short_name: 'x' })).status).toBe(404);
  });

  it('permission checks per operation', async () => {
    seedAdmin(fake, ['teams.read']);
    expect((await request(app).post(BASE).set(AUTHED).send({ name: 'No Grant FC' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${T1}`).set(AUTHED).send({ short_name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${T1}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('delete safety: referenced team -> 409; bare team deletes', async () => {
    const blocked = await request(app).delete(`${BASE}/${T1}`).set(AUTHED);
    expect(blocked.status).toBe(409);

    const created = await request(app).post(BASE).set(AUTHED).send({ name: 'Ephemeral FC' });
    const id = created.body.data.id as string;
    const del = await request(app).delete(`${BASE}/${id}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true });
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'teams.delete'),
    ).toBe(true);
    expect((await request(app).delete(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(404);
  });
});
