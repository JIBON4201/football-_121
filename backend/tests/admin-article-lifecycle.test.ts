import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv, setTestRoles } from './helpers';
import type { FakeClient } from './fake';

const AUTHED = { Authorization: 'Bearer valid-token' };
const BASE = '/api/v1/admin/articles';

function seedAdmin(fake: FakeClient, keys: string[]) {
  fake.store.roles = [{ id: 1, name: 'super_admin' }];
  fake.store.profiles = [{ user_id: 'user-1', status: 'active' }];
  fake.store.user_roles = [{ user_id: 'user-1', role_id: 1 }];
  fake.store.admin_permissions = keys.map((key, i) => {
    const [resource, action] = key.split('.');
    return { id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, key, resource, action };
  });
  const ids = new Map(
    (fake.store.admin_permissions as Array<{ id: string; key: string }>).map((p) => [p.key, p.id]),
  );
  fake.store.admin_role_permissions = keys.map((key) => ({ role_id: 1, permission_id: ids.get(key) }));
  setTestRoles(['admin']);
}

describe('admin articles lifecycle routes', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    seedAdmin(fake, ['articles.read', 'articles.create', 'articles.update', 'articles.publish']);
  });

  it('draft -> submit -> publish via admin routes', async () => {
    const created = await request(app).post(BASE).set(AUTHED).send({
      title: 'Lifecycle real test article',
      articleType: 'news',
      content: 'This article body is long enough to be valid during lifecycle testing.',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const submitted = await request(app).post(`${BASE}/${id}/submit`).set(AUTHED);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('review');

    const published = await request(app).post(`${BASE}/${id}/publish`).set(AUTHED);
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('published');
    expect(published.body.data.published_at).toBeTruthy();

    const archived = await request(app).post(`${BASE}/${id}/archive`).set(AUTHED);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  it('publish requires articles.publish permission', async () => {
    seedAdmin(fake, ['articles.read', 'articles.create', 'articles.update']);
    const created = await request(app).post(BASE).set(AUTHED).send({
      title: 'Another test article',
      articleType: 'news',
      content: 'Body long enough for the lifecycle guard test article.',
    });
    const id = created.body.data.id as string;
    await request(app).post(`${BASE}/${id}/submit`).set(AUTHED);
    const res = await request(app).post(`${BASE}/${id}/publish`).set(AUTHED);
    expect(res.status).toBe(403);
  });

  it('schedule requires a future datetime payload', async () => {
    const created = await request(app).post(BASE).set(AUTHED).send({
      title: 'Scheduled test article',
      articleType: 'news',
      content: 'Enough content for the schedule validation path.',
    });
    const id = created.body.data.id as string;
    const res = await request(app).post(`${BASE}/${id}/schedule`).set(AUTHED).send({});
    expect(res.status).toBe(400);
  });
});
