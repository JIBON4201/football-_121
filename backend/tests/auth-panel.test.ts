import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetPasswordAuthProviders, setPasswordAuthProviders } from '../src/auth/passwordAuth';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };

function seedAdmin(fake: FakeClient) {
  fake.store.roles = [
    { id: 1, name: 'super_admin' },
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = [
    { id: '90000000-0000-4000-8000-000000000001', key: 'dashboard.read', resource: 'dashboard', action: 'read' },
  ];
  fake.store.admin_role_permissions = [{ role_id: 2, permission_id: '90000000-0000-4000-8000-000000000001' }];
}

describe('step 16: panel auth exchange + admin identity', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    resetPasswordAuthProviders();
    seedAdmin(fake);
  });

  it('login validates input before any auth call', async () => {
    expect((await request(app).post('/api/v1/auth/login').send({})).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(400);
  });

  it('login rejects bad credentials generically (no oracle)', async () => {
    setPasswordAuthProviders({ signIn: async () => { throw new Error('nope'); } });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('login returns session without echoing the password', async () => {
    setPasswordAuthProviders({
      signIn: async (email) => ({
        accessToken: 'access-123', refreshToken: 'refresh-123', expiresIn: 3600,
        user: { id: 'user-9', email },
      }),
    });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 's3cret' });
    expect(res.status).toBe(200);
    expect(res.body.data.session.access_token).toBe('access-123');
    expect(JSON.stringify(res.body)).not.toContain('s3cret');
  });

  it('logout always succeeds and never leaks', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true });
  });

  it('admin/me: 401 unauth, 403 non-admin, 200 with grants', async () => {
    expect((await request(app).get('/api/v1/admin/me')).status).toBe(401);

    fake.store.user_roles = [{ user_id: 'user-1', role_id: 6 }];
    fake.store.admin_role_permissions = [];
    expect((await request(app).get('/api/v1/admin/me').set(AUTHED)).status).toBe(403);

    seedAdmin(fake);
    const res = await request(app).get('/api/v1/admin/me').set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 'user-1', roles: ['admin'], permissions: ['dashboard.read'] });
    expect(JSON.stringify(res.body)).not.toMatch(/service_role|sb_secret|refresh/i);
  });
});
