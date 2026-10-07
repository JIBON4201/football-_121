import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };

const KEYS = [
  'dashboard.read',
  'articles.read',
  'transfers.read',
  'matches.read',
  'teams.read',
  'players.read',
  'competitions.read',
  'seasons.read',
  'venues.read',
  'media.read',
  'users.manage',
  'users.read',
  'roles.read',
  'audit_logs.read',
];

function seedRbac(fake: FakeClient, keys: string[]) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({
    role_id: 2,
    permission_id: ids.get(key),
  }));
}

function seedNormalUser(fake: FakeClient) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 6 }];
  fake.store.admin_permissions = [];
  fake.store.admin_role_permissions = [];
}

const ENDPOINTS = [
  '/api/v1/admin/articles',
  '/api/v1/admin/transfers',
  '/api/v1/admin/matches',
  '/api/v1/admin/teams',
  '/api/v1/admin/players',
  '/api/v1/admin/competitions',
  '/api/v1/admin/seasons',
  '/api/v1/admin/venues',
  '/api/v1/admin/media',
  '/api/v1/admin/users',
  '/api/v1/admin/roles',
  '/api/v1/admin/audit-logs',
];

describe('step 4: admin read APIs', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedRbac(fake, KEYS);
    fake.store.media = [];
    fake.store.audit_logs = [];
  });

  it('authentication failure -> 401 with stable envelope', async () => {
    for (const path of ['/api/v1/admin/dashboard', '/api/v1/admin/articles']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(typeof res.body.requestId).toBe('string');
      expect(JSON.stringify(res.body)).not.toMatch(/SELECT|FROM|stack/i);
    }
  });

  it('authorization failure -> 403 for normal users', async () => {
    seedNormalUser(fake);
    const res = await request(app).get('/api/v1/admin/articles').set(AUTHED);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('permission enforcement -> scoped admin blocked outside grants', async () => {
    seedRbac(fake, ['articles.read']);
    expect((await request(app).get('/api/v1/admin/articles').set(AUTHED)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/transfers').set(AUTHED)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/dashboard').set(AUTHED)).status).toBe(403);
  });

  it('valid admin read endpoints -> 200 with data + pagination', async () => {
    for (const path of ENDPOINTS) {
      const res = await request(app).get(path).set(AUTHED);
      expect(res.status, path).toBe(200);
      expect(Array.isArray(res.body.data), path).toBe(true);
      expect(res.body.pagination, path).toMatchObject({ page: 1 });
      expect(typeof res.body.requestId, path).toBe('string');
    }
    // Admin sees what public hides: drafts + rumours.
    const articles = await request(app).get('/api/v1/admin/articles').set(AUTHED);
    expect(articles.body.pagination.total).toBe(3);
    const transfers = await request(app).get('/api/v1/admin/transfers').set(AUTHED);
    expect(transfers.body.pagination.total).toBe(2);
  });

  it('invalid parameters -> 400 before any query', async () => {
    expect((await request(app).get('/api/v1/admin/articles?page=0').set(AUTHED)).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/articles?status=bogus').set(AUTHED)).status).toBe(
      400,
    );
    expect(
      (await request(app).get('/api/v1/admin/seasons?competition_id=not-a-uuid').set(AUTHED)).status,
    ).toBe(400);
    const res = await request(app).get('/api/v1/admin/articles?status=bogus').set(AUTHED);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('pagination limits clamp to server maximum', async () => {
    const clamped = await request(app).get('/api/v1/admin/articles?limit=9999').set(AUTHED);
    expect(clamped.status).toBe(200);
    expect(clamped.body.pagination.limit).toBeLessThanOrEqual(100);
    const small = await request(app).get('/api/v1/admin/articles?limit=5').set(AUTHED);
    expect(small.body.pagination.limit).toBe(5);
  });

  it('dashboard returns aggregates without loading tables', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard').set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      articles: { total: 3, published: 2, draft: 1 },
      transfers: { total: 2 },
      matches: { upcoming: 1, live: 0 },
      teams: { total: 2 },
      players: { total: 1 },
      competitions: { total: 1 },
    });
    expect(typeof res.body.requestId).toBe('string');
  });
});
