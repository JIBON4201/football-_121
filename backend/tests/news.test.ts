import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';
import type { FakeClient } from './fake';

describe('news API', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
  });

  it('lists published articles with pagination envelope', async () => {
    const res = await request(app).get('/api/v1/news');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(res.body.requestId).toBeDefined();
    expect(res.headers['cache-control']).toContain('public');
  });

  it('always constrains queries to published content', async () => {
    await request(app).get('/api/v1/news?type=news');
    const articlesQuery = fake.queries.find((q) => q.table === 'articles');
    expect(articlesQuery).toBeDefined();
    expect(articlesQuery!.ops).toContainEqual({ op: 'eq', args: ['status', 'published'] });
    expect(articlesQuery!.ops).toContainEqual({ op: 'not', args: ['published_at', 'is', null] });
  });

  it('clamps excessive page sizes to the server maximum', async () => {
    const res = await request(app).get('/api/v1/news?limit=9999');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });

  it('rejects invalid enum filters and pagination', async () => {
    for (const path of ['/api/v1/news?type=bogus', '/api/v1/news?page=0', '/api/v1/news?limit=abc']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('filters by article type', async () => {
    const res = await request(app).get('/api/v1/news?type=transfer');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('transfer-news');
  });

  it('filters by related team slug', async () => {
    const res = await request(app).get('/api/v1/news?team=fc-example');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('big-win');
  });

  it('returns empty list for unknown relation slugs', async () => {
    const res = await request(app).get('/api/v1/news?team=no-such-team');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('treats search input as a literal value', async () => {
    const res = await request(app).get('/api/v1/news?q=win;SELECT');
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
  });

  it('returns a published article by slug', async () => {
    const res = await request(app).get('/api/v1/news/big-win');
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('big-win');
  });

  it('hides drafts behind 404', async () => {
    const res = await request(app).get('/api/v1/news/draft-piece');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malicious slugs with 400', async () => {
    const res = await request(app).get(`/api/v1/news/${encodeURIComponent("'; DROP TABLE articles;--")}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
