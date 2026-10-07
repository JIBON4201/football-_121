import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };

const COMP = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const SEASON = '44444444-4444-4444-8444-444444444444';
const COUNTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const MISSING = '00000000-0000-4000-8000-000000000999';

const GRANTS = [
  'competitions.read', 'competitions.create', 'competitions.update', 'competitions.delete',
  'seasons.read', 'seasons.manage',
  'venues.read', 'venues.manage',
];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  setTestRoles(['admin']);
}

function audits(fake: FakeClient, action: string) {
  return (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === action);
}

describe('step 10: admin competitions/seasons/venues', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('competitions list + filters + pagination', async () => {
    const get = (qs: string) => request(app).get(`/api/v1/admin/competitions?${qs}`).set(AUTHED);
    expect((await get('limit=1')).body.pagination).toMatchObject({ total: 1 });
    expect((await get('q=premier')).body.pagination.total).toBe(1);
    expect((await get(`countryId=${COUNTRY}`)).body.pagination.total).toBe(1);
    expect((await get('active=true')).body.pagination.total).toBe(1);
    expect((await get('sort=name&order=desc')).status).toBe(200);
    expect((await get('active=maybe')).status).toBe(400);
  });

  it('competition single + dependents', async () => {
    const res = await request(app).get(`/api/v1/admin/competitions/${COMP}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: COMP });
    expect(res.body.data.dependents.seasons).toBeGreaterThanOrEqual(1);
    expect(res.body.data.dependents.matches).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`/api/v1/admin/competitions/${MISSING}`).set(AUTHED)).status).toBe(404);
  });

  it('competition create/update/delete + audit + guards', async () => {
    const created = await request(app).post('/api/v1/admin/competitions').set(AUTHED).send({
      name: 'Championship', country_id: COUNTRY, type: 'league',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe('championship');
    const id = created.body.data.id as string;

    const dup = await request(app).post('/api/v1/admin/competitions').set(AUTHED).send({ name: 'Copy', slug: 'premier-league' });
    expect(dup.status).toBe(201);
    expect(dup.body.data.slug).not.toBe('premier-league');

    expect((await request(app).post('/api/v1/admin/competitions').set(AUTHED).send({})).status).toBe(400);

    const patched = await request(app).patch(`/api/v1/admin/competitions/${id}`).set(AUTHED).send({ is_active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.is_active).toBe(false);

    expect((await request(app).delete(`/api/v1/admin/competitions/${COMP}`).set(AUTHED)).status).toBe(409);
    expect((await request(app).delete(`/api/v1/admin/competitions/${id}`).set(AUTHED)).status).toBe(200);
    expect(audits(fake, 'competitions.create')).toBe(true);
    expect(audits(fake, 'competitions.update')).toBe(true);
    expect(audits(fake, 'competitions.delete')).toBe(true);
  });

  it('competition permission enforcement', async () => {
    seedAdmin(fake, ['competitions.read']);
    expect((await request(app).post('/api/v1/admin/competitions').set(AUTHED).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/competitions/${COMP}`).set(AUTHED).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/competitions/${COMP}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/competitions').set(AUTHED)).status).toBe(200);
  });

  it('seasons list/filter/create/duplicate/FK/dates', async () => {
    expect((await request(app).get(`/api/v1/admin/seasons?competition_id=${COMP}`).set(AUTHED)).body.pagination.total).toBe(1);
    expect((await request(app).get('/api/v1/admin/seasons?current=true').set(AUTHED)).body.pagination.total).toBe(1);

    const created = await request(app).post('/api/v1/admin/seasons').set(AUTHED).send({
      competition_id: COMP, name: '2027/28', start_date: '2027-08-01', end_date: '2028-05-31',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    expect((await request(app).post('/api/v1/admin/seasons').set(AUTHED).send({ competition_id: COMP, name: '2026/27' })).status).toBe(409);
    expect((await request(app).post('/api/v1/admin/seasons').set(AUTHED).send({ competition_id: MISSING, name: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/seasons').set(AUTHED).send({ competition_id: COMP, name: 'Bad', start_date: '2028-01-01', end_date: '2027-01-01' })).status).toBe(400);

    expect((await request(app).patch(`/api/v1/admin/seasons/${id}`).set(AUTHED).send({ is_current: true })).status).toBe(200);
    expect((await request(app).delete(`/api/v1/admin/seasons/${SEASON}`).set(AUTHED)).status).toBe(409);
    expect((await request(app).delete(`/api/v1/admin/seasons/${id}`).set(AUTHED)).status).toBe(200);
    expect(audits(fake, 'seasons.create')).toBe(true);
    expect(audits(fake, 'seasons.delete')).toBe(true);
  });

  it('seasons permission enforcement (manage = write grant)', async () => {
    seedAdmin(fake, ['seasons.read']);
    expect((await request(app).post('/api/v1/admin/seasons').set(AUTHED).send({ competition_id: COMP, name: 'X' })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/seasons').set(AUTHED)).status).toBe(200);
  });

  it('venues list/search/create/update/delete + guards', async () => {
    seedAdmin(fake, [...GRANTS, 'teams.create', 'teams.read']);
    expect((await request(app).get('/api/v1/admin/venues?q=arena').set(AUTHED)).body.pagination.total).toBe(1);

    const created = await request(app).post('/api/v1/admin/venues').set(AUTHED).send({
      name: 'New Arena', city: 'Manchester', country_id: COUNTRY, capacity: 75000, latitude: 53.46, longitude: -2.29,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    expect((await request(app).post('/api/v1/admin/venues').set(AUTHED).send({ name: 'Bad', capacity: -1 })).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/venues').set(AUTHED).send({ name: 'Bad', latitude: 999 })).status).toBe(400);

    expect((await request(app).patch(`/api/v1/admin/venues/${id}`).set(AUTHED).send({ capacity: 80000 })).status).toBe(200);

    // Referenced by a team -> 409.
    await request(app).post('/api/v1/admin/teams').set(AUTHED).send({ name: 'Arena FC', venue_id: id });
    expect((await request(app).delete(`/api/v1/admin/venues/${id}`).set(AUTHED)).status).toBe(409);

    expect(audits(fake, 'venues.create')).toBe(true);
    expect(audits(fake, 'venues.update')).toBe(true);
  });

  it('venues bare delete + permission enforcement', async () => {
    const created = await request(app).post('/api/v1/admin/venues').set(AUTHED).send({ name: 'Empty Ground' });
    const id = created.body.data.id as string;
    expect((await request(app).delete(`/api/v1/admin/venues/${id}`).set(AUTHED)).status).toBe(200);
    expect(audits(fake, 'venues.delete')).toBe(true);

    seedAdmin(fake, ['venues.read']);
    expect((await request(app).post('/api/v1/admin/venues').set(AUTHED).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/venues').set(AUTHED)).status).toBe(200);
  });
});
