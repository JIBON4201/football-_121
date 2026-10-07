import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { setAuthUserCreator } from '../src/admin/services/users.admin.service';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };

const U1 = 'user-1';
const U2 = 'user-2';
const MISSING = '00000000-0000-4000-8000-000000000999';

const GRANTS = [
  'users.read', 'users.manage',
  'roles.read', 'roles.manage',
  'permissions.read',
];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 1, name: 'super_admin' },
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [
    { user_id: U1, status: 'active', display_name: 'Root' },
    { user_id: U2, status: 'active', display_name: 'Second' },
  ];
  fake.store.user_roles = [
    { user_id: U1, role_id: 1 },
    { user_id: U2, role_id: 2 },
  ];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.flatMap((key) => [
    { role_id: 1, permission_id: ids.get(key) },
    { role_id: 2, permission_id: ids.get(key) },
  ]);
  fake.store.audit_logs = [];
  setTestRoles(['admin']);
  setAuthUserCreator(async (email) => ({ id: 'user-3', email }));
}

function audits(fake: FakeClient, action: string) {
  return (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === action);
}

function permId(fake: FakeClient, key: string): string {
  const row = (fake.store.admin_permissions as Array<{ id: string; key: string }>).find((p) => p.key === key);
  if (!row) throw new Error(`missing seed permission ${key}`);
  return row.id;
}

describe('step 13: admin users, roles, permissions', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('users list/search/filter + pagination', async () => {
    const all = await request(app).get('/api/v1/admin/users').set(AUTHED);
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBe(2);
    expect(all.body.data[0]).toHaveProperty('roles');

    expect((await request(app).get('/api/v1/admin/users?q=root').set(AUTHED)).body.pagination.total).toBe(1);
    expect((await request(app).get('/api/v1/admin/users?role=super_admin').set(AUTHED)).body.pagination.total).toBe(1);
    expect((await request(app).get('/api/v1/admin/users?role=nope').set(AUTHED)).body.pagination.total).toBe(0);
    expect((await request(app).get('/api/v1/admin/users?status=suspended').set(AUTHED)).body.pagination.total).toBe(0);
  });

  it('single user + 404', async () => {
    const res = await request(app).get(`/api/v1/admin/users/${U2}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toContain('admin');
    expect((await request(app).get(`/api/v1/admin/users/${MISSING}`).set(AUTHED)).status).toBe(404);
  });

  it('invite creates auth user + profile + roles (audited)', async () => {
    const res = await request(app).post('/api/v1/admin/users').set(AUTHED).send({
      email: 'new@example.com', display_name: 'Newbie', roleIds: [2],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'user-3', email: 'new@example.com' });
    expect(res.body.data.roles).toContain('admin');
    expect(audits(fake, 'users.create')).toBe(true);
    expect((await request(app).post('/api/v1/admin/users').set(AUTHED).send({ email: 'not-an-email' })).status).toBe(400);
    expect((await request(app).post('/api/v1/admin/users').set(AUTHED).send({ email: 'x@example.com', roleIds: [999] })).status).toBe(400);
  });

  it('update metadata + disable + role change (audited)', async () => {
    const res = await request(app).patch(`/api/v1/admin/users/${U2}`).set(AUTHED).send({ display_name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.display_name).toBe('Renamed');

    const disabled = await request(app).patch(`/api/v1/admin/users/${U2}`).set(AUTHED).send({ status: 'suspended' });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.status).toBe('suspended');
    expect(audits(fake, 'users.update')).toBe(true);
  });

  it('last active super_admin cannot be suspended, de-roled or revoked', async () => {
    expect((await request(app).patch(`/api/v1/admin/users/${U1}`).set(AUTHED).send({ status: 'suspended' })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/admin/users/${U1}`).set(AUTHED).send({ roleIds: [2] })).status).toBe(409);
    expect((await request(app).delete(`/api/v1/admin/users/${U1}`).set(AUTHED)).status).toBe(409);
    // Non-sole admin is fair game.
    expect((await request(app).patch(`/api/v1/admin/users/${U2}`).set(AUTHED).send({ status: 'suspended' })).status).toBe(200);
  });

  it('revoke strips staff roles, keeps base user (audited)', async () => {
    const res = await request(app).delete(`/api/v1/admin/users/${U2}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ revoked: true });
    const after = await request(app).get(`/api/v1/admin/users/${U2}`).set(AUTHED);
    expect(after.body.data.roles).toEqual(['user']);
    expect(audits(fake, 'users.revoke')).toBe(true);
  });

  it('roles CRUD + guards + audit', async () => {
    const list = await request(app).get('/api/v1/admin/roles').set(AUTHED);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toHaveProperty('memberCount');

    const single = await request(app).get('/api/v1/admin/roles/1').set(AUTHED);
    expect(single.body.data.permissions).toContain('users.manage');

    const created = await request(app).post('/api/v1/admin/roles').set(AUTHED).send({ name: 'moderator', description: 'Mods' });
    expect(created.status).toBe(201);
    const modId = created.body.data.id as number;
    expect((await request(app).post('/api/v1/admin/roles').set(AUTHED).send({ name: 'admin' })).status).toBe(409);
    expect((await request(app).post('/api/v1/admin/roles').set(AUTHED).send({ name: 'king' })).status).toBe(400);

    expect((await request(app).patch(`/api/v1/admin/roles/${modId}`).set(AUTHED).send({ description: 'Updated' })).status).toBe(200);
    expect((await request(app).delete('/api/v1/admin/roles/1').set(AUTHED)).status).toBe(403);
    expect((await request(app).delete('/api/v1/admin/roles/2').set(AUTHED)).status).toBe(403);
    // Member role cannot be deleted while assigned.
    await request(app).post('/api/v1/admin/users').set(AUTHED).send({ email: 'mod@example.com', roleIds: [modId] });
    expect((await request(app).delete(`/api/v1/admin/roles/${modId}`).set(AUTHED)).status).toBe(409);
    // After revoking the only member, deletion succeeds and audits.
    await request(app).delete('/api/v1/admin/users/user-3').set(AUTHED);
    expect((await request(app).delete(`/api/v1/admin/roles/${modId}`).set(AUTHED)).status).toBe(200);
    expect(audits(fake, 'roles.create')).toBe(true);
    expect(audits(fake, 'roles.delete')).toBe(true);
  });

  it('permission catalogue listing + assignment lifecycle', async () => {
    const list = await request(app).get('/api/v1/admin/permissions').set(AUTHED);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data[0]).toHaveProperty('key');

    const target = permId(fake, 'users.read');
    const set = await request(app).put('/api/v1/admin/roles/2/permissions').set(AUTHED).send({ permissionIds: [target] });
    expect(set.status).toBe(200);
    expect(set.body.data.permissions).toEqual(['users.read']);

    expect((await request(app).put('/api/v1/admin/roles/2/permissions').set(AUTHED).send({ permissionIds: [MISSING] })).status).toBe(400);
    expect((await request(app).put('/api/v1/admin/roles/1/permissions').set(AUTHED).send({ permissionIds: [target] })).status).toBe(403);
    expect(audits(fake, 'roles.permissions')).toBe(true);
  });

  it('unauthorized access: read-only cannot write', async () => {
    seedAdmin(fake, ['users.read', 'roles.read', 'permissions.read']);
    expect((await request(app).post('/api/v1/admin/users').set(AUTHED).send({ email: 'x@example.com' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/users/${U2}`).set(AUTHED).send({ display_name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/v1/admin/users/${U2}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).post('/api/v1/admin/roles').set(AUTHED).send({ name: 'moderator' })).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/roles/2/permissions').set(AUTHED).send({ permissionIds: [] })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/users').set(AUTHED)).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/permissions').set(AUTHED)).status).toBe(200);
  });
});
