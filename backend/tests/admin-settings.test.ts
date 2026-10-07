import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/settings';

const GRANTS = ['settings.read', 'settings.manage'];

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  fake.store.system_settings = [
    { key: 'site.name', value: 'Football', type: 'string', description: 'Public site name', updated_at: '2026-01-01T00:00:00.000Z' },
    { key: 'features.breaking_news', value: true, type: 'boolean', description: 'Breaking module', updated_at: '2026-01-01T00:00:00.000Z' },
    { key: 'news.page_size', value: 20, type: 'number', description: 'Page size', updated_at: '2026-01-01T00:00:00.000Z' },
    { key: 'social.twitter', value: 'https://twitter.com', type: 'url', description: 'Twitter', updated_at: '2026-01-01T00:00:00.000Z' },
    { key: 'seo.home', value: { title: 'Home' }, type: 'json', description: 'Home SEO', updated_at: '2026-01-01T00:00:00.000Z' },
  ];
  setTestRoles(['admin']);
}

function audits(fake: FakeClient, action: string) {
  return (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === action);
}

describe('step 12: admin site settings', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('list with categories + pagination', async () => {
    const res = await request(app).get(`${BASE}?limit=2`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ total: 5 });
    expect(res.body.data).toHaveLength(2);
    const all = await request(app).get(BASE).set(AUTHED);
    const byKey = Object.fromEntries((all.body.data as Array<Record<string, unknown>>).map((r) => [r.key, r.category]));
    expect(byKey['site.name']).toBe('Website');
    expect(byKey['features.breaking_news']).toBe('Features');
    expect(byKey['news.page_size']).toBe('News');
  });

  it('single setting + 404 unknown', async () => {
    const res = await request(app).get(`${BASE}/site.name`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'site.name', value: 'Football', type: 'string' });
    expect((await request(app).get(`${BASE}/nope.missing`).set(AUTHED)).status).toBe(404);
  });

  it('valid updates per type + audit with before/after', async () => {
    expect((await request(app).patch(`${BASE}/site.name`).set(AUTHED).send({ value: 'Footy' })).body.data.value).toBe('Footy');
    expect((await request(app).patch(`${BASE}/features.breaking_news`).set(AUTHED).send({ value: false })).body.data.value).toBe(false);
    expect((await request(app).patch(`${BASE}/news.page_size`).set(AUTHED).send({ value: 30 })).body.data.value).toBe(30);
    expect((await request(app).patch(`${BASE}/social.twitter`).set(AUTHED).send({ value: 'https://x.com/club' })).body.data.value).toBe('https://x.com/club');
    expect((await request(app).patch(`${BASE}/seo.home`).set(AUTHED).send({ value: { title: 'New' } })).body.data.value).toMatchObject({ title: 'New' });

    const rows = fake.store.audit_logs as Array<Record<string, unknown>>;
    const entry = rows.find((a) => a.action === 'settings.update');
    expect(entry).toBeDefined();
    expect(entry!.new_data).toBeDefined();
  });

  it('invalid values -> 400, nothing changed', async () => {
    expect((await request(app).patch(`${BASE}/site.name`).set(AUTHED).send({ value: 42 })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/features.breaking_news`).set(AUTHED).send({ value: 'yes' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/news.page_size`).set(AUTHED).send({ value: 'lots' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/social.twitter`).set(AUTHED).send({ value: 'not a url' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/site.name`).set(AUTHED).send({})).status).toBe(400);
    expect((await request(app).get(`${BASE}/site.name`).set(AUTHED)).body.data.value).toBe('Football');
  });

  it('type is immutable (extra fields ignored, value applied)', async () => {
    const res = await request(app).patch(`${BASE}/site.name`).set(AUTHED).send({ value: 'Renamed', type: 'number' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: 'string', value: 'Renamed' });
  });

  it('permission enforcement: read vs manage split', async () => {
    seedAdmin(fake, []);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(403);

    seedAdmin(fake, ['settings.read']);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
    expect((await request(app).patch(`${BASE}/site.name`).set(AUTHED).send({ value: 'X' })).status).toBe(403);
    // Untouched by the rejected write.
    expect((await request(app).get(`${BASE}/site.name`).set(AUTHED)).body.data.value).toBe('Football');
  });

  it('protected infrastructure keys are never exposed or writable', async () => {
    (fake.store.system_settings as Array<Record<string, unknown>>).push({
      key: 'internal.api_secret', value: 'shh', type: 'string', description: 'must stay hidden',
    });
    expect((await request(app).get(`${BASE}/internal.api_secret`).set(AUTHED)).status).toBe(404);
    expect((await request(app).patch(`${BASE}/internal.api_secret`).set(AUTHED).send({ value: 'x' })).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).body.data.some((r: Record<string, unknown>) => r.key === 'internal.api_secret')).toBe(false);
  });

  it('public website behavior unchanged', async () => {
    expect((await request(app).get('/api/v1/news').set(AUTHED)).status).toBe(200);
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});
