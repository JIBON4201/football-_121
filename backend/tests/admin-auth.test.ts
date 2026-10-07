import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { hasAllPermissions, hasAnyPermission } from '../src/admin/permissions';
import { redactSensitive, writeAdminAudit } from '../src/admin/audit';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

const P_ARTICLES = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const P_TRANSFERS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';

const AUTHED = { Authorization: 'Bearer valid-token' };

function seedAdminBase(fake: FakeClient) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.admin_permissions = [
    { id: P_ARTICLES, key: 'articles.read', resource: 'articles', action: 'read' },
    { id: P_TRANSFERS, key: 'transfers.read', resource: 'transfers', action: 'read' },
  ];
}

function asAdminWith(fake: FakeClient, permissionIds: string[], status = 'active') {
  fake.store.profiles = [{ user_id: 'user-1', status }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_role_permissions = permissionIds.map((permission_id) => ({
    role_id: 2,
    permission_id,
  }));
}

function asNormalUser(fake: FakeClient) {
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 6 }];
  fake.store.admin_role_permissions = [];
}

describe('step 3: admin authentication + RBAC', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdminBase(fake);
    fake.store.audit_logs = [];
  });

  it('1. unauthenticated request -> 401', async () => {
    const res = await request(app).get('/api/v1/admin/ping');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('2. normal website user -> 403 (never auto-admin)', async () => {
    asNormalUser(fake);
    const res = await request(app).get('/api/v1/admin/ping').set(AUTHED);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('3. disabled admin -> 403', async () => {
    asAdminWith(fake, [P_ARTICLES], 'suspended');
    const res = await request(app).get('/api/v1/admin/ping').set(AUTHED);
    expect(res.status).toBe(403);
  });

  it('4. valid admin -> allowed', async () => {
    asAdminWith(fake, [P_ARTICLES]);
    const res = await request(app).get('/api/v1/admin/ping').set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, userId: 'user-1' });
  });

  it('5. missing permission -> 403', async () => {
    asAdminWith(fake, [P_ARTICLES]);
    const res = await request(app).get('/api/v1/admin/transfers').set(AUTHED);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('6. required permission (+ any/all helpers) -> allowed', async () => {
    asAdminWith(fake, [P_ARTICLES]);
    expect((await request(app).get('/api/v1/admin/articles').set(AUTHED)).status).toBe(200);
    // any/all helpers (unit-level, same logic the guards use)
    const identity = {
      userId: 'user-1',
      status: 'active',
      roles: ['admin'],
      roleIds: [2],
      permissions: ['articles.read'],
    };
    expect(hasAnyPermission(identity, ['articles.read', 'transfers.read'])).toBe(true);
    expect(hasAllPermissions(identity, ['articles.read', 'transfers.read'])).toBe(false);

    asAdminWith(fake, [P_ARTICLES, P_TRANSFERS]);
    expect((await request(app).get('/api/v1/admin/transfers').set(AUTHED)).status).toBe(200);
  });

  it('7. client-supplied fake role -> rejected', async () => {
    asNormalUser(fake);
    const query = await request(app).get('/api/v1/admin/ping?role=super_admin').set(AUTHED);
    expect(query.status).toBe(403);
    const header = await request(app)
      .get('/api/v1/admin/ping')
      .set({ ...AUTHED, 'x-admin-role': 'super_admin' });
    expect(header.status).toBe(403);
  });

  it('8. client-supplied fake permission -> rejected', async () => {
    asNormalUser(fake);
    const query = await request(app).get('/api/v1/admin/ping?permission=articles.read').set(AUTHED);
    expect(query.status).toBe(403);
    const header = await request(app)
      .get('/api/v1/admin/articles')
      .set({ ...AUTHED, 'x-admin-permission': 'articles.read' });
    expect(header.status).toBe(403);
  });

  it('audit helper redacts secrets and never throws', async () => {
    asAdminWith(fake, [P_ARTICLES]);
    const redacted = redactSensitive({
      title: 'ok',
      password: 'hunter2',
      nested: { api_key: 'abc', items: [{ token: 't', keep: 1 }] },
    }) as Record<string, unknown>;
    expect(redacted.password).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');

    const ok = await writeAdminAudit({
      userId: 'user-1',
      action: 'articles.read',
      resource: 'articles',
      newData: { password: 'hunter2', title: 'ok' },
    });
    expect(ok).toBe(true);
    const row = fake.store.audit_logs[0] as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('hunter2');
    expect(row.action).toBe('articles.read');
  });
});
