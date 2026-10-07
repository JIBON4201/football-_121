import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, installTestEnv } from './helpers';

describe('categories and tags', () => {
  beforeEach(() => {
    installTestEnv();
  });

  it('categories list active only', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('pl-news');
  });

  it('category detail hides inactive entries', async () => {
    const found = await request(app).get('/api/v1/categories/pl-news');
    expect(found.status).toBe(200);

    const hidden = await request(app).get('/api/v1/categories/old-news');
    expect(hidden.status).toBe(404);
  });

  it('tags list and detail work', async () => {
    const list = await request(app).get('/api/v1/tags');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const detail = await request(app).get('/api/v1/tags/goals');
    expect(detail.status).toBe(200);

    const missing = await request(app).get('/api/v1/tags/nope');
    expect(missing.status).toBe(404);
  });
});
