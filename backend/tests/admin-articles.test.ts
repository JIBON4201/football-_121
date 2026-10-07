import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/articles';

const GRANTS = ['articles.read', 'articles.create', 'articles.update', 'articles.delete'];

// Seed articles use shorthand ids (a1..a3); the :id routes validate UUIDs,
// so remap to UUIDs per test (isolated store, no cross-test impact).
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function seedAdmin(fake: FakeClient, keys: string[] = GRANTS) {
  fake.store.roles = [
    { id: 2, name: 'admin' },
    { id: 6, name: 'user' },
  ];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 2 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `90000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 2, permission_id: ids.get(key) }));
  fake.store.audit_logs = [];
  // Deterministic timestamps for date/sort filters + UUID ids for :id routes.
  const articleIds = [A1, A2, A3];
  const stamps = ['2026-01-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z'];
  (fake.store.articles as Array<Record<string, unknown>>).forEach((a, i) => {
    a.id = articleIds[i];
    a.created_at = stamps[i];
    a.updated_at = stamps[i];
  });
  setTestRoles(['admin']);
}

describe('step 5: admin articles CRUD', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake);
  });

  it('list + pagination + total', async () => {
    const res = await request(app).get(`${BASE}?limit=1`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 3 });
  });

  it('search + status/type/featured filters', async () => {
    const search = await request(app).get(`${BASE}?q=big-win`).set(AUTHED);
    expect(search.body.pagination.total).toBe(1);

    expect((await request(app).get(`${BASE}?status=draft`).set(AUTHED)).body.pagination.total).toBe(1);
    expect(
      (await request(app).get(`${BASE}?article_type=transfer`).set(AUTHED)).body.pagination.total,
    ).toBe(1);
    expect((await request(app).get(`${BASE}?featured=true`).set(AUTHED)).body.pagination.total).toBe(
      1,
    );
    expect(
      (await request(app).get(`${BASE}?from=2026-02-01&to=2026-02-28`).set(AUTHED)).body.pagination
        .total,
    ).toBe(1);
    expect(
      (await request(app).get(`${BASE}?sort=created_at&order=asc`).set(AUTHED)).status,
    ).toBe(200);
  });

  it('category + author filters', async () => {
    (fake.store.article_categories as unknown[]).push({ article_id: A1, category_id: 'cat1' });
    (fake.store.articles as Array<Record<string, unknown>>)[0].author_id = 'user-1';
    expect((await request(app).get(`${BASE}?categoryId=cat1`).set(AUTHED)).body.pagination.total).toBe(
      1,
    );
    const authorId = 'user-1';
    expect(
      (await request(app).get(`${BASE}?authorId=${authorId}`).set(AUTHED)).body.pagination.total,
    ).toBe(1);
  });

  it('single article with relations', async () => {
    const res = await request(app).get(`${BASE}/${A1}`).set(AUTHED);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: A1, slug: 'big-win' });
    expect(res.body.data).toHaveProperty('categories');
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(AUTHED)).status).toBe(400);
    expect((await request(app).get(`${BASE}/00000000-0000-4000-8000-000000000999`).set(AUTHED)).status).toBe(
      404,
    );
  });

  it('create draft (201, slug auto-generated, audited)', async () => {
    const res = await request(app)
      .post(BASE)
      .set(AUTHED)
      .send({ title: 'A Proper New Story', content: 'Enough body content for validation rules.' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'draft' });
    expect(typeof res.body.data.slug).toBe('string');
    const audits = fake.store.audit_logs as Array<Record<string, unknown>>;
    expect(audits.some((a) => a.action === 'article.create')).toBe(true);
  });

  it('create breaking_news reuses the article table + flags', async () => {
    const ok = await request(app).post(BASE).set(AUTHED).send({
      title: 'Huge Breaking Development',
      content: 'Enough body content for validation rules.',
      articleType: 'breaking_news',
      isBreaking: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ article_type: 'breaking_news', is_breaking: true });

    const missing = await request(app).post(BASE).set(AUTHED).send({
      title: 'Bad Breaking Story Here',
      content: 'Enough body content for validation rules.',
      articleType: 'breaking_news',
    });
    expect(missing.status).toBe(400);

    const mismatch = await request(app).post(BASE).set(AUTHED).send({
      title: 'Wrong Flag Story Here',
      content: 'Enough body content for validation rules.',
      isBreaking: true,
    });
    expect(mismatch.status).toBe(400);
  });

  it('validation failure -> 400, nothing written', async () => {
    const before = (fake.store.articles as unknown[]).length;
    expect(
      (await request(app).post(BASE).set(AUTHED).send({ title: 'abc', content: 'short' })).status,
    ).toBe(400);
    expect(
      (await request(app).post(BASE).set(AUTHED).send({ title: 'Valid Title Here', content: 'Enough body content for validation rules.', slug: 'bad slug!' })).status,
    ).toBe(400);
    expect((fake.store.articles as unknown[]).length).toBe(before);
  });

  it('duplicate slug is auto-resolved, never 409', async () => {
    const res = await request(app).post(BASE).set(AUTHED).send({
      title: 'Another Big Win Story',
      content: 'Enough body content for validation rules.',
      slug: 'big-win',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).not.toBe('big-win');
    expect(String(res.body.data.slug).startsWith('big-win')).toBe(true);
  });

  it('update draft + audit trail', async () => {
    const res = await request(app).patch(`${BASE}/${A3}`).set(AUTHED).send({ title: 'Renamed Draft Piece' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Renamed Draft Piece');
    const audits = fake.store.audit_logs as Array<Record<string, unknown>>;
    expect(audits.some((a) => a.action === 'article.update')).toBe(true);
  });

  it('unauthorized update (service role gate) -> 403 even with route grants', async () => {
    setTestRoles(['user']);
    const res = await request(app).patch(`${BASE}/${A3}`).set(AUTHED).send({ title: 'Hacked Title Here' });
    expect(res.status).toBe(403);
  });

  it('permission checks per operation', async () => {
    seedAdmin(fake, ['articles.read']);
    setTestRoles(['admin']);
    expect((await request(app).post(BASE).set(AUTHED).send({ title: 'No Grant Title', content: 'Enough body content for validation rules.' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${A3}`).set(AUTHED).send({ title: 'No Grant Title' })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${A3}`).set(AUTHED)).status).toBe(403);
    expect((await request(app).get(BASE).set(AUTHED)).status).toBe(200);
  });

  it('delete draft + audit; published delete stays admin-guarded', async () => {
    const del = await request(app).delete(`${BASE}/${A3}`).set(AUTHED);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true });
    expect((fake.store.articles as Array<Record<string, unknown>>).some((a) => a.id === A3)).toBe(false);
    expect(
      (fake.store.audit_logs as Array<Record<string, unknown>>).some((a) => a.action === 'article.delete'),
    ).toBe(true);

    // Editor (non-admin role) cannot hard-delete published content.
    setTestRoles(['editor']);
    const blocked = await request(app).delete(`${BASE}/${A1}`).set(AUTHED);
    expect(blocked.status).toBe(403);
  });
});
